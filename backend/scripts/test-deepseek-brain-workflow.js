/**
 * E2E: Brain node with DeepSeek via local Ollama (no cloud API key).
 * Usage: node scripts/test-deepseek-brain-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import * as store from '../src/services/agent-workflow-store.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();

const WORKFLOW_ID = 'test-deepseek-brain-summarize';
const ownerUserId = process.env.WORKFLOW_TEST_OWNER_USER_ID || getBalaCeoAuthId();

function deepseekEndpoint() {
  const raw = (process.env.DEEPSEEK_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://ollama:11434/v1')
    .trim()
    .replace(/\/$/, '');
  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
}

function buildGraph() {
  const apiEndpoint = deepseekEndpoint();
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v3';
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 120 },
        data: { label: 'Start', triggerModes: ['manual'] },
      },
      {
        id: 'brain-1',
        type: 'brain',
        position: { x: 260, y: 120 },
        data: {
          label: 'DeepSeek Summarize',
          inputBindings: [
            {
              id: 'userMessage',
              mode: 'static',
              value:
                'Agent OS coordinates multi-agent workflows with OpenClaw gateways, Kanban tasks, content tools, and published A2A agents on AgentExchange.',
            },
          ],
          taskConfig: {
            modelSource: 'deepseek',
            apiEndpoint,
            apiKey: '',
            model,
            maxTokens: 400,
            systemPrompt: 'Summarize the following text in exactly 3 short bullet points.\n\n{{input}}',
            mcpToolCalling: false,
            mcpServerIds: [],
          },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'trigger-1', target: 'brain-1' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function waitForRun(runId, maxMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const row = getDb()
      .prepare(`SELECT status, context_json FROM agent_workflow_runs WHERE id = ?`)
      .get(runId);
    if (!row) throw new Error(`run ${runId} missing`);
    if (row.status === 'completed' || row.status === 'failed' || row.status === 'cancelled') {
      return row;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`run ${runId} timed out`);
}

const actor = { id: 'deepseek-test', name: 'DeepSeek Test', type: 'system' };
const graph = buildGraph();
let def = store.getDefinition(WORKFLOW_ID, ownerUserId);
if (!def) {
  def = store.createDefinition({
    id: WORKFLOW_ID,
    name: 'DeepSeek Brain Summarize Test',
    ownerUserId,
    actor,
    graph,
    trigger_modes: ['manual'],
  });
} else {
  store.updateDraft(WORKFLOW_ID, ownerUserId, { graph, trigger_modes: ['manual'] }, actor);
}
store.publishDefinition(WORKFLOW_ID, ownerUserId, actor);

console.log('DeepSeek (Ollama) endpoint:', deepseekEndpoint());
console.log('Model:', process.env.DEEPSEEK_MODEL || 'deepseek-v3');
console.log('Owner:', ownerUserId);

const run = await startAgentWorkflowRun(WORKFLOW_ID, ownerUserId, {
  trigger: 'manual',
  input: 'deepseek smoke',
  actor,
});

console.log('Started run', run.id);
const final = await waitForRun(run.id);
if (final.status !== 'completed') {
  console.error('Run failed:', final.status, String(final.context_json || '').slice(0, 800));
  process.exit(1);
}

let ctx;
try {
  ctx = JSON.parse(final.context_json || '{}');
} catch {
  ctx = {};
}
const brainOut = ctx.node_outputs?.['brain-1'];
const text = typeof brainOut === 'object' ? brainOut?.text : String(brainOut || '');
console.log('Brain provider:', typeof brainOut === 'object' ? brainOut?.provider : 'n/a');
console.log('Brain model:', typeof brainOut === 'object' ? brainOut?.model_used : 'n/a');
console.log('Summary preview:', String(text).slice(0, 400));

if (!text || String(text).trim().length < 20) {
  console.error('DeepSeek brain output too short');
  process.exit(1);
}

console.log('DEEPSEEK_BRAIN_WORKFLOW_OK');
