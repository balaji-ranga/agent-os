#!/usr/bin/env bash
# Smoke: optional-deepseek profile + Brain summarize workflow.
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "==> DeepSeek proxy health"
if ! grep -qE '^DEEPSEEK_API_KEY=.+' .env 2>/dev/null; then
  echo "ERROR: DEEPSEEK_API_KEY not set in deploy/.env"
  exit 1
fi

docker compose --profile optional-deepseek build deepseek
docker compose --profile optional-deepseek up -d deepseek

for i in $(seq 1 30); do
  if docker compose exec -T deepseek curl -fsS http://127.0.0.1:8080/health 2>/dev/null | grep -q '"ok":true'; then
    echo "    deepseek proxy healthy"
    break
  fi
  sleep 2
done

docker compose exec -T deepseek curl -fsS http://127.0.0.1:8080/health || {
  echo "ERROR: deepseek proxy health failed"
  exit 1
}

echo "==> Brain workflow summarize via DeepSeek"
docker compose exec -T -w /opt/agent-os/backend backend node scripts/test-deepseek-brain-workflow.js

echo "SMOKE_DEEPSEEK_BRAIN_DONE"
