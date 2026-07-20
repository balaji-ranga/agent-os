#!/bin/bash
set -euo pipefail
docker cp /tmp/strip-openai-baseurl.js agent-os-openclaw-1:/tmp/strip-openai-baseurl.js
docker exec agent-os-openclaw-1 node /tmp/strip-openai-baseurl.js
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
docker compose restart openclaw
for i in $(seq 1 20); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then
    echo "gateway ready"; break
  fi
  echo "wait $i"; sleep 3
done
TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag4-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
console.log("status", res.status);
console.log((await res.text()).slice(0,800));
'
echo "=== recent logs ==="
docker logs --tail 30 agent-os-openclaw-1 2>&1 | tail -n 30
