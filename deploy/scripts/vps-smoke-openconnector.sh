#!/usr/bin/env bash
# Smoke: OpenConnector facade + connector workflow node + connector content tools.
# Uses optional-openconnector-mock when real OpenConnector is not configured.
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "==> Ensure OpenConnector mock is running (optional-openconnector-mock)"
docker compose --profile optional-openconnector-mock up -d --build openconnector-mcp-mock

echo "==> Wait for OpenConnector mock health"
for i in $(seq 1 20); do
  if docker compose exec -T openconnector-mcp-mock curl -fsS http://127.0.0.1:3105/health >/dev/null 2>&1; then
    echo "  openconnector-mcp-mock healthy"
    break
  fi
  sleep 2
done

MOCK_URL="http://openconnector-mcp-mock:3105"
MOCK_TOKEN="${OPENCONNECTOR_MOCK_TOKEN:-oc-mock-vps-smoke}"

echo "==> Seed OpenConnector MCP registry + env for backend"
docker compose exec -T backend node -e "
import { initDb, getDb } from './src/db/schema.js';
import { connectMcpServer, createMcpServer, getMcpServer, updateMcpServer } from './src/services/mcp-servers.js';
initDb();
const db = getDb();
const admin = db.prepare(\"SELECT id, role FROM platform_users WHERE role='admin' LIMIT 1\").get();
const auth = { id: admin.id, role: admin.role };
const MCP_ID = process.env.OPENCONNECTOR_MCP_ID || 'mcp-openconnector';
const URL = '${MOCK_URL}/mcp';
let server = getMcpServer(MCP_ID, auth);
if (!server) {
  createMcpServer(auth, {
    id: MCP_ID,
    name: 'OpenConnector',
    description: 'OpenConnector gateway',
    url: URL,
    transport: 'streamable_http',
    authBearer: '${MOCK_TOKEN}',
  });
  console.log('Created MCP', MCP_ID);
} else {
  updateMcpServer(MCP_ID, auth, { url: URL, authBearer: '${MOCK_TOKEN}' });
  console.log('Updated MCP', MCP_ID);
}
const result = await connectMcpServer(MCP_ID, auth, { bearer: '${MOCK_TOKEN}' });
console.log('Status:', result.status, 'tools:', (result.tools||[]).map(t=>t.name).join(', '));
"

echo "==> Run OpenConnector connectors e2e"
docker compose exec -T -w /opt/agent-os/backend \
  -e OPENCONNECTOR_URL="${MOCK_URL}" \
  -e OPENCONNECTOR_MCP_URL="${MOCK_URL}/mcp" \
  -e OPENCONNECTOR_MCP_BEARER="${MOCK_TOKEN}" \
  -e OPENCONNECTOR_MOCK_TOKEN="${MOCK_TOKEN}" \
  -e AGENT_OS_PUBLIC_URL=http://127.0.0.1:3001 \
  backend node scripts/test-openconnector-connectors-e2e.js

echo "SMOKE_OPENCONNECTOR_DONE"
