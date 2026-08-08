#!/usr/bin/env bash
# Ensure Business Core env + optional Twenty (and ERP stack when requested).
# Idempotent. Call from up.sh / vps-deploy-latest or manually:
#   bash deploy/scripts/ensure-business-core-env.sh
#   START_TWENTY=1 bash deploy/scripts/ensure-business-core-env.sh
#   START_ERPNEXT=1 bash ...
set -euo pipefail

ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
fi
ROOT="${AGENT_OS_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
START_TWENTY="${START_TWENTY:-1}"
START_ERPNEXT="${START_ERPNEXT:-0}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ensure-business-core-env: missing $ENV_FILE (skip)" >&2
  exit 0
fi

upsert() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    # only fill empty values
    local cur
    cur="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2-)"
    if [[ -z "${cur// /}" ]]; then
      if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s#^${key}=.*#${key}=${val}#" "$ENV_FILE"
      else
        sed -i "s#^${key}=.*#${key}=${val}#" "$ENV_FILE"
      fi
      echo "ensure-business-core-env: set empty $key"
    fi
    return 0
  fi
  printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  echo "ensure-business-core-env: added $key"
}

# Public app host for HTTPS proxies (same cert as login)
PUBLIC_HOST="$(grep -E '^(AGENT_OS_PUBLIC_URL|AGENT_OS_BASE_URL)=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's#https\?://##;s#/.*##')"
PUBLIC_HOST="${PUBLIC_HOST:-login.flolah.cloud}"

upsert TWENTY_PUBLIC_HTTPS_PORT '8443'
upsert ERPNEXT_PUBLIC_HTTPS_PORT '8444'
upsert TWENTY_HOST_PORT '3100'
upsert ERPNEXT_HOST_PORT '8085'
upsert TWENTY_API_URL 'http://twenty-server:3000'
# Prefer same-origin :443 path (Hostinger often does not pass non-443 ports to the VPS)
upsert TWENTY_SERVER_URL "https://${PUBLIC_HOST}/crm-app"
upsert TWENTY_EMBED_URL "https://${PUBLIC_HOST}/crm-app"
upsert ERPNEXT_PUBLIC_URL "https://${PUBLIC_HOST}:8444"
upsert ERPNEXT_EMBED_URL "https://${PUBLIC_HOST}:8444"
upsert TWENTY_APP_SECRET "$(openssl rand -hex 24 2>/dev/null || echo 'change-me-twenty-app-secret-min-32-chars-xx')"
upsert TWENTY_DB_PASSWORD 'twenty'
upsert ERPNEXT_DB_ROOT_PASSWORD 'admin'
upsert BUSINESS_CORE_MCP_URL 'http://business-core-mcp:8082/mcp'

# Do not invent TWENTY_API_KEY / ERPNEXT_API_* — operator fills after first login.

if [[ "${SKIP_BUSINESS_CORE_STACK:-0}" == "1" ]]; then
  echo "ensure-business-core-env: env only (SKIP_BUSINESS_CORE_STACK=1)"
  exit 0
fi

cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml:docker-compose.business-core.yml}"

if [[ "$START_TWENTY" == "1" || "$START_TWENTY" == "true" ]]; then
  echo "==> start optional-twenty (Postgres + Twenty server)"
  docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.business-core.yml \
    --profile optional-twenty up -d twenty-db twenty-redis twenty-server twenty-worker \
    || echo "ensure-business-core-env: WARN twenty up failed"
fi

if [[ "$START_ERPNEXT" == "1" || "$START_ERPNEXT" == "true" ]]; then
  echo "==> start optional-erpnext (MariaDB + stub backend — site init still required)"
  docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.business-core.yml \
    --profile optional-erpnext up -d \
    || echo "ensure-business-core-env: WARN erpnext up failed"
fi

# Recreate backend so it picks embed env
docker compose --env-file "$ENV_FILE" up -d --no-deps --force-recreate backend \
  || docker compose --env-file "$ENV_FILE" restart backend \
  || true

echo "ENSURE_BUSINESS_CORE_ENV_DONE public_host=${PUBLIC_HOST}"