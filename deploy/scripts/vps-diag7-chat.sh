#!/bin/bash
set -euo pipefail
TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag7-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
console.log("status", res.status);
console.log((await res.text()).slice(0,500));
'
echo "=== logs ==="
docker logs --tail 40 agent-os-openclaw-1 2>&1 | tail -n 40
echo "=== openai cfg ==="
docker exec agent-os-openclaw-1 node -e 'const c=require("/root/.openclaw/openclaw.json"); const o=c.models.providers.openai; console.log({api:o.api, baseUrl:o.baseUrl, keys:Object.keys(o), modelApi:o.models?.[0]?.api}); console.log("env OPENAI_BASE_URL", JSON.stringify(process.env.OPENAI_BASE_URL));'
