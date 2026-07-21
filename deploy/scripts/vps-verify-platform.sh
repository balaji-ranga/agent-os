#!/usr/bin/env bash
# Post-deploy platform verification: multi-tenant, Master Data, notifications, Flowlah branding.
#
# Usage (on VPS):
#   bash /opt/agent-os/deploy/scripts/vps-verify-platform.sh
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "==> platform verify $(date -Is)"

echo "==> services"
docker compose ps backend frontend openclaw --format '{{.Service}} {{.Status}}'

echo "==> source on disk"
check() {
  local label="$1"
  shift
  printf '    %-28s ' "$label"
  if "$@"; then echo OK; else echo MISSING; fi
}
check "kanban cron sync" grep -q completePipelineKanbanForDelegation "$ROOT/backend/src/routes/standups.js"
check "kanban in_progress mark" grep -q markKanbanInProgressForDelegation "$ROOT/backend/src/services/delegation-queue.js"
check "kanban stuck heal" grep -q healStuckKanbanForCompletedDelegations "$ROOT/backend/src/index.js"
check "COO chat reach-me hook" grep -q tryHandleCooReachMeRequest "$ROOT/backend/src/routes/agents.js"
check "standup reach-me hook" grep -q tryHandleCooReachMeRequest "$ROOT/backend/src/routes/standups.js"
check "notify_ceo COO rewrite" grep -q tryRewriteCooNotifyAsSpecialist "$ROOT/backend/src/routes/tools.js"
check "notify_ceo chat link" grep -q '/agents/' "$ROOT/backend/src/services/notify-ceo.js"
check "COO reach-me guard" grep -q 'Do \*\*NOT\*\* call \*\*notify_ceo\*\* yourself' "$ROOT/openclaw-workspace-templates/balserve/AGENTS.md" || grep -q 'Do NOT call' "$ROOT/backend/src/services/org-context.js"
check "workspace heal startup" grep -q healAgentWorkspacePaths "$ROOT/backend/src/index.js"
check "AgentWorkspace UI" grep -q workspace_root "$ROOT/frontend/src/pages/AgentWorkspace.jsx" || grep -q agentWorkspaceFiles "$ROOT/frontend/src/pages/AgentWorkspace.jsx"
check "master_data routes" grep -q master-data-list-tables "$ROOT/backend/src/routes/tools.js"
check "master-data-tools.js" test -f "$ROOT/backend/src/services/master-data-tools.js"
check "standups owner scope" grep -q 'owner_user_id = ?' "$ROOT/backend/src/routes/standups.js"
check "notification dismiss API" grep -q 'notifications/dismiss' "$ROOT/backend/src/routes/standups.js"
check "user_feed_dismissals" grep -q user_feed_dismissals "$ROOT/backend/src/db/schema.js"
check "agent dismiss service" grep -q dismissAgentResponseNotifications "$ROOT/backend/src/services/agent-response-notifications.js"
check "composite dismiss keys" grep -q agentStandupDismissKey "$ROOT/backend/src/services/agent-response-notifications.js"
check "api standupNotificationsDismiss" grep -q standupNotificationsDismiss "$ROOT/frontend/src/api.js"
check "NotificationProvider" grep -q NotificationProvider "$ROOT/frontend/src/App.jsx"
check "NotificationContext" test -f "$ROOT/frontend/src/context/NotificationContext.jsx"
check "shared bell dismiss" grep -q standupNotificationsDismiss "$ROOT/frontend/src/context/NotificationContext.jsx"
check "broadcast route" grep -q "/api/broadcast" "$ROOT/backend/src/routes/broadcast.js" || test -f "$ROOT/backend/src/routes/broadcast.js"
check "broadcast CEO session" grep -q registerOpenClawSessionOwner "$ROOT/backend/src/routes/broadcast.js"
check "Broadcast UI" grep -q Broadcast "$ROOT/frontend/src/pages/Broadcast.jsx" || grep -q '/broadcast' "$ROOT/frontend/src/App.jsx"
check "tool-owner-scope fix" grep -q SESSION_USER_PREFIXES "$ROOT/backend/src/services/tool-owner-scope.js"
check "Master Data UI purpose" grep -q 'Purpose / description' "$ROOT/frontend/src/pages/MasterData.jsx"
check "Flowlah title" grep -q 'Flowlah - An Agent Company Setup' "$ROOT/frontend/index.html"
check "api masterDataTableUpdate" grep -q masterDataTableUpdate "$ROOT/frontend/src/api.js"
check "SKILL anti-browser" grep -q 'never browser' "$ROOT/openclaw-skills/agent-os-content-tools/SKILL.md"
check "TOOLS anti-browser" grep -q 'browser tool for Master Data' "$ROOT/openclaw-workspace-templates/balserve/TOOLS.md"
check "platform-help docs on disk" test -f "$ROOT/knowledgebase/platform-help/01-getting-started.md"
check "platformhelp SOUL template" test -f "$ROOT/openclaw-workspace-templates/platformhelp/SOUL.md"
check "platformhelp seed script" test -f "$ROOT/backend/scripts/seed-platform-help-agent.js"
check "platformhelp startup seed" grep -q seedPlatformHelpAgent "$ROOT/backend/src/index.js"
check "backend Dockerfile help COPY" grep -q 'knowledgebase/platform-help' "$ROOT/deploy/docker/backend.Dockerfile"

echo "==> frontend bundle"
if docker compose exec -T frontend sh -c 'grep -Rql "Purpose / description" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    Master Data purpose UI in bundle OK"
else
  echo "    WARN: Purpose / description not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Flowlah - An Agent Company Setup" /usr/share/nginx/html/index.html 2>/dev/null'; then
  echo "    Flowlah title in index.html OK"
else
  echo "    WARN: Flowlah title not in deployed index.html"
fi
if docker compose exec -T frontend sh -c 'grep -Rql NotificationProvider /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    NotificationProvider (shared bell feed) in bundle OK"
else
  echo "    WARN: NotificationProvider not found in frontend JS (rebuild frontend?)"
fi
if docker compose exec -T frontend sh -c 'grep -Rql standupNotificationsDismiss /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    Notification dismiss API client in bundle OK"
else
  echo "    WARN: standupNotificationsDismiss not found in frontend JS (rebuild frontend?)"
fi

echo "==> DB runtime"
docker compose exec -T backend node <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const db = getDb();
const mdTools = db.prepare("SELECT COUNT(*) AS c FROM content_tools_meta WHERE name LIKE 'master_data_%'").get().c;
const mdGrants = db.prepare("SELECT COUNT(*) AS c FROM agent_tool_grants WHERE tool_name LIKE 'master_data_%'").get().c;
const delCols = db.prepare('PRAGMA table_info(agent_delegation_tasks)').all().map((c) => c.name);
const standupCols = db.prepare('PRAGMA table_info(standups)').all().map((c) => c.name);
const dismissTbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_feed_dismissals'").get();
console.log('    master_data tools meta:', mdTools, 'grants:', mdGrants);
console.log('    delegation owner_user_id:', delCols.includes('owner_user_id') ? 'OK' : 'MISSING');
console.log('    standups owner_user_id:', standupCols.includes('owner_user_id') ? 'OK' : 'MISSING');
console.log('    user_feed_dismissals table:', dismissTbl ? 'OK' : 'MISSING');
const platformHelp = db.prepare(`SELECT id, name, agent_type FROM agents WHERE id = 'platformhelp'`).get();
console.log('    platformhelp agent:', platformHelp ? `${platformHelp.name} (${platformHelp.agent_type})` : 'MISSING');
const helpDocs = db
  .prepare(`SELECT COUNT(*) AS c FROM master_data_documents WHERE title LIKE 'Flowlah Help —%' OR title LIKE 'Flowlah Help -%'`)
  .get().c;
console.log('    Flowlah Help Master Data docs:', helpDocs);
const helpGrants = db
  .prepare(
    `SELECT COUNT(*) AS c FROM agent_tool_grants WHERE agent_id = 'platformhelp' AND tool_name IN ('master_data_rag','master_data_list_documents')`
  )
  .get().c;
console.log('    platformhelp RAG grants:', helpGrants);
if (mdTools < 7) throw new Error('expected at least 7 master_data tools in content_tools_meta');
if (!dismissTbl) throw new Error('user_feed_dismissals table missing');
if (!platformHelp) throw new Error('platformhelp agent missing from agents table');
if (helpGrants < 2) throw new Error('platformhelp missing master_data_rag / list_documents grants');
NODE

echo "==> platform-help image + RAG smoke"
docker compose exec -T backend sh -c 'test -f /opt/agent-os/knowledgebase/platform-help/07-workflow-nodes-reference.md'
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-platform-help-rag.js

echo "==> master_data invoke smoke"
docker compose exec -T backend node <<'NODE'
import { initDb } from './src/db/schema.js';
import { getBalaCeoAuthId } from './src/services/job-applicant-ceo.js';
import { listRowsForAgent } from './src/services/master-data-tools.js';
initDb();
const owner = getBalaCeoAuthId();
const out = listRowsForAgent(owner, { table_name: 'departments', limit: 5 });
const names = (out.rows || []).map((r) => r.data?.name).filter(Boolean);
console.log('    departments sample:', names.slice(0, 5).join(', ') || '(none)');
NODE

echo "==> agent workspace MD smoke"
docker compose exec -T backend node <<'NODE'
import { existsSync } from 'fs';
import { initDb, getDb } from './src/db/schema.js';
import { resolveAgentWorkspaceRoot, listWorkspaceFiles, readWorkspaceFile } from './src/workspace/adapter.js';
initDb();
const agent = getDb().prepare(`SELECT * FROM agents WHERE is_coo = 1 OR id = 'balserve' ORDER BY is_coo DESC LIMIT 1`).get();
if (!agent) throw new Error('no COO agent');
const root = resolveAgentWorkspaceRoot(agent, { healDb: false });
const listed = await listWorkspaceFiles(root);
const soul = await readWorkspaceFile('soul', { workspaceRoot: root });
console.log('    agent:', agent.id, 'root:', root);
console.log('    files:', (listed.files || []).map((f) => f.name).join(', ') || '(none)');
console.log('    SOUL.md bytes:', (soul.text || '').length, existsSync(root) ? 'dir OK' : 'dir MISSING');
if (!existsSync(root)) throw new Error('workspace root missing: ' + root);
if (!(soul.text || '').trim()) throw new Error('SOUL.md empty or missing at ' + root);
NODE

echo "==> broadcast routing smoke"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-broadcast-routing.js

echo "==> Kanban delegation sync smoke"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-kanban-delegation-sync.js

echo "==> COO reach-me delegation smoke"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-coo-reach-me-delegation.js

echo "==> OpenClaw allowlists (master_data)"
docker compose exec -T -w /opt/agent-os openclaw node -e "
import { REQUIRED_GLOBAL_CONTENT_TOOLS, COO_CONTENT_TOOLS_ALLOW } from './scripts/lib/content-tools-allow.js';
const md = [
  'master_data_list_tables','master_data_list_rows','master_data_insert_row',
  'master_data_update_row','master_data_delete_row','master_data_list_documents','master_data_rag',
];
for (const t of md) {
  if (!REQUIRED_GLOBAL_CONTENT_TOOLS.includes(t)) { console.error('missing REQUIRED_GLOBAL', t); process.exit(2); }
  if (!COO_CONTENT_TOOLS_ALLOW.includes(t)) { console.error('missing COO allow', t); process.exit(3); }
}
console.log('    master_data tools in REQUIRED_GLOBAL + COO allowlists OK');
"

echo "PLATFORM_VERIFY_DONE $(date -Is)"
