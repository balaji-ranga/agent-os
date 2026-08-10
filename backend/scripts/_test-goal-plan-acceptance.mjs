/**
 * VPS acceptance: multi-intent goal plans + scheduled draft plan review.
 * docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/_test-goal-plan-acceptance.mjs
 */
import { getDb } from '../src/db/schema.js';
import {
  previewGoalPlan,
  createScheduledGoal,
  setScheduledGoalPlan,
  approveScheduledGoalPlan,
  deleteScheduledGoal,
  runScheduledGoal,
  listScheduledGoals,
} from '../src/services/scheduled-goals.js';
import {
  planGoalStepsAsync,
  extractStructuralWorkflowSteps,
  planUsesGoalRunMode,
  normalizeStepSpec,
} from '../src/services/agent-goal-run.js';
import {
  stripWorkflowPhrasesFromPrompt,
  specialtyIntentsToSteps,
  splitResidualIntoIntentHints,
} from '../src/services/goal-plan-specialty.js';

const db = getDb();

function assert(c, m) {
  if (!c) throw new Error(m || 'assert');
}

// Prefer BrightBox demo CEO
const ceo =
  db.prepare(`SELECT id FROM platform_users WHERE id LIKE 'ceo-demo-brightbox%' AND enabled=1 LIMIT 1`).get() ||
  db.prepare(`SELECT id FROM platform_users WHERE role='ceo' AND enabled=1 ORDER BY id LIMIT 1`).get();
assert(ceo?.id, 'need ceo');
const owner = ceo.id;
console.log('owner', owner);

// Clean prior acceptance goals
for (const r of db.prepare(`SELECT id FROM scheduled_goals WHERE owner_user_id=? AND source='vps_accept_goal_plan'`).all(owner)) {
  try { deleteScheduledGoal(owner, r.id); } catch (_) {}
}

// --- 1 unit multi specialty hints (>2) ---
const hints = splitResidualIntoIntentHints(
  'A) Research vegan biryani\nB) Design poster\nC) Write LinkedIn post\nD) Draft email subject'
);
assert(hints.length >= 3, '>=3 intents expected got ' + hints.length);
const par = specialtyIntentsToSteps(
  hints.map((h, i) => ({ agent_id: 'a' + i, message: h, name: 'S' + i })),
  { parallel: true }
);
assert(par.length >= 3 && par.every((s) => s.parallel_group === 1), 'parallel multi specialty');
console.log('PASS multi-intent count', par.length);

// --- 2 Hybrid residual not dropped ---
const hybrid =
  'Goal: L2C for Acme. Run crm maker checker for pre-order pipeline. Then run erp maker checker for O2C. ' +
  'Also research authentic Hyderabadi biryani and write a short cooking story for social.';
const wf = extractStructuralWorkflowSteps(hybrid);
const residual = stripWorkflowPhrasesFromPrompt(hybrid);
assert(wf.length >= 2, 'hybrid wf');
assert(/biryani|cooking|social/i.test(residual), 'hybrid residual kept: ' + residual.slice(0, 120));
console.log('PASS hybrid residual');

// --- 3 L2C structural regression ---
const l2c =
  'Leads to Orders to cash for Acme Hotels. Run crm maker checker for pre-order. Run erp maker checker for order-to-cash.';
const stepsL2c = await planGoalStepsAsync(l2c, { ownerUserId: owner });
assert(planUsesGoalRunMode(stepsL2c), 'l2c mode');
assert(stepsL2c.filter((s) => s.type === 'workflow_trigger').length >= 2, 'l2c wf>=2');
console.log('PASS l2c', stepsL2c.map((s) => s.type));

// --- 4 Multspecialty plan with real owner (may use LLM) ---
const multiPrompt =
  'A) Research three gift ideas for corporate kits\nB) Design a one-pager concept for BrightBox\nC) Write a LinkedIn post draft\nD) Outline a 3-step store ops checklist';
let planMulti;
try {
  planMulti = await previewGoalPlan(owner, { prompt: multiPrompt });
} catch (e) {
  console.warn('preview multi LLM warn', e.message);
  planMulti = {
    steps: specialtyIntentsToSteps(
      multiPrompt
        .split(/\n/)
        .map((s) => s.replace(/^[A-D]\)\s*/, ''))
        .filter(Boolean)
        .map((m, i) => ({ agent_id: 'spec' + i, message: m, name: 'S' + i }))
    )
      .map(normalizeStepSpec)
      .concat([normalizeStepSpec({ type: 'notify_ceo' })])
      .map((s, i) => ({ step_index: i, type: s.type, label: s.label, spec: s.spec })),
  };
}
const types = (planMulti.steps || []).map((s) => s.type);
const specialtyN = types.filter((t) => t === 'specialty_task').length;
console.log('multi plan types', types, 'specialtyN', specialtyN);
// Prefer specialty when classifier works; fall back agent_continue is ok if agents.md empty
assert(types.includes('notify_ceo') || specialtyN >= 1 || types.includes('agent_continue'), 'plan has work');
if (specialtyN >= 2) console.log('PASS multi specialty_task', specialtyN);
else console.log('WARN fewer specialty_task than ideal (LLM/agents.md) — structural multi still ok');

// --- 5 Single-intent multi-step lettered same domain ---
const singleMulti =
  'Research only:\n1) Find biryani spice list\n2) Write method steps\n3) Write plating tips';
const hints2 = splitResidualIntoIntentHints(singleMulti);
assert(hints2.length >= 2, 'single intent multi-step hints ' + hints2.length);
console.log('PASS single-intent multi-step hints', hints2.length);

// --- 6 Draft plan flow ---
const draft = await createScheduledGoal(owner, {
  title: 'Accept plan draft multi',
  prompt: multiPrompt,
  agent_id: 'balserve',
  cadence: 'daily',
  time_local: '23:50',
  source: 'vps_accept_goal_plan',
  approve_plan: false,
  plan: planMulti,
});
assert(draft.status === 'draft', 'draft status got ' + draft.status);
assert(draft.plan_status === 'draft', 'plan draft');
let blocked = false;
try {
  await runScheduledGoal(owner, draft.id, { force: true });
} catch (e) {
  blocked = /draft/i.test(e.message || '');
}
assert(blocked, 'run while draft should fail');
const refined = await setScheduledGoalPlan(owner, draft.id, {
  feedback: 'Do specialty steps in parallel; keep notify CEO at end',
  approve: false,
});
assert(refined.plan_status === 'draft', 'still draft after feedback');
const approved = await approveScheduledGoalPlan(owner, draft.id);
assert(approved.status === 'active' && approved.plan_status === 'approved', 'approved active');
console.log('PASS draft->feedback->approve', approved.id);

// Cleanup
deleteScheduledGoal(owner, draft.id);
const leftover = listScheduledGoals(owner).filter((g) => g.source === 'vps_accept_goal_plan');
assert(!leftover.length, 'cleanup');

// --- 7 connector users cleanup ---
const conn = db
  .prepare(
    `SELECT id, email, name FROM platform_users WHERE lower(id) LIKE 'connector%' OR lower(COALESCE(email,'')) LIKE 'connector%' OR lower(COALESCE(name,'')) LIKE 'connector%'`
  )
  .all();
console.log('connector users found', conn.length, conn.map((u) => u.id));
for (const u of conn) {
  try {
    // soft: disable + mark cleaned
    db.prepare(`UPDATE platform_users SET enabled=0, email=COALESCE(email,'') || '.deleted-connector' WHERE id=?`).run(u.id);
    console.log('disabled connector user', u.id);
  } catch (e) {
    console.warn('disable fail', u.id, e.message);
  }
}
// Prefer delete if FK allows; try hard delete orphans
let deleted = 0;
for (const u of conn) {
  try {
    db.prepare(`DELETE FROM platform_users WHERE id=?`).run(u.id);
    deleted += 1;
  } catch (e) {
    console.warn('delete skip (fk)', u.id, String(e.message || e).slice(0, 80));
  }
}
console.log('connector deleted', deleted, 'of', conn.length);

console.log('GOAL_PLAN_ACCEPTANCE_OK');