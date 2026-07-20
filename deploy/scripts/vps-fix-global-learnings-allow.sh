#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "=== Add learnings_summary to global tools.allow ==="
docker compose exec -T openclaw node <<'NODE'
const fs = require('fs');
const path = '/root/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(path, 'utf8'));
c.tools = c.tools || {};
if (!Array.isArray(c.tools.allow)) c.tools.allow = [];
const need = ['learnings_summary', 'brain_history', 'content_tools_enquire', 'kanban_create_task'];
let added = [];
for (const t of need) {
  if (!c.tools.allow.includes(t)) {
    c.tools.allow.push(t);
    added.push(t);
  }
}
fs.writeFileSync(path, JSON.stringify(c, null, 2));
console.log('added to global tools.allow:', added.length ? added.join(',') : '(none)');
console.log('global has learnings', c.tools.allow.includes('learnings_summary'));
NODE

docker compose restart openclaw
echo "cooling 50s…"
sleep 50

TOKEN=$(docker compose exec -T openclaw node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)' | tr -d '\r')
BACKEND_WD=/opt/agent-os/backend
docker compose exec -T backend test -f /opt/agent-os/backend/scripts/test-coo-tools-prompt-e2e.js || BACKEND_WD=/app

# Ensure test script is current
docker cp /tmp/test-coo-tools-prompt-e2e.js "$(docker compose ps -q backend)":$BACKEND_WD/scripts/test-coo-tools-prompt-e2e.js

echo "=== learnings-only ==="
docker compose exec -T \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_ONLY=learnings_summary \
  -e COO_TOOLS_SKIP_IMAGE=1 \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -e COO_TOOLS_SKIP_IBKR=1 \
  -e COO_TOOLS_OWNER_USER_ID=default \
  -w "$BACKEND_WD" \
  backend node scripts/test-coo-tools-prompt-e2e.js

echo "=== check tool-policy during that run ==="
docker compose logs --since 2m openclaw 2>/dev/null | grep -i 'tool policy removed' | tail -5
