#!/usr/bin/env bash
# Social Researcher + Business Discovery: tools, MCP, Instaloader, Exchange, agent chat.
# Places live search is skipped when GOOGLE_PLACES_API_KEY is unset (asserts 503).
set -euo pipefail
ROOT="${AGENT_OS_ROOT:-/opt/agent-os}"
cd "$ROOT/deploy"
set -a
# shellcheck disable=SC1091
source "$ROOT/deploy/.env" 2>/dev/null || true
set +a

echo "==> social-research-mcp + instaloader-sidecar"
docker compose --env-file .env --profile optional-social-research-mcp up -d instaloader-sidecar social-research-mcp
for i in $(seq 1 30); do
  if docker compose --env-file .env exec -T social-research-mcp \
    node -e "fetch('http://127.0.0.1:8084/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "    social-research-mcp healthy"
    break
  fi
  sleep 2
done

echo "==> places free-text parse"
docker compose --env-file .env exec -T -w /opt/agent-os/backend \
  backend node scripts/test-places-parse-text.mjs

echo "==> vps-test-social-research.mjs"
docker compose --env-file .env exec -T -w /opt/agent-os/backend \
  -e SKIP_CHAT="${SKIP_CHAT:-0}" \
  backend node scripts/vps-test-social-research.mjs

echo "VPS_SOCIAL_RESEARCH_SMOKE_OK"
