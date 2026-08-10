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
# Twenty SPA host root on dedicated CRM subdomain crm.<apex> (never marketing www/apex).
CRM_PUBLIC_HOST="${TWENTY_PUBLIC_HOST:-}"
if [[ -z "$CRM_PUBLIC_HOST" ]]; then
  if [[ "$PUBLIC_HOST" == login.* ]]; then
    CRM_PUBLIC_HOST="crm.${PUBLIC_HOST#login.}"
  elif [[ "$PUBLIC_HOST" == www.* ]]; then
    CRM_PUBLIC_HOST="crm.${PUBLIC_HOST#www.}"
  else
    CRM_PUBLIC_HOST="crm.${PUBLIC_HOST}"
  fi
fi
# Force-correct known-broken path embeds (upsert skips non-empty values)
if grep -qE '^TWENTY_SERVER_URL=.*/crm-app' "$ENV_FILE" 2>/dev/null \
  || grep -qE '^TWENTY_SERVER_URL=.*:8443' "$ENV_FILE" 2>/dev/null \
  || grep -qE '^TWENTY_SERVER_URL=.*//www\\.' "$ENV_FILE" 2>/dev/null \
  || ! grep -qE '^TWENTY_SERVER_URL=' "$ENV_FILE" 2>/dev/null; then
  if grep -qE '^TWENTY_SERVER_URL=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^TWENTY_SERVER_URL=.*#TWENTY_SERVER_URL=https://${CRM_PUBLIC_HOST}#" "$ENV_FILE"
  else
    printf '\nTWENTY_SERVER_URL=https://%s\n' "$CRM_PUBLIC_HOST" >> "$ENV_FILE"
  fi
  echo "ensure-business-core-env: TWENTY_SERVER_URL=https://${CRM_PUBLIC_HOST}"
fi
if grep -qE '^TWENTY_EMBED_URL=.*/crm-app' "$ENV_FILE" 2>/dev/null \
  || grep -qE '^TWENTY_EMBED_URL=.*:8443' "$ENV_FILE" 2>/dev/null \
  || grep -qE '^TWENTY_EMBED_URL=.*//www\\.' "$ENV_FILE" 2>/dev/null \
  || ! grep -qE '^TWENTY_EMBED_URL=' "$ENV_FILE" 2>/dev/null; then
  if grep -qE '^TWENTY_EMBED_URL=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^TWENTY_EMBED_URL=.*#TWENTY_EMBED_URL=https://${CRM_PUBLIC_HOST}#" "$ENV_FILE"
  else
    printf '\nTWENTY_EMBED_URL=https://%s\n' "$CRM_PUBLIC_HOST" >> "$ENV_FILE"
  fi
  echo "ensure-business-core-env: TWENTY_EMBED_URL=https://${CRM_PUBLIC_HOST}"
fi
upsert TWENTY_SERVER_URL "https://${CRM_PUBLIC_HOST}"
upsert TWENTY_EMBED_URL "https://${CRM_PUBLIC_HOST}"
# ERP public host on :443 (Hostinger edges often drop :8444). Prefer apex erp.<domain>
# once DNS+SAN exist; default to erp.crm.<apex> which reuses DNS wildcard *.crm.<apex>.
if [[ "$PUBLIC_HOST" == login.* ]]; then
  APEX_FOR_ERP="${PUBLIC_HOST#login.}"
elif [[ "$PUBLIC_HOST" == www.* ]]; then
  APEX_FOR_ERP="${PUBLIC_HOST#www.}"
else
  APEX_FOR_ERP="${PUBLIC_HOST}"
fi
ERP_PUBLIC_HOST="${ERPNEXT_PUBLIC_HOST:-erp.crm.${APEX_FOR_ERP}}"
# Force-correct known-broken alternate-port embeds (same as Twenty :8443 fix)
if grep -qE '^ERPNEXT_EMBED_URL=.*:8444' "$ENV_FILE" 2>/dev/null \
  || grep -qE '^ERPNEXT_PUBLIC_URL=.*:8444' "$ENV_FILE" 2>/dev/null \
  || ! grep -qE '^ERPNEXT_EMBED_URL=' "$ENV_FILE" 2>/dev/null; then
  if grep -qE '^ERPNEXT_EMBED_URL=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^ERPNEXT_EMBED_URL=.*#ERPNEXT_EMBED_URL=https://${ERP_PUBLIC_HOST}#" "$ENV_FILE"
  else
    printf '\nERPNEXT_EMBED_URL=https://%s\n' "$ERP_PUBLIC_HOST" >> "$ENV_FILE"
  fi
  if grep -qE '^ERPNEXT_PUBLIC_URL=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s#^ERPNEXT_PUBLIC_URL=.*#ERPNEXT_PUBLIC_URL=https://${ERP_PUBLIC_HOST}#" "$ENV_FILE"
  else
    printf '\nERPNEXT_PUBLIC_URL=https://%s\n' "$ERP_PUBLIC_HOST" >> "$ENV_FILE"
  fi
  echo "ensure-business-core-env: ERPNEXT_*_URL=https://${ERP_PUBLIC_HOST}"
fi
upsert ERPNEXT_PUBLIC_URL "https://${ERP_PUBLIC_HOST}"
upsert ERPNEXT_EMBED_URL "https://${ERP_PUBLIC_HOST}"
# APP_SECRET must match Twenty container APP_SECRET (upsert only fills empty; never rotate on re-run)
upsert TWENTY_APP_SECRET "$(openssl rand -hex 24 2>/dev/null || echo 'change-me-twenty-app-secret-min-32-chars-xx')"
upsert TWENTY_DB_USER 'twenty'
upsert TWENTY_DB_NAME 'twenty'
upsert TWENTY_DB_PASSWORD 'twenty'
upsert TWENTY_SSO_ENABLED "1"
# Same Redis as twenty-server — Flolah DELs flatWorkspaceMemberMaps after JIT membership SQL.
upsert TWENTY_REDIS_URL "redis://twenty-redis:6379"
upsert TWENTY_IS_MULTIWORKSPACE_ENABLED "true"
# Multi-workspace: browser API base = current origin ({sub}.crm.*) not fixed apex URL
if grep -qE '^TWENTY_FRONT_AUTO_BASE_URL=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s#^TWENTY_FRONT_AUTO_BASE_URL=.*#TWENTY_FRONT_AUTO_BASE_URL=true#" "$ENV_FILE" 2>/dev/null \
    || sed -i '' "s#^TWENTY_FRONT_AUTO_BASE_URL=.*#TWENTY_FRONT_AUTO_BASE_URL=true#" "$ENV_FILE"
else
  printf '\nTWENTY_FRONT_AUTO_BASE_URL=true\n' >> "$ENV_FILE"
fi
# Optional: TWENTY_BOOTSTRAP_EMAIL for signing up new workspaces (otherwise first ACTIVE admin is used)
# Build DATABASE_URL from TWENTY_DB_* so JIT SSO provision hits the same Postgres as Twenty
_tuser="$(grep -E '^TWENTY_DB_USER=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
_tpass="$(grep -E '^TWENTY_DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
_tdb="$(grep -E '^TWENTY_DB_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
_tuser="${_tuser:-twenty}"
_tpass="${_tpass:-twenty}"
_tdb="${_tdb:-twenty}"
upsert TWENTY_DATABASE_URL "postgres://${_tuser}:${_tpass}@twenty-db:5432/${_tdb}"
# Do not rely on TWENTY_WORKSPACE_ID for multi-tenant: each Flolah company binds its own UUID via ensureCompanyTwentyWorkspace
upsert ERPNEXT_DB_ROOT_PASSWORD 'admin'
upsert BUSINESS_CORE_MCP_URL 'http://business-core-mcp:8082/mcp'

# Do not invent TWENTY_API_KEY / ERPNEXT_API_* — operator fills after first login.
# After stack is up, recreate backend so TWENTY_APP_SECRET + TWENTY_DATABASE_URL + TWENTY_SSO_* are injected.

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
  echo "==> start optional-erpnext (MariaDB + configurator + create-site + gunicorn + workers)"
  upsert ERPNEXT_URL 'http://erpnext-frontend:8080'
# Prefer frontend nginx (assets + FRAPPE_SITE_NAME_HEADER). Bare gunicorn breaks Node Host.
  upsert ERPNEXT_SITE_NAME 'frontend'
  upsert ERPNEXT_SSO_ENABLED '1'
  upsert ERPNEXT_ADMIN_PASSWORD 'admin'
  docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.business-core.yml \
    --profile optional-erpnext up -d \
    || echo "ensure-business-core-env: WARN erpnext up failed"
  echo "ensure-business-core-env: after site is healthy, create API Key+Secret in Desk → set ERPNEXT_API_KEY/SECRET"
fi

# Recreate backend so it picks embed env
docker compose --env-file "$ENV_FILE" up -d --no-deps --force-recreate backend \
  || docker compose --env-file "$ENV_FILE" restart backend \
  || true

echo "ENSURE_BUSINESS_CORE_ENV_DONE public_host=${PUBLIC_HOST}"