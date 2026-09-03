import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-goal-quality-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
const { validateTypedGoalPlan, validateCandidateGoalPlan, validateSeedRequirementCoverage, repairCheckerExecutorAvailability, safeGoalClarificationPlan, normalizeExecutorOutputKinds } = await import('../src/services/goal-plan-quality.js');
const { isEfficiencyModeTool } = await import('../src/services/llm-efficiency-mode.js');
const { resolveCapabilitiesFromPrompt } = await import('../src/services/business-capabilities.js');
const { matchSelfToolsFromCatalog, specialtyMessageContainsToolInstruction } = await import('../src/services/goal-plan-intent.js');
assert.equal(isEfficiencyModeTool('goal_plan_intent'), false);
assert.equal(isEfficiencyModeTool('goal_plan_maker'), false);
assert.equal(isEfficiencyModeTool('goal_plan_checker'), false);
assert.equal(isEfficiencyModeTool('goal_plan_tool_args'), true);
const pluralCatalogMatch = matchSelfToolsFromCatalog(
  'Retrieve the list of workflow nodes supported by the builder.',
  [{ name: 'agent_workflow_list', display_name: 'List agent workflows', purpose: 'List workflows available to this agent.' }]
);
assert.equal(pluralCatalogMatch.length, 1);
assert.equal(pluralCatalogMatch[0].tool_name, 'agent_workflow_list');
assert.equal(specialtyMessageContainsToolInstruction('Provide help tracking status of workflows and goals.', 'agent_workflow_list'), false);
assert.equal(specialtyMessageContainsToolInstruction('Create a Kanban card for this assignment.', 'kanban_create_task'), true);
assert.equal(resolveCapabilitiesFromPrompt('Do not send email, publish, or mutate records.').some((capability) => capability.id === 'send_email'), false);
assert.equal(resolveCapabilitiesFromPrompt('Send the completed report by email.').some((capability) => capability.id === 'send_email'), true);
assert.equal(resolveCapabilitiesFromPrompt('Send an outcome-rich terminal report to the CEO in chat. Do not email.').some((capability) => capability.id === 'send_email'), false);
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
const nestedCandidate = valid.map(({ key, type, label, depends_on, required_inputs, produces, spec }) => ({
  type,
  label,
  spec: { ...spec, step_key: key, depends_on, required_inputs, produces },
}));
const validatedSeed = validateCandidateGoalPlan(nestedCandidate, catalog);
assert.equal(validatedSeed.validation.ok, true);
assert.deepEqual(validatedSeed.steps.map((step) => step.key), valid.map((step) => step.key));
const legacyCandidate = valid.map(({ key, type, label, spec }, index) => ({
  type,
  label,
  spec: { ...spec, step_key: key, depends_on: index ? [index - 1] : [] },
}));
const validatedLegacySeed = validateCandidateGoalPlan(legacyCandidate, catalog);
assert.equal(validatedLegacySeed.validation.ok, true, JSON.stringify(validatedLegacySeed.validation.errors));
assert.deepEqual(validatedLegacySeed.steps[2].depends_on, ['prepare_review']);
assert.equal(validatedLegacySeed.steps[2].required_inputs[0].source_step_key, 'prepare_review');
const unboundHandoff = validateCandidateGoalPlan(valid.map((step) => ({
  type: step.type,
  label: step.label,
  spec: { ...step.spec, step_key: step.key },
})), catalog);
assert.equal(unboundHandoff.validation.ok, true, JSON.stringify(unboundHandoff.validation.errors));
const fallbackHuman = unboundHandoff.steps.find((step) => step.type === 'human_task');
assert.deepEqual(fallbackHuman.depends_on, ['prepare_review']);
assert(fallbackHuman.required_inputs.some((input) => input.kind === 'artifact' && input.source_step_key === 'prepare_review'));
assert.equal(validateSeedRequirementCoverage(valid, valid).ok, true);
const omittedRequiredTool = valid.filter((step) => step.key !== 'draft_po');
const incompleteCoverage = validateSeedRequirementCoverage(omittedRequiredTool, valid);
assert.equal(incompleteCoverage.ok, false);
assert(incompleteCoverage.errors.some((error) => error.includes('tool:erp_purchase_order_create_draft')));

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

const missingWorkflowId = structuredClone(valid);
missingWorkflowId[0].type = 'workflow_trigger';
missingWorkflowId[0].spec = {};
assert.equal(validateTypedGoalPlan(missingWorkflowId, catalog).ok, false);

const disconnectedInput = structuredClone(valid);
disconnectedInput[3].depends_on = [];
const disconnected = validateTypedGoalPlan(disconnectedInput, catalog);
assert.equal(disconnected.ok, false);
assert(disconnected.errors.some((x) => /not in its dependency graph/i.test(x)));

const vagueSpecialty = structuredClone(valid);
vagueSpecialty[1].spec.message = '';
assert(validateTypedGoalPlan(vagueSpecialty, catalog).errors.some((x) => /no bounded work instruction/i.test(x)));

const orphaned = structuredClone(valid);
orphaned.splice(1, 0, {
  key: 'unused_lookup', type: 'agent_tool', label: 'Unused lookup', depends_on: [], required_inputs: [],
  produces: [{ key: 'unused_data', kind: 'data', required: true }], spec: { tool_name: 'erp_invoice_read' },
});
assert(validateTypedGoalPlan(orphaned, catalog).errors.some((x) => /orphaned from the terminal outcome/i.test(x)));
const repairedOrphan = validateCandidateGoalPlan(orphaned, catalog);
assert.equal(repairedOrphan.validation.ok, true, JSON.stringify(repairedOrphan.validation.errors));
assert(repairedOrphan.steps.at(-1).depends_on.includes('unused_lookup'));

const duplicateOutput = structuredClone(valid);
duplicateOutput[0].produces.push({ ...duplicateOutput[0].produces[0] });
assert(validateTypedGoalPlan(duplicateOutput, catalog).errors.some((x) => /duplicate output/i.test(x)));

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

const { ensureAgentGoalRunTables, completeGoalStepAndContinue } = await import('../src/services/agent-goal-run.js');
ensureAgentGoalRunTables();
const testDb = (await import('../src/db/schema.js')).getDb();
testDb.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)`)
  .run('ceo-resume-test', 'resume@example.test', 'x', 'Resume Test', 'ceo');
testDb.prepare(`INSERT INTO agents(id,name,role,is_coo,openclaw_agent_id,owner_user_id) VALUES(?,?,?,?,?,?)`)
  .run('coo-resume-test', 'Resume COO', 'COO', 1, 'coo-resume-test', 'ceo-resume-test');
testDb.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)`)
  .run('ceo-resume-test', 'coo-resume-test');
testDb.prepare(`INSERT INTO agent_goal_runs(id,owner_user_id,agent_id,title,prompt,status) VALUES(?,?,?,?,?,'running')`)
  .run('agr-resume-test', 'ceo-resume-test', 'coo-resume-test', 'Resume test', 'Complete nested work then continue.');
testDb.prepare(`INSERT INTO agent_goal_steps(id,goal_run_id,step_index,step_type,label,status) VALUES(?,?,?,?,?,'running')`)
  .run('ags-resume-1', 'agr-resume-test', 0, 'specialty_task', 'Nested orchestrator');
testDb.prepare(`INSERT INTO agent_goal_steps(id,goal_run_id,step_index,step_type,label,status) VALUES(?,?,?,?,?,'pending')`)
  .run('ags-resume-2', 'agr-resume-test', 1, 'agent_tool', 'Next tool');
let resumed = null;
const resumedResult = await completeGoalStepAndContinue({
  goalRunId: 'agr-resume-test', stepId: 'ags-resume-1', ownerUserId: 'ceo-resume-test', result: { ok: true },
}, { executeNext: async (goalRunId, options) => {
  resumed = { goalRunId, options };
  return { ok: true, step_id: 'ags-resume-2' };
} });
assert.deepEqual(resumed, { goalRunId: 'agr-resume-test', options: { ownerUserId: 'ceo-resume-test' } });
assert.equal(resumedResult.continuation.step_id, 'ags-resume-2', 'nested step completion must wake the parent goal');

console.log('goal plan maker/checker typed contract tests passed');
try { const { getDb } = await import('../src/db/schema.js'); getDb().close(); } catch {}
rmSync(dataDir, { recursive: true, force: true });
