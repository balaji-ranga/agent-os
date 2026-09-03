import assert from 'node:assert/strict';
import { getDb } from '../src/db/schema.js';
import { qualityAssureGoalPlan } from '../src/services/goal-plan-quality.js';
import {
  listOrchestratorToolsForGoalPlan,
  listSpecialtyAgentsForGoalPlan,
} from '../src/services/goal-plan-intent.js';

const db = getDb();
const ownerId = String(process.env.REGRESSION_CEO_ID || 'ceo-bala').trim();
const owner = db.prepare("SELECT id FROM platform_users WHERE id=? AND role='ceo' AND enabled=1").get(ownerId);
assert(owner, `Enabled CEO ${ownerId} was not found`);
const orchestrator = db.prepare(`SELECT a.id,a.openclaw_agent_id FROM agents a
  JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=? AND ua.enabled=1
  WHERE (COALESCE(a.is_coo,0)=1 OR COALESCE(a.is_orchestrator,0)=1)
  ORDER BY COALESCE(a.is_coo,0) DESC,a.id LIMIT 1`).get(ownerId);
assert(orchestrator, `No orchestrator is entitled to ${ownerId}`);
const orchestratorId = orchestrator.openclaw_agent_id || orchestrator.id;
const tools = listOrchestratorToolsForGoalPlan(ownerId, orchestratorId);
const tool = ['ceo_profile', 'status_checker'].map((name) => tools.find((item) => item.name === name)).find(Boolean)
  || tools.find((item) => /\b(read|list|status|profile)\b/i.test(`${item.name} ${item.purpose || ''}`));
assert(tool?.name, 'No safe read-only tool is available for the inactive-slot checker regression');
const agents = (await listSpecialtyAgentsForGoalPlan(ownerId, orchestratorId))
  .filter((agent) => String(agent.id).toLowerCase() !== String(orchestrator.id).toLowerCase());
const specialist = agents.find((agent) => /research|analysis|technology/i.test(`${agent.name} ${agent.role}`)) || agents[0];
assert(specialist?.id, 'No eligible specialist is available for the inactive-slot checker regression');

const prompt = `Read-only planner regression: call exact tool ${tool.name}, pass its structured result to exact specialist ${specialist.id} (${specialist.name}) for a bounded factual interpretation, and return an outcome-rich final result to the CEO. Do not send email, publish, mutate records, or create external side effects.`;
const candidateSteps = [
  {
    key: 'read_data', type: 'agent_tool', label: `Call ${tool.name}`, depends_on: [], required_inputs: [],
    produces: [{ key: 'source_data', kind: 'data', required: true }],
    spec: { tool_name: tool.name, selection_rationale: 'The goal explicitly selects this available read-only tool.' },
  },
  {
    key: 'interpret_data', type: 'specialty_task', label: `${specialist.name} interprets the result`, depends_on: ['read_data'],
    required_inputs: [{ key: 'source_data', kind: 'data', source_step_key: 'read_data', required: true }],
    produces: [{ key: 'interpretation', kind: 'data', required: true }],
    spec: {
      agent_id: specialist.id,
      message: 'Interpret only the supplied read-only result and return a concise factual outcome.',
      selection_rationale: 'The named specialist is explicitly selected and available in the live tenant catalog.',
    },
  },
  {
    key: 'report_outcome', type: 'notify_ceo', label: 'Return the completed outcome to the CEO', depends_on: ['interpret_data'],
    required_inputs: [
      { key: 'source_data', kind: 'data', source_step_key: 'read_data', required: true },
      { key: 'interpretation', kind: 'data', source_step_key: 'interpret_data', required: true },
    ],
    produces: [],
    spec: { selection_rationale: 'The CEO requested the final factual outcome in chat.' },
  },
];

const result = await qualityAssureGoalPlan({
  ownerUserId: ownerId,
  orchestratorAgentId: orchestratorId,
  prompt,
  candidateSteps,
});
assert.equal(result.quality.checker_endpoint, 'secondary', `Expected inactive secondary slot checker, got ${result.quality.checker_endpoint}`);
assert.equal(result.quality.checker_degraded, false, 'Inactive-slot checker degraded to deterministic-only validation');
assert(result.quality.checker_model && result.quality.checker_model !== 'deterministic_contract', 'Inactive-slot checker model was not used');
assert.equal(result.steps.at(-1)?.type, 'notify_ceo');
assert(result.steps.some((step) => step.type === 'agent_tool' && step.spec?.tool_name === tool.name));
assert(result.steps.some((step) => step.type === 'specialty_task' && String(step.spec?.agent_id).toLowerCase() === String(specialist.id).toLowerCase()));
console.log('GOAL_PLAN_INACTIVE_CHECKER_OK', JSON.stringify({
  owner_user_id: ownerId,
  orchestrator_agent_id: orchestratorId,
  maker_model: result.quality.maker_model,
  checker_model: result.quality.checker_model,
  checker_endpoint: result.quality.checker_endpoint,
  checker_degraded: result.quality.checker_degraded,
  checker_approved_maker: result.quality.checker_approved_maker,
  steps: result.steps.map((step) => ({ key: step.key, type: step.type, executor: step.spec?.tool_name || step.spec?.agent_id || null })),
}, null, 2));
