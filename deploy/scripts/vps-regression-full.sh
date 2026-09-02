#!/usr/bin/env bash
# Run the full regression against an isolated, disposable CEO tenant on the VPS.
# A trap always offboards the fixture and verifies owner-scoped rows are gone.
#
# Usage (on VPS, from deploy/):
#   bash scripts/vps-regression-full.sh
#   bash scripts/vps-regression-full.sh
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
  docker compose cp "$ROOT/backend/scripts/test-goal-plan-async-ui.mjs" backend:/opt/agent-os/backend/scripts/test-goal-plan-async-ui.mjs 2>/dev/null || true
  docker compose cp "$ROOT/backend/scripts/_test-goal-plan-acceptance.mjs" backend:/opt/agent-os/backend/scripts/_test-goal-plan-acceptance.mjs 2>/dev/null || true
  docker compose cp "$ROOT/backend/scripts/_test-goal-plan-multistep.mjs" backend:/opt/agent-os/backend/scripts/_test-goal-plan-multistep.mjs 2>/dev/null || true
  docker compose cp "$ROOT/backend/src/services/agent-goal-run.js" backend:/opt/agent-os/backend/src/services/agent-goal-run.js 2>/dev/null || true
  docker compose cp "$ROOT/backend/src/services/goal-plan-specialty.js" backend:/opt/agent-os/backend/src/services/goal-plan-specialty.js 2>/dev/null || true
  docker compose cp "$ROOT/backend/src/services/agent-workflow-run-watch.js" backend:/opt/agent-os/backend/src/services/agent-workflow-run-watch.js 2>/dev/null || true
fi

if [[ -f "$ROOT/tests/regression-full.js" ]]; then
  docker compose cp "$ROOT/tests/regression-full.js" backend:/opt/agent-os/tests/regression-full.js
  docker compose cp "$ROOT/tests/regression-minimal.js" backend:/opt/agent-os/tests/regression-minimal.js
  docker compose cp "$ROOT/tests/lib/ceo-session.js" backend:/opt/agent-os/tests/lib/ceo-session.js
fi

for script in regression-test-user.mjs test-chat-context-boundaries.mjs test-delegation-result-callback.mjs test-company-llm-design.mjs test-model-routing-registry.mjs; do
  if [[ -f "$ROOT/backend/scripts/$script" ]]; then
    docker compose cp "$ROOT/backend/scripts/$script" "backend:/opt/agent-os/backend/scripts/$script"
  fi
done

if ! docker compose exec -T backend test -f /opt/agent-os/tests/regression-full.js; then
  echo "ERROR: tests/regression-full.js missing in backend container — rebuild backend image"
  exit 1
fi

echo "==> remove stale tagged regression users/data"
docker compose exec -T -w /opt/agent-os/backend backend \
  node scripts/regression-test-user.mjs cleanup-stale

echo "==> create isolated regression CEO"
CREATE_OUTPUT=$(docker compose exec -T -w /opt/agent-os/backend backend \
  node scripts/regression-test-user.mjs create)
FIXTURE_LINE=$(printf '%s\n' "$CREATE_OUTPUT" | grep '^REGRESSION_FIXTURE|' | tail -n 1)
if [[ -z "${FIXTURE_LINE:-}" ]]; then
  echo "ERROR: could not create isolated regression CEO"
  exit 1
fi
IFS='|' read -r _FIXTURE_MARKER REGRESSION_CEO_ID REGRESSION_CEO_EMAIL TOKEN <<<"$FIXTURE_LINE"
if [[ -z "${REGRESSION_CEO_ID:-}" || -z "${TOKEN:-}" ]]; then
  echo "ERROR: malformed regression fixture output"
  exit 1
fi

cleanup_fixture() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  echo "==> cleanup isolated regression CEO/data id=${REGRESSION_CEO_ID:-unknown}"
  if [[ -n "${REGRESSION_CEO_ID:-}" ]]; then
    docker compose exec -T -w /opt/agent-os/backend backend \
      node scripts/regression-test-user.mjs cleanup "$REGRESSION_CEO_ID"
    [[ $? -eq 0 ]] || status=1
  fi
  docker compose exec -T -w /opt/agent-os/backend backend \
    node scripts/regression-test-user.mjs cleanup-stale
  [[ $? -eq 0 ]] || status=1
  exit "$status"
}
trap cleanup_fixture EXIT INT TERM

echo "    isolated CEO id=${REGRESSION_CEO_ID} email=${REGRESSION_CEO_EMAIL}"
docker compose exec -T -w /opt/agent-os \
  -e BASE_URL=http://127.0.0.1:3001 \
  -e AGENT_OS_REGRESSION_TOKEN="$TOKEN" \
  -e REGRESSION_ISOLATED_USER=1 \
  -e REGRESSION_COMPANY_LIFECYCLE="${REGRESSION_COMPANY_LIFECYCLE:-1}" \
  -e REGRESSION_CEO_ID="$REGRESSION_CEO_ID" \
  -e REGRESSION_GOAL_PLAN="${REGRESSION_GOAL_PLAN:-1}" \
  -e REGRESSION_GOAL_PLAN_FORCE_TERMINAL="${REGRESSION_GOAL_PLAN_FORCE_TERMINAL:-1}" \
  backend node tests/regression-full.js
