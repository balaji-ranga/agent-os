#!/bin/bash
set -euo pipefail
docker exec agent-os-openclaw-1 node -e '
const c=require("/root/.openclaw/openclaw.json");
const a=(c.agents.list||[]).find(x=>x.id==="balserve");
const allow=a?.tools?.allow||[];
console.log("has learnings_summary", allow.includes("learnings_summary"));
if (!allow.includes("learnings_summary")) {
  allow.push("learnings_summary");
  a.tools.allow=allow;
  require("fs").writeFileSync("/root/.openclaw/openclaw.json", JSON.stringify(c,null,2));
  console.log("added learnings_summary to allow");
}
'
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module -e '
import { initDb, getDb } from "./src/db/schema.js";
initDb();
const db=getDb();
db.prepare("INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)").run("balserve","learnings_summary");
console.log(db.prepare("SELECT tool_name FROM agent_tool_grants WHERE agent_id=? AND tool_name=?").get("balserve","learnings_summary"));
'
cd /opt/agent-os/deploy
export COMPOSE_FILE=docker-compose.yml:docker-compose.browser.yml
docker compose restart openclaw
sleep 12
docker cp /tmp/test-coo-tools-prompt-e2e.js agent-os-backend-1:/opt/agent-os/backend/scripts/test-coo-tools-prompt-e2e.js
TOKEN=$(docker exec agent-os-openclaw-1 node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)')
echo "cooling 30s…"
sleep 30
# Run only learnings via a tiny node one-shot by setting env to skip others — easier: full suite again slim
docker exec \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -e COO_TOOLS_SKIP_IMAGE=1 \
  -e COO_TOOLS_SKIP_IBKR=1 \
  -e COO_TOOLS_CASE_PAUSE_MS=12000 \
  -e COO_TOOLS_OWNER_USER_ID=default \
  -w /opt/agent-os/backend \
  agent-os-backend-1 \
  node scripts/test-coo-tools-prompt-e2e.js
