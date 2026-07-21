#!/bin/bash
cd /opt/agent-os/deploy
echo "=== plugin / tools list files ==="
docker compose exec -T openclaw sh -c '
  ls -la /root/.openclaw/extensions/agent-os-content-tools 2>/dev/null
  ls -la /root/.openclaw/agent-os-tools.json 2>/dev/null || echo "MISSING agent-os-tools.json"
  if [ -f /root/.openclaw/agent-os-tools.json ]; then
    node -e "const j=require(\"/root/.openclaw/agent-os-tools.json\"); const a=Array.isArray(j)?j:(j.tools||[]); console.log(\"count\", a.length); console.log(a.filter(t=>String(t.name||t).includes(\"workflow\")).map(t=>t.name||t));"
  fi
  echo "--- plugin index head ---"
  head -40 /root/.openclaw/extensions/agent-os-content-tools/index.js 2>/dev/null || head -40 /root/.openclaw/extensions/agent-os-content-tools/index.ts 2>/dev/null
'

echo
echo "=== openclaw startup plugin lines ==="
docker compose logs --since=30m openclaw 2>/dev/null | grep -iE 'content-tools|plugin|agent-os-tools|register|failed to load' | tail -40

echo
echo "=== correct tools invoke shape ==="
docker compose exec -T backend node -e '
const {getDb}=require("./src/db/schema.js");
' 2>/dev/null || true
# probe invoke contract from route
docker compose exec -T backend sh -c '
  grep -n "tool_name\|req.body" src/routes/tools.js | head -40
'

echo
echo "=== invoke with tool_name ==="
docker compose exec -T openclaw sh -c '
  curl -sS --max-time 20 -X POST http://backend:3001/api/tools/invoke \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOOLS_API_KEY" \
    -H "X-OpenClaw-Agent-Id: balserve" \
    -d "{\"tool_name\":\"agent_workflow_list\",\"arguments\":{},\"agent_id\":\"balserve\"}" | head -c 1500
  echo
'
