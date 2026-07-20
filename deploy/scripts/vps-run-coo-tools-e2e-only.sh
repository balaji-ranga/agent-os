#!/bin/bash
set -euo pipefail
docker cp /tmp/test-coo-tools-prompt-e2e.js agent-os-backend-1:/opt/agent-os/backend/scripts/test-coo-tools-prompt-e2e.js
TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
# Wait for OpenAI rate limit window to cool
echo "cooling 45s for OpenAI TPM…"
sleep 45
for i in $(seq 1 15); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then break; fi
  sleep 2
done
docker exec \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -e COO_TOOLS_SKIP_IMAGE=1 \
  -e COO_TOOLS_SKIP_IBKR=1 \
  -e COO_TOOLS_CASE_PAUSE_MS=15000 \
  -e COO_TOOLS_OWNER_USER_ID=default \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-coo-tools-prompt-e2e.js
