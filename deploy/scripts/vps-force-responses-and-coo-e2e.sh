#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml

docker cp /tmp/force-openai-responses-replace.js agent-os-openclaw-1:/tmp/force-openai-responses-replace.js
docker exec -e OPENAI_API_KEY="$(docker exec agent-os-openclaw-1 printenv OPENAI_API_KEY || true)" agent-os-openclaw-1 node /tmp/force-openai-responses-replace.js

docker compose restart openclaw
for i in $(seq 1 30); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then
    echo ready; break
  fi
  echo wait $i; sleep 3
done

TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
echo "=== probe ==="
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag10-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
console.log("status", res.status);
console.log((await res.text()).slice(0,800));
if (!res.ok) process.exit(2);
'

echo "=== COO tools e2e ==="
docker exec \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-coo-tools-prompt-e2e.js
