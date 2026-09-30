import assert from 'node:assert/strict';

import { enrichCreateWorkflowActions } from '../src/services/agent-workflow-recipes.js';
import { normalizeWorkflowGraph } from '../src/services/agent-workflow-builder.js';
import { analyzeWorkflowForPublish } from '../src/services/agent-workflow-builder-catalog.js';

const prompt = 'create a workflow to get the latest status from content tool and send email';
const runtime = {
  contentTools: [
    {
      name: 'browse_recipe_run',
      display_name: 'Run Browser Recipe',
      purpose: 'Replay a saved browser-session recipe against an attached Chrome tab.',
    },
    {
      name: 'status_checker',
      display_name: 'COO Status Checker',
      purpose: 'Get the latest status or general company task status as an owner-scoped Kanban and agent task digest.',
    },
    {
      name: 'agent_goal_status',
      display_name: 'Goal Plan Status',
      purpose: 'Get one goal run by required goal_run_id.',
    },
    {
      name: 'agent_workflow_runs',
      display_name: 'Agent Workflow Runs',
      purpose: 'Inspect recent workflow run statuses, optionally scoped by workflow or run id.',
    },
    {
      name: 'crm_status',
      display_name: 'CRM Status',
      purpose: 'Return the Twenty CRM connection and object status.',
    },
    {
      name: 'erp_status',
      display_name: 'ERP Status',
      purpose: 'Return the ERPNext connection and company status.',
    },
    {
      name: 'email_send',
      display_name: 'Send Email',
      purpose: 'Send a one-off email message.',
    },
    {
      name: 'summarize_url',
      display_name: 'Summarize URL',
      purpose: 'Read and summarize the contents of a public web page.',
    },
  ],
};

function brokenLlmActions() {
  return [
    {
      action: 'create_workflow',
      name: 'Get Latest Status and Send Email',
      graph: {
        nodes: [
          { id: 'trigger-1', type: 'trigger', position: { x: 40, y: 120 }, data: { label: 'Start' } },
          {
            id: 'tool-1',
            type: 'tool',
            position: { x: 300, y: 120 },
            data: { label: 'Get Latest Status', toolName: 'browse_recipe_run' },
          },
          {
            id: 'email-1',
            type: 'email',
            position: { x: 560, y: 120 },
            data: {
              label: 'Send Email',
              inputBindings: [
                { id: 'to', mode: 'static', value: '' },
                { id: 'subject', mode: 'static', value: '' },
                { id: 'body', mode: 'dynamic', sourceNodeId: 'tool-1', sourceOutputKey: 'text' },
              ],
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'trigger-1', target: 'tool-1' },
          { id: 'e2', source: 'tool-1', target: 'email-1' },
        ],
      },
    },
  ];
}

const repaired = enrichCreateWorkflowActions(prompt, brokenLlmActions(), runtime);
const create = repaired.find((action) => action.action === 'create_workflow');
const graph = normalizeWorkflowGraph(create.graph);
const tool = graph.nodes.find((node) => node.type === 'tool');
const email = graph.nodes.find((node) => node.type === 'email');
const trigger = graph.nodes.find((node) => node.type === 'trigger');

assert.equal(tool.data.toolName, 'status_checker', 'catalog purpose should replace an unrelated browser tool');
assert.equal(
  email.data.inputBindings.find((binding) => binding.id === 'to')?.sourceOutputKey,
  'trigger_input.recipient_email',
  'missing recipient should become a required runtime input'
);
assert.match(
  email.data.inputBindings.find((binding) => binding.id === 'subject')?.value || '',
  /Get Latest Status and Send Email result/,
  'missing subject should receive a safe deterministic default'
);
assert.equal(
  email.data.inputBindings.find((binding) => binding.id === 'body')?.sourceNodeId,
  tool.id,
  'email body should use the upstream content-tool result'
);
assert.deepEqual(trigger.data.inputSchema?.required, ['recipient_email']);
assert(graph.edges.some((edge) => edge.source === tool.id && edge.target === email.id));

const readiness = analyzeWorkflowForPublish(graph);
assert.equal(readiness.ok, true, readiness.issues.map((issue) => issue.message).join('; '));

const explicitRecipient = enrichCreateWorkflowActions(
  `${prompt} to ceo@example.com`,
  brokenLlmActions(),
  runtime
)[0];
const explicitGraph = normalizeWorkflowGraph(explicitRecipient.graph);
const explicitEmail = explicitGraph.nodes.find((node) => node.type === 'email');
assert.deepEqual(
  explicitEmail.data.inputBindings.find((binding) => binding.id === 'to'),
  { id: 'to', label: 'To address', mode: 'static', value: 'ceo@example.com' }
);
assert.equal(explicitGraph.nodes.find((node) => node.type === 'trigger').data.inputSchema, undefined);

const namedToolActions = brokenLlmActions();
namedToolActions[0].graph.nodes[1].data.toolName = 'summarize_url';
const namedTool = enrichCreateWorkflowActions(
  'create a workflow using content tool summarize_url and send email to ceo@example.com',
  namedToolActions,
  runtime
)[0].graph.nodes.find((node) => node.type === 'tool');
assert.equal(namedTool.data.toolName, 'summarize_url', 'an explicitly named catalog tool must be preserved');

console.log('workflow-builder content-tool → email regression: PASS');
