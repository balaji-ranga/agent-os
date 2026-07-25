#!/usr/bin/env bash
# Post-deploy smoke for agent budgets, Efficiency Agent View, and org leaf members.
# Runs schema/ledger verify, mock-A2A delegation e2e, authenticated API checks, and SPA markers.
#
# Usage (on VPS, from deploy/):
#   bash scripts/vps-smoke-budgets-org-members.sh
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml}"

echo "==> smoke: agent budgets + Agent View + org leaf members"

fail=0

run_js() {
  local script="$1"
  local label="$2"
  if docker compose exec -T -w /opt/agent-os/backend backend test -f "scripts/${script}"; then
    if docker compose exec -T -w /opt/agent-os/backend backend node "scripts/${script}"; then
      echo "    ${label} OK"
    else
      echo "    FAIL: ${label}"
      fail=1
    fi
  else
    echo "    FAIL: scripts/${script} missing in backend image (rebuild backend)"
    fail=1
  fi
}

run_js "verify-budgets-org-members.js" "schema + ledger + warn-then-block"
run_js "verify-module-graph.js" "module graph (no circular import breaks)"
run_js "test-org-member-delegation-e2e.js" "COO → external leaf member delegation e2e"
run_js "verify-agent-view-api.js" "authenticated Agent View / budgets / org-members API"

# Frontend SPA markers
if docker compose exec -T frontend sh -c 'grep -Rql "Agent View" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend: Agent View tab OK"
else
  echo "    FAIL: Agent View tab missing from frontend bundle"
  fail=1
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Add to org" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend: Add to org OK"
else
  echo "    FAIL: Add to org missing from frontend bundle"
  fail=1
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Department tokens this month" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend: Department tab OK"
else
  echo "    FAIL: Department tab missing from frontend bundle"
  fail=1
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Reset usage" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend: Reset usage OK"
else
  echo "    FAIL: Reset usage missing from frontend bundle"
  fail=1
fi
if docker compose exec -T frontend sh -c 'grep -Rql "Research AI trends and give me Q2 expense report" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    FAIL: outdated Standup multi-intent blurb still in bundle"
  fail=1
else
  echo "    frontend: Standup multi-intent blurb removed OK"
fi
if docker compose exec -T frontend sh -c 'grep -Rql "n/a for external agents" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
  echo "    frontend: leaf KPI n/a tip OK"
else
  echo "    FAIL: leaf KPI n/a tip missing from frontend bundle"
  fail=1
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css 2>/dev/null | grep -q eff-na'; then
  echo "    frontend: leaf KPI n/a CSS OK"
else
  echo "    FAIL: eff-na CSS missing"
  fail=1
fi
if docker compose exec -T frontend sh -c 'cat /usr/share/nginx/html/assets/*.css 2>/dev/null | grep -q eff-gauge'; then
  echo "    frontend: budget gauge CSS OK"
else
  echo "    FAIL: eff-gauge CSS missing"
  fail=1
fi

# Platform Help corpus on disk in the image
if docker compose exec -T backend test -f /opt/agent-os/knowledgebase/platform-help/18-agent-budgets-and-org-members.md; then
  echo "    platform-help 18-agent-budgets-and-org-members.md OK"
else
  echo "    FAIL: help doc 18 missing from backend image"
  fail=1
fi

# Help doc seeded into Master Data for at least one CEO (tenant DB via listDocuments)
HELP_COUNT=$(docker compose exec -T -w /opt/agent-os/backend backend node --input-type=module <<'NODE' 2>/dev/null || echo 0
import { initDb, getDb } from './src/db/schema.js';
import { listDocuments } from './src/services/master-data.js';
initDb();
const ceos = getDb().prepare("SELECT id FROM platform_users WHERE role='ceo' AND enabled=1").all();
let hits = 0;
for (const c of ceos) {
  try {
    const docs = listDocuments(c.id) || [];
    hits += docs.filter(
      (d) =>
        String(d.title || '').includes('Agent Budgets Org Members') ||
        String(d.filename || '').includes('18-agent-budgets')
    ).length;
  } catch {
    /* tenant db missing */
  }
}
process.stdout.write(String(hits));
NODE
)
if [[ "${HELP_COUNT}" =~ ^[0-9]+$ ]] && [[ "${HELP_COUNT}" -gt 0 ]]; then
  echo "    Master Data help doc 18 seeded (${HELP_COUNT} rows) OK"
else
  echo "    FAIL: help doc 18 not seeded into Master Data (count=${HELP_COUNT})"
  fail=1
fi

if [[ "$fail" != "0" ]]; then
  echo "SMOKE_BUDGETS_ORG_MEMBERS_FAILED"
  exit 1
fi
echo "SMOKE_BUDGETS_ORG_MEMBERS_DONE"
