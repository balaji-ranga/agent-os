import assert from 'node:assert/strict';
import { normalizeExecutorOutputKinds } from '../src/services/goal-plan-quality.js';
import { normalizeStepSpec } from '../src/services/agent-goal-run.js';
import { compactRouterInput } from '../src/services/agent-turn-router.js';

const catalog = {
  agents: [{
    id: 'ibkr-portfolio--strategy-sme-2',
    capabilities: [{ name: 'ibkr_portfolio_analytics' }],
    connector_actions: [],
    skills: [{
      id: 'platform:ibkr-portfolio-strategy-sme',
      version: 2,
      version_id: 'platform:ibkr-portfolio-strategy-sme:v2',
      required_tools: ['ibkr_quant_signal_infer'],
      ready: true,
    }],
  }],
  tools: [], workflows: [], humans: [],
};

const recommendation = normalizeExecutorOutputKinds([{
  type: 'specialty_task', key: 'ibkr_review', label: 'IBKR portfolio assessment',
  produces: [{ key: 'assessment', kind: 'data', required: true }],
  spec: {
    agent_id: 'ibkr-portfolio--strategy-sme-2',
    skill_refs: [{ skill_id: 'platform:ibkr-portfolio-strategy-sme' }],
    objective: 'Assess the portfolio and recommend strategy changes',
    operation_mode: 'analyze', subject: 'portfolio and strategy', deliverable_kind: 'data',
    message: 'Review the portfolio and provide quantified recommendations.',
  },
}], catalog, { prompt: 'Assess my IBKR portfolio and recommend strategy changes.' });
assert.deepEqual(recommendation[0].spec.required_tool_names, ['ibkr_quant_signal_infer']);
assert.match(recommendation[0].spec.message, /MUST call ibkr_quant_signal_infer/);
assert.ok(recommendation[0].produces.some((item) => item.key === 'quant_signal_evidence'));
assert.deepEqual(normalizeStepSpec(recommendation[0]).spec.required_tool_names, ['ibkr_quant_signal_infer']);

const statusOnly = normalizeExecutorOutputKinds([{
  type: 'specialty_task', key: 'ibkr_status', label: 'IBKR status report', produces: [],
  spec: { agent_id: 'ibkr-portfolio--strategy-sme-2', skill_refs: [{ skill_id: 'platform:ibkr-portfolio-strategy-sme' }],
    objective: 'Return a status report', operation_mode: 'analyze', subject: 'recent activity', deliverable_kind: 'status_report', message: 'Report recent activity.' },
}], catalog, { prompt: 'Get me a status report from the IBKR SME.' });
assert.equal(statusOnly[0].spec.required_tool_names, undefined);

const routerInput = compactRouterInput({
  current_message: 'A'.repeat(200000),
  agent: { id: 'coo', name: 'COO', capabilities: ['tool'], skills: [{ id: 's', name: 'Skill', description: 'D'.repeat(1000) }] },
  organization: Array.from({ length: 100 }, (_, i) => ({ id: `agent-${i}`, name: `Agent ${i}`, role: 'specialist', capabilities: Array.from({ length: 100 }, () => 'capability'), skills: [{ id: 's', name: 'Skill', description: 'D'.repeat(1000) }] })),
  capability_catalog: Array.from({ length: 500 }, (_, i) => ({ name: `cap-${i}`, description: 'D'.repeat(1000) })),
  candidate_turns: Array.from({ length: 30 }, (_, i) => ({ id: i, content: 'T'.repeat(2000) })),
});
assert.ok(JSON.stringify(routerInput).length <= 60000, 'router context must stay within compaction budget');
assert.equal(routerInput._context_compaction.compacted, true);
console.log('quant skill contract and router context compaction tests passed');
