#!/bin/bash
cd /opt/agent-os/deploy
echo "=== recent COO / workflow tool errors ==="
docker compose logs --since=20m openclaw 2>/dev/null | grep -iE 'workflow|coo|balserve|t-ceo-bala--main|tool|Invalid|custom|error|agent_workflow|invoke|TOOLS_API' | tail -60

echo
echo "=== content-tools plugin config (no secrets) ==="
docker compose exec -T openclaw node -e '
const c=require("/root/.openclaw/openclaw.json");
const p=c.plugins?.entries?.["agent-os-content-tools"]||{};
console.log({enabled:p.enabled, baseUrl:p.config?.baseUrl, hasApiKey:!!p.config?.apiKey, loadPaths:c.plugins?.load?.paths});
const main=(c.agents?.list||[]).find(a=>a.id==="t-ceo-bala--main"||a.id==="balserve");
console.log("coo-like", main&&{id:main.id, allow:(main.tools?.allow||[]).filter(t=>/workflow|intent|kanban|learn/.test(t))});
'

echo
echo "=== backend tools invoke agent_workflow_list ==="
docker compose exec -T backend sh -c '
  TOKEN="${TOOLS_API_KEY:-}"
  curl -sS --max-time 20 -X POST http://127.0.0.1:3001/api/tools/invoke \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-OpenClaw-Agent-Id: balserve" \
    -d "{\"tool\":\"agent_workflow_list\",\"args\":{},\"agentId\":\"balserve\"}" | head -c 1200
  echo
'

echo
echo "=== openclaw -> backend reachability ==="
docker compose exec -T openclaw sh -c '
  echo TOOLS_API_KEY=$( [ -n "$TOOLS_API_KEY" ] && echo set || echo MISSING )
  curl -sS --max-time 10 -o /tmp/health.json -w "health_http=%{http_code}\n" http://backend:3001/health || echo fail
  cat /tmp/health.json 2>/dev/null; echo
  curl -sS --max-time 20 -X POST http://backend:3001/api/tools/invoke \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOOLS_API_KEY" \
    -H "X-OpenClaw-Agent-Id: balserve" \
    -d "{\"tool\":\"agent_workflow_list\",\"args\":{},\"agentId\":\"balserve\"}" | head -c 1200
  echo
'

echo
echo "=== openai still failing custom? ==="
docker compose logs --since=10m openclaw 2>/dev/null | grep -iE "Invalid value|custom|candidate_failed|agent_workflow" | tail -20
