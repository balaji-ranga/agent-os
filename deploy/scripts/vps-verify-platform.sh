#!/usr/bin/env bash
# Post-deploy platform verification: multi-tenant fixes, Master Data tools/UI, Flowlah branding.
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
check "delegation per-CEO" grep -q processPendingDelegationTasksForAllCeos "$ROOT/backend/src/services/delegation-queue.js"
check "master_data routes" grep -q master-data-list-tables "$ROOT/backend/src/routes/tools.js"
check "master-data-tools.js" test -f "$ROOT/backend/src/services/master-data-tools.js"
check "tool-owner-scope fix" grep -q SESSION_USER_PREFIXES "$ROOT/backend/src/services/tool-owner-scope.js"
check "Master Data UI purpose" grep -q 'Purpose / description' "$ROOT/frontend/src/pages/MasterData.jsx"
check "Flowlah title" grep -q 'Flowlah - An Agent Company Setup' "$ROOT/frontend/index.html"
check "api masterDataTableUpdate" grep -q masterDataTableUpdate "$ROOT/frontend/src/api.js"
check "SKILL anti-browser" grep -q 'never browser' "$ROOT/openclaw-skills/agent-os-content-tools/SKILL.md"
check "TOOLS anti-browser" grep -q 'browser tool for Master Data' "$ROOT/openclaw-workspace-templates/balserve/TOOLS.md"

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

echo "==> DB runtime"
docker compose exec -T backend node <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const db = getDb();
const mdTools = db.prepare("SELECT COUNT(*) AS c FROM content_tools_meta WHERE name LIKE 'master_data_%'").get().c;
const mdGrants = db.prepare("SELECT COUNT(*) AS c FROM agent_tool_grants WHERE tool_name LIKE 'master_data_%'").get().c;
const cols = db.prepare('PRAGMA table_info(agent_delegation_tasks)').all().map((c) => c.name);
console.log('    master_data tools meta:', mdTools, 'grants:', mdGrants);
console.log('    delegation owner_user_id:', cols.includes('owner_user_id') ? 'OK' : 'MISSING');
if (mdTools < 7) throw new Error('expected at least 7 master_data tools in content_tools_meta');
NODE

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
