/**
 * Specialty orchestrator self-plan: granted tools stay on the plan (not COO prefer-list).
 * Usage: node scripts/test-goal-plan-specialty-orchestrator.mjs
 */
import { planGoalStepsAsync } from '../src/services/agent-goal-run.js';
import { listOrchestratorToolsForGoalPlan } from '../src/services/goal-plan-intent.js';

const owner = process.env.REGRESSION_CEO_ID || process.env.FLOLAH_EXCHANGE_PUBLISHER_USER_ID || 'ceo-bala';
const orchestrator = process.env.GOAL_PLAN_ORCHESTRATOR_ID || 'businessdiscovery';

function assert(c, m) {
  if (!c) throw new Error(m);
}

const tools = listOrchestratorToolsForGoalPlan(owner, orchestrator);
if (!tools.some((t) => t.name === 'business_discover' || t.name === 'google_places_nearby')) {
  console.log('SKIP specialty orchestrator plan (no Places/discover grants on', orchestrator, ')');
  process.exit(0);
}

const prompt = `Research dental clinics within 5 km of Tampines, Singapore.
Find up to 20 businesses using Google Places and research their publicly available online presence.
Rank the top 5 potential prospects. Do not permanently track these businesses unless I ask you to.`;

const steps = await planGoalStepsAsync(prompt, {
  ownerUserId: owner,
  orchestratorAgentId: orchestrator,
});
console.log(
  JSON.stringify(
    steps.map((s, i) => ({
      i,
      type: s.type,
      label: s.label,
      tool: s.spec?.tool_name || s.tool_name,
      agent: s.spec?.agent_id,
    })),
    null,
    2
  )
);

assert(!steps.some((s) => s.type === 'specialty_task'), 'self-plan must not nest specialty_task');
const toolNames = steps
  .filter((s) => s.type === 'agent_tool')
  .map((s) => s.spec?.tool_name || s.tool_name);
assert(
  toolNames.some((n) => /business_discover|google_places/.test(String(n || ''))),
  'expected Places/discover agent_tool, got ' + JSON.stringify(toolNames)
);
assert(
  steps.some((s) => s.type === 'agent_continue') || toolNames.length >= 1,
  'expected data tools and/or agent_continue synthesis'
);

console.log('GOAL_PLAN_SPECIALTY_ORCHESTRATOR_OK', { steps: steps.length, toolNames });
