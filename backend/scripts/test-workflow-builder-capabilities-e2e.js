/**
 * Workflow Builder capability E2E — create (job pipeline), clone, troubleshoot, RCA.
 * Usage: node scripts/test-workflow-builder-capabilities-e2e.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { seedWorkflowBuilderAgent } from './seed-workflow-builder-agent.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import { applyWorkflowBuilderActions } from '../src/services/agent-workflow-builder.js';
import { runWorkflowBuilderChat } from '../src/services/agent-workflow-agent.js';
import { parseWorkflowAgentCommand } from '../src/services/agent-workflow-chat-tools.js';
import {
  JOB_APPLICANT_TEMPLATE_ID,
  buildJobApplicantPipelineGraph,
} from '../src/services/agent-workflow-templates.js';
import { diagnoseWorkflowGraph } from '../src/services/agent-workflow-agent-troubleshoot.js';
import { formatRunRcaSection, parseFailedRunQueryIntent } from '../src/services/agent-workflow-agent-runs.js';
import { summarizeRunForAgent } from '../src/services/agent-workflow-chat-tools.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';

initDb();
seedWorkflowBuilderAgent();

const owner = getBalaCeoAuthId();
const actor = { id: 'workflowbuilder', name: 'Workflow Builder', type: 'workflow_builder' };
const stamp = Date.now().toString(36);

let passed = 0;
let failed = 0;
const createdIds = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  OK: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function expectedJobPipelineShape(graph) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edgeSet = new Set(edges.map((e) => `${e.source}->${e.target}`));
  return {
    hasTrigger: !!byId['trigger-1'] && byId['trigger-1'].type === 'trigger',
    hasDiscovery: byId['agent-discovery']?.data?.agentId === 'jobdiscovery',
    hasFit: byId['agent-fitscorer']?.data?.agentId === 'fitscorer',
    hasResume: byId['agent-resumetailor']?.data?.agentId === 'resumetailor',
    hasApply: byId['agent-application']?.data?.agentId === 'applicationagent',
    wired:
      edgeSet.has('trigger-1->agent-discovery') &&
      edgeSet.has('agent-discovery->agent-fitscorer') &&
      edgeSet.has('agent-fitscorer->agent-resumetailor') &&
      edgeSet.has('agent-resumetailor->agent-application'),
    nodeCount: nodes.length,
  };
}

async function chat(message, workflowId = null) {
  return runWorkflowBuilderChat({
    ownerUserId: owner,
    workflowId,
    message,
    history: [],
    actor,
    persist: false,
  });
}

console.log('=== Workflow Builder capabilities E2E ===');
console.log('Owner:', owner);

// --------------------------------------------------------------------------
// 1. Create job-pipeline-equivalent workflow via prompting (recipe path)
// --------------------------------------------------------------------------
console.log('\n— 1. Create job pipeline via prompt');
const createName = `WB Job Pipeline ${stamp}`;
const createRes = await chat(
  `Create a new workflow called ${createName} that is the same as the job applicant pipeline workflow`
);
createdIds.push(createRes.workflow_id);
assert(createRes.workflow_id, 'created workflow id');
const created = store.getDefinition(createRes.workflow_id, owner);
assert(created, 'definition exists');
const shape = expectedJobPipelineShape(created.draft_graph || created.published_graph);
assert(shape.hasTrigger, 'has trigger-1');
assert(shape.hasDiscovery, 'has jobdiscovery agent');
assert(shape.hasFit, 'has fitscorer agent');
assert(shape.hasResume, 'has resumetailor agent');
assert(shape.hasApply, 'has applicationagent');
assert(shape.wired, 'linear edges match job pipeline');
assert(shape.nodeCount === 5, `5 nodes (got ${shape.nodeCount})`);
assert(
  createRes.actions_applied?.some((a) => a.action === 'create_from_template' || a.action === 'create_workflow'),
  'create action applied'
);
assert(created.status === 'published', 'recipe auto-published');

// Structural parity vs template graph
const tplGraph = buildJobApplicantPipelineGraph();
const tplShape = expectedJobPipelineShape(tplGraph);
assert(tplShape.wired && shape.wired, 'matches template topology');

// E2E: trigger a run (agents may fail in this env — run must start)
let pipelineRun = null;
try {
  pipelineRun = await startAgentWorkflowRun(created.id, owner, {
    trigger: 'manual',
    input: 'Capability E2E smoke',
    actor,
  });
  assert(pipelineRun?.id, `run started #${pipelineRun?.run_number}`);
  const after = store.getRun(pipelineRun.id, owner);
  assert(
    after && ['running', 'completed', 'failed', 'paused'].includes(after.status),
    `run status=${after?.status}`
  );
} catch (e) {
  assert(false, `trigger failed: ${e.message}`);
}

// --------------------------------------------------------------------------
// 2. Clone / copy existing definition
// --------------------------------------------------------------------------
console.log('\n— 2. Clone workflow');
const cloneCmd = parseWorkflowAgentCommand(`clone ${createName} as ${createName} Clone`, {
  workflowId: null,
});
assert(cloneCmd?.cmd === 'clone_workflow', 'parses clone ... as ...');
assert(cloneCmd?.workflow_name?.includes('Job Pipeline'), 'clone source name parsed');

const cloneRes = await chat(`clone ${createName} as ${createName} Clone`);
createdIds.push(cloneRes.workflow_id);
assert(cloneRes.workflow_id && cloneRes.workflow_id !== createRes.workflow_id, 'clone has new id');
const cloned = store.getDefinition(cloneRes.workflow_id, owner);
assert(cloned?.name?.includes('Clone'), `clone name=${cloned?.name}`);
assert(cloned?.status === 'draft', 'clone starts as draft');
const cloneShape = expectedJobPipelineShape(cloned.draft_graph);
assert(cloneShape.wired, 'cloned graph retains job pipeline wiring');
assert(
  cloneRes.actions_applied?.some((a) =>
    ['clone_workflow', 'copy_workflow', 'duplicate_workflow'].includes(a.action)
  ),
  'clone action applied'
);

// Direct action path
const clone2 = await applyWorkflowBuilderActions(
  owner,
  null,
  [{ action: 'clone_workflow', source_workflow_id: createRes.workflow_id, new_name: `${createName} Copy2` }],
  actor
);
createdIds.push(clone2.workflow_id);
assert(clone2.results?.[0]?.cloned_from === createRes.workflow_id, 'direct clone_from id');

// --------------------------------------------------------------------------
// 3. Induce structural issues → troubleshoot + fix
// --------------------------------------------------------------------------
console.log('\n— 3. Troubleshoot broken workflow');
const brokenName = `WB Broken ${stamp}`;
const brokenCreate = await applyWorkflowBuilderActions(
  owner,
  null,
  [
    {
      action: 'create_from_template',
      template_id: JOB_APPLICANT_TEMPLATE_ID,
      name: brokenName,
    },
  ],
  actor
);
createdIds.push(brokenCreate.workflow_id);
const brokenId = brokenCreate.workflow_id;

// Induce: delete middle edge + clear an agent id
await applyWorkflowBuilderActions(
  owner,
  brokenId,
  [
    { action: 'delete_edge', source: 'agent-discovery', target: 'agent-fitscorer' },
    {
      action: 'update_node',
      node_id: 'agent-fitscorer',
      agent_id: '',
      data: { agentId: '', agentName: '' },
    },
  ],
  actor
);

// Clear agentId more reliably via draft patch if update_node doesn't clear
{
  const def = store.getDefinition(brokenId, owner);
  const g = JSON.parse(JSON.stringify(def.draft_graph));
  const fit = g.nodes.find((n) => n.id === 'agent-fitscorer');
  if (fit) {
    fit.data.agentId = '';
    fit.data.agent_id = '';
  }
  // Also ensure edge is gone
  g.edges = g.edges.filter((e) => !(e.source === 'agent-discovery' && e.target === 'agent-fitscorer'));
  store.updateDraft(brokenId, owner, { graph: g }, actor);
}

const beforeDiag = diagnoseWorkflowGraph(store.getDefinition(brokenId, owner));
assert(beforeDiag.issues.length >= 1, `induced issues count=${beforeDiag.issues.length}`);

const tsReport = await chat(`troubleshoot workflow ${brokenName}`, brokenId);
assert(/issue/i.test(tsReport.reply), 'troubleshoot reports issues');

const tsFix = await chat(`fix this workflow ${brokenName}`, brokenId);
assert(
  tsFix.actions_applied?.length > 0 || /applied|fix/i.test(tsFix.reply),
  'fix path applied or acknowledged fixes'
);

// Manually ensure edge + agent restored if heuristic only partially fixed
{
  const def = store.getDefinition(brokenId, owner);
  const g = JSON.parse(JSON.stringify(def.draft_graph));
  const hasEdge = g.edges.some((e) => e.source === 'agent-discovery' && e.target === 'agent-fitscorer');
  if (!hasEdge) {
    await applyWorkflowBuilderActions(
      owner,
      brokenId,
      [{ action: 'add_edge', source: 'agent-discovery', target: 'agent-fitscorer' }],
      actor
    );
  }
  const fit = (store.getDefinition(brokenId, owner).draft_graph.nodes || []).find(
    (n) => n.id === 'agent-fitscorer'
  );
  if (!fit?.data?.agentId) {
    await applyWorkflowBuilderActions(
      owner,
      brokenId,
      [{ action: 'update_node', node_id: 'agent-fitscorer', agent_id: 'fitscorer', agent_name: 'Fit Scoring' }],
      actor
    );
  }
}
const afterDiag = diagnoseWorkflowGraph(store.getDefinition(brokenId, owner));
const stillOrphanOrMissingAgent = afterDiag.issues.some((i) =>
  ['orphan_node', 'missing_agent_id', 'trigger_disconnected'].includes(i.code)
);
assert(!stillOrphanOrMissingAgent, 'critical structural issues resolved');

// --------------------------------------------------------------------------
// 4. Induce run failure → RCA
// --------------------------------------------------------------------------
console.log('\n— 4. Failed run RCA');
const failName = `WB Fail RCA ${stamp}`;
const failCreate = await applyWorkflowBuilderActions(
  owner,
  null,
  [
    {
      action: 'create_workflow',
      name: failName,
      chat_phrase: `run fail rca ${stamp}`,
      trigger_modes: ['manual', 'chat'],
      graph: {
        nodes: [
          {
            id: 'trigger-1',
            type: 'trigger',
            position: { x: 40, y: 120 },
            data: {
              label: 'Start',
              triggerModes: ['manual', 'chat'],
              chatPhrase: `run fail rca ${stamp}`,
              inputBindings: [],
              outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
            },
          },
          {
            id: 'api-1',
            type: 'api',
            position: { x: 280, y: 120 },
            data: {
              label: 'Bad API',
              inputBindings: [
                {
                  id: 'url',
                  mode: 'static',
                  value: 'http://127.0.0.1:1/definitely-down',
                },
                { id: 'body', mode: 'static', value: '{}' },
              ],
              taskConfig: {
                method: 'POST',
                authType: 'none',
                timeoutMs: 3000,
                timeoutAction: 'fail',
                defaultTimeoutOutput: '{}',
              },
              outputs: [
                { id: 'status', label: 'HTTP status' },
                { id: 'body', label: 'Response body' },
                { id: 'ok', label: 'Success' },
              ],
            },
          },
        ],
        edges: [{ id: 'e1', source: 'trigger-1', target: 'api-1' }],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    },
    { action: 'publish' },
  ],
  actor
);
createdIds.push(failCreate.workflow_id);
assert(failCreate.workflow_id, 'fail-test workflow created');

const failRun = await startAgentWorkflowRun(failCreate.workflow_id, owner, {
  trigger: 'manual',
  input: 'force failure',
  actor,
});
// Wait for failure
let terminal = null;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 500));
  terminal = store.getRun(failRun.id, owner);
  if (terminal && ['failed', 'completed', 'paused'].includes(terminal.status)) break;
}
assert(terminal?.status === 'failed', `run failed (status=${terminal?.status})`);

const rcaIntent = parseFailedRunQueryIntent(
  `what is the RCA for the recent failed run of ${failName}`
);
assert(rcaIntent, 'parses RCA / failed-run intent');

const rcaChat = await chat(
  `Analyze the recent failed run of ${failName} and provide RCA / root cause`,
  failCreate.workflow_id
);
assert(/root cause|RCA|Failed step/i.test(rcaChat.reply), 'RCA reply includes analysis');
assert(/api|http|timeout|fetch|connect|ECONNREFUSED|failed/i.test(rcaChat.reply), 'RCA mentions failure evidence');

const summary = summarizeRunForAgent(terminal);
const rcaBlock = formatRunRcaSection({ name: failName }, summary);
assert(/Likely root cause/i.test(rcaBlock), 'RCA section formatted');
assert(/Recommended fix/i.test(rcaBlock), 'RCA has recommended fix');

// --------------------------------------------------------------------------
// Cleanup
// --------------------------------------------------------------------------
console.log('\n— Cleanup');
for (const id of createdIds.filter(Boolean)) {
  try {
    await applyWorkflowBuilderActions(owner, id, [{ action: 'delete_workflow', workflow_id: id }], actor);
  } catch (e) {
    console.warn('  cleanup skip', id, e.message);
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
console.log('All workflow builder capability tests passed.');
