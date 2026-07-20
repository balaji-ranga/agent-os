#!/bin/bash
# Sync balserve learnings_summary into DB grants + allowlists + openclaw.json, then retest.
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "=== 1) Grant + sync allowlists from backend ==="
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import { syncAllowlistsFile, syncOpenClawJsonForAgent, getAgentToolGrants } from './src/services/openclaw-agent-tools.js';
import { grantLearningsSummaryToAllAgents } from './src/services/agent-feedback.js';
import { writeOpenClawToolsList } from './src/services/content-tools-meta.js';

initDb();
try { grantLearningsSummaryToAllAgents(); } catch (e) { console.warn('grantLearnings', e.message); }
const db = getDb();
db.prepare('INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)').run('balserve', 'learnings_summary');
const agent = db.prepare("SELECT * FROM agents WHERE id = 'balserve'").get();
if (!agent) throw new Error('balserve agent missing');
const allow = syncOpenClawJsonForAgent(agent);
const lists = syncAllowlistsFile();
writeOpenClawToolsList();
console.log('balserve grants', getAgentToolGrants('balserve').filter((t) => t.includes('learn') || t.includes('summarize') || t.startsWith('kanban') || t.startsWith('agent_workflow') || t.startsWith('intent')));
console.log('openclaw allow has learnings', Array.isArray(allow) && allow.includes('learnings_summary'));
console.log('allowlists balserve has learnings', Array.isArray(lists.balserve) && lists.balserve.includes('learnings_summary'));
console.log('allowlists balserve count', (lists.balserve || []).length);
NODE

echo "=== 2) Copy updated plugin + test script ==="
# Prefer mounted extensions; also patch in-container if present
if [ -f /tmp/content-tools-index.js ]; then
  docker compose cp /tmp/content-tools-index.js openclaw:/root/.openclaw/extensions/agent-os-content-tools/index.js 2>/dev/null || true
  docker cp /tmp/content-tools-index.js "$(docker compose ps -q openclaw)":/root/.openclaw/extensions/agent-os-content-tools/index.js 2>/dev/null || true
fi
docker cp /tmp/test-coo-tools-prompt-e2e.js "$(docker compose ps -q backend)":/app/scripts/test-coo-tools-prompt-e2e.js 2>/dev/null || \
  docker cp /tmp/test-coo-tools-prompt-e2e.js agent-os-backend-1:/opt/agent-os/backend/scripts/test-coo-tools-prompt-e2e.js 2>/dev/null || \
  docker compose cp /tmp/test-coo-tools-prompt-e2e.js backend:/app/scripts/test-coo-tools-prompt-e2e.js

# Detect backend workdir
BACKEND_WD=/app
docker compose exec -T backend test -f /app/scripts/test-coo-tools-prompt-e2e.js || BACKEND_WD=/opt/agent-os/backend
docker compose exec -T backend test -f "$BACKEND_WD/scripts/test-coo-tools-prompt-e2e.js"
echo "backend wd $BACKEND_WD"

echo "=== 3) Verify allowlists on openclaw volume ==="
docker compose exec -T openclaw node -e '
const fs=require("fs");
const a=JSON.parse(fs.readFileSync("/root/.openclaw/agent-tool-allowlists.json","utf8"));
const c=JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json","utf8"));
const ba=a.balserve||[];
const oa=((c.agents.list||[]).find(x=>x.id==="balserve")||{}).tools?.allow||[];
console.log("allowlists.has", ba.includes("learnings_summary"), "count", ba.length);
console.log("openclaw.has", oa.includes("learnings_summary"), "count", oa.length);
const keys=Object.keys(a).filter(k=>k.includes("balserve")||k.includes("serve"));
for (const k of keys) console.log("key", k, "has", (a[k]||[]).includes("learnings_summary"), "n", (a[k]||[]).length);
'

echo "=== 4) Restart openclaw + cool TPM ==="
docker compose restart openclaw
sleep 20
echo "cooling 40s…"
sleep 40

TOKEN=$(docker compose exec -T openclaw node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)' | tr -d '\r')

echo "=== 5) Learnings-only smoke ==="
docker compose exec -T \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_ONLY=learnings_summary \
  -e COO_TOOLS_SKIP_IMAGE=1 \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -e COO_TOOLS_SKIP_IBKR=1 \
  -e COO_TOOLS_CASE_PAUSE_MS=5000 \
  -e COO_TOOLS_OWNER_USER_ID=default \
  -w "$BACKEND_WD" \
  backend node scripts/test-coo-tools-prompt-e2e.js

echo "=== 6) Full slim suite ==="
echo "cooling 45s before full suite…"
sleep 45
docker compose exec -T \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_SKIP_IMAGE=1 \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -e COO_TOOLS_SKIP_IBKR=1 \
  -e COO_TOOLS_CASE_PAUSE_MS=15000 \
  -e COO_TOOLS_OWNER_USER_ID=default \
  -w "$BACKEND_WD" \
  backend node scripts/test-coo-tools-prompt-e2e.js
