#!/usr/bin/env bash
# Platform MCP connectors (Brave Search BYOK + Facebook / Meta Graph OAuth + Business Core CRM/ERP).
# Idempotent: keeps deploy/.env keys, starts optional compose profiles, seeds registry.
#
# Usage:
#   bash deploy/scripts/ensure-platform-mcps.sh [/path/to/deploy/.env]
#   SKIP_PLATFORM_MCPS=1 bash deploy/scripts/ensure-platform-mcps.sh   # env keys only
#   PLATFORM_MCP_BUILD=0 bash ...                                      # up/seed, skip rebuild
#
# Called from up.sh and vps-deploy-latest.sh after backend is healthy.
set -euo pipefail

ENV_FILE="${1:-}"
if [[ -z "$ENV_FILE" ]]; then
  ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
fi
ROOT="${AGENT_OS_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
SKIP_PLATFORM_MCPS="${SKIP_PLATFORM_MCPS:-0}"
PLATFORM_MCP_BUILD="${PLATFORM_MCP_BUILD:-1}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ensure-platform-mcps: missing $ENV_FILE (skip)" >&2
  exit 0
fi

upsert() {
  local key="$1"
  local val="$2"
  if grep -qE "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return 0
  fi
  printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  echo "ensure-platform-mcps: added $key"
}

# Default internal Docker DNS URLs (platform MCP containers)
upsert BRAVE_MCP_URL 'http://brave-search-mcp:8080/mcp'
upsert META_GRAPH_MCP_URL 'http://meta-graph-mcp:8081/mcp'
upsert BUSINESS_CORE_MCP_URL 'http://business-core-mcp:8082/mcp'
upsert SOCIAL_RESEARCH_MCP_URL 'http://social-research-mcp:8084/mcp'
upsert INSTALOADER_URL 'http://instaloader-sidecar:8083'
# FACEBOOK_APP_ID / FACEBOOK_APP_SECRET / MCP_OAUTH_CALLBACK_URL are operator secrets — do not invent.

if ! grep -q 'optional-meta-graph-mcp' "$ENV_FILE" 2>/dev/null; then
  cat >> "$ENV_FILE" <<'EOF'

# ---- Platform MCPs (Compose profiles optional-brave-mcp + optional-meta-graph-mcp + optional-business-core-mcp + optional-social-research-mcp) ----
# ensure-platform-mcps.sh starts containers + seeds mcp-brave-search / mcp-meta-graph / mcp-flolah-crm / mcp-flolah-erp / mcp-social-research (is_platform=1).
# Brave: workflow/node BYOK headers (no BRAVE_API_KEY in MCP container).
# Facebook: admin FACEBOOK_APP_* or Connectors → MCPs (platform App; CEOs may override App ID/secret); each CEO Connects.
# Business Core: CRM (Twenty) + ERP (ERPNext) tools; pass X-Ceo-User-Id. Prefab Maker/Checker AI employees when Profile selects platform.
# Social Research: Places + Instaloader + indexed search; pass X-Ceo-User-Id. Docs: knowledgebase/platform-help/42-social-research-business-discovery.md
# SKIP_PLATFORM_MCPS=1 to skip containers/seeds. Docs: knowledgebase/platform-help/32-business-core-crm-erp.md (+ 08, 31)
# BRAVE_MCP_URL=http://brave-search-mcp:8080/mcp
# META_GRAPH_MCP_URL=http://meta-graph-mcp:8081/mcp
# BUSINESS_CORE_MCP_URL=http://business-core-mcp:8082/mcp
# SOCIAL_RESEARCH_MCP_URL=http://social-research-mcp:8084/mcp
# INSTALOADER_URL=http://instaloader-sidecar:8083
# FACEBOOK_APP_ID=
# FACEBOOK_APP_SECRET=
# MCP_OAUTH_CALLBACK_URL=https://login.example.com/api/integrations/mcp/oauth/callback
EOF
  echo "ensure-platform-mcps: added platform MCP comment block"
fi

if [[ "$SKIP_PLATFORM_MCPS" == "1" || "$SKIP_PLATFORM_MCPS" == "true" ]]; then
  echo "ensure-platform-mcps: SKIP_PLATFORM_MCPS=1 — env only"
  echo "ENSURE_PLATFORM_MCPS_DONE skip_containers=1"
  exit 0
fi

cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml}"

BUILD_ARGS=()
if [[ "${NO_CACHE:-0}" == "1" ]]; then
  BUILD_ARGS+=(--no-cache)
fi

wait_backend() {
  for i in $(seq 1 40); do
    if docker compose --env-file "$ENV_FILE" exec -T backend curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "ensure-platform-mcps: WARN backend not healthy — seeds may fail" >&2
  return 1
}

echo "==> platform MCPs: Brave Search + Meta Graph + Business Core (CRM/ERP) + Social Research"

if [[ -f "$ROOT/tools/brave-search-mcp-byok/server.js" ]]; then
  if [[ "$PLATFORM_MCP_BUILD" == "1" ]]; then
    docker compose --env-file "$ENV_FILE" --profile optional-brave-mcp build "${BUILD_ARGS[@]}" brave-search-mcp \
      || echo "ensure-platform-mcps: WARN brave-search-mcp build failed"
  fi
  docker compose --env-file "$ENV_FILE" --profile optional-brave-mcp up -d --force-recreate brave-search-mcp \
    || echo "ensure-platform-mcps: WARN brave-search-mcp up failed"
else
  echo "ensure-platform-mcps: WARN missing tools/brave-search-mcp-byok/server.js"
fi

if [[ -f "$ROOT/tools/meta-graph-mcp/server.js" ]]; then
  if [[ "$PLATFORM_MCP_BUILD" == "1" ]]; then
    docker compose --env-file "$ENV_FILE" --profile optional-meta-graph-mcp build "${BUILD_ARGS[@]}" meta-graph-mcp \
      || echo "ensure-platform-mcps: WARN meta-graph-mcp build failed"
  fi
  docker compose --env-file "$ENV_FILE" --profile optional-meta-graph-mcp up -d --force-recreate meta-graph-mcp \
    || echo "ensure-platform-mcps: WARN meta-graph-mcp up failed"
else
  echo "ensure-platform-mcps: WARN missing tools/meta-graph-mcp/server.js"
fi

if [[ -f "$ROOT/tools/business-core-mcp/server.js" ]]; then
  if [[ "$PLATFORM_MCP_BUILD" == "1" ]]; then
    docker compose --env-file "$ENV_FILE" --profile optional-business-core-mcp build "${BUILD_ARGS[@]}" business-core-mcp \
      || echo "ensure-platform-mcps: WARN business-core-mcp build failed"
  fi
  docker compose --env-file "$ENV_FILE" --profile optional-business-core-mcp up -d --force-recreate business-core-mcp \
    || echo "ensure-platform-mcps: WARN business-core-mcp up failed"
else
  echo "ensure-platform-mcps: WARN missing tools/business-core-mcp/server.js"
fi

if [[ -f "$ROOT/tools/instaloader-sidecar/server.py" ]]; then
  if [[ "$PLATFORM_MCP_BUILD" == "1" ]]; then
    docker compose --env-file "$ENV_FILE" --profile optional-social-research-mcp build "${BUILD_ARGS[@]}" instaloader-sidecar \
      || echo "ensure-platform-mcps: WARN instaloader-sidecar build failed"
  fi
  docker compose --env-file "$ENV_FILE" --profile optional-social-research-mcp up -d --force-recreate instaloader-sidecar \
    || echo "ensure-platform-mcps: WARN instaloader-sidecar up failed"
else
  echo "ensure-platform-mcps: WARN missing tools/instaloader-sidecar/server.py"
fi

if [[ -f "$ROOT/tools/social-research-mcp/server.js" ]]; then
  if [[ "$PLATFORM_MCP_BUILD" == "1" ]]; then
    docker compose --env-file "$ENV_FILE" --profile optional-social-research-mcp build "${BUILD_ARGS[@]}" social-research-mcp \
      || echo "ensure-platform-mcps: WARN social-research-mcp build failed"
  fi
  docker compose --env-file "$ENV_FILE" --profile optional-social-research-mcp up -d --force-recreate social-research-mcp \
    || echo "ensure-platform-mcps: WARN social-research-mcp up failed"
else
  echo "ensure-platform-mcps: WARN missing tools/social-research-mcp/server.js"
fi

# Wait for MCP health endpoints (non-fatal)
for svc_port in "brave-search-mcp:8080" "meta-graph-mcp:8081" "business-core-mcp:8082" "social-research-mcp:8084"; do
  svc="${svc_port%%:*}"
  port="${svc_port##*:}"
  ok=0
  for i in $(seq 1 20); do
    if docker compose --env-file "$ENV_FILE" exec -T "$svc" \
      node -e "fetch('http://127.0.0.1:${port}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      echo "    $svc healthy"
      ok=1
      break
    fi
    sleep 2
  done
  if [[ "$ok" != "1" ]]; then
    echo "ensure-platform-mcps: WARN $svc not healthy yet"
  fi
done

wait_backend || true

if [[ -f "$ROOT/backend/scripts/seed-brave-search-mcp.js" ]]; then
  echo "==> seed mcp-brave-search (platform)"
  docker compose --env-file "$ENV_FILE" exec -T backend \
    node scripts/seed-brave-search-mcp.js \
    || echo "ensure-platform-mcps: WARN seed-brave-search-mcp failed"
fi

if [[ -f "$ROOT/backend/scripts/seed-meta-graph-mcp.js" ]]; then
  echo "==> seed mcp-meta-graph + OAuth config (platform)"
  docker compose --env-file "$ENV_FILE" exec -T backend \
    node scripts/seed-meta-graph-mcp.js \
    || echo "ensure-platform-mcps: WARN seed-meta-graph-mcp failed"
fi

if [[ -f "$ROOT/backend/scripts/seed-business-core-mcp.js" ]]; then
  echo "==> seed mcp-flolah-crm + mcp-flolah-erp (platform Business Core)"
  docker compose --env-file "$ENV_FILE" exec -T \
    -e BUSINESS_CORE_MCP_URL="${BUSINESS_CORE_MCP_URL:-http://business-core-mcp:8082/mcp}" \
    backend node scripts/seed-business-core-mcp.js \
    || echo "ensure-platform-mcps: WARN seed-business-core-mcp failed"
fi

if [[ -f "$ROOT/backend/scripts/seed-social-research-mcp.js" ]]; then
  echo "==> seed mcp-social-research (platform)"
  docker compose --env-file "$ENV_FILE" exec -T \
    -e SOCIAL_RESEARCH_MCP_URL="${SOCIAL_RESEARCH_MCP_URL:-http://social-research-mcp:8084/mcp}" \
    backend node scripts/seed-social-research-mcp.js \
    || echo "ensure-platform-mcps: WARN seed-social-research-mcp failed"
fi

echo "ENSURE_PLATFORM_MCPS_DONE"