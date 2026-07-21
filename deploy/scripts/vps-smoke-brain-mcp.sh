#!/usr/bin/env bash
# Smoke: Brain node with inline MCP tool-calling loop (mcp-random-sse).
# Starts the optional-mcp container if needed, updates the MCP registry URL for
# Docker networking, then runs the E2E test using the VPS Ollama llama3.2 model.
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "==> Ensure mcp-random-sse container is running"
if ! docker compose ps mcp-random-sse 2>/dev/null | grep -q "Up"; then
  docker compose --profile optional-mcp up -d mcp-random-sse
  echo "  mcp-random-sse started — waiting for health"
  sleep 5
fi

echo "==> Check MCP health from backend"
for i in $(seq 1 15); do
  if docker compose exec -T backend node -e \
    "fetch('http://mcp-random-sse:3099/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "  MCP healthy"
    break
  fi
  sleep 2
done

echo "==> Update MCP registry URL for Docker network"
docker compose exec -T backend node -e "
import { initDb, getDb } from './src/db/schema.js';
import { updateMcpServer, connectMcpServer, createMcpServer, getMcpServer } from './src/services/mcp-servers.js';
initDb();
const db = getDb();
const admin = db.prepare(\"SELECT id, role FROM platform_users WHERE role='admin' LIMIT 1\").get();
const auth = { id: admin.id, role: admin.role };
const url = 'http://mcp-random-sse:3099/mcp';
let server = getMcpServer('mcp-local-random-sse', auth);
if (!server) {
  createMcpServer(auth, { id: 'mcp-local-random-sse', name: 'Local Random SSE (test)', description: 'Generates random numbers + SSE events', url, transport: 'sse' });
  console.log('Created MCP');
} else if (server.url !== url) {
  updateMcpServer('mcp-local-random-sse', auth, { url });
  console.log('Updated MCP URL');
}
const result = await connectMcpServer('mcp-local-random-sse', auth);
console.log('Status:', result.status, '— tools:', (result.tools||[]).map(t=>t.name).join(', '));
"

echo "==> Run Brain + MCP tool-loop E2E test"
docker compose exec -T -w /opt/agent-os/backend \
  -e BRAIN_MCP_TEST_PROVIDER=ollama \
  -e OLLAMA_BASE_URL=http://ollama:11434/v1 \
  -e OLLAMA_MODEL=llama3.2 \
  -e MCP_RANDOM_URL=http://mcp-random-sse:3099/mcp \
  backend node scripts/test-brain-mcp-loop-workflow.js

echo "SMOKE_BRAIN_MCP_DONE"
