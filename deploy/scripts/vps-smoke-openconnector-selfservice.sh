#!/usr/bin/env bash
# Smoke: OpenConnector self-service (public origin, admin console gate, façade, HN).
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
ENV_FILE="$ROOT/deploy/.env"

get_env() {
  local key="$1"
  grep "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true
}

PUBLIC_URL="$(get_env AGENT_OS_PUBLIC_URL)"
PUBLIC_URL="${PUBLIC_URL%/}"
OC_PUBLIC="$(get_env OPENCONNECTOR_PUBLIC_ORIGIN)"
OC_ORIGIN="$(get_env OOMOL_CONNECT_ORIGIN)"
echo "==> OpenConnector self-service smoke"
echo "    AGENT_OS_PUBLIC_URL=$PUBLIC_URL"
echo "    OPENCONNECTOR_PUBLIC_ORIGIN=$OC_PUBLIC"
echo "    OOMOL_CONNECT_ORIGIN=$OC_ORIGIN"

if [[ -z "$OC_PUBLIC" || "$OC_PUBLIC" != *"/openconnector"* ]]; then
  echo "ERROR: OPENCONNECTOR_PUBLIC_ORIGIN must be set to …/openconnector (run vps-enable-real-openconnector.sh)"
  exit 1
fi

echo "==> /openconnector/ without cookie → 401"
code=$(curl -ksS -o /dev/null -w "%{http_code}" "${PUBLIC_URL}/openconnector/" || true)
if [[ "$code" != "401" ]]; then
  echo "ERROR: expected 401 for console without admin cookie, got $code"
  exit 1
fi
echo "    ok ($code)"

echo "==> /openconnector/oauth/callback is reachable (not admin-gated)"
code=$(curl -ksS -o /dev/null -w "%{http_code}" "${PUBLIC_URL}/openconnector/oauth/callback" || true)
if [[ "$code" == "401" ]]; then
  echo "ERROR: oauth callback returned 401 (admin gate incorrectly applied)"
  exit 1
fi
echo "    ok (http $code)"

echo "==> Façade: CEO aliases + HN execute"
docker compose exec -T backend node scripts/test-openconnector-selfservice.js

echo "SELF_SERVICE_SMOKE_OK"
