#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml

# Ensure compose override is present on this host
if ! grep -q 'OPENAI_BASE_URL: ""' docker-compose.yml; then
  echo "WARN: local compose may be stale; applying runtime unset via recreate env"
fi

# Recreate openclaw with empty OPENAI_BASE_URL
docker compose up -d --force-recreate --no-deps openclaw

for i in $(seq 1 25); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then
    echo "gateway ready"; break
  fi
  echo "wait $i"; sleep 3
done

echo "=== openclaw OPENAI_BASE_URL ==="
docker exec agent-os-openclaw-1 sh -c 'echo "[$OPENAI_BASE_URL]"; echo primary_base="[$OPENAI_PRIMARY_BASE_URL]"'

# Re-apply responses api + strip baseUrl from models.json
docker cp /tmp/strip-openai-baseurl.js agent-os-openclaw-1:/tmp/strip-openai-baseurl.js
docker exec agent-os-openclaw-1 node /tmp/strip-openai-baseurl.js
docker compose restart openclaw
sleep 8
for i in $(seq 1 15); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then
    echo "gateway ready2"; break
  fi
  sleep 2
done

TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
echo "=== probe chat ==="
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag6-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
console.log("status", res.status);
console.log((await res.text()).slice(0,900));
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
