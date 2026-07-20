#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml

docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
if (!fs.existsSync(p+".bak-full2")) fs.writeFileSync(p+".bak-full2", JSON.stringify(c,null,2));
c.plugins.allow=[];
for (const k of Object.keys(c.plugins.entries||{})) {
  c.plugins.entries[k].enabled=false;
}
const a=(c.agents.list||[]).find(x=>x.id==="balserve");
if (a) a.tools={allow:[], deny:["*"]};
// also clear global tools.allow to empty/minimal
if (c.tools) c.tools.allow=[];
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log("stripped plugins/tools");
'
docker compose restart openclaw
for i in $(seq 1 25); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then echo ready; break; fi
  echo wait $i; sleep 3
done
set +e
docker exec agent-os-openclaw-1 openclaw agent --agent balserve --message "Reply with exactly PONG." --json 2>&1 | tail -n 50
docker logs --tail 30 agent-os-openclaw-1 2>&1 | tail -n 30
set -e
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
fs.writeFileSync(p, fs.readFileSync(p+".bak-full2"));
console.log("restored");
'
docker compose restart openclaw
echo done
