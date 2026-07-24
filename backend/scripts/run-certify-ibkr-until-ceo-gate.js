/**
 * Fix Balaji certify-ibkr-llm-mrxmpmlm wiring + CEO gate, then run until CEO approval.
 * Does not approve.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import * as store from '../src/services/agent-workflow-store.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();
const db = getDb();
const ownerUserId = getBalaCeoAuthId();
const WF_ID = 'certify-ibkr-llm-mrxmpmlm-mrxmppqd';
const actor = { id: 'ops', name: 'Run until CEO gate' };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function summarizeSteps(run) {
  for (const s of run.steps || []) {
    const err = s.error_message ? ` err=${s.error_message}` : '';
    console.log(`  ${s.node_id} (${s.node_type}): ${s.status}${err}`);
  }
}

function healGraph(def) {
  const prev = structuredClone(def.published_graph || def.draft_graph || { nodes: [], edges: [] });
  const byId = Object.fromEntries((prev.nodes || []).map((n) => [n.id, n]));

  // Ensure CEO node exists (reuse config if present)
  if (!byId['ceo-day']) {
    byId['ceo-day'] = {
      id: 'ceo-day',
      type: 'ceo_approval',
      position: { x: 1410, y: 40 },
      data: {
        label: 'CEO day-plan gate',
        taskConfig: {
          prompt: 'Approve paper day plan before marking accepted?',
          timeoutHours: 24,
        },
      },
    };
  }

  const required = [
    'trigger-1',
    'parallel-1',
    'stub-snapshot',
    'stub-history',
    'merge-1',
    'maker-1',
    'checker-1',
    'if-checker',
    'ceo-day',
    'done-ok',
    'done-reject',
  ];
  for (const id of required) {
    if (!byId[id]) throw new Error(`Missing required node ${id}`);
  }

  // IF node must put sourceNodeId/operator on taskConfig (bindings alone are ignored at runtime)
  const iff = byId['if-checker'];
  iff.data = iff.data || {};
  iff.data.taskConfig = {
    ...(iff.data.taskConfig || {}),
    sourceNodeId: 'checker-1',
    sourceOutputKey: 'text',
    operator: 'contains',
    compareValue: 'approved',
  };

  const nodes = required.map((id) => byId[id]);
  const edges = [
    { id: 'e1', source: 'trigger-1', target: 'parallel-1' },
    { id: 'e2a', source: 'parallel-1', target: 'stub-snapshot' },
    { id: 'e2b', source: 'parallel-1', target: 'stub-history' },
    { id: 'e3a', source: 'stub-snapshot', target: 'merge-1' },
    { id: 'e3b', source: 'stub-history', target: 'merge-1' },
    { id: 'e4', source: 'merge-1', target: 'maker-1' },
    { id: 'e5', source: 'maker-1', target: 'checker-1' },
    { id: 'e6', source: 'checker-1', target: 'if-checker' },
    { id: 'e7t', source: 'if-checker', target: 'ceo-day', sourceHandle: 'true' },
    { id: 'e7f', source: 'if-checker', target: 'done-reject', sourceHandle: 'false' },
    { id: 'e8', source: 'ceo-day', target: 'done-ok' },
  ];

  const graph = { nodes, edges, viewport: prev.viewport || { x: 0, y: 0, zoom: 0.7 } };
  store.updateDraft(
    def.id,
    ownerUserId,
    {
      graph,
      description: `${def.description || ''} | ops healed wiring + CEO gate`,
    },
    actor
  );
  store.publishDefinition(def.id, ownerUserId, actor);
  return store.getDefinition(def.id, ownerUserId);
}

async function waitForCeoGate(runId, { timeoutMs = 720000 } = {}) {
  const start = Date.now();
  let lastLog = 0;
  while (Date.now() - start < timeoutMs) {
    const run = store.getRun(runId, ownerUserId);
    const ceoStep = (run.steps || []).find((s) => s.node_type === 'ceo_approval');
    const ceoActive =
      ceoStep && ['in_progress', 'listening', 'awaiting', 'waiting'].includes(ceoStep.status);
    const kanban = db
      .prepare(
        `SELECT id, title, status FROM kanban_tasks
         WHERE description LIKE ? AND description LIKE ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(`%agent_wf_run_id: ${runId}%`, '%node_type: ceo_approval%');

    if (Date.now() - lastLog > 15000) {
      lastLog = Date.now();
      const active = (run.steps || []).filter((s) =>
        ['in_progress', 'listening', 'awaiting', 'running'].includes(s.status)
      );
      console.log(
        `… ${Math.round((Date.now() - start) / 1000)}s status=${run.status} progress=${run.progress_pct ?? '?'} active=${active.map((s) => `${s.node_id}:${s.status}`).join(',') || '-'}`
      );
    }

    if (ceoActive || kanban) {
      return { run, ceoStep, kanban, reached: true };
    }
    if (['failed', 'completed', 'cancelled'].includes(run.status)) {
      return { run, ceoStep, kanban: null, reached: false };
    }
    await sleep(3000);
  }
  return { run: store.getRun(runId, ownerUserId), ceoStep: null, kanban: null, reached: false, timedOut: true };
}

async function main() {
  let def = store.getDefinition(WF_ID, ownerUserId);
  if (!def) throw new Error(`Workflow ${WF_ID} not found`);
  console.log('owner', ownerUserId, 'workflow', def.id, def.status);

  def = healGraph(def);
  const g = def.published_graph;
  console.log(
    'healed edges',
    (g.edges || []).map((e) => `${e.source}->${e.target}${e.sourceHandle ? '[' + e.sourceHandle + ']' : ''}`).join(', ')
  );
  store.setPaused(def.id, ownerUserId, false, actor);

  console.log('\n=== Start run (stop at CEO; no approve) ===');
  const run = await startAgentWorkflowRun(def.id, ownerUserId, {
    trigger: 'manual',
    input: 'Prepare today paper day plan for allowlist names within $1000 budget.',
    actor,
  });
  console.log('Run id:', run.id, 'status:', run.status);

  const result = await waitForCeoGate(run.id);
  console.log('\n=== Result ===');
  console.log(
    JSON.stringify(
      {
        workflow_id: def.id,
        reached_ceo_gate: !!result.reached,
        timed_out: !!result.timedOut,
        run_id: result.run?.id,
        run_status: result.run?.status,
        progress_pct: result.run?.progress_pct,
        ceo_step: result.ceoStep
          ? { node_id: result.ceoStep.node_id, status: result.ceoStep.status }
          : null,
        kanban: result.kanban || null,
      },
      null,
      2
    )
  );
  summarizeSteps(result.run);
  if (!result.reached) {
    console.error('\nDID_NOT_REACH_CEO_GATE');
    process.exit(1);
  }
  console.log('\nREACHED_CEO_APPROVAL_GATE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
