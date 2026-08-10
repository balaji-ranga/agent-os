/**
 * UI-path retest: CEO Bearer token -> POST /api/agents/balserve/chat (AgentChat path).
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { getGoalRun } from '../src/services/agent-goal-run.js';

initDb();
const db = getDb();
function assert(c, m) { if (!c) throw new Error(m || 'assert failed'); }

const ownerRow =
  db.prepare(`SELECT id, email FROM platform_users WHERE id LIKE 'ceo-demo-brightbox%' AND enabled=1 LIMIT 1`).get() ||
  db.prepare(`SELECT id, email FROM platform_users WHERE role='ceo' AND enabled=1 LIMIT 1`).get();
assert(ownerRow?.id, 'need CEO');
const { token } = createSession(ownerRow.id, { userAgent: 'ui-chat-retest' });

const base = process.env.REGRESSION_API_BASE || process.env.PUBLIC_API_BASE || 'http://127.0.0.1:3001';
const marker = 'UI-RETEST-' + Date.now();
const prompt =
  'You are the COO AI employee. Execute the following multi-step goal plan precisely, in order. Do not skip or reorder steps. Include the goal run ID in your reply.\n\n' +
  '1. Create and launch goal: Use the agent_goal_create tool with this full prompt as the goal specification. Start execution immediately. Capture and include the goal run ID in your reply.\n\n' +
  '2. Run CRM maker-checker: Execute the CRM maker-checker process for Acme Hotels welcome-kits L2C (no discount).\n\n' +
  '3. Run ERP maker-checker: After CRM completes successfully, execute the ERP maker-checker process for Acme Hotels welcome-kits L2C (no discount).\n\n' +
  '4. via Platform Help agent: provide help on how to track status of workflows and goals.\n\n' +
  '5. Notify CEO: When the above steps are finished, use notify_ceo with a one-screen status summary covering CRM status, ERP status, and any blockers.\n\n' +
  '6. List workflows: Retrieve the list of workflow nodes supported by the workflow builder agent.\n\n' +
  '7. Send completion email: Send an email with the final goal completion status summarizing steps 1-6.\n\n' +
  'Keep interactions professional and compliant.\n\n' +
  '[' + marker + ']';

console.log('[ui-chat] owner', ownerRow.id, 'base', base, 'marker', marker);
const t0 = Date.now();
const res = await fetch(base.replace(/\/$/, '') + '/api/agents/balserve/chat', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: prompt, user_id: ownerRow.id }),
  signal: AbortSignal.timeout(Number(process.env.CHAT_TIMEOUT_MS) || 240000),
});
const bodyText = await res.text();
let body;
try { body = JSON.parse(bodyText); } catch { body = { raw: bodyText.slice(0, 2000) }; }
console.log('[ui-chat] status', res.status, 'ms', Date.now() - t0);
console.log('[ui-chat] keys', Object.keys(body || {}));
console.log('[ui-chat] reply preview', String(body.reply || body.message || body.content || bodyText).slice(0, 1500));

const toolCalls = body.toolCalls || body.tool_calls || body.tools || [];
console.log(
  '[ui-chat] toolCalls',
  Array.isArray(toolCalls) ? toolCalls.map((t) => t.tool_name || t.name || t.tool).slice(0, 30) : toolCalls
);

const blob = JSON.stringify(body);
const uniqueAgrs = [...new Set([...blob.matchAll(/\bagr-[a-f0-9]{8,}/gi)].map((m) => m[0]))];
console.log('[ui-chat] agr ids in HTTP body', uniqueAgrs);

const latest = db
  .prepare(
    `SELECT id, status, title, substr(prompt,1,120) p, created_at FROM agent_goal_runs
     WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT 5`
  )
  .all(ownerRow.id);
console.log('[ui-chat] latest goals', latest);

// Prefer goal containing our marker
let pick = null;
for (const row of latest) {
  if (String(row.p || '').includes(marker) || String(row.title || '').includes(marker)) {
    pick = row.id;
    break;
  }
}
if (!pick && uniqueAgrs[0]) pick = uniqueAgrs[0];
if (!pick && latest[0]) pick = latest[0].id;
if (!pick) {
  console.error('NO_AGR — chat path did not create plan; GoalPlanPanel cannot appear');
  process.exit(2);
}

const goal = getGoalRun(pick, ownerRow.id);
assert(goal, 'goal not loadable for CEO (panel would 404)');
const steps = goal.steps || [];
console.log(
  '[ui-chat] plan steps',
  steps.map((s) => ({
    i: s.step_index,
    type: s.step_type,
    label: s.label,
    tool: s.spec?.tool_name,
    agent: s.spec?.agent_id,
    phrase: s.spec?.phrase,
  }))
);

const types = steps.map((s) => s.step_type);
const crm = steps.filter((s) => s.step_type === 'workflow_trigger' && /crm/i.test(String(s.spec?.phrase || '')));
const erp = steps.filter((s) => s.step_type === 'workflow_trigger' && /erp/i.test(String(s.spec?.phrase || '')));
const help = steps.filter((s) => s.step_type === 'specialty_task');
const notify = steps.filter((s) => s.step_type === 'notify_ceo');
const tools = steps.filter((s) => s.step_type === 'agent_tool');
const email = tools.filter((s) => s.spec?.tool_name === 'email_send');
const list = tools.filter((s) => /workflow_list|workflow_enquire/i.test(String(s.spec?.tool_name || '')));
const reply = String(body.reply || body.message || body.content || '');
const inReply = /\bagr-[a-f0-9]{8,}/i.test(reply);
const report = {
  goal_run_id: pick,
  steps: steps.length,
  types,
  crm: crm.length,
  erp: erp.length,
  help: help.length,
  notify: notify.length,
  list: list.length,
  email: email.length,
  reply_has_agr: inReply,
  tool_agrs: uniqueAgrs.length,
  chat_status: res.status,
  marker_matched: Boolean(String(goal.prompt || '').includes(marker)),
};
console.log('[ui-chat] REPORT', report);

if (!report.marker_matched && uniqueAgrs.length < 1) {
  console.warn('[ui-chat] WARNING: using latest plan without marker — may be stale open plan');
}

if (crm.length < 1 || erp.length < 1 || help.length < 1 || notify.length < 1 || list.length < 1 || email.length < 1) {
  console.error('PLAN_SHAPE_FAIL', report);
  process.exit(3);
}
if (!inReply && uniqueAgrs.length < 1) {
  console.error('UI_PANEL_INVISIBLE — no agr in chat payload so GoalPlanPanel will not render');
  process.exit(4);
}
console.log('GOAL_PLAN_UI_CHAT_OK', report);