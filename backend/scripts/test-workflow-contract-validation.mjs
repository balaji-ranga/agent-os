import assert from 'node:assert/strict';
import {
  analyzeWorkflowForPublish,
  formatCatalogForPrompt,
  validateWorkflowForPublish,
} from '../src/services/agent-workflow-builder-catalog.js';

const trigger = {
  id: 'trigger-1',
  type: 'trigger',
  position: { x: 0, y: 0 },
  data: { label: 'Start', taskConfig: {} },
};
const email = (bindings) => ({
  id: 'email-1',
  type: 'email',
  position: { x: 200, y: 0 },
  data: { label: 'Send report', inputBindings: bindings, taskConfig: { useEnvSmtp: true } },
});
const edge = { id: 'e-1', source: 'trigger-1', target: 'email-1' };

const incomplete = analyzeWorkflowForPublish({ nodes: [trigger, email([])], edges: [edge] });
assert.equal(incomplete.ok, false);
assert.deepEqual(
  new Set(incomplete.issues.filter((issue) => issue.code === 'required_input_missing').map((issue) => issue.field)),
  new Set(['inputBindings.to', 'inputBindings.subject', 'inputBindings.body'])
);

const completeStatic = {
  nodes: [
    trigger,
    email([
      { id: 'to', mode: 'static', value: 'ceo@example.com' },
      { id: 'subject', mode: 'static', value: 'Daily report' },
      { id: 'body', mode: 'static', value: 'All systems operational.' },
    ]),
  ],
  edges: [edge],
};
assert.deepEqual(validateWorkflowForPublish(completeStatic), []);

const report = {
  id: 'report-1',
  type: 'agent',
  position: { x: 180, y: 0 },
  data: {
    label: 'Prepare report',
    agentId: 'status-checker',
    prompt: 'Prepare a report',
    inputBindings: [{ id: 'prompt', mode: 'static', value: 'Prepare a report' }],
    taskConfig: {},
  },
};
const dynamic = {
  nodes: [
    trigger,
    report,
    email([
      { id: 'to', mode: 'workflow_variable', variableKey: 'recipient_email' },
      { id: 'subject', mode: 'static', value: 'Daily report' },
      { id: 'body', mode: 'dynamic', sourceNodeId: 'report-1', sourceOutputKey: 'text' },
    ]),
  ],
  edges: [
    { id: 'e-trigger-report', source: 'trigger-1', target: 'report-1' },
    { id: 'e-report-email', source: 'report-1', target: 'email-1' },
  ],
};
assert.deepEqual(validateWorkflowForPublish(dynamic), []);

const badOutput = structuredClone(dynamic);
badOutput.nodes.find((node) => node.id === 'email-1').data.inputBindings.find((binding) => binding.id === 'body').sourceOutputKey = 'not_real';
assert(validateWorkflowForPublish(badOutput).some((message) => message.includes('unavailable output')));

const promptCatalog = formatCatalogForPrompt({ compact: true });
assert(promptCatalog.includes('"required": true'));
assert(promptCatalog.includes('staticRecipientDynamicBody'));
assert(promptCatalog.includes('workflow_variable'));

console.log('workflow contract validation: ok');
