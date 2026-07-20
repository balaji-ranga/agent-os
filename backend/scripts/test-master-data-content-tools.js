#!/usr/bin/env node
/**
 * Smoke: Master Data content tools (owner-scoped) + agent invoke path.
 * Prompt covered: "get the latest list of departments in this organization"
 *
 *   node backend/scripts/test-master-data-content-tools.js
 *   SKIP_CHAT=1 node backend/scripts/test-master-data-content-tools.js
 */
import 'dotenv/config';
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
import { getToolsApiKey } from '../src/config/tools.js';
import * as openclaw from '../src/gateway/openclaw.js';

initDb();
seedMasterDataToolsIfMissing();
const granted = grantMasterDataToolsToAllAgents();
if (granted) syncAllowlistsFile();

const owner = getBalaCeoAuthId();
console.log('owner:', owner);

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
for (const t of ['master_data_list_tables', 'master_data_list_rows', 'master_data_rag']) {
  if (!balserveGrants.includes(t)) {
    console.error('FAIL: balserve missing grant', t);
    process.exit(1);
  }
}
console.log('balserve grants OK for master_data_*');

const ocId = 't-ceo-bala--balserve';
const sessionUser = openclaw.sessionUserFor(ocId, owner);
const sessionKey = openclaw.sessionKeyFor(ocId, sessionUser);
const key = getToolsApiKey();
const headers = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${key}`,
  'x-openclaw-agent-id': ocId,
  'x-ceo-user-id': owner,
  'x-openclaw-session-key': sessionKey,
};
const inv1 = await fetch('http://127.0.0.1:3001/api/tools/invoke', {
  method: 'POST',
  headers,
  body: JSON.stringify({ tool_name: 'master_data_list_tables', caller_agent_id: ocId }),
});
const j1 = await inv1.json();
const inv2 = await fetch('http://127.0.0.1:3001/api/tools/invoke', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    tool_name: 'master_data_list_rows',
    caller_agent_id: ocId,
    table_name: 'departments',
  }),
});
const j2 = await inv2.json();
const invokeNames = (j2.rows || []).map((r) => r.data?.name).filter(Boolean);
console.log('agent invoke:', inv1.status, inv2.status, 'departments=', invokeNames.join(', ') || '(none)');
if (inv1.status !== 200 || inv2.status !== 200 || !invokeNames.length) {
  console.error('FAIL: agent invoke', j1, j2);
  process.exit(1);
}
console.log('AGENT_INVOKE_PASS — departments list for org via master_data_* tools');

if (process.env.SKIP_CHAT === '1') {
  console.log('PASS');
  process.exit(0);
}

try {
  const { ensureTenantOpenClawAgent } = await import('../src/services/openclaw-tenant.js');
  const { registerOpenClawSessionOwner } = await import('../src/services/tool-owner-scope.js');
  const agent = getDb().prepare(`SELECT * FROM agents WHERE id = 'balserve' OR is_coo = 1 LIMIT 1`).get();
  if (!agent) {
    console.log('PASS');
    process.exit(0);
  }
  const runtime = ensureTenantOpenClawAgent(agent, owner);
  const su = openclaw.sessionUserFor(runtime.openclawAgentId, owner);
  registerOpenClawSessionOwner(openclaw.sessionKeyFor(runtime.openclawAgentId, su), owner);
  const prompt =
    'get the latest list of departments in this organization. Use master_data_list_tables then master_data_list_rows with table_name departments. Do not use browser. Reply with department names only.';
  console.log('chatting COO', runtime.openclawAgentId, '…');
  const { content } = await openclaw.chatCompletions(
    runtime.openclawAgentId,
    [{ role: 'user', content: prompt }],
    su,
    false,
    { timeoutMs: 180000 }
  );
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  console.log('--- agent reply ---\n', text?.slice(0, 2000));
  const hit = names.some((n) => text && text.toLowerCase().includes(String(n).toLowerCase()));
  if (!hit) console.warn('WARN: chat reply missing names (invoke already PASS)');
  else console.log('chat mentions departments — PASS');
} catch (e) {
  console.warn('chat optional:', e.message);
}

console.log('PASS');
