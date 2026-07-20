#!/usr/bin/env bash
# Post-deploy smoke: Broadcast → TechResearcher → notify_ceo (CEO-scoped session).
# Requires OpenClaw gateway + notify_ceo grants (backend boot).
#
# Usage (on VPS, from deploy/):
#   bash scripts/vps-smoke-broadcast-notify.sh
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
PUBLIC_URL="${AGENT_OS_PUBLIC_URL:-https://127.0.0.1}"

echo "==> smoke: Broadcast → TechResearcher notify_ceo"

SMOKE_JS="/opt/agent-os/backend/scripts/test-broadcast-notify-ceo.js"
if ! docker compose exec -T backend test -f "$SMOKE_JS"; then
  echo "WARN: $SMOKE_JS missing in image — sync backend/scripts then rebuild backend"
  exit 0
fi

# TechResearcher template must document notify_ceo (synced into tenant workspaces on ensure)
if docker compose exec -T -w /opt/agent-os backend test -f openclaw-workspace-templates/techresearcher/TOOLS.md; then
  if docker compose exec -T -w /opt/agent-os backend grep -q notify_ceo openclaw-workspace-templates/techresearcher/TOOLS.md; then
    echo "    techresearcher TOOLS.md documents notify_ceo OK"
  else
    echo "WARN: techresearcher TOOLS.md missing notify_ceo — workspace sync may be stale"
  fi
else
  echo "WARN: techresearcher TOOLS.md not in image"
fi

# SPA route
spa=$(curl -ksS -o /dev/null -w '%{http_code}' "${PUBLIC_URL%/}/broadcast" 2>/dev/null \
  || curl -ksS -o /dev/null -w '%{http_code}' https://127.0.0.1/broadcast \
  || echo 000)
echo "    GET /broadcast (SPA) -> HTTP ${spa}"

if docker compose exec -T frontend sh -c 'grep -Rql Broadcast /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend assets: Broadcast page OK"
else
  echo "    WARN: Broadcast not found in frontend JS (rebuild frontend?)"
fi

# Unauth broadcast must be 401
BC_UNAUTH=$(curl -ksS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"message":"x"}' "${PUBLIC_URL%/}/api/broadcast" 2>/dev/null \
  || curl -ksS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  -d '{"message":"x"}' https://127.0.0.1/api/broadcast \
  || echo 000)
echo "    POST /api/broadcast (no auth) -> HTTP ${BC_UNAUTH} (expect 401)"

echo "==> live gateway: broadcast → techresearcher → notify_ceo"
docker compose exec -T -w /opt/agent-os/backend \
  -e TOOLS_BASE_URL=http://127.0.0.1:3001 \
  backend node "$SMOKE_JS"

echo "SMOKE_BROADCAST_NOTIFY_DONE"
