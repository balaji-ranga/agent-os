/**
 * Pure planner unit checks — no live LLM required for structural paths.
 * docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/_test-goal-plan-multistep.mjs
 */
import {
  normalizeStepSpec,
  extractStructuralWorkflowSteps,
  planGoalStepsFromText,
  planGoalStepsAsync,
  planUsesGoalRunMode,
  validateAndRepairGoalPlan,
} from '../src/services/agent-goal-run.js';
import {
  stripWorkflowPhrasesFromPrompt,
  stripPlanOrchestrationFromResidual,
  extractExplicitPlatformHelpIntent,
  splitResidualIntoIntentHints,
  specialtyIntentsToSteps,
  GOAL_PLAN_MAX_SPECIALTY,
} from '../src/services/goal-plan-specialty.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}

// specialty normalize
const st = normalizeStepSpec({
  type: 'specialty_task',
  agent_id: 'researcher',
  message: 'Find 3 angles',
  parallel_group: 1,
  label: 'Research angles',
});
assert(st.type === 'specialty_task', 'normalize specialty_task');
assert(st.spec.agent_id === 'researcher', 'agent_id');
assert(st.spec.parallel_group === 1, 'parallel_group');
assert(st.spec.message.includes('angles'), 'message');

// more than 2 intents — hints
const hints = splitResidualIntoIntentHints(
  'A) Research biryani recipes\nB) Design a poster for the dish\nC) Write LinkedIn post\nD) Cook timing plan'
);
assert(hints.length >= 3, 'expected >=3 lettered intents got ' + hints.length);
console.log('hints', hints.length);

// parallel specialty steps
const stepsSp = specialtyIntentsToSteps(
  [
    { agent_id: 'a', message: '1', name: 'A' },
    { agent_id: 'b', message: '2', name: 'B' },
    { agent_id: 'c', message: '3', name: 'C' },
  ],
  { parallel: true }
);
assert(stepsSp.length === 3, '3 specialty steps');
assert(stepsSp.every((s) => s.parallel_group === 1), 'same parallel group');
assert(GOAL_PLAN_MAX_SPECIALTY >= 3, 'max specialty');

// residual strip
const residual = stripWorkflowPhrasesFromPrompt(
  'Run crm maker checker then research biryani and design a poster. Run erp maker checker for O2C.'
);
assert(!/run\s+crm\s+maker/i.test(residual), 'crm stripped');
assert(!/run\s+erp/i.test(residual), 'erp stripped');
assert(/biryani/i.test(residual) || /poster/i.test(residual), 'residual specialty text kept');

// L2C structural
const l2cPrompt =
  'Leads to Orders to cash. Customer: Acme. Run crm maker checker for pre-order pipeline. Then run erp maker checker for order-to-cash.';
const wf = extractStructuralWorkflowSteps(l2cPrompt);
assert(wf.length >= 2, 'crm+erp structural');
assert(wf[0].type === 'workflow_trigger' && /crm/i.test(wf[0].spec.phrase || wf[0].label), 'crm first');
assert(wf.some((s) => /erp/i.test(s.spec?.phrase || s.label || '')), 'erp present');

const plannedL2c = planGoalStepsFromText(l2cPrompt);
assert(planUsesGoalRunMode(plannedL2c), 'l2c goal mode');
assert(plannedL2c.some((s) => s.type === 'notify_ceo'), 'notify');

// hybrid plan with mocked specialty injected via planGoalStepsAsync explicit?
// Use planGoalStepsAsync with feedback only + owner without DB classifer may return wf only.
const hybridPrompt =
  l2cPrompt + ' Also research authentic Hyderabadi biryani recipe and write a cooking story.';
const hybridStruct = extractStructuralWorkflowSteps(hybridPrompt);
const residualH = stripWorkflowPhrasesFromPrompt(hybridPrompt);
assert(hybridStruct.length >= 2, 'hybrid still has workflows');
assert(/biryani|cooking|recipe/i.test(residualH), 'hybrid residual not dropped');

// Multi-step single agent via lettered after specialtyIntentsToSteps + normalize
const multiSame = specialtyIntentsToSteps(
  [
    { agent_id: 'chef', message: 'step1 research recipe', step_label: 'Step 1 research' },
    { agent_id: 'chef', message: 'step2 write method', step_label: 'Step 2 method' },
  ],
  { parallel: false }
).map(normalizeStepSpec);
assert(multiSame.length === 2 && multiSame.every((s) => s.type === 'specialty_task'), 'same-agent multi-step');
assert(multiSame.every((s) => s.spec.parallel_group == null), 'sequential when not parallel');

// vague → agent continue
const vague = planGoalStepsFromText('Keep the company healthy this week');
assert(vague.some((s) => s.type === 'agent_continue'), 'vague continue');
assert(vague.some((s) => s.type === 'notify_ceo'), 'vague notify');

// planGoalStepsAsync without owner: structural only + notify
const asyncHybrid = await planGoalStepsAsync(hybridPrompt, { ownerUserId: null });
assert(asyncHybrid.filter((s) => s.type === 'workflow_trigger').length >= 2, 'async hybrid wf');
assert(asyncHybrid.some((s) => s.type === 'notify_ceo'), 'async notify');
// Without owner, specialty not classified; residual must not invent empty specialty silently — wf still present
assert(planUsesGoalRunMode(asyncHybrid), 'async uses goal mode');

// Approved/stored plans must not override explicit CEO execution constraints.
const constrainedMarket = validateAndRepairGoalPlan(
  [
    normalizeStepSpec({ type: 'specialty_task', agent_id: 'businessdiscovery', message: 'Summarize basket' }),
    normalizeStepSpec({ type: 'specialty_task', agent_id: 'marketwatcher', message: 'Fetch basket' }),
  ],
  'Use market_history and market_fundamentals for MAG7 and VOOG. Do not delegate to MarketWatcher; handle it yourself as the COO.'
);
assert(!constrainedMarket.some((s) => s.type === 'specialty_task'), 'handle-yourself removes all delegations');

const oneForbidden = validateAndRepairGoalPlan(
  [
    normalizeStepSpec({ type: 'specialty_task', agent_id: 'researcher', message: 'Research' }),
    normalizeStepSpec({ type: 'specialty_task', agent_id: 'writer', message: 'Draft' }),
  ],
  'Research and draft the brief. Do not delegate to writer.'
);
assert(oneForbidden.some((s) => s.spec?.agent_id === 'researcher'), 'unconstrained delegate retained');
assert(!oneForbidden.some((s) => s.spec?.agent_id === 'writer'), 'named forbidden delegate removed');


// createGoalRun re-maps plan steps — normalize must be idempotent for workflow phrases
const plannedCrm = normalizeStepSpec({
  type: 'workflow_trigger',
  phrase: 'run crm maker checker',
  phase: 'crm_phase',
  label: 'CRM maker-checker workflow',
});
const renorm = normalizeStepSpec(plannedCrm);
assert(renorm.spec.phrase === 'run crm maker checker', 'idempotent re-normalize phrase, got ' + renorm.spec.phrase);
assert(renorm.spec.phase === 'crm_phase', 'idempotent phase');
const residualNotify = stripPlanOrchestrationFromResidual(
  'Also answer via Platform Help where CEOs track plans. When finished, notify_ceo with CRM ERP status.'
);
assert(!/notify_ceo/i.test(residualNotify), 'orchestration strip notify');
assert(extractExplicitPlatformHelpIntent(residualNotify), 'explicit platform help');

console.log('GOAL_PLAN_MULTISTEP_UNIT_OK', {
  maxSpecialty: GOAL_PLAN_MAX_SPECIALTY,
  hints: hints.length,
  hybridResidual: residualH.slice(0, 80),
  asyncTypes: asyncHybrid.map((s) => s.type),
});
