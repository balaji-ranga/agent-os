#!/usr/bin/env node
/**
 * Smoke: ensure departments master table exists, exercise master_data_* tools
 * as an agent would (owner-scoped), then optionally chat COO with the departments prompt.
 *
 * Usage:
 *   node backend/scripts/test-master-data-content-tools.js
 *   SKIP_CHAT=1 node backend/scripts/test-master-data-content-tools.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import {
  createTable,
  findTableByName,
  insertRow,
  listRows,
  updateTableMeta,
} from '../src/services/master-data.js';
import {
  listTablesForAgent,
  listRowsForAgent,
  assertNoSchemaMutation,
} from '../src/services/master-data-tools.js';
import { seedMasterDataToolsIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantMasterDataToolsToAllAgents } from '../src/services/agent-feedback.js';
import { getAgentToolGrants, syncAllowlistsFile } from '../src/services/openclaw-agent-tools.js';

initDb();
seedMasterDataToolsIfMissing();
const granted = grantMasterDataToolsToAllAgents();
if (granted) syncAllowlistsFile();

const owner = getBalaCeoAuthId();
console.log('owner:', owner);

// Refuse schema mutation
try {
  assertNoSchemaMutation('drop_table');
  console.error('FAIL: drop_table should be blocked');
  process.exit(1);
} catch (e) {
  console.log('schema guard OK:', e.message.slice(0, 80));
}

let table = findTableByName(owner, 'departments');
if (!table) {
  table = createTable(owner, {
    name: 'departments',
    description: 'Org departments for this CEO company — latest list of department names',
    columns: ['name'],
  });
  for (const name of ['Engineering', 'Product', 'Operations', 'Finance', 'People']) {
    insertRow(owner, table.id, { name });
  }
  console.log('created departments table', table.id);
} else {
  if (!table.description) {
    table = updateTableMeta(owner, table.id, {
      description: 'Org departments for this CEO company — latest list of department names',
    });
  }
  const { total } = listRows(owner, table.id, { limit: 1, offset: 0 });
  if (!total) {
    for (const name of ['Engineering', 'Product', 'Operations', 'Finance', 'People']) {
      insertRow(owner, table.id, { name });
    }
  }
  console.log('using departments table', table.id, 'rows~', table.row_count);
}

const listed = listTablesForAgent(owner);
const deptMeta = listed.tables.find((t) => String(t.name).toLowerCase() === 'departments');
if (!deptMeta) {
  console.error('FAIL: departments not in list_tables');
  process.exit(1);
}
console.log('list_tables purpose:', deptMeta.description || '(empty)');

const rowsOut = listRowsForAgent(owner, { table_name: 'departments', limit: 50 });
const names = (rowsOut.rows || []).map((r) => r.data?.name || r.data?.Name).filter(Boolean);
console.log('departments via tool:', names.join(', ') || '(none)');
if (!names.length) {
  console.error('FAIL: no department rows');
  process.exit(1);
}

const balserveGrants = getAgentToolGrants('balserve');
const need = [
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_rag',
];
for (const t of need) {
  if (!balserveGrants.includes(t)) {
    console.error('FAIL: balserve missing grant', t);
    process.exit(1);
  }
}
console.log('balserve grants OK for master_data_*');

const meta = getDb()
  .prepare(`SELECT name FROM content_tools_meta WHERE name LIKE 'master_data_%' ORDER BY name`)
  .all()
  .map((r) => r.name);
console.log('seeded tools:', meta.join(', '));

if (process.env.SKIP_CHAT === '1') {
  console.log('SKIP_CHAT=1 — tool path PASS');
  process.exit(0);
}

// Optional: prompt COO via OpenClaw chat (requires gateway)
try {
  const { ensureTenantOpenClawAgent } = await import('../src/services/openclaw-tenant.js');
  const openclaw = await import('../src/gateway/openclaw.js');
  const agent = getDb().prepare(`SELECT * FROM agents WHERE id = 'balserve' OR is_coo = 1 LIMIT 1`).get();
  if (!agent) {
    console.warn('No COO agent — skipping chat test');
    console.log('PASS (tools only)');
    process.exit(0);
  }
  const runtime = ensureTenantOpenClawAgent(agent, owner);
  const prompt =
    'get the latest list of departments in this organization. Use master_data_list_tables then master_data_list_rows on the departments table. Reply with the department names only.';
  console.log('chatting COO', runtime.openclawAgentId, '…');
  const { content } = await openclaw.chatCompletions(
    runtime.openclawAgentId,
    [{ role: 'user', content: prompt }],
    `md-test-${Date.now()}`,
    false,
    { timeoutMs: 300000 }
  );
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  console.log('--- agent reply ---\n', text?.slice(0, 2000));
  const hit = names.some((n) => text && text.toLowerCase().includes(String(n).toLowerCase()));
  if (!hit) {
    console.warn('WARN: agent reply did not clearly include seeded department names (tools still OK)');
  } else {
    console.log('agent reply mentions department names — PASS');
  }
} catch (e) {
  console.warn('chat test skipped/failed:', e.message);
  console.log('PASS (tools path verified; chat optional)');
  process.exit(0);
}

console.log('PASS');
