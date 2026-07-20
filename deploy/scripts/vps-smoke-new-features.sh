#!/usr/bin/env bash
# Post-deploy smoke: email_send + notify_ceo + org sync + workflow A2A / AgentExchange.
# Runs inside the backend container (script is COPY'd via backend.Dockerfile).
#
# Usage (on VPS, from deploy/):
#   bash scripts/vps-smoke-new-features.sh
#   SKIP_SMOKE=1 bash scripts/vps-deploy-latest.sh   # skip from deploy-latest
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
PUBLIC_URL="${AGENT_OS_PUBLIC_URL:-https://127.0.0.1}"

echo "==> smoke: email_send + notify_ceo + org sync + workflow A2A / AgentExchange"

SMOKE_JS="/opt/agent-os/backend/scripts/vps-smoke-new-features.js"
if ! docker compose exec -T backend test -f "$SMOKE_JS"; then
  echo "WARN: $SMOKE_JS missing in image — copy backend/scripts then rebuild backend"
  exit 0
fi

docker compose exec -T -w /opt/agent-os/backend backend node "$SMOKE_JS"

# HTTP surfaces (nginx → backend)
HEALTH=$(curl -ksS -o /dev/null -w '%{http_code}' "${PUBLIC_URL%/}/api/health" 2>/dev/null \
  || curl -ksS -o /dev/null -w '%{http_code}' "https://127.0.0.1/api/health" \
  || echo 000)
echo "    GET /api/health -> HTTP ${HEALTH}"

EX_UNAUTH=$(curl -ksS -o /dev/null -w '%{http_code}' "${PUBLIC_URL%/}/api/agent-exchange" 2>/dev/null \
  || curl -ksS -o /dev/null -w '%{http_code}' "https://127.0.0.1/api/agent-exchange" \
  || echo 000)
echo "    GET /api/agent-exchange (no auth) -> HTTP ${EX_UNAUTH} (expect 401)"

ORG_UNAUTH=$(curl -ksS -o /dev/null -w '%{http_code}' -X POST "${PUBLIC_URL%/}/api/agents/org/sync" 2>/dev/null \
  || curl -ksS -o /dev/null -w '%{http_code}' -X POST "https://127.0.0.1/api/agents/org/sync" \
  || echo 000)
echo "    POST /api/agents/org/sync (no auth) -> HTTP ${ORG_UNAUTH} (expect 401)"

# SPA route should serve index (200) for AgentExchange
spa=$(curl -ksS -o /dev/null -w '%{http_code}' "${PUBLIC_URL%/}/agent-exchange" 2>/dev/null \
  || curl -ksS -o /dev/null -w '%{http_code}' https://127.0.0.1/agent-exchange \
  || echo 000)
echo "    GET /agent-exchange (SPA) -> HTTP ${spa}"

# Dashboard org resync button must be in the frontend bundle
if docker compose exec -T frontend sh -c 'grep -Rql "Resync ORG" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Resync ORG.md & AGENTS.md button OK"
else
  echo "    WARN: Resync ORG button not found in frontend JS (rebuild frontend?)"
fi

# Authenticated org sync (Dashboard button path)
TOKEN=$(docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE' 2>/dev/null || true
import { initDb, getDb } from './src/db/schema.js';
import { createSession } from './src/services/auth/session.js';
initDb();
const u = getDb().prepare("SELECT id FROM platform_users WHERE role='ceo' ORDER BY rowid LIMIT 1").get();
if (!u) process.exit(2);
process.stdout.write(createSession(u.id).token);
NODE
)
if [[ -n "${TOKEN:-}" ]]; then
  ORG_AUTH=$(docker compose exec -T backend curl -s -o /tmp/org-sync.json -w '%{http_code}' \
    -X POST -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
    http://127.0.0.1:3001/api/agents/org/sync || echo 000)
  echo "    POST /api/agents/org/sync (CEO auth) -> HTTP ${ORG_AUTH} (expect 200)"
  if [[ "$ORG_AUTH" == "200" ]]; then
    docker compose exec -T backend sh -c 'grep -o "\"ok\":true\|workspaces_synced" /tmp/org-sync.json | head -2' 2>/dev/null \
      || docker compose exec -T backend cat /tmp/org-sync.json 2>/dev/null | head -c 200 || true
    echo
  fi
fi

# email_send + notify_ceo must be in OpenClaw allowlists (parity script source of truth)
verify_allowlists() {
  docker compose exec -T -w /opt/agent-os openclaw node -e "
import { REQUIRED_GLOBAL_CONTENT_TOOLS, COO_CONTENT_TOOLS_ALLOW } from './scripts/lib/content-tools-allow.js';
for (const t of ['email_send', 'notify_ceo']) {
  if (!REQUIRED_GLOBAL_CONTENT_TOOLS.includes(t)) { console.error('missing REQUIRED_GLOBAL', t); process.exit(2); }
  if (!COO_CONTENT_TOOLS_ALLOW.includes(t)) { console.error('missing COO allow', t); process.exit(3); }
}
console.log('email_send + notify_ceo in REQUIRED_GLOBAL + COO allowlists OK');
"
}

if ! verify_allowlists 2>/dev/null; then
  docker compose exec -T openclaw node -e "
import { REQUIRED_GLOBAL_CONTENT_TOOLS, COO_CONTENT_TOOLS_ALLOW } from './scripts/lib/content-tools-allow.js';
for (const t of ['email_send', 'notify_ceo']) {
  if (!REQUIRED_GLOBAL_CONTENT_TOOLS.includes(t)) { console.error('missing REQUIRED_GLOBAL', t); process.exit(2); }
  if (!COO_CONTENT_TOOLS_ALLOW.includes(t)) { console.error('missing COO allow', t); process.exit(3); }
}
console.log('email_send + notify_ceo in REQUIRED_GLOBAL + COO allowlists OK');
" || echo "WARN: could not verify email_send/notify_ceo allowlist inside openclaw"
fi

echo "SMOKE_NEW_FEATURES_DONE"
