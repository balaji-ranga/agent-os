#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

TOKEN=$(docker compose exec -T openclaw node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)' | tr -d '\r')

echo "=== raw chat completions dump ==="
docker compose exec -T openclaw sh -c "
curl -sS -X POST http://127.0.0.1:18789/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer $TOKEN' \
  -H 'x-openclaw-agent-id: balserve' \
  -d '{
    \"model\": \"openclaw\",
    \"messages\": [{\"role\":\"user\",\"content\":\"You must call the learnings_summary tool now with {\\\"topic\\\":\\\"coo tools e2e\\\",\\\"days\\\":30}. Do not answer without the tool.\"}],
    \"user\": \"agent-os-balserve-default\"
  }' | tee /tmp/learn-chat.json | head -c 4000
echo
"

echo "=== parse tool-ish fields ==="
docker compose exec -T openclaw node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync("/tmp/learn-chat.json","utf8"));
console.log(JSON.stringify({
  id:j.id,
  model:j.model,
  choices:(j.choices||[]).map(c=>({
    finish:c.finish_reason,
    content:String(c.message?.content||"").slice(0,300),
    tool_calls:c.message?.tool_calls,
    refusal:c.message?.refusal,
  })),
  error:j.error,
  usage:j.usage,
},null,2));
'

echo "=== recent tool-policy / learnings logs ==="
docker compose logs --since 3m openclaw 2>/dev/null | grep -iE 'learnings|tool-policy|tool call|content-tools|invoke|optional' | tail -50

echo "=== content_tool_logs last 3 min ==="
docker compose exec -T backend node -e '
const {initDb,getDb}=require("./src/db/schema.js");
initDb();
const db=getDb();
console.log(db.prepare("SELECT id,tool_name,status,created_at,substr(cast(response_payload as text),1,180) r FROM content_tool_logs WHERE created_at >= datetime(\"now\",\"-10 minutes\") ORDER BY id DESC LIMIT 15").all());
'
