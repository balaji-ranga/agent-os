/**
 * E2E: adhoc multi-intent goal plan — CRM → ERP → Platform Help specialty → notify_ceo.
 * Proves plan storage keeps workflow phrases, specialty is planned, and steps can complete.
 *
 * Usage:
 *   docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/test-goal-plan-adhoc-e2e.mjs
 *   # or from backend: node scripts/test-goal-plan-adhoc-e2e.mjs
 *
 * Env:
 *   REGRESSION_GOAL_PLAN_FORCE_TERMINAL=1 (default) complete child WF / specialty tasks to finish plan
 *   REGRESSION_CEO_ID=ceo-demo-... optional owner override
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  createAndStartGoalRun,
  getGoalRun,
  onWorkflowTerminalForGoalRun,
  onDelegationTerminalForGoalRun,
  startGoalRunExecution,
  planGoalStepsAsync,
  normalizeStepSpec,
} from '../src/services/agent-goal-run.js';
import {
  createDefinition,
  publishDefinition,
} from '../src/services/agent-workflow-store.js';

initDb();
const db = getDb();

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

const forceTerminal = String(process.env.REGRESSION_GOAL_PLAN_FORCE_TERMINAL || '1') !== '0';
const ownerOverride = String(process.env.REGRESSION_CEO_ID || '').trim();
const requireSpecialty = String(
  process.env.REGRESSION_REQUIRE_SPECIALTY ??
    (String(process.env.REGRESSION_ISOLATED_USER || '') === '1' ? '0' : '1')
) !== '0';

const ceo =
  (ownerOverride && db.prepare(`SELECT id FROM platform_users WHERE id = ? AND enabled=1`).get(ownerOverride)) ||
  db.prepare(`SELECT id FROM platform_users WHERE id LIKE 'ceo-demo-brightbox%' AND enabled=1 LIMIT 1`).get() ||
  db.prepare(`SELECT id FROM platform_users WHERE role='ceo' AND enabled=1 ORDER BY id LIMIT 1`).get();
assert(ceo?.id, 'need enabled CEO (REGRESSION_CEO_ID or seed CEO)');
const owner = ceo.id;

function ensureIsolatedTriggerWorkflow(phrase, suffix) {
  const existing = db.prepare(
    `SELECT id,status FROM agent_workflow_definitions
     WHERE owner_user_id=? AND lower(chat_trigger_phrase)=lower(?) LIMIT 1`
  ).get(owner, phrase);
  if (existing?.id) {
    if (existing.status !== 'published') {
      publishDefinition(existing.id, owner, { id: 'regression', name: 'Regression pack' });
    }
    return existing.id;
  }
  const id = `regression-${owner}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
  createDefinition({
    id,
    name: `Regression ${suffix}`,
    description: 'Disposable trigger-only workflow for isolated goal-plan regression.',
    ownerUserId: owner,
    actor: { id: 'regression', name: 'Regression pack' },
    trigger_modes: ['manual', 'chat'],
    chat_trigger_phrase: phrase,
    graph: {
      nodes: [{ id: 'trigger', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Trigger' } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  });
  publishDefinition(id, owner, { id: 'regression', name: 'Regression pack' });
  return id;
}

if (
  String(process.env.REGRESSION_INSTALL_GOAL_FIXTURES || '') === '1' ||
  String(process.env.REGRESSION_ISOLATED_USER || '') === '1'
) {
  console.log('[goal-plan-e2e] installing isolated trigger workflows');
  ensureIsolatedTriggerWorkflow('run crm maker checker', 'crm-maker-checker');
  ensureIsolatedTriggerWorkflow('run erp maker checker', 'erp-maker-checker');
}

let agentId = 'balserve';
try {
  const pick =
    db
      .prepare(
        `SELECT openclaw_agent_id AS id FROM agents
         WHERE owner_user_id = ? AND lower(COALESCE(openclaw_agent_id,'')) LIKE '%balserve%'
         LIMIT 1`
      )
      .get(owner) ||
    db
      .prepare(
        `SELECT openclaw_agent_id AS id FROM agents
         WHERE owner_user_id = ?
           AND (lower(COALESCE(name,'')) LIKE '%coo%'
             OR lower(COALESCE(role,'')) LIKE '%chief operating%'
             OR lower(COALESCE(openclaw_agent_id,'')) LIKE '%coordinator%')
         LIMIT 1`
      )
      .get(owner) ||
    db.prepare(`SELECT openclaw_agent_id AS id FROM agents WHERE owner_user_id = ? LIMIT 1`).get(owner);
  if (pick?.id) agentId = String(pick.id).trim();
} catch (e) {
  console.warn('[goal-plan-e2e] agent lookup fallback balserve', e.message);
}
if (!agentId) agentId = 'balserve';

// COO test prompt (stable multi-intent acceptance)
const PROMPT =
  process.env.REGRESSION_GOAL_PLAN_PROMPT ||
  'Run crm maker checker then run erp maker checker for Acme Hotels welcome-kits L2C (no discount). Also answer via Platform Help where CEOs track multi-intent goal plan progress. When finished, notify_ceo with a one-screen status of CRM, ERP, and any blockers.';

console.log('[goal-plan-e2e] owner', owner, 'agent', agentId);

// --- Plan shape (phrases + specialty + notify) ---
const planned = await planGoalStepsAsync(PROMPT, { ownerUserId: owner });
const plannedTypes = planned.map((s) => s.type);
console.log('[goal-plan-e2e] planned types', plannedTypes);
console.log(
  '[goal-plan-e2e] planned detail',
  planned.map((s) => ({
    type: s.type,
    phrase: s.spec?.phrase,
    agent: s.spec?.agent_id,
  }))
);

const crm = planned.find((s) => s.type === 'workflow_trigger' && /crm/i.test(s.spec?.phrase || s.label || ''));
const erp = planned.find((s) => s.type === 'workflow_trigger' && /erp/i.test(s.spec?.phrase || s.label || ''));
const help = planned.find(
  (s) =>
    s.type === 'specialty_task' &&
    (/platformhelp|platform\s*help/i.test(String(s.spec?.agent_id || '')) ||
      /platform\s*help/i.test(String(s.label || '')))
);
const notify = planned.find((s) => s.type === 'notify_ceo');
assert(crm, 'planned CRM workflow_trigger missing');
assert(erp, 'planned ERP workflow_trigger missing');
if (requireSpecialty) assert(help, 'planned Platform Help specialty_task missing');
assert(notify, 'planned notify_ceo missing');
assert(
  crm.spec.phrase === 'run crm maker checker',
  'CRM phrase must be exact chat trigger, got ' + crm.spec.phrase
);
assert(
  erp.spec.phrase === 'run erp maker checker',
  'ERP phrase must be exact chat trigger, got ' + erp.spec.phrase
);

// Idempotent re-normalize (createGoalRun maps steps again)
const renorm = planned.map(normalizeStepSpec);
assert(renorm[0].spec.phrase === crm.spec.phrase, 're-normalize lost CRM phrase');
if (requireSpecialty) {
  assert(
    renorm.find((s) => s.type === 'specialty_task')?.spec?.agent_id,
    're-normalize lost specialty agent_id'
  );
}

// --- Create + start ---
const { goal, execution } = await createAndStartGoalRun({
  ownerUserId: owner,
  agentId,
  title: 'regression-goal-plan-adhoc',
  prompt: PROMPT,
  // Execute the plan validated above. Replanning the same prompt here doubles
  // remote maker/checker latency without adding coverage.
  steps: planned,
  source: 'regression-goal-plan-adhoc-e2e',
});
assert(goal?.id && String(goal.id).startsWith('agr-'), 'goal_run_id agr-… required, got ' + goal?.id);
console.log('[goal-plan-e2e] goal_run_id', goal.id, 'exec', {
  ok: execution?.ok,
  async: execution?.async,
  error: execution?.error,
});

let loaded = getGoalRun(goal.id, owner);
const expectedMinSteps = requireSpecialty ? 4 : 3;
assert(
  loaded?.steps?.length >= expectedMinSteps,
  `stored plan must have ≥${expectedMinSteps} steps, got ${loaded?.steps?.length}`
);
const s0 = loaded.steps.find((s) => (s.step_type || s.type) === 'workflow_trigger');
assert(s0?.spec?.phrase === 'run crm maker checker', 'stored CRM phrase lost: ' + JSON.stringify(s0?.spec));
const helpStored = loaded.steps.find((s) => (s.step_type || s.type) === 'specialty_task');
if (requireSpecialty) assert(helpStored, 'stored specialty_task missing');
if (/No workflow matched/i.test(String(s0.error_message || ''))) {
  throw new Error('CRM must match published workflow: ' + s0.error_message);
}
if (String(s0.status) === 'failed') {
  throw new Error('CRM step failed early: ' + (s0.error_message || s0.status));
}

function forceCompleteWorkflow(runId) {
  db.prepare(
    `UPDATE agent_workflow_runs SET status = 'completed', completed_at = datetime('now'),
     progress_pct = 100, error_message = NULL WHERE id = ?`
  ).run(runId);
}

function forceCompleteDelegation(taskId) {
  db.prepare(
    `UPDATE agent_delegation_tasks SET status = 'completed',
     response_content = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(
    'Platform Help (regression): CEOs track multi-intent goal plan progress on Digest (/this-week), Goal Plan panel (agr-…), and /goal-plans.',
    taskId
  );
}

if (forceTerminal) {
  for (let round = 0; round < 12; round++) {
    loaded = getGoalRun(goal.id, owner);
    const snap = loaded.steps
      .map(
        (s) =>
          `${s.step_index}:${s.step_type || s.type}:${s.status}:wr=${s.child_workflow_run_id || ''}:del=${s.child_delegation_task_id || ''}`
      )
      .join(' | ');
    console.log('[goal-plan-e2e] r' + round, loaded.status, snap);
    if (loaded.status === 'completed') break;
    if (loaded.status === 'failed') {
      throw new Error('goal failed: ' + (loaded.error_message || loaded.steps.find((s) => s.error_message)?.error_message));
    }

    const runningWf = loaded.steps.find(
      (s) =>
        (s.step_type || s.type) === 'workflow_trigger' &&
        s.status === 'running' &&
        s.child_workflow_run_id
    );
    if (runningWf) {
      forceCompleteWorkflow(runningWf.child_workflow_run_id);
      await onWorkflowTerminalForGoalRun(runningWf.child_workflow_run_id);
      continue;
    }

    const runningDel = loaded.steps.find(
      (s) =>
        (s.step_type || s.type) === 'specialty_task' &&
        s.status === 'running' &&
        s.child_delegation_task_id
    );
    if (runningDel) {
      forceCompleteDelegation(runningDel.child_delegation_task_id);
      await onDelegationTerminalForGoalRun(runningDel.child_delegation_task_id);
      continue;
    }

    try {
      await startGoalRunExecution(goal.id, { ownerUserId: owner });
    } catch (e) {
      console.warn('[goal-plan-e2e] kick', e.message);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

loaded = getGoalRun(goal.id, owner);
const byType = Object.fromEntries(
  (loaded.steps || []).map((s) => [s.step_index + ':' + (s.step_type || s.type), s.status])
);
console.log('[goal-plan-e2e] final', loaded.status, byType);

if (forceTerminal) {
  assert(loaded.status === 'completed', 'goal status completed, got ' + loaded.status);
  for (const s of loaded.steps) {
    assert(s.status === 'completed', `step ${s.step_index} ${s.step_type || s.type} not completed: ${s.status} ${s.error_message || ''}`);
  }
  const typesDone = loaded.steps.map((s) => s.step_type || s.type);
  assert(typesDone.includes('workflow_trigger'), 'workflow steps');
  if (requireSpecialty) assert(typesDone.includes('specialty_task'), 'specialty step');
  assert(typesDone.includes('notify_ceo'), 'notify step');
}

console.log('GOAL_PLAN_ADHOC_E2E_OK', {
  goal_run_id: goal.id,
  forceTerminal,
  statuses: (loaded.steps || []).map((s) => s.status),
});
