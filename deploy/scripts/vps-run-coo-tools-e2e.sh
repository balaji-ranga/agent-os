#!/bin/bash
set -euo pipefail
docker cp /tmp/test-coo-tools-prompt-e2e.js agent-os-backend-1:/opt/agent-os/backend/scripts/test-coo-tools-prompt-e2e.js
docker exec agent-os-backend-1 ls -la /opt/agent-os/backend/scripts/test-coo-tools-prompt-e2e.js
TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
# wait for gateway if needed
for i in $(seq 1 15); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then
    echo "gateway ready"
    break
  fi
  echo "wait gateway $i"
  sleep 2
done
docker exec \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-coo-tools-prompt-e2e.js
