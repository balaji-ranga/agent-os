#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const db = getDb();
const meta = db.prepare('SELECT name, endpoint, enabled FROM content_tools_meta WHERE name IN (?, ?)').all('generate_chart', 'vedic_compute_chart');
console.log('meta', meta);
const vedic = db.prepare(`SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? ORDER BY 1`).all('vedic-astrology').map((r) => r.tool_name);
const coo = db.prepare(`SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? AND tool_name = ?`).get('balserve', 'generate_chart');
console.log('vedic has generate_chart', vedic.includes('generate_chart'));
console.log('vedic has vedic_compute_chart', vedic.includes('vedic_compute_chart'));
console.log('coo has generate_chart', !!coo);
if (!vedic.includes('generate_chart')) process.exit(1);
if (coo) {
  console.error('FAIL: generate_chart granted to balserve');
  process.exit(1);
}
const soul = await import('fs').then((fs) =>
  fs.readFileSync('/root/.openclaw/tenants/ceo-bala/workspace-vedic-astrology/TOOLS.md', 'utf8')
);
if (!soul.includes('generate_chart')) throw new Error('TOOLS.md missing generate_chart');
if (!soul.includes('chart_spec')) throw new Error('TOOLS.md missing chart_spec');
console.log('PASS grants isolation + workspace TOOLS');
NODE
echo CONFIRM_DONE
