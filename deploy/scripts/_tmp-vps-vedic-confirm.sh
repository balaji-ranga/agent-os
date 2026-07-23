#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
docker compose exec -T backend node scripts/vps-onboard-specialty-agents-bala.js
docker compose exec -T backend node scripts/test-vedic-compute-chart.js
docker compose exec -T backend sh -c 'test -f /opt/agent-os/openclaw-workspace-templates/vedic-astrology/SOUL.md && echo TEMPLATE=OK || echo TEMPLATE=MISSING'
docker compose exec -T frontend sh -c 'grep -Rql chat_attachments /usr/share/nginx/html/assets/*.js && echo ChatAttach=OK || echo ChatAttach=MISSING'
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const t = getDb().prepare('SELECT name, endpoint, enabled FROM content_tools_meta WHERE name = ?').get('vedic_compute_chart');
console.log('tool_meta', t);
if (!t || !t.enabled) process.exit(1);
console.log('PASS meta');
NODE
echo ALL_GOOD
