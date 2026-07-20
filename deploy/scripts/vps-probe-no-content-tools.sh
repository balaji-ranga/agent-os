#!/bin/bash
set -euo pipefail
bash /tmp/vps-inspect-openai-mjs.sh | head -n 80 || true

cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml

docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
fs.writeFileSync(p+".bak-full", JSON.stringify(c,null,2));
c.plugins.allow=["browser"];
if (c.plugins.entries["agent-os-content-tools"]) c.plugins.entries["agent-os-content-tools"].enabled=false;
const a=(c.agents.list||[]).find(x=>x.id==="balserve");
if (a) a.tools={allow:[], deny:["image"]};
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log("no content tools mode");
'
docker compose restart openclaw
for i in $(seq 1 25); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then echo ready; break; fi
  echo wait $i; sleep 3
done
echo "=== agent CLI no tools ==="
set +e
docker exec agent-os-openclaw-1 openclaw agent --agent balserve --message "Reply with exactly PONG. Do not use tools." --json 2>&1 | tail -n 40
set -e

docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
fs.writeFileSync(p, fs.readFileSync(p+".bak-full"));
console.log("restored");
'
docker compose restart openclaw
echo restored
