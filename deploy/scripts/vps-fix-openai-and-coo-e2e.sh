#!/bin/bash
set -euo pipefail
docker cp /tmp/fix-openai-responses-api.js agent-os-openclaw-1:/tmp/fix-openai-responses-api.js
docker exec agent-os-openclaw-1 node /tmp/fix-openai-responses-api.js

cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
docker compose restart openclaw
for i in $(seq 1 25); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then
    echo "gateway ready"
    break
  fi
  echo "wait $i"; sleep 3
done

TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
echo "=== verify openai config ==="
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); const o=c.models.providers.openai; console.log({api:o.api, baseUrl:o.baseUrl, modelApi:o.models?.[0]?.api, fallbacks:c.agents.defaults.model.fallbacks});'

echo "=== probe chat ==="
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag3-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
const t=await res.text();
console.log("status", res.status);
console.log(t.slice(0,800));
if (!res.ok) {
  // dump logs
  process.exit(2);
}
'

echo "=== COO tools e2e ==="
docker exec \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-coo-tools-prompt-e2e.js
