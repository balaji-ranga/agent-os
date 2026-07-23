#!/usr/bin/env bash
# Build, bootstrap, and start Agent OS (Docker Compose or Podman Compose).
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${DEPLOY_DIR}"

COMPOSE="${COMPOSE_CMD:-docker compose}"
if command -v podman-compose >/dev/null 2>&1 && [[ "${USE_PODMAN:-0}" == "1" ]]; then
  COMPOSE="podman-compose"
fi

if [[ ! -f .env ]]; then
  echo "Copy .env.example to .env and edit secrets first." >&2
  exit 1
fi

echo "Ensuring TOOLS_API_KEY + AGENT_OS_INTERNAL_TOKEN + TOOLS_BASE_URL in deploy/.env..."
node "${DEPLOY_DIR}/../scripts/ensure-deploy-secrets.js" --env-file "${DEPLOY_DIR}/.env"

if [[ ! -f nginx/certs/fullchain.pem ]]; then
  echo "TLS certs missing — generating dev self-signed certs..."
  bash scripts/generate-dev-certs.sh
fi

echo "Building images..."
${COMPOSE} build

echo "Running one-shot bootstrap (init profile)..."
${COMPOSE} --profile init run --rm init

echo "Starting stack..."
${COMPOSE} up -d "$@"

# Optional: wait for backend and register OpenConnector MCP when URL is configured.
if grep -qE '^OPENCONNECTOR_MCP_URL=.+' .env 2>/dev/null; then
  OC_URL="$(grep -E '^OPENCONNECTOR_MCP_URL=' .env | head -1 | cut -d= -f2-)"
  if [[ -n "${OC_URL}" ]]; then
    echo "Waiting for backend health before OpenConnector MCP seed..."
    for i in $(seq 1 60); do
      if ${COMPOSE} exec -T backend curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
        break
      fi
      sleep 2
    done
    echo "Seeding OpenConnector MCP (${OC_URL})..."
    ${COMPOSE} exec -T backend node scripts/seed-openconnector-mcp.js || \
      echo "OpenConnector seed skipped/failed — start optional-openconnector or fix OPENCONNECTOR_MCP_URL, then re-run seed."
  fi
fi

echo ""
echo "Stack started. Check: ${COMPOSE} ps"
echo "Health: curl -k https://localhost/health  (or http://localhost:8080 with docker-compose.dev.yml)"
echo "APIs (via nginx /api): master-data, feedback, openconnector, email-inbound, BYOK LLM,"
echo "  email_send (/api/tools/email-send), notify_ceo (/api/tools/notify-ceo),"
echo "  broadcast (/api/broadcast) — UI /broadcast; CEO-scoped so notify_ceo works,"
echo "  org sync (/api/agents/org/sync) — Dashboard: Resync ORG.md & AGENTS.md,"
echo "  master_data_* content tools, shared notification dismiss (NotificationProvider),"
echo "  notification bell shows datetime; CEO Policies (/policies) → POLICY.md + Brain,"
echo "  deploy verify smokes self-clean CEO UI,"
echo "  /standups/notifications/dismiss[-all] + /platform-notifications/read[-all],"
echo "  AgentExchange (/api/agent-exchange),"
echo "  workflow A2A (/api/a2a/:publishId + card; secured: /oauth/token client credentials)"
echo "Post-deploy smoke (on VPS): bash scripts/vps-smoke-new-features.sh"
echo "Broadcast notify smoke: bash scripts/vps-smoke-broadcast-notify.sh"
echo "Platform verify (on VPS): bash scripts/vps-verify-platform.sh"
echo "Clean rebuild if UI markers missing: NO_CACHE=1 bash scripts/vps-deploy-latest.sh"
