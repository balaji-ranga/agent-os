#!/usr/bin/env bash
# Live CRM SSO shape: workspace apply token, not Twenty /verify JWT.
# Run from VPS deploy (backend container) or:
#   docker compose exec -T -w /opt/agent-os/backend backend node scripts/vps-verify-crm-sso.js
set -euo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
if docker compose exec -T -w /opt/agent-os/backend backend test -f scripts/vps-verify-crm-sso.js 2>/dev/null; then
  docker compose exec -T -w /opt/agent-os/backend backend node scripts/vps-verify-crm-sso.js
else
  echo "WARN: backend/scripts/vps-verify-crm-sso.js missing in image"
  exit 0
fi
