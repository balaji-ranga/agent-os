#!/bin/bash
set -euo pipefail
# Backup and temporarily disable content-tools to isolate custom-tools failure
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
fs.writeFileSync(p+".bak-tools", JSON.stringify(c,null,2));
c.plugins.allow = (c.plugins.allow||[]).filter(x=>x!=="agent-os-content-tools");
if (c.plugins.entries && c.plugins.entries["agent-os-content-tools"]) {
  c.plugins.entries["agent-os-content-tools"].enabled = false;
}
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log("allow", c.plugins.allow);
'
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
docker compose restart openclaw
sleep 10
TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
echo "=== chat without content-tools ==="
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag8-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
console.log("status", res.status);
console.log((await res.text()).slice(0,600));
'
docker logs --tail 15 agent-os-openclaw-1 2>&1 | tail -n 15

# restore
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const bak=p+".bak-tools";
if (fs.existsSync(bak)) { fs.writeFileSync(p, fs.readFileSync(bak)); console.log("restored"); }
'
docker compose restart openclaw
sleep 8
echo restored
