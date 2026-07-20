#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const glob="/usr/local/lib/node_modules/openclaw/dist";
for (const f of ["gateway-startup-plugin-ids-COmsQTCi.js"]) {
  const s=fs.readFileSync(glob+"/"+f,"utf8");
  const i=s.indexOf("codex");
  console.log(s.slice(Math.max(0,i-200), i+400));
}
'
echo "==== disable codex auto ==="
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
c.plugins=c.plugins||{};
c.plugins.entries=c.plugins.entries||{};
c.plugins.entries.codex={enabled:false};
c.plugins.entries.openai={enabled:true};
// also deny openai plugin auto completions by setting providers only
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log("codex entry", c.plugins.entries.codex);
'
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
docker compose restart openclaw
sleep 12
TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag11-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
console.log("status", res.status);
console.log((await res.text()).slice(0,700));
'
docker logs --tail 25 agent-os-openclaw-1 2>&1 | tail -n 25
