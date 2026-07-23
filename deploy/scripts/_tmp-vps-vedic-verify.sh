#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const db = getDb();
const grants = db.prepare(`SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY tool_name`).all('vedic-astrology');
const names = grants.map((g) => g.tool_name);
console.log('grants', names.join(','));
if (!names.includes('vedic_compute_chart')) throw new Error('missing vedic_compute_chart grant');
if (!names.includes('master_data_rag')) throw new Error('missing master_data_rag grant');
const tool = db.prepare(`SELECT name, endpoint, enabled FROM content_tools WHERE name = ?`).get('vedic_compute_chart');
console.log('tool_meta', tool);
if (!tool || !tool.enabled) throw new Error('vedic_compute_chart not in content_tools');
console.log('PASS grants+meta');
NODE
# Hit compute endpoint via internal curl if tools key present
docker compose exec -T backend node --input-type=module <<'NODE'
import { computeVedicChart } from './src/services/vedic-chart.js';
import { getOpenClawMediaDir } from './src/config/openclaw-paths.js';
const out = computeVedicChart({
  birth_date: '1990-05-15', birth_time: '14:30', timezone_offset_hours: 5.5,
  latitude: 13.08, longitude: 80.27, chart_style: 'both', include_navamsa: true,
}, { mediaDir: getOpenClawMediaDir('generated') });
if (!out.visuals_markdown?.includes(out.north_chart_url)) throw new Error('visuals order');
console.log('PASS api-shape', out.north_chart_url, out.south_chart_url);
NODE
echo VERIFY_DONE
