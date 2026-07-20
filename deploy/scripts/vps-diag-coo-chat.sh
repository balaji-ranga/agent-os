#!/bin/bash
set -euo pipefail
TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
echo "openclaw status:"; docker inspect -f '{{.State.Status}} {{.State.Health.Status}}' agent-os-openclaw-1
echo "=== single chat from backend ==="
docker exec -e TOKEN="$TOKEN" agent-os-backend-1 node --input-type=module -e '
const tok=process.env.TOKEN;
try {
  const res=await fetch("http://openclaw:18789/v1/chat/completions",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      Authorization:"Bearer "+tok,
      "x-openclaw-agent-id":"balserve"
    },
    body:JSON.stringify({model:"openclaw",messages:[{role:"user",content:"Reply with exactly PONG. Do not use tools."}],user:"diag-"+Date.now()}),
    signal:AbortSignal.timeout(120000)
  });
  const t=await res.text();
  console.log("status",res.status);
  console.log(t.slice(0,800));
} catch(e) {
  console.error("ERR", e.name, e.message, e.cause);
}
'
echo "=== openclaw recent logs ==="
docker logs --tail 50 agent-os-openclaw-1 2>&1 | tail -n 50
