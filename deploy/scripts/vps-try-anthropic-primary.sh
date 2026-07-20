#!/bin/bash
set -euo pipefail
echo "=== openai-related env in openclaw ==="
docker exec agent-os-openclaw-1 sh -c 'env | grep -iE "OPENAI|OPENCLAW_MODEL|API" | sed "s/\(KEY\|TOKEN\|SECRET\)=.*/\1=***/"'
echo "=== try anthropic primary ==="
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
const key=process.env.ANTHROPIC_API_KEY||"";
console.log("anthropic key len", key.length);
if (!c.models) c.models={};
if (!c.models.providers) c.models.providers={};
if (key) {
  c.models.providers.anthropic={
    apiKey:key,
    api:"anthropic-messages",
    models:[{id:"claude-sonnet-4-20250514", name:"claude-sonnet-4-20250514", reasoning:false, input:["text"], cost:{input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow:200000, maxTokens:8192}]
  };
  c.agents.defaults.model.primary="anthropic/claude-sonnet-4-20250514";
  c.agents.defaults.model.fallbacks=["openai/gpt-4o-mini"];
  fs.writeFileSync(p, JSON.stringify(c,null,2));
  console.log("set anthropic primary");
} else {
  console.log("no anthropic key in process env — reading from compose env file via host");
}
'
# Pass key from host container env explicitly
AK=$(docker exec agent-os-openclaw-1 printenv ANTHROPIC_API_KEY || true)
echo "printenv len ${#AK}"
if [ -n "$AK" ]; then
  docker exec -e ANTHROPIC_API_KEY="$AK" agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
const key=process.env.ANTHROPIC_API_KEY;
c.models=c.models||{}; c.models.providers=c.models.providers||{};
c.models.providers.anthropic={
  apiKey:key,
  api:"anthropic-messages",
  models:[{id:"claude-sonnet-4-20250514", name:"claude-sonnet-4-20250514", reasoning:false, input:["text"], cost:{input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow:200000, maxTokens:8192}]
};
c.agents.defaults.model.primary="anthropic/claude-sonnet-4-20250514";
c.agents.defaults.model.fallbacks=["openai/gpt-4o-mini"];
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log("primary", c.agents.defaults.model.primary);
'
fi

cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
docker compose restart openclaw
for i in $(seq 1 20); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then echo ready; break; fi
  sleep 3
done
TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag5-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
console.log("status", res.status);
console.log((await res.text()).slice(0,900));
'
docker logs --tail 25 agent-os-openclaw-1 2>&1 | tail -n 25
