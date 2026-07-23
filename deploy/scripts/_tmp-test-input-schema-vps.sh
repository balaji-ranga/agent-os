#!/bin/bash
set -euo pipefail
docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/test-workflow-input-schema.js
EMAIL=$(grep -E '^AGENT_OS_ADMIN_EMAIL=' /opt/agent-os/deploy/.env | head -1 | cut -d= -f2-)
PASS=$(grep -E '^AGENT_OS_ADMIN_PASSWORD=' /opt/agent-os/deploy/.env | head -1 | cut -d= -f2-)
TKEY=$(grep -E '^TOOLS_API_KEY=' /opt/agent-os/deploy/.env | head -1 | cut -d= -f2-)
docker exec -w /opt/agent-os/backend \
  -e AGENT_OS_BASE_URL=http://127.0.0.1:3001 \
  -e AGENT_OS_ADMIN_EMAIL="$EMAIL" \
  -e AGENT_OS_ADMIN_PASSWORD="$PASS" \
  -e TOOLS_API_KEY="$TKEY" \
  agent-os-backend-1 node scripts/test-workflow-input-schema-e2e.js
echo SCHEMA_VPS_ALL_OK
