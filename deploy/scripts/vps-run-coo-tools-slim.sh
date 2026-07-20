#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

TOKEN=$(docker compose exec -T openclaw node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)' | tr -d '\r')
BACKEND_WD=/opt/agent-os/backend
docker compose exec -T backend test -f /opt/agent-os/backend/scripts/test-coo-tools-prompt-e2e.js || BACKEND_WD=/app
docker cp /tmp/test-coo-tools-prompt-e2e.js "$(docker compose ps -q backend)":$BACKEND_WD/scripts/test-coo-tools-prompt-e2e.js

# Also sync global allow from backend writeOpenClawToolsList (durable)
docker compose exec -T -w "$BACKEND_WD" backend node --input-type=module -e '
import { initDb } from "./src/db/schema.js";
import { writeOpenClawToolsList } from "./src/services/content-tools-meta.js";
initDb();
writeOpenClawToolsList();
console.log("writeOpenClawToolsList done");
' 2>/dev/null || true

echo "cooling 30s before full suite…"
sleep 30

docker compose exec -T \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_SKIP_IMAGE=1 \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -e COO_TOOLS_SKIP_IBKR=1 \
  -e COO_TOOLS_CASE_PAUSE_MS=15000 \
  -e COO_TOOLS_OWNER_USER_ID=default \
  -w "$BACKEND_WD" \
  backend node scripts/test-coo-tools-prompt-e2e.js
