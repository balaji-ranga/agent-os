#!/usr/bin/env bash
# Run full post-CEO-login regression against the backend inside Docker on the VPS.
# Mints a CEO session (avoids MFA / password) and sets AGENT_OS_REGRESSION_TOKEN.
#
# Usage (on VPS, from deploy/):
#   bash scripts/vps-regression-full.sh
#   REGRESSION_CEO_EMAIL=bala@agent-os.local bash scripts/vps-regression-full.sh
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml:docker-compose.vps-client-ip.yml}"

echo "==> full regression (post CEO login) via backend container"

# Prefer host-synced tests (may be ahead of the image), fall back to image-baked /opt/agent-os/tests.
docker compose exec -T backend mkdir -p /opt/agent-os/tests/lib

# Keep goal-plan e2e script in the image for full pack + optional direct run
if [[ -f "$ROOT/backend/scripts/test-goal-plan-adhoc-e2e.mjs" ]]; then
  docker compose exec -T backend mkdir -p /opt/agent-os/backend/scripts
  docker compose cp "$ROOT/backend/scripts/test-goal-plan-adhoc-e2e.mjs" backend:/opt/agent-os/backend/scripts/test-goal-plan-adhoc-e2e.mjs
  docker compose cp "$ROOT/backend/scripts/_test-goal-plan-acceptance.mjs" backend:/opt/agent-os/backend/scripts/_test-goal-plan-acceptance.mjs 2>/dev/null || true
  docker compose cp "$ROOT/backend/scripts/_test-goal-plan-multistep.mjs" backend:/opt/agent-os/backend/scripts/_test-goal-plan-multistep.mjs 2>/dev/null || true
  docker compose cp "$ROOT/backend/src/services/agent-goal-run.js" backend:/opt/agent-os/backend/src/services/agent-goal-run.js 2>/dev/null || true
  docker compose cp "$ROOT/backend/src/services/goal-plan-specialty.js" backend:/opt/agent-os/backend/src/services/goal-plan-specialty.js 2>/dev/null || true
fi

if [[ -f "$ROOT/tests/regression-full.js" ]]; then
  docker compose cp "$ROOT/tests/regression-full.js" backend:/opt/agent-os/tests/regression-full.js
  docker compose cp "$ROOT/tests/regression-minimal.js" backend:/opt/agent-os/tests/regression-minimal.js
  docker compose cp "$ROOT/tests/lib/ceo-session.js" backend:/opt/agent-os/tests/lib/ceo-session.js
fi

if ! docker compose exec -T backend test -f /opt/agent-os/tests/regression-full.js; then
  echo "ERROR: tests/regression-full.js missing in backend container — rebuild backend image"
  exit 1
fi

CEO_EMAIL="${REGRESSION_CEO_EMAIL:-${AGENT_OS_BALA_EMAIL:-bala@agent-os.local}}"
TOKEN=$(docker compose exec -T -w /opt/agent-os/backend -e CEO_EMAIL="$CEO_EMAIL" backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import { createSession } from './src/services/auth/session.js';
initDb();
const email = String(process.env.CEO_EMAIL || 'bala@agent-os.local').trim();
const row =
  getDb().prepare("SELECT id FROM platform_users WHERE email = ? AND role='ceo' AND enabled=1").get(email) ||
  getDb().prepare("SELECT id FROM platform_users WHERE id = 'ceo-bala' AND enabled=1").get() ||
  getDb().prepare("SELECT id FROM platform_users WHERE role='ceo' AND enabled=1 ORDER BY rowid LIMIT 1").get();
if (!row) {
  console.error('no CEO user for regression');
  process.exit(2);
}
console.error(`[regression] minting session for ${row.id}`);
process.stdout.write(createSession(row.id).token);
NODE
)

if [[ -z "${TOKEN:-}" ]]; then
  echo "ERROR: could not mint CEO session for regression"
  exit 1
fi

echo "    minted session for ${CEO_EMAIL}"
docker compose exec -T -w /opt/agent-os \
  -e BASE_URL=http://127.0.0.1:3001 \
  -e AGENT_OS_REGRESSION_TOKEN="$TOKEN" \
  -e REGRESSION_GOAL_PLAN="${REGRESSION_GOAL_PLAN:-1}" \
  -e REGRESSION_GOAL_PLAN_FORCE_TERMINAL="${REGRESSION_GOAL_PLAN_FORCE_TERMINAL:-1}" \
  backend node tests/regression-full.js
