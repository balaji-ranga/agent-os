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
if grep -q 'GOAL_PLAN_FAILURE_KANBAN' "$ROOT/deploy/docker-compose.yml" 2>/dev/null \
  && grep -q 'GOAL_PLAN_MAX_SPECIALTY' "$ROOT/deploy/docker-compose.yml" 2>/dev/null \
  && grep -q 'SCHEDULED_GOAL_CHAT_TIMEOUT_MS' "$ROOT/deploy/docker-compose.yml" 2>/dev/null \
  && grep -q 'WORKFLOW_TERMINAL_WATCH_CRON' "$ROOT/deploy/docker-compose.yml" 2>/dev/null; then
  ok "compose injects GOAL_PLAN_* / SCHEDULED_GOAL_CHAT / WORKFLOW_TERMINAL_WATCH"
else
  bad "compose missing goal-plan env (GOAL_PLAN_MAX_SPECIALTY / SCHEDULED_GOAL_CHAT_TIMEOUT_MS / WORKFLOW_TERMINAL_WATCH_CRON)"
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
if grep -qE 'scheduled-goals|Scheduled goals' "$ROOT/frontend/src/utils/ceoNavCatalog.js" 2>/dev/null \
  || grep -qE 'scheduled-goals|Scheduled goals' "$ROOT/frontend/src/components/AppNavMenu.jsx" 2>/dev/null; then
  ok "nav Scheduled goals"
else
  bad "nav missing Scheduled goals (ceoNavCatalog.js or AppNavMenu.jsx)"
fi
if grep -q 'SCHEDULED_GOALS_CRON' "$ROOT/knowledgebase/platform-help/19-scheduled-jobs-and-crons.md" 2>/dev/null; then
  ok "help 19 documents SCHEDULED_GOALS_CRON"
else
  bad "help 19 missing SCHEDULED_GOALS_CRON"
fi
if grep -q 'COO vs other employees' "$ROOT/knowledgebase/platform-help/28-scheduled-goals.md" 2>/dev/null \
  && grep -q 'Save & schedule' "$ROOT/knowledgebase/platform-help/28-scheduled-goals.md" 2>/dev/null; then
  ok "help 28 documents COO-only Generate draft vs Save & schedule"
else
  bad "help 28 missing COO vs other employees / Save & schedule"
fi
if grep -q 'agentAllowsScheduledGoalPlan' "$ROOT/backend/src/services/scheduled-goals.js" 2>/dev/null \
  && grep -q 'is_coo' "$ROOT/backend/src/services/scheduled-goals.js" 2>/dev/null; then
  ok "API gates plan preview/set to is_coo"
else
  bad "scheduled-goals.js missing agentAllowsScheduledGoalPlan / is_coo"
fi
if grep -q 'COO_PLAN_TIP' "$ROOT/frontend/src/pages/ScheduledGoals.jsx" 2>/dev/null \
  && grep -q 'agentIsCoo' "$ROOT/frontend/src/pages/ScheduledGoals.jsx" 2>/dev/null; then
  ok "frontend Generate draft gated to COO"
else
  bad "ScheduledGoals.jsx missing COO_PLAN_TIP / agentIsCoo"
fi
if grep -qE 'hourly|Hourly' "$ROOT/knowledgebase/platform-help/28-scheduled-goals.md" 2>/dev/null; then
  ok "help 28 documents hourly cadence"
else
  bad "help 28 missing hourly cadence"
fi
if grep -qE 'Edit|edit' "$ROOT/knowledgebase/platform-help/28-scheduled-goals.md" 2>/dev/null; then
  ok "help 28 documents edit"
else
  bad "help 28 missing edit"
fi
if grep -q 'Execution trace' "$ROOT/knowledgebase/platform-help/28-scheduled-goals.md" 2>/dev/null \
  && grep -q 'goal_created' "$ROOT/knowledgebase/platform-help/28-scheduled-goals.md" 2>/dev/null; then
  ok "help 28 documents execution trace / telemetry"
else
  bad "help 28 missing execution trace / telemetry"
fi
if test -f "$ROOT/frontend/src/pages/GoalPlanDetail.jsx" \
  && grep -q 'Execution telemetry' "$ROOT/frontend/src/components/GoalPlanTelemetry.jsx" 2>/dev/null; then
  ok "frontend Goal execution trace page"
else
  bad "frontend missing GoalPlanDetail / GoalPlanTelemetry"
fi
if grep -q "28-scheduled-goals.md" "$ROOT/backend/src/services/ceo-default-master-data.js" 2>/dev/null; then
  ok "PLATFORM_HELP catalog includes 28"
else
  bad "ceo-default-master-data missing 28 catalog entry"
fi
if grep -q "hourly" "$ROOT/backend/src/services/scheduled-goals.js" 2>/dev/null \
  && grep -q "normalizeCadence" "$ROOT/backend/src/services/scheduled-goals.js" 2>/dev/null; then
  ok "service supports hourly cadence"
else
  bad "service missing hourly cadence"
fi
if grep -q "scheduledGoalsUpdate" "$ROOT/frontend/src/api.js" 2>/dev/null; then
  ok "frontend api scheduledGoalsUpdate (edit)"
else
  bad "frontend api missing scheduledGoalsUpdate"
fi
if grep -q openEdit "$ROOT/frontend/src/pages/ScheduledGoals.jsx" 2>/dev/null \
  && grep -q hourly "$ROOT/frontend/src/pages/ScheduledGoals.jsx" 2>/dev/null; then
  ok "frontend ScheduledGoals.jsx edit + hourly UI"
else
  bad "frontend ScheduledGoals.jsx missing Edit/hourly"
fi
if grep -q 'scheduled.goal' "$ROOT/openclaw-workspace-templates/balserve/AGENTS.md" 2>/dev/null \
  || grep -q 'scheduled_goal' "$ROOT/openclaw-workspace-templates/balserve/AGENTS.md" 2>/dev/null; then
  ok "COO AGENTS.md scheduled goals"
else
  bad "COO AGENTS.md missing scheduled_goal tools"
fi
if grep -q 'deliver_to' "$ROOT/backend/src/services/scheduled-goals.js" 2>/dev/null \
  && test -f "$ROOT/backend/src/services/agent-channel-announce.js"; then
  ok "scheduled-goals deliver_to + agent-channel-announce"
else
  bad "missing deliver_to / agent-channel-announce.js"
fi
if grep -q 'From: <your employee name>' "$ROOT/openclaw-workspace-templates/_shared/AGENT-OS-OPS.md" 2>/dev/null \
  || grep -q 'From: <your name>' "$ROOT/openclaw-workspace-templates/_shared/AGENT-OS-OPS.md" 2>/dev/null; then
  ok "AGENT-OS-OPS WhatsApp From: agent name"
else
  bad "AGENT-OS-OPS missing From: agent name on WhatsApp"
fi
if grep -q 'WHATSAPP_FROM_RESPONSE_PREFIX' "$ROOT/scripts/lib/openclaw-whatsapp-from-prefix.js" 2>/dev/null \
  && grep -q 'applyWhatsAppFromPrefixToChannel' "$ROOT/backend/src/services/openclaw-channels-config.js" 2>/dev/null \
  && grep -q 'applyIdentityNameToAgentEntry' "$ROOT/backend/src/services/openclaw-tenant.js" 2>/dev/null; then
  ok "WhatsApp From: prefix (responsePrefix + identity.name)"
else
  bad "missing WhatsApp From: responsePrefix wiring"
fi
if grep -q 'deliver_whatsapp' "$ROOT/frontend/src/pages/ScheduledGoals.jsx" 2>/dev/null; then
  ok "frontend WhatsApp deliver-to checkbox"
else
  bad "ScheduledGoals.jsx missing deliver_whatsapp"
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

if [[ -f "$ROOT/backend/scripts/test-agent-channel-announce.mjs" ]]; then
  docker cp "$ROOT/backend/scripts/test-agent-channel-announce.mjs" "$BE:/opt/agent-os/backend/scripts/test-agent-channel-announce.mjs" 2>/dev/null || true
  if docker exec -w /opt/agent-os/backend "$BE" node scripts/test-agent-channel-announce.mjs 2>&1 | tee /tmp/sg-announce-unit.log | tail -5; then
    if grep -q 'CHANNEL_ANNOUNCE_UNIT_OK' /tmp/sg-announce-unit.log; then
      ok "channel announce unit CHANNEL_ANNOUNCE_UNIT_OK"
    else
      bad "announce unit did not print CHANNEL_ANNOUNCE_UNIT_OK"
    fi
  else
    bad "test-agent-channel-announce.mjs failed"
  fi
else
  bad "test-agent-channel-announce.mjs missing"
fi

if [[ -f "$ROOT/backend/scripts/test-openclaw-delivery-noise.mjs" ]]; then
  docker cp "$ROOT/backend/scripts/test-openclaw-delivery-noise.mjs" "$BE:/opt/agent-os/backend/scripts/test-openclaw-delivery-noise.mjs" 2>/dev/null || true
  if docker exec -w /opt/agent-os/backend "$BE" node scripts/test-openclaw-delivery-noise.mjs 2>&1 | tee /tmp/sg-delivery-noise-unit.log | tail -5; then
    if grep -q 'OPENCLAW_DELIVERY_NOISE_OK' /tmp/sg-delivery-noise-unit.log; then
      ok "delivery-noise unit OPENCLAW_DELIVERY_NOISE_OK"
    else
      bad "delivery-noise unit did not print OPENCLAW_DELIVERY_NOISE_OK"
    fi
  else
    bad "test-openclaw-delivery-noise.mjs failed"
  fi
else
  bad "test-openclaw-delivery-noise.mjs missing"
fi

if [[ -f "$ROOT/scripts/lib/test-openclaw-whatsapp-from-prefix.mjs" ]]; then
  if node "$ROOT/scripts/lib/test-openclaw-whatsapp-from-prefix.mjs" 2>&1 | tee /tmp/wa-from-prefix-unit.log | tail -5; then
    if grep -q 'WHATSAPP_FROM_PREFIX_UNIT_OK' /tmp/wa-from-prefix-unit.log; then
      ok "WhatsApp From: prefix unit WHATSAPP_FROM_PREFIX_UNIT_OK"
    else
      bad "from-prefix unit did not print WHATSAPP_FROM_PREFIX_UNIT_OK"
    fi
  else
    bad "test-openclaw-whatsapp-from-prefix.mjs failed"
  fi
else
  bad "test-openclaw-whatsapp-from-prefix.mjs missing"
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
    bad "frontend bundle missing Scheduled goals markers — rebuild frontend (sync -Services frontend)"
  fi
  if docker exec "$FE" sh -c 'grep -Rql "Save changes\|Edit scheduled goal\|scheduledGoalsUpdate" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
    ok "frontend bundle includes Edit goal UI"
  else
    bad "frontend bundle missing Edit UI — deploy 19c76b3+ / rebuild frontend"
  fi
  if docker exec "$FE" sh -c 'grep -Rql "Save \& schedule\|Execution plans apply only to the COO" /usr/share/nginx/html/assets/*.js 2>/dev/null'; then
    ok "frontend bundle includes COO-only plan / Save & schedule"
  else
    bad "frontend bundle missing COO-only Generate draft copy — rebuild frontend"
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
