#!/usr/bin/env bash
# Smoke: Ollama deepseek-v3 + Brain summarize workflow (no cloud API key).
set -euo pipefail

ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "==> Ensure Ollama + deepseek-v3"
sed -i 's/\r$//' "$ROOT/deploy/scripts/ensure-deepseek-env.sh" 2>/dev/null || true
PULL_DEEPSEEK=1 bash "$ROOT/deploy/scripts/ensure-deepseek-env.sh" "$ROOT/deploy/.env"

MODEL=$(grep -E '^DEEPSEEK_MODEL=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || echo deepseek-v3)
MODEL="${MODEL:-deepseek-v3}"

if ! docker compose exec -T ollama ollama list 2>/dev/null | grep -qE "^${MODEL}[[:space:]:]"; then
  echo "ERROR: Ollama model $MODEL not available — pull failed or not enough resources"
  docker compose exec -T ollama ollama list || true
  free -h | head -2 || true
  df -h / | tail -1 || true
  exit 1
fi

echo "==> Brain workflow summarize via Ollama DeepSeek ($MODEL)"
docker compose exec -T -w /opt/agent-os/backend \
  -e DEEPSEEK_BASE_URL=http://ollama:11434/v1 \
  -e DEEPSEEK_MODEL="$MODEL" \
  -e OLLAMA_BASE_URL=http://ollama:11434 \
  backend node scripts/test-deepseek-brain-workflow.js

echo "SMOKE_DEEPSEEK_BRAIN_DONE"
