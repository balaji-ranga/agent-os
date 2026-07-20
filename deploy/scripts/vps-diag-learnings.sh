#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy

echo "=== find openclaw home ==="
docker compose exec -T openclaw sh -c 'echo HOME=$HOME; whoami; ls -la /root/.openclaw 2>/dev/null | head -20; ls -la /home/node/.openclaw 2>/dev/null | head -10; ls -la ~/.openclaw 2>/dev/null | head -10'

OC=/root/.openclaw
docker compose exec -T openclaw test -f /root/.openclaw/openclaw.json && OC=/root/.openclaw
docker compose exec -T openclaw test -f /home/node/.openclaw/openclaw.json && OC=/home/node/.openclaw
echo "Using OC path probe via container:"

docker compose exec -T openclaw sh -c '
OC=""
if [ -f /root/.openclaw/openclaw.json ]; then OC=/root/.openclaw
elif [ -f /home/node/.openclaw/openclaw.json ]; then OC=/home/node/.openclaw
else echo "NO openclaw.json"; find / -name openclaw.json 2>/dev/null | head -10; exit 1
fi
echo "OC=$OC"
echo "=== tools list ==="
ls -la "$OC/agent-os-tools.json" 2>/dev/null || echo MISSING_tools_json
if [ -f "$OC/agent-os-tools.json" ]; then
  node -e "
const fs=require(\"fs\");
const a=JSON.parse(fs.readFileSync(process.argv[1],\"utf8\"));
const arr=Array.isArray(a)?a:(a.tools||[]);
const hit=arr.filter(t=>String(t.name||t.tool_name||\"\").includes(\"learn\"));
console.log(\"total\", arr.length);
console.log(\"learnings\", JSON.stringify(hit,null,2));
console.log(\"names sample\", arr.slice(0,5).map(t=>t.name));
" "$OC/agent-os-tools.json"
fi
echo "=== balserve allow ==="
node -e "
const fs=require(\"fs\");
const c=JSON.parse(fs.readFileSync(process.argv[1],\"utf8\"));
const a=(c.agents&&c.agents.list||[]).find(x=>x.id===\"balserve\");
const allow=(a&&a.tools&&a.tools.allow)||[];
console.log(\"has_learnings\", allow.includes(\"learnings_summary\"));
console.log(allow.join(\"\\n\"));
" "$OC/openclaw.json"
'

echo "=== backend sqlite ==="
docker compose exec -T backend node -e '
const {initDb,getDb}=require("./src/db/schema.js");
initDb();
const db=getDb();
console.log("grant", db.prepare("SELECT * FROM agent_tool_grants WHERE agent_id='\''balserve'\'' AND tool_name='\''learnings_summary'\''").all());
console.log("meta", db.prepare("SELECT name, enabled, endpoint FROM content_tools_meta WHERE name='\''learnings_summary'\''").all());
console.log("logs", db.prepare("SELECT id,status,created_at,substr(cast(response_payload as text),1,200) r FROM content_tool_logs WHERE tool_name='\''learnings_summary'\'' ORDER BY id DESC LIMIT 5").all());
console.log("write path env", process.env.OPENCLAW_TOOLS_LIST_PATH || "(default)");
'

echo "=== where backend writes tools list ==="
docker compose exec -T backend node -e '
const {writeOpenClawToolsList}=require("./src/services/content-tools-meta.js");
const {initDb}=require("./src/db/schema.js");
initDb();
writeOpenClawToolsList();
console.log("rewrote tools list");
'

docker compose exec -T openclaw sh -c '
OC=/root/.openclaw
[ -f /home/node/.openclaw/openclaw.json ] && OC=/home/node/.openclaw
[ -f /root/.openclaw/openclaw.json ] && OC=/root/.openclaw
echo after rewrite:
ls -la "$OC/agent-os-tools.json" 2>/dev/null || echo still missing
node -e "
const fs=require(\"fs\");
const p=process.argv[1];
if(!fs.existsSync(p)){console.log(\"missing\",p);process.exit(0)}
const a=JSON.parse(fs.readFileSync(p,\"utf8\"));
const arr=Array.isArray(a)?a:(a.tools||[]);
console.log(\"total\",arr.length,\"has learnings\", arr.some(t=>t.name===\"learnings_summary\"));
" "$OC/agent-os-tools.json"
'

echo "=== direct invoke ==="
docker compose exec -T backend node -e '
const {initDb,getDb}=require("./src/db/schema.js");
initDb();
' >/dev/null
TOKEN=$(docker compose exec -T backend printenv TOOLS_API_KEY 2>/dev/null | tr -d "\r\n" || true)
docker compose exec -T openclaw sh -c "
curl -sS -w '\nhttp=%{http_code}\n' -X POST http://backend:3001/api/tools/invoke \
  -H 'Content-Type: application/json' \
  -H 'x-openclaw-agent-id: balserve' \
  ${TOKEN:+-H \"Authorization: Bearer $TOKEN\"} \
  -d '{\"tool_name\":\"learnings_summary\",\"topic\":\"coo tools e2e\",\"days\":30}' | head -c 800
echo
"

echo "=== openclaw learn logs ==="
docker compose logs --tail=800 openclaw 2>/dev/null | grep -i learn | tail -40 || true
