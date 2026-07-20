/**
 * Generic smoke: Application Agent — departments (list_rows), RAG, notify.
 * Clears chat/session between scenarios so tools are not skipped via memory.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { classifyBroadcastNotifyIntent } from '../src/services/broadcast-intent.js';
import * as md from '../src/services/master-data.js';
import { clearOpenClawSessionForUser } from '../src/services/agent-chat-scope.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';
import { seedMasterDataToolsIfMissing } from '../src/db/seed-content-tools-meta.js';
import { writeOpenClawToolsList } from '../src/services/content-tools-meta.js';

initDb();
seedMasterDataToolsIfMissing();
try {
  writeOpenClawToolsList();
  console.log('refreshed OpenClaw tools list');
} catch (e) {
  console.warn('tools list refresh', e.message);
}

const db = getDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const CEO = 'ceo-bala';
const AGENT = 'applicationagent';

const token = createSession(CEO).token;
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function clearAgentChat() {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(AGENT);
  const ensured = ensureTenantOpenClawAgent(agent, CEO);
  clearOpenClawSessionForUser(AGENT, ensured.openclawAgentId, CEO);
  db.prepare('DELETE FROM chat_turns WHERE agent_id = ? AND owner_user_id = ?').run(AGENT, CEO);
}

async function chat(message) {
  const res = await fetch(`${BASE}/api/agents/${AGENT}/chat`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function toolsAfter(beforeId) {
  return db
    .prepare(
      `SELECT tool_name, status, substr(request_payload,1,200) AS req, created_at
       FROM content_tool_logs WHERE owner_user_id = ? AND id > ? ORDER BY id ASC`
    )
    .all(CEO, beforeId);
}

let tables = md.listTables(CEO);
let dept = tables.find((t) => /depart/i.test(t.name) || /depart/i.test(t.description || ''));
if (!dept) {
  dept = md.createTable(CEO, {
    name: 'departments',
    description: 'Organization departments and org units for this CEO',
    columns: [
      { name: 'name', type: 'text' },
      { name: 'code', type: 'text' },
    ],
  });
  md.insertRow(CEO, dept.id, { name: 'Engineering', code: 'ENG' });
  md.insertRow(CEO, dept.id, { name: 'Research', code: 'RES' });
  md.insertRow(CEO, dept.id, { name: 'Social', code: 'SOC' });
  console.log('created departments table', dept.id);
} else {
  console.log('using departments table', dept.name, dept.id);
}

const ptoDoc = md.uploadDocument(CEO, {
  title: 'PTO Policy (test)',
  filename: 'pto-policy.txt',
  mimeType: 'text/plain',
  contentText:
    'Agent OS handbook. Vacation policy: full-time staff receive 20 days PTO per year. ' +
    'Remote work is allowed two days per week with manager approval.',
});
console.log('pto doc', ptoDoc?.id || ptoDoc);

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

const intent = await classifyBroadcastNotifyIntent(
  'getback on their status summary and send notification once ready'
);
console.log('notify intent', intent);
ok(intent.require_notify === true, `require_notify true (got ${intent.require_notify})`);
ok(intent.status_rollup === true, `status_rollup true (got ${intent.status_rollup})`);

const intentNo = await classifyBroadcastNotifyIntent('what departments are there in this org?');
console.log('no-notify intent', intentNo);
ok(intentNo.require_notify === false, 'departments ask does not require_notify');

await clearAgentChat();
const beforeDept = db.prepare(`SELECT MAX(id) AS id FROM content_tool_logs`).get()?.id || 0;
const deptChat = await chat(
  'what departments are there in this org? Use Master Data tools: discover tables by purpose then list rows from the matching departments table.'
);
console.log('dept reply', String(deptChat.data.reply || deptChat.data.error || '').slice(0, 500));
const deptTools = toolsAfter(beforeDept).filter((t) => String(t.tool_name).startsWith('master_data_'));
console.log('dept tools', deptTools);
ok(deptChat.status < 400, `dept chat status ${deptChat.status}`);
ok(
  deptTools.some((t) => t.tool_name === 'master_data_list_rows' && t.status === 'ok'),
  'called master_data_list_rows'
);

await clearAgentChat();
const beforeRag = db.prepare(`SELECT MAX(id) AS id FROM content_tool_logs`).get()?.id || 0;
const ragChat = await chat(
  'Search our Master Data documents with RAG: how many PTO days do full-time staff get according to the PTO Policy document?'
);
console.log('rag reply', String(ragChat.data.reply || ragChat.data.error || '').slice(0, 500));
const ragTools = toolsAfter(beforeRag).filter((t) => String(t.tool_name).startsWith('master_data_'));
console.log('rag tools', ragTools);
ok(ragChat.status < 400, `rag chat status ${ragChat.status}`);
ok(ragTools.some((t) => t.tool_name === 'master_data_rag' && t.status === 'ok'), 'called master_data_rag');
ok(/20/.test(String(ragChat.data.reply || '')), 'rag reply mentions 20 days');

await clearAgentChat();
const beforeNotify = db.prepare(`SELECT MAX(id) AS id FROM content_tool_logs`).get()?.id || 0;
// Broadcast to one agent: LLM intent sets MUST notify_ceo (generic, not keywords).
const bcast = await fetch(`${BASE}/api/broadcast`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    message: 'Please get back with your status summary and send me a notification when ready.',
    agent_ids: [AGENT],
  }),
  signal: AbortSignal.timeout(300000),
});
const bcastData = await bcast.json().catch(() => ({}));
console.log('broadcast routing', bcastData.routing);
console.log('broadcast reply', String(bcastData.results?.[0]?.reply || bcastData.results?.[0]?.error || '').slice(0, 400));
const notifyTools = toolsAfter(beforeNotify).filter((t) => t.tool_name === 'notify_ceo');
console.log('notify tools', notifyTools);
ok(bcast.status < 400, `broadcast status ${bcast.status}`);
ok(bcastData.routing?.reach_me === true || bcastData.routing?.notify_intent?.require_notify === true, 'intent require_notify');
ok(notifyTools.some((t) => t.status === 'ok'), 'called notify_ceo ok');

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('PASS applicationagent masterdata+rag+notify');
