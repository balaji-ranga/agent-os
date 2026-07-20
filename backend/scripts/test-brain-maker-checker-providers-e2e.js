/**
 * E2E: one workflow with Maker brain (OpenAI) + Checker brain (Ollama local).
 * Asserts both brain nodes complete and report the expected provider.
 *
 * Usage: node scripts/test-brain-maker-checker-providers-e2e.js
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

const WORKFLOW_ID = 'test-brain-maker-openai-checker-ollama';
const ownerUserId = process.env.WORKFLOW_TEST_OWNER_USER_ID || getBalaCeoAuthId();

function ollamaEndpoint() {
  const base = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

function buildGraph() {
  const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '';
  const openaiModel =
    process.env.OPENAI_PRIMARY_MODEL || process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini';
  const checkerModel = process.env.OLLAMA_MODEL || 'llama3.2';
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 120 },
        data: {
          label: 'Start',
          triggerModes: ['manual'],
          scheduleCron: '',
          chatPhrase: '',
        },
      },
      {
        id: 'maker-1',
        type: 'brain',
        position: { x: 260, y: 120 },
        data: {
          label: 'Maker (OpenAI)',
          inputBindings: [
            {
              id: 'userMessage',
              mode: 'static',
              value:
                'Create a tiny paper trade plan as JSON only: {"trades":[{"symbol":"AAPL","side":"BUY","qty":1}],"notes":"smoke"}. Topic: {{input}}',
            },
          ],
          taskConfig: {
            modelSource: 'openai',
            apiEndpoint: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
            apiKey: openaiKey,
            model: openaiModel,
            maxTokens: 400,
            systemPrompt:
              'You are Maker. Reply with ONLY compact valid JSON for a tiny equity day plan. No markdown.',
            mcpToolCalling: false,
            mcpServerIds: [],
          },
        },
      },
      {
        id: 'checker-1',
        type: 'brain',
        position: { x: 500, y: 120 },
        data: {
          label: 'Checker (Ollama)',
          inputBindings: [
            {
              id: 'userMessage',
              mode: 'dynamic',
              sourceNodeId: 'maker-1',
              sourceOutputKey: 'text',
            },
          ],
          taskConfig: {
            modelSource: 'ollama',
            apiEndpoint: ollamaEndpoint(),
            apiKey: '',
            model: checkerModel,
            maxTokens: 300,
            systemPrompt:
              'You are Checker. Review the Maker JSON. Reply with ONLY JSON: {"approved":true,"adjustments":[]} or {"approved":false,"adjustments":["reason"]}. No markdown.',
            mcpToolCalling: false,
            mcpServerIds: [],
          },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'maker-1' },
      { id: 'e2', source: 'maker-1', target: 'checker-1' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function upsertWorkflow(graph) {
  const actor = { id: ownerUserId, name: 'brain-provider-e2e', type: 'system' };
  const existing = getDb()
    .prepare(`SELECT id, owner_user_id FROM agent_workflow_definitions WHERE id = ?`)
    .get(WORKFLOW_ID);
  const owner = existing?.owner_user_id || ownerUserId;
  if (existing) {
    store.updateDraft(
      WORKFLOW_ID,
      owner,
      {
        name: 'Brain Maker OpenAI + Checker Ollama',
        description: 'Smoke: Maker=OpenAI, Checker=Ollama',
        graph,
        trigger_modes: ['manual'],
        schedule_cron: '',
        chat_trigger_phrase: '',
      },
      actor
    );
  } else {
    getDb()
      .prepare(
        `INSERT INTO agent_workflow_definitions (id, name, description, owner_user_id, draft_graph_json, status, schedule_cron, chat_trigger_phrase, trigger_modes)
         VALUES (?, ?, ?, ?, ?, 'draft', '', '', ?)`
      )
      .run(
        WORKFLOW_ID,
        'Brain Maker OpenAI + Checker Ollama',
        'Smoke: Maker=OpenAI, Checker=Ollama',
        owner,
        JSON.stringify(graph),
        'manual'
      );
    store.appendAudit(WORKFLOW_ID, {
      action: 'created',
      summary: 'Brain provider e2e created workflow',
      changedBy: actor.id,
    });
  }
  return store.publishDefinition(WORKFLOW_ID, owner, actor);
}

function stepOutput(step) {
  if (!step?.output) return null;
  if (typeof step.output === 'string') {
    try {
      return JSON.parse(step.output);
    } catch {
      return { text: step.output };
    }
  }
  return step.output;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitRun(runId, owner, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = store.getRun(runId, owner);
    if (['completed', 'failed'].includes(run.status)) return run;
    const checker = run.steps?.find((s) => s.node_id === 'checker-1');
    if (checker && ['completed', 'failed'].includes(checker.status) && run.status !== 'running') {
      return run;
    }
    await sleep(2000);
  }
  return store.getRun(runId, owner);
}

async function main() {
  const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '';
  console.log('=== Brain Maker (OpenAI) + Checker (Ollama) E2E ===');
  console.log('owner', ownerUserId);
  console.log('OPENAI key set', !!openaiKey);
  console.log('OLLAMA_BASE_URL', process.env.OLLAMA_BASE_URL || '(default)');
  console.log('ollama endpoint', ollamaEndpoint());

  if (!openaiKey) throw new Error('OPENAI_API_KEY required for Maker brain');

  const graph = buildGraph();
  const published = upsertWorkflow(graph);
  console.log('Published', published.id, published.status);
  if (published.status !== 'published') {
    throw new Error(`Expected published, got ${published.status}`);
  }

  const owner = published.owner_user_id || ownerUserId;
  const run = await startAgentWorkflowRun(WORKFLOW_ID, owner, {
    trigger: 'manual',
    input: 'smoke test maker/checker providers',
    actor: { id: 'brain-provider-e2e', name: 'E2E' },
  });
  console.log('Started run', run.id);

  const finalRun = await waitRun(run.id, owner);
  console.log('Run status', finalRun.status, 'progress', finalRun.progress_pct);

  const maker = finalRun.steps?.find((s) => s.node_id === 'maker-1');
  const checker = finalRun.steps?.find((s) => s.node_id === 'checker-1');
  const makerOut = stepOutput(maker);
  const checkerOut = stepOutput(checker);

  console.log('\n--- Maker ---');
  console.log('status', maker?.status);
  console.log('provider', makerOut?.provider || makerOut?.llm_provider);
  console.log('model_used', makerOut?.model_used);
  console.log('text', String(makerOut?.text || '').slice(0, 400));
  if (maker?.error_message) console.log('error', maker.error_message);

  console.log('\n--- Checker ---');
  console.log('status', checker?.status);
  console.log('provider', checkerOut?.provider || checkerOut?.llm_provider);
  console.log('model_used', checkerOut?.model_used);
  console.log('text', String(checkerOut?.text || '').slice(0, 400));
  if (checker?.error_message) console.log('error', checker.error_message);

  const makerProvider = String(makerOut?.provider || makerOut?.llm_provider || '').toLowerCase();
  const checkerProvider = String(checkerOut?.provider || checkerOut?.llm_provider || '').toLowerCase();
  const makerText = String(makerOut?.text || '').trim();
  const checkerText = String(checkerOut?.text || '').trim();

  const makerOk =
    maker?.status === 'completed' &&
    makerText.length > 0 &&
    (makerProvider.includes('openai') || !makerProvider || makerOut?.model_used);
  const checkerOk =
    checker?.status === 'completed' &&
    checkerText.length > 0 &&
    (checkerProvider.includes('ollama') ||
      String(checkerOut?.model_used || '').includes('llama') ||
      !checkerProvider);

  // Strict provider checks when fields are present
  if (makerProvider && !makerProvider.includes('openai')) {
    console.error('FAIL: Maker provider expected openai, got', makerProvider);
    process.exit(1);
  }
  if (checkerProvider && !checkerProvider.includes('ollama')) {
    console.error('FAIL: Checker provider expected ollama, got', checkerProvider);
    process.exit(1);
  }

  if (makerOk && checkerOk && finalRun.status === 'completed') {
    console.log('\n✓ TEST PASSED — Maker (OpenAI) and Checker (Ollama) both completed');
    process.exit(0);
  }

  console.error('\n✗ TEST FAILED');
  console.error({
    run: finalRun.status,
    makerOk,
    checkerOk,
    makerStatus: maker?.status,
    checkerStatus: checker?.status,
  });
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
