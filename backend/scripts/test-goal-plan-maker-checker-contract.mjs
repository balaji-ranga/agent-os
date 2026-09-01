import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-goal-quality-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
const { validateTypedGoalPlan, repairCheckerExecutorAvailability, safeGoalClarificationPlan, normalizeExecutorOutputKinds } = await import('../src/services/goal-plan-quality.js');
const { isEfficiencyModeTool } = await import('../src/services/llm-efficiency-mode.js');
assert.equal(isEfficiencyModeTool('goal_plan_intent'), false);
assert.equal(isEfficiencyModeTool('goal_plan_maker'), false);
assert.equal(isEfficiencyModeTool('goal_plan_checker'), false);
assert.equal(isEfficiencyModeTool('goal_plan_tool_args'), true);
const catalog = {
  tools: [{ name: 'erp_invoice_read' }, { name: 'erp_purchase_order_create_draft' }],
  workflows: [],
  agents: [{ id: 'erp-agent' }],
  humans: [{ id: 'human-raji' }],
};

const valid = [
  {
    key: 'retrieve_invoice', type: 'agent_tool', label: 'Retrieve invoice', depends_on: [], required_inputs: [],
    produces: [{ key: 'invoice_record', kind: 'data', required: true }], spec: { tool_name: 'erp_invoice_read' },
  },
  {
    key: 'prepare_review', type: 'specialty_task', label: 'Prepare review packet', depends_on: ['retrieve_invoice'],
    required_inputs: [{ key: 'invoice_record', kind: 'data', source_step_key: 'retrieve_invoice', required: true }],
    produces: [{ key: 'invoice_review_packet', kind: 'artifact', required: true }], spec: { agent_id: 'erp-agent', message: 'Create a PDF attachment review packet and return its file URL.' },
  },
  {
    key: 'human_approval', type: 'human_task', label: 'Raji approval', depends_on: ['prepare_review'],
    required_inputs: [{ key: 'invoice_review_packet', kind: 'artifact', source_step_key: 'prepare_review', required: true }],
    produces: [{ key: 'purchase_decision', kind: 'decision', required: true }], spec: { user_id: 'human-raji', message: 'Approve or reject this invoice for creation of a TEST draft PO.' },
  },
  {
    key: 'draft_po', type: 'agent_tool', label: 'Create TEST draft PO', depends_on: ['human_approval'],
    required_inputs: [{ key: 'purchase_decision', kind: 'decision', source_step_key: 'human_approval', required: true }],
    produces: [{ key: 'draft_po', kind: 'data', required: true }], spec: { tool_name: 'erp_purchase_order_create_draft' },
  },
  { key: 'notify', type: 'notify_ceo', label: 'Report outcome', depends_on: ['draft_po'], required_inputs: [], produces: [], spec: {} },
];
assert.deepEqual(validateTypedGoalPlan(valid, catalog), { ok: true, errors: [] });

const falseArtifact = structuredClone(valid);
falseArtifact[0].produces[0].kind = 'artifact';
falseArtifact[1].required_inputs[0].kind = 'artifact';
const normalizedFalseArtifact = normalizeExecutorOutputKinds(falseArtifact, catalog);
assert.equal(normalizedFalseArtifact[0].produces[0].kind, 'data');
assert.equal(normalizedFalseArtifact[1].required_inputs[0].kind, 'data');
assert.equal(normalizedFalseArtifact[1].produces[0].kind, 'artifact');
const terminalInputs = normalizedFalseArtifact.at(-1).required_inputs;
assert(terminalInputs.some((input) => input.source_step_key === 'retrieve_invoice' && input.key === 'invoice_record'));
assert(terminalInputs.some((input) => input.source_step_key === 'human_approval' && input.key === 'purchase_decision'));

const skippedPreparation = [valid[2], valid[3], valid[4]];
const missing = validateTypedGoalPlan(skippedPreparation, catalog);
assert.equal(missing.ok, false);
assert(missing.errors.some((x) => /non-prior|invalid source/i.test(x)));

const wholeGoalHuman = structuredClone(valid);
wholeGoalHuman[2].spec.message = '';
const vague = validateTypedGoalPlan(wholeGoalHuman, catalog);
assert.equal(vague.ok, false);
assert(vague.errors.some((x) => /no specific work/i.test(x)));

const unavailableExecutor = structuredClone(valid);
unavailableExecutor[1].spec.agent_id = 'hallucinated-agent';
assert.equal(validateTypedGoalPlan(unavailableExecutor, catalog).ok, false);

const futureDependency = structuredClone(valid);
futureDependency[0].depends_on = ['draft_po'];
assert.equal(validateTypedGoalPlan(futureDependency, catalog).ok, false);

const noHumanCatalog = { ...catalog, humans: [] };
const clarification = repairCheckerExecutorAvailability([{
  key: 'clarify', type: 'human_task', label: 'Obtain missing scope', depends_on: [], required_inputs: [],
  produces: [{ key: 'scope', kind: 'data', required: true }], spec: { user_id: 'invented-user', message: 'Ask the CEO to specify the target.' },
}], noHumanCatalog);
assert.equal(clarification[0].type, 'agent_continue');
assert.equal(validateTypedGoalPlan(clarification, noHumanCatalog).ok, true);
const safe = safeGoalClarificationPlan();
assert.equal(validateTypedGoalPlan(safe, noHumanCatalog).ok, true);
assert.equal(safe.some((step) => step.type === 'agent_tool' || step.type === 'specialty_task' || step.type === 'human_task'), false);

console.log('goal plan maker/checker typed contract tests passed');
try { const { getDb } = await import('../src/db/schema.js'); getDb().close(); } catch {}
rmSync(dataDir, { recursive: true, force: true });
