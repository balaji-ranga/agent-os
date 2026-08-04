#!/usr/bin/env bash
# Verify Scheduled Goals feature on VPS (or any compose stack).
# Usage:
#   bash deploy/scripts/vps-verify-scheduled-goals.sh
#   ROOT=/opt/agent-os bash deploy/scripts/vps-verify-scheduled-goals.sh
set -euo pipefail

ROOT="${ROOT:-${AGENT_OS_ROOT:-/opt/agent-os}}"
cd "$ROOT/deploy" 2>/dev/null || cd "$ROOT"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml:docker-compose.docker-tools.yml}"

fail=0
ok() { echo "  OK  $1"; }
bad() { echo "  FAIL $1"; fail=$((fail + 1)); }

echo "==> scheduled goals — source / compose / docs"
if grep -q 'SCHEDULED_GOALS_CRON' "$ROOT/deploy/docker-compose.yml" 2>/dev/null; then
  ok "compose injects SCHEDULED_GOALS_CRON"
else
  bad "compose missing SCHEDULED_GOALS_CRON"
fi
if grep -q 'SCHEDULED_GOALS_CRON' "$ROOT/deploy/.env.example" 2>/dev/null; then
  ok "deploy/.env.example mentions SCHEDULED_GOALS_CRON"
else
  bad "deploy/.env.example missing SCHEDULED_GOALS_CRON"
fi
if grep -q 'SCHEDULED_GOALS_CRON' "$ROOT/backend/.env.example" 2>/dev/null; then
  ok "backend/.env.example mentions SCHEDULED_GOALS_CRON"
else
  bad "backend/.env.example missing SCHEDULED_GOALS_CRON"
fi
if grep -q 'scheduled_goals' "$ROOT/backend/src/index.js" 2>/dev/null; then
  ok "backend registers scheduled_goals cron"
else
  bad "backend/src/index.js missing scheduled_goals cron"
fi
if test -f "$ROOT/backend/src/services/scheduled-goals.js"; then
  ok "scheduled-goals service present"
else
  bad "scheduled-goals service missing"
fi
if test -f "$ROOT/backend/src/routes/scheduled-goals.js"; then
  ok "scheduled-goals routes present"
else
  bad "scheduled-goals routes missing"
fi
if test -f "$ROOT/frontend/src/pages/ScheduledGoals.jsx"; then
  ok "frontend ScheduledGoals page present"
else
  bad "frontend ScheduledGoals page missing"
fi
if grep -q 'scheduledGoalsList' "$ROOT/frontend/src/api.js" 2>/dev/null; then
  ok "frontend api scheduledGoalsList"
else
  bad "frontend api missing scheduledGoals"
fi
if grep -q 'scheduled-goals' "$ROOT/frontend/src/App.jsx" 2>/dev/null; then
  ok "App.jsx route /scheduled-goals"
else
  bad "App.jsx missing scheduled-goals route"
fi
if grep -q 'Scheduled goals' "$ROOT/frontend/src/components/AppNavMenu.jsx" 2>/dev/null; then
  ok "nav Scheduled goals"
else
  bad "nav missing Scheduled goals"
fi
if grep -q 'SCHEDULED_GOALS_CRON' "$ROOT/knowledgebase/platform-help/19-scheduled-jobs-and-crons.md" 2>/dev/null; then
  ok "help 19 documents SCHEDULED_GOALS_CRON"
else
  bad "help 19 missing SCHEDULED_GOALS_CRON"
fi
if grep -q 'scheduled.goal' "$ROOT/openclaw-workspace-templates/balserve/AGENTS.md" 2>/dev/null \
  || grep -q 'scheduled_goal' "$ROOT/openclaw-workspace-templates/balserve/AGENTS.md" 2>/dev/null; then
  ok "COO AGENTS.md scheduled goals"
else
  bad "COO AGENTS.md missing scheduled_goal tools"
fi

echo "==> scheduled goals — live backend (container)"
if ! docker compose ps backend 2>/dev/null | grep -q 'Up\|running'; then
  # try name filter
  if ! docker ps --format '{{.Names}}' | grep -q 'backend'; then
    bad "backend container not running"
    echo "SCHEDULED_GOALS_VERIFY_FAILED"
    exit 1
  fi
fi

BE="${BACKEND_CONTAINER:-}"
if [[ -z "$BE" ]]; then
  BE="$(docker ps --format '{{.Names}}' | grep -E 'backend' | head -1 || true)"
fi
if [[ -z "$BE" ]]; then
  bad "could not resolve backend container name"
  echo "SCHEDULED_GOALS_VERIFY_FAILED"
  exit 1
fi
ok "backend container=$BE"

# Ensure smoke script is inside container
if [[ -f "$ROOT/backend/scripts/_smoke-scheduled-goals.mjs" ]]; then
  docker cp "$ROOT/backend/scripts/_smoke-scheduled-goals.mjs" "$BE:/opt/agent-os/backend/scripts/_smoke-scheduled-goals.mjs" 2>/dev/null || true
fi

if docker exec -w /opt/agent-os/backend "$BE" node scripts/_smoke-scheduled-goals.mjs 2>&1 | tee /tmp/sg-smoke.log | tail -20; then
  if grep -q 'SCHEDULED_GOALS_SMOKE_OK' /tmp/sg-smoke.log; then
    ok "CRUD smoke SCHEDULED_GOALS_SMOKE_OK"
  else
    bad "smoke did not print SCHEDULED_GOALS_SMOKE_OK"
  fi
else
  bad "smoke script failed"
fi

# Avoid grep -q under pipefail: early exit can SIGPIPE docker logs (nonzero pipeline).
_sg_logs="$(docker logs --tail 800 "$BE" 2>&1 || true)"
if printf '%s' "$_sg_logs" | grep -E -q 'registered: scheduled_goals|id=scheduled_goals'; then
  ok "platform-cron registered scheduled_goals (logs)"
else
  bad "scheduled_goals not in platform-cron logs"
fi

# Public HTTP unauth
code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/api/scheduled-goals 2>/dev/null || echo 000)"
if [[ "$code" == "401" || "$code" == "403" ]]; then
  ok "GET /api/scheduled-goals unauth=$code"
else
  bad "GET /api/scheduled-goals expected 401/403 got $code"
fi

FE="$(docker ps --format '{{.Names}}' | grep -E 'frontend' | head -1 || true)"
if [[ -n "$FE" ]]; then
  if docker exec "$FE" sh -c 'grep -Rql "Scheduled goals\|scheduled-goals\|scheduledGoalsList" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
    ok "frontend bundle includes Scheduled goals"
  else
    bad "frontend bundle missing Scheduled goals markers"
  fi
else
  bad "frontend container not found"
fi

# Tools in meta live
tools_n="$(docker exec -w /opt/agent-os/backend "$BE" node --input-type=module -e "
import { getDb } from './src/db/schema.js';
const n = getDb().prepare(\"SELECT COUNT(*) AS n FROM content_tools_meta WHERE name LIKE 'scheduled_goal_%'\").get().n;
console.log(n);
" 2>/dev/null | tr -d '\r' | tail -1)"
if [[ "${tools_n:-0}" -ge 5 ]]; then
  ok "content_tools_meta scheduled_goal_* count=$tools_n"
else
  bad "content_tools_meta scheduled_goal count=$tools_n (want >=5)"
fi

if [[ "$fail" -gt 0 ]]; then
  echo "SCHEDULED_GOALS_VERIFY_FAILED fails=$fail"
  exit 1
fi
echo "SCHEDULED_GOALS_VERIFY_OK"
exit 0
