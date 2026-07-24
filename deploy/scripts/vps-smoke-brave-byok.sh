#!/usr/bin/env bash
# Seed + test Balaji Brave BYOK workflow on VPS (keys from deploy/.env as *run input* only).
set -euo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
set -a
# shellcheck disable=SC1091
source "$ROOT/deploy/.env" 2>/dev/null || true
set +a

echo "==> ensure brave-search-mcp BYOK is up"
docker compose --profile optional-brave-mcp up -d --build brave-search-mcp
for i in $(seq 1 30); do
  if docker compose exec -T brave-search-mcp node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "    brave-search-mcp healthy"
    break
  fi
  sleep 2
done

echo "==> seed + e2e test (BRAVE_API_KEY / DEEPSEEK used as workflow input only)"
docker compose exec -T \
  -e BRAVE_API_KEY="${BRAVE_API_KEY:-}" \
  -e DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}" \
  -e OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  -e OPENAI_PRIMARY_API_KEY="${OPENAI_PRIMARY_API_KEY:-}" \
  -w /opt/agent-os/backend \
  backend node scripts/test-balaji-brave-byok-workflow.js

echo "VPS_BRAVE_BYOK_SMOKE_OK"
