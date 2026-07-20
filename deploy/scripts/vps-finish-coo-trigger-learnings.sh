#!/bin/bash
set -euo pipefail
cd /opt/agent-os/deploy
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"
BACKEND_WD=/opt/agent-os/backend
docker compose exec -T backend test -f /opt/agent-os/backend/src/db/schema.js || BACKEND_WD=/app

docker compose exec -T -w "$BACKEND_WD" backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import * as store from './src/services/agent-workflow-store.js';

initDb();
const db = getDb();
const row = db
  .prepare(
    `SELECT id, name, status, owner_user_id, trigger_modes, chat_trigger_phrase, paused
     FROM agent_workflow_definitions
     WHERE id = 'test-brain-maker-openai-checker-ollama'`
  )
  .get();
console.log('before', row);

store.updateTriggers(row.id, row.owner_user_id, {
  trigger_modes: ['manual', 'chat'],
  chat_trigger_phrase: row.chat_trigger_phrase || 'coo tools e2e trigger',
}, { id: 'coo_tools_e2e', name: 'COO tools e2e' });

const after = db
  .prepare(
    `SELECT id, trigger_modes, chat_trigger_phrase FROM agent_workflow_definitions WHERE id = ?`
  )
  .get(row.id);
console.log('after', after);
const def = store.getDefinition(row.id, row.owner_user_id);
console.log('parsed modes', def.trigger_modes, 'chat phrase', def.chat_trigger_phrase);
NODE

TOKEN=$(docker compose exec -T openclaw node -e 'console.log(require("/root/.openclaw/openclaw.json").gateway.auth.token)' | tr -d '\r')
docker cp /tmp/test-coo-tools-prompt-e2e.js "$(docker compose ps -q backend)":$BACKEND_WD/scripts/test-coo-tools-prompt-e2e.js

echo "cooling 25s…"
sleep 25

docker compose exec -T \
  -e OPENCLAW_GATEWAY_URL=http://openclaw:18789 \
  -e OPENCLAW_GATEWAY_TOKEN="$TOKEN" \
  -e COO_TOOLS_ONLY=agent_workflow_trigger,learnings_summary \
  -e COO_TOOLS_SKIP_IMAGE=1 \
  -e COO_TOOLS_SKIP_VIDEO=1 \
  -e COO_TOOLS_SKIP_IBKR=1 \
  -e COO_TOOLS_CASE_PAUSE_MS=20000 \
  -e COO_TOOLS_OWNER_USER_ID=default \
  -w "$BACKEND_WD" \
  backend node scripts/test-coo-tools-prompt-e2e.js
