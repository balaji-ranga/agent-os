#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml

# Ensure content-tools restored
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const bak=p+".bak-tools";
let c=JSON.parse(fs.readFileSync(p,"utf8"));
if (fs.existsSync(bak)) {
  c=JSON.parse(fs.readFileSync(bak,"utf8"));
  fs.writeFileSync(p, JSON.stringify(c,null,2));
  console.log("restored from bak");
}
if (!c.plugins.allow.includes("agent-os-content-tools")) {
  c.plugins.allow.unshift("agent-os-content-tools");
  if (c.plugins.entries?.["agent-os-content-tools"]) c.plugins.entries["agent-os-content-tools"].enabled=true;
  fs.writeFileSync(p, JSON.stringify(c,null,2));
  console.log("forced re-enable");
}
console.log("allow", c.plugins.allow);
'

docker compose restart openclaw
for i in $(seq 1 30); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then
    echo ready; break
  fi
  echo wait $i; sleep 3
done

# Test: empty tools allow for balserve temporarily — chat without plugin tools in agent allowlist
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const c=JSON.parse(fs.readFileSync(p,"utf8"));
fs.writeFileSync(p+".bak-allow", JSON.stringify(c,null,2));
const a=(c.agents.list||[]).find(x=>x.id==="balserve");
if (a) { a.tools={allow:["sessions_list"], deny:["image"]}; }
fs.writeFileSync(p, JSON.stringify(c,null,2));
console.log("balserve allow", a?.tools?.allow);
'
docker compose restart openclaw
for i in $(seq 1 20); do
  if docker exec agent-os-backend-1 node -e 'fetch("http://openclaw:18789/v1/chat/completions",{method:"OPTIONS",signal:AbortSignal.timeout(2000)}).then(r=>{console.log(r.status);process.exit(0)}).catch(()=>process.exit(1))'; then echo ready2; break; fi
  sleep 3
done

TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
echo "=== chat with minimal tools.allow ==="
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
const res=await fetch("http://openclaw:18789/v1/chat/completions",{
  method:"POST",
  headers:{ "Content-Type":"application/json", Authorization:"Bearer "+tok, "x-openclaw-agent-id":"balserve" },
  body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag9-"+Date.now()}),
  signal:AbortSignal.timeout(120000)
});
console.log("status", res.status);
console.log((await res.text()).slice(0,700));
'
docker logs --tail 20 agent-os-openclaw-1 2>&1 | tail -n 20

# restore allowlist
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const p="/root/.openclaw/openclaw.json";
const bak=p+".bak-allow";
if (fs.existsSync(bak)) { fs.writeFileSync(p, fs.readFileSync(bak)); console.log("allow restored"); }
'
docker compose restart openclaw
echo done
