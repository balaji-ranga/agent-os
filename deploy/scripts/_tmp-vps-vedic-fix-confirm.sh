#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
docker compose exec -T backend node scripts/vps-onboard-specialty-agents-bala.js
docker compose exec -T backend node scripts/test-vedic-compute-chart.js
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const names = getDb()
  .prepare(`SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY 1`)
  .all('vedic-astrology')
  .map((r) => r.tool_name);
console.log('grants', names.join(','));
if (names.includes('generate_image')) throw new Error('generate_image still granted');
if (!names.includes('vedic_compute_chart') || !names.includes('generate_chart')) throw new Error('missing chart tools');
console.log('PASS no generate_image');
NODE
docker compose exec -T frontend sh -c 'grep -Rql collectChartUrlsFromToolCalls /usr/share/nginx/html/assets/*.js && echo ChartUI=OK || echo ChartUI=MISSING'
grep -q 'Never call \*\*`generate_image`\*\*' /root/.openclaw/tenants/ceo-bala/workspace-vedic-astrology/SOUL.md \
  || grep -q 'generate_image' /root/.openclaw/tenants/ceo-bala/workspace-vedic-astrology/SOUL.md
head -20 /root/.openclaw/tenants/ceo-bala/workspace-vedic-astrology/SOUL.md
echo DONE
