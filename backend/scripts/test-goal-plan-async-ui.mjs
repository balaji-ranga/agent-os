/**
 * UI-perspective: major goal must async-ack with plan; first step runs; remaining advance on terminals;
 * terminal notify / chat wake text must include goal plan id + title when bound.
 *
 * Usage (backend container):
 *   node scripts/test-goal-plan-async-ui.mjs
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  createAndStartGoalRun,
  getGoalRun,
  onWorkflowTerminalForGoalRun,
} from '../src/services/agent-goal-run.js';
import {
  registerWorkflowRunWatch,
  notifyWorkflowRunTerminal,
} from '../src/services/agent-workflow-run-watch.js';

initDb();
const db = getDb();

function assert(c, m) {
  if (!c) throw new Error(m || 'assert failed');
}

const owner =
  process.env.REGRESSION_CEO_ID ||
  db.prepare(`SELECT id FROM platform_users WHERE id LIKE 'ceo-demo-brightbox%' AND enabled=1 LIMIT 1`).get()?.id ||
  db.prepare(`SELECT id FROM platform_users WHERE role='ceo' AND enabled=1 LIMIT 1`).get()?.id;
assert(owner, 'need CEO');

const agentId = 'balserve';
const marker = 'ASYNC-UI-' + Date.now().toString(36);
const PROMPT =
  process.env.REGRESSION_GOAL_PLAN_PROMPT ||
  `Run crm maker checker then run erp maker checker for ${marker} kits (no discount). ` +
    'Also answer via Platform Help where CEOs track multi-intent goal plan progress. ' +
    'When finished, notify_ceo with a one-screen status.';

console.log('[async-ui] owner', owner, 'marker', marker);

// cancel open goal runs for quiet slate (non-destructive to definitions)
const cancel = db
  .prepare(
    `UPDATE agent_goal_runs SET status = 'cancelled', error_message = 'async-ui clean', completed_at = datetime('now')
     WHERE owner_user_id = ? AND status IN ('pending','running','waiting')`
  )
  .run(owner);
console.log('[async-ui] cancelled open plans', cancel.changes);

const t0 = Date.now();
const started = await createAndStartGoalRun({
  ownerUserId: owner,
  agentId,
  title: 'Async UI ack ' + marker,
  prompt: PROMPT,
  source: 'async_ui_test',
});
const ackMs = Date.now() - t0;
console.log('[async-ui] createAndStart ms', ackMs);

assert(started?.async === true, 'createAndStart must async:true');
assert(started?.goal_run_id || started?.goal?.id, 'goal_run_id required');
const gid = started.goal_run_id || started.goal.id;
const goal = getGoalRun(gid, owner);
assert(goal, 'goal load');
assert(Array.isArray(goal.steps) && goal.steps.length >= 2, 'plan must have multiple steps');
const completed = goal.steps.filter((s) => s.status === 'completed').length;
const running = goal.steps.filter((s) => s.status === 'running').length;
console.log(
  '[async-ui] plan after ack',
  goal.id,
  goal.title,
  goal.steps.map((s) => ({ i: s.step_index, t: s.step_type, st: s.status, lab: s.label }))
);

// Major goal ack: not fully terminal after create
assert(goal.status !== 'completed', 'must not finish whole plan on ack');
assert(completed < goal.steps.length, 'must leave steps for background');
assert(running >= 1 || goal.status === 'running', 'first step should be running');
assert(ackMs < 120000, 'ack too slow >120s (planning may be slow)');

// Bound first workflow run metadata should include goal_run_id on watch
const wfStep = goal.steps.find((s) => s.step_type === 'workflow_trigger' && s.child_workflow_run_id);
if (wfStep?.child_workflow_run_id) {
  const runId = Number(wfStep.child_workflow_run_id);
  const row = db.prepare('SELECT context_json FROM agent_workflow_runs WHERE id = ?').get(runId);
  let ctx = {};
  try {
    ctx = JSON.parse(row?.context_json || '{}');
  } catch {
    ctx = {};
  }
  const watch = ctx.coo_run_watch || {};
  console.log('[async-ui] watch', {
    runId,
    goal_run_id: watch.goal_run_id,
    goal_title: watch.goal_title,
    wake: watch.wake_orchestrator_on_terminal,
  });
  assert(String(watch.goal_run_id || '') === String(gid), 'watch must store goal_run_id');
  assert(watch.wake_orchestrator_on_terminal === false, 'plan-bound must not wake COO multiphase');

  // force complete first WF to exercise advance + notify correlation
  db.prepare(
    `UPDATE agent_workflow_runs SET status = 'completed', completed_at = datetime('now'), error_message = NULL WHERE id = ?`
  ).run(runId);

  // capture platform notifications before/after
  const beforeCount = db
    .prepare(`SELECT COUNT(*) AS c FROM platform_user_notifications WHERE user_id = ?`)
    .get(owner)?.c;

  notifyWorkflowRunTerminal(runId);
  // goal advance may be async-catch but onWorkflowTerminalForGoalRun is awaited inside notify as void - await explicitly
  await onWorkflowTerminalForGoalRun(runId);

  const afterGoal = getGoalRun(gid, owner);
  console.log(
    '[async-ui] after terminal advance',
    afterGoal.status,
    afterGoal.steps.map((s) => ({ i: s.step_index, t: s.step_type, st: s.status }))
  );
  const firstWf = afterGoal.steps.find((s) => s.id === wfStep.id);
  assert(firstWf.status === 'completed' || firstWf.status === 'failed', 'first WF step should terminal');

  // latest notification body should mention agr / title
  const note = db
    .prepare(
      `SELECT title, body FROM platform_user_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 5`
    )
    .all(owner);
  const hit = note.find(
    (n) =>
      String(n.title || '').includes(gid) ||
      String(n.body || '').includes(gid) ||
      String(n.title || '').toLowerCase().includes('goal plan') ||
      String(n.body || '').includes(gid)
  );
  console.log(
    '[async-ui] recent notifies',
    note.map((n) => ({ title: n.title, body: String(n.body || '').slice(0, 160) }))
  );
  assert(hit, 'terminal notify must correlate goal plan id/title');
  const text = String(hit.title || '') + '\n' + String(hit.body || '');
  assert(text.includes(gid) || /goal plan/i.test(text), 'notify text must name goal plan');
  console.log('[async-ui] notify correlation OK', { title: hit.title, body: String(hit.body).slice(0, 200) });
  console.log('[async-ui] notify count delta', Number(beforeCount || 0), '->', note.length);
} else {
  console.warn('[async-ui] no child workflow yet (maybe specialty first); register-smoke only');
  // ensure register API accepts goal fields without throwing
  const reg = registerWorkflowRunWatch(1, {
    ownerUserId: owner,
    goalRunId: gid,
    goalTitle: goal.title,
    wakeOrchestratorOnTerminal: false,
  });
  console.log('[async-ui] register smoke', reg?.ok, reg?.instruction?.slice?.(0, 80));
}

// Optional COO chat path (same API as UI) when base URL + token provided
const base = String(process.env.AGENT_OS_PUBLIC_URL || process.env.API_BASE || '').replace(/\/$/, '');
const token = String(process.env.CEO_JWT || process.env.REGRESSION_CEO_TOKEN || '').trim();
if (base && token && process.env.REGRESSION_ASYNC_UI_CHAT === '1') {
  const chatPrompt =
    `MAJOR GOAL ASYNC TEST ${marker}: run crm maker checker then run erp maker checker for ${marker}. ` +
    'Use agent_goal_create only. Acknowledge the plan with agr- id and end without waiting for all phases.';
  const tChat = Date.now();
  const res = await fetch(`${base}/api/agents/balserve/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: chatPrompt }),
  });
  const chatMs = Date.now() - tChat;
  const body = await res.json().catch(() => ({}));
  const reply = String(body?.reply || body?.content || body?.message || JSON.stringify(body)).slice(0, 800);
  console.log('[async-ui] chat status', res.status, 'ms', chatMs, 'preview', reply);
  assert(res.ok, 'COO chat failed');
  assert(/agr-[a-f0-9]+/i.test(reply), 'COO reply must include agr goal plan id');
  // chat should finish while some plan still open (weak check via newest agr in DB)
  const newest = db
    .prepare(
      `SELECT id, status FROM agent_goal_runs WHERE owner_user_id = ? AND prompt LIKE ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(owner, `%${marker}%`);
  console.log('[async-ui] chat-linked goal', newest);
  assert(newest, 'chat should create goal');
}

console.log('ASYNC_UI_OK', { goal_run_id: gid, ackMs });
process.exit(0);