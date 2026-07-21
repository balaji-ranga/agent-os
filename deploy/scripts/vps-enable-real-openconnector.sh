#!/usr/bin/env bash
# Enable real self-hosted OpenConnector on VPS (profile optional-openconnector).
# Generates secrets in deploy/.env if missing, stops mock, starts OC, recreates backend, seeds MCP.
#
# Usage (on VPS):
#   bash /opt/agent-os/deploy/scripts/vps-enable-real-openconnector.sh
#   bash deploy/scripts/vps-enable-real-openconnector.sh --test   # also run smoke
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
ENV_FILE="$ROOT/deploy/.env"
RUN_TEST=0
[[ "${1:-}" == "--test" ]] && RUN_TEST=1

upsert_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

get_env() {
  local key="$1"
  grep "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found — copy .env.example first"
  exit 1
fi

echo "==> OpenConnector real enable $(date -Is)"

ADMIN_TOKEN="$(get_env OPENCONNECTOR_ADMIN_TOKEN)"
ENCRYPT_KEY="$(get_env OPENCONNECTOR_ENCRYPTION_KEY)"
if [[ -z "$ADMIN_TOKEN" ]]; then
  ADMIN_TOKEN="oc-admin-$(openssl rand -hex 24)"
  upsert_env OPENCONNECTOR_ADMIN_TOKEN "$ADMIN_TOKEN"
  echo "    generated OPENCONNECTOR_ADMIN_TOKEN"
fi
if [[ -z "$ENCRYPT_KEY" ]]; then
  ENCRYPT_KEY="$(openssl rand -hex 32)"
  upsert_env OPENCONNECTOR_ENCRYPTION_KEY "$ENCRYPT_KEY"
  echo "    generated OPENCONNECTOR_ENCRYPTION_KEY"
fi

PUBLIC_URL="$(get_env AGENT_OS_PUBLIC_URL)"
PUBLIC_URL="${PUBLIC_URL%/}"
# Browser-facing OC origin (OAuth callbacks + admin console via nginx /openconnector/)
OC_PUBLIC="${PUBLIC_URL}/openconnector"
if [[ -n "$PUBLIC_URL" ]]; then
  upsert_env OPENCONNECTOR_PUBLIC_ORIGIN "$OC_PUBLIC"
  upsert_env OOMOL_CONNECT_ORIGIN "$OC_PUBLIC"
  echo "    set OPENCONNECTOR_PUBLIC_ORIGIN=$OC_PUBLIC"
  echo "    set OOMOL_CONNECT_ORIGIN=$OC_PUBLIC"
fi

upsert_env OPENCONNECTOR_URL "http://openconnector:3000"
upsert_env OPENCONNECTOR_MCP_URL "http://openconnector:3000/mcp"
upsert_env OPENCONNECTOR_MCP_ID "mcp-openconnector"
upsert_env OPENCONNECTOR_MCP_TRANSPORT "streamable_http"

echo "==> Stop mock (optional-openconnector-mock)"
docker compose --profile optional-openconnector-mock stop openconnector-mcp-mock 2>/dev/null || true

echo "==> Pull and start real OpenConnector (with public OAuth origin)"
docker compose --profile optional-openconnector pull openconnector
docker compose --profile optional-openconnector up -d --force-recreate openconnector

echo "==> Wait for OpenConnector runtime"
ok=0
for i in $(seq 1 40); do
  if docker compose exec -T backend node -e "
const admin = '${ADMIN_TOKEN}';
fetch('http://openconnector:3000/api/actions', {
  headers: { Authorization: 'Bearer ' + admin },
  signal: AbortSignal.timeout(8000),
}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));
" 2>/dev/null; then
    ok=1
    echo "    openconnector healthy after ${i} tries"
    break
  fi
  sleep 3
done
if [[ "$ok" != "1" ]]; then
  echo "ERROR: openconnector not reachable from backend"
  docker compose --profile optional-openconnector ps openconnector
  docker compose --profile optional-openconnector logs openconnector --tail 40
  exit 1
fi

echo "==> Create bootstrap runtime token (admin API)"
RUNTIME_JSON=$(docker compose exec -T backend node -e "
const admin = '${ADMIN_TOKEN}';
const res = await fetch('http://openconnector:3000/api/runtime-tokens', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin },
  body: JSON.stringify({ name: 'agent-os-vps-bootstrap' }),
  signal: AbortSignal.timeout(30000),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(JSON.stringify(data));
  process.exit(1);
}
const token = data.token || data.runtime_token || data.plainToken || data.value || '';
if (!token) { console.error('no token in response', JSON.stringify(data)); process.exit(2); }
process.stdout.write(JSON.stringify({ token }));
")

RUNTIME_TOKEN=$(docker compose exec -T backend node -e "
const d = JSON.parse(process.argv[1]);
process.stdout.write(d.token || '');
" "$RUNTIME_JSON")
if [[ -z "$RUNTIME_TOKEN" ]]; then
  echo "ERROR: failed to create runtime token"
  exit 1
fi
upsert_env OPENCONNECTOR_MCP_BEARER "$RUNTIME_TOKEN"
echo "    runtime token created (stored in OPENCONNECTOR_MCP_BEARER for MCP seed)"

echo "==> Recreate backend + nginx (OPENCONNECTOR_* + /openconnector/ proxy)"
docker compose up -d --force-recreate backend nginx

echo "==> Wait for backend health"
for i in $(seq 1 30); do
  if docker compose exec -T backend curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
    echo "    backend healthy"
    break
  fi
  sleep 2
done

echo "==> Seed OpenConnector MCP registry"
docker compose exec -T backend node scripts/seed-openconnector-mcp.js

echo "==> Direct Hacker News action smoke (real OC, no OAuth)"
docker compose exec -T backend node -e "
const token = process.env.OPENCONNECTOR_MCP_BEARER || '${RUNTIME_TOKEN}';
const res = await fetch('http://openconnector:3000/v1/actions/hackernews.get_top_stories', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ input: {} }),
  signal: AbortSignal.timeout(60000),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) { console.error('HN failed', res.status, data); process.exit(1); }
console.log('HN ok sample:', JSON.stringify(data).slice(0, 200));
"

echo "ENABLE_REAL_OPENCONNECTOR_DONE"
if [[ "$RUN_TEST" == "1" ]]; then
  bash "$ROOT/deploy/scripts/vps-smoke-openconnector-real.sh"
fi
