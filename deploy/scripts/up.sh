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
echo "New APIs (via nginx /api): master-data, feedback, openconnector, email-inbound, BYOK LLM settings"
