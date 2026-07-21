#!/usr/bin/env bash
# Smoke real OpenConnector via Agent OS facade + connector workflow node.
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

ENV_FILE="$ROOT/deploy/.env"
get_env() { grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

OC_URL="$(get_env OPENCONNECTOR_URL)"
RUNTIME_TOKEN="$(get_env OPENCONNECTOR_MCP_BEARER)"
ADMIN_TOKEN="$(get_env OPENCONNECTOR_ADMIN_TOKEN)"

if [[ -z "$OC_URL" || "$OC_URL" != *openconnector:3000* ]]; then
  echo "ERROR: OPENCONNECTOR_URL not set to real openconnector — run vps-enable-real-openconnector.sh first"
  exit 1
fi

if [[ -z "$RUNTIME_TOKEN" ]]; then
  echo "ERROR: OPENCONNECTOR_MCP_BEARER missing — run vps-enable-real-openconnector.sh first"
  exit 1
fi

echo "==> Real OpenConnector smoke (facade + workflow + HN execute)"
docker compose exec -T -w /opt/agent-os/backend \
  -e OPENCONNECTOR_URL="$OC_URL" \
  -e OPENCONNECTOR_MCP_URL="${OC_URL}/mcp" \
  -e OPENCONNECTOR_MCP_BEARER="$RUNTIME_TOKEN" \
  -e OPENCONNECTOR_MOCK_TOKEN="$RUNTIME_TOKEN" \
  -e OPENCONNECTOR_ADMIN_TOKEN="$ADMIN_TOKEN" \
  -e AGENT_OS_PUBLIC_URL=http://127.0.0.1:3001 \
  backend node scripts/test-openconnector-connectors-e2e.js

echo "SMOKE_REAL_OPENCONNECTOR_DONE"
