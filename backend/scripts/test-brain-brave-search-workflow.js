/**
 * E2E: Brain + Brave Search MCP tool-calling.
 *
 * Prerequisites:
 *   - docker compose --profile optional-brave-mcp up -d brave-search-mcp
 *   - BRAVE_API_KEY in deploy/.env (consumed by MCP container only)
 *   - node backend/scripts/seed-brave-search-mcp.js
 *   - LLM: DeepSeek primary (default) via deploy/.env OPENAI_*
 *
 * Run: node backend/scripts/test-brain-brave-search-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import * as store from '../src/services/agent-workflow-store.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import { connectMcpServer } from '../src/services/mcp-servers.js';
import {
  seedBrainBraveSearchWorkflow,
  WORKFLOW_ID,
  buildBrainBraveSearchGraph,
} from './seed-brain-brave-search-workflow.js';
import { BRAVE_MCP_ID } from './seed-brave-search-mcp.js';

initDb();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseStepOutput(step) {
  if (!step?.output) return null;
  return typeof step.output === 'string' ? JSON.parse(step.output) : step.output;
}

function toolCallsFromOutput(out) {
  if (!out) return [];
  if (Array.isArray(out.mcp_tool_calls)) return out.mcp_tool_calls;
  const list = out.outputs || [];
  const tc = list.find((o) => o.id === 'mcp_tool_calls');
  if (!tc?.value) return [];
  try {
    return JSON.parse(tc.value);
  } catch {
    return [];
  }
}

function textFromOutput(out) {
  if (!out) return '';
  if (typeof out.text === 'string') return out.text;
  const list = out.outputs || [];
  const t = list.find((o) => o.id === 'text');
  return t?.value || '';
}

async function main() {
  const ownerUserId = process.env.WORKFLOW_SEED_OWNER_ID || process.env.AGENT_OS_BALA_CEO_ID || 'ceo-bala';
  const admin = getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' LIMIT 1`).get();
  if (!admin) throw new Error('No admin user');

  console.log('=== Connect Brave MCP ===');
  const mcp = await connectMcpServer(BRAVE_MCP_ID, admin);
  console.log('MCP status:', mcp.status, 'tools:', (mcp.tools || []).map((t) => t.name).join(', '));
  if (mcp.status !== 'healthy') {
    throw new Error('Brave MCP not healthy — seed and start container first');
  }

  console.log('\n=== Seed workflow ===');
  const def = seedBrainBraveSearchWorkflow(ownerUserId, { publish: true });
  store.setPaused(WORKFLOW_ID, ownerUserId, false, { id: 'test', name: 'Test' });
  const cfg = buildBrainBraveSearchGraph().nodes.find((n) => n.id === 'brain-1').data.taskConfig;
  console.log('Workflow:', def.id, 'brain=', cfg.modelSource, cfg.model);

  const question =
    process.env.BRAVE_TEST_QUERY ||
    'What is Brave Search API used for in AI agents? Give a brief answer with sources.';

  console.log('\n=== Start run ===');
  console.log('Query:', question);
  const run = await startAgentWorkflowRun(WORKFLOW_ID, ownerUserId, {
    trigger: 'manual',
    input: question,
    actor: { id: 'test', name: 'Brave Brain test', type: 'system' },
  });
  console.log('Run #' + run.run_number, 'id=' + run.id);

  let latest = store.getRun(run.id, ownerUserId);
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    latest = store.getRun(run.id, ownerUserId);
    const brain = latest.steps?.find((s) => s.node_id === 'brain-1');
    if (brain?.status === 'completed' || brain?.status === 'failed') break;
    if (i % 5 === 0) console.log('  … brain status:', brain?.status || 'pending', 'run:', latest.status);
  }

  const brainStep = latest.steps?.find((s) => s.node_id === 'brain-1');
  const out = parseStepOutput(brainStep);
  const toolCalls = toolCallsFromOutput(out);
  const text = textFromOutput(out);

  console.log('\n=== Result ===');
  console.log('Run status:', latest.status);
  console.log('Brain status:', brainStep?.status);
  if (brainStep?.error_message) console.log('Error:', brainStep.error_message);
  console.log('Tool calls:', toolCalls.map((c) => c.name || c.tool || JSON.stringify(c).slice(0, 80)).join(', ') || '(none)');
  console.log('Answer:\n', String(text).slice(0, 1500));

  const usedBrave = toolCalls.some((c) => {
    const n = String(c.name || c.tool || c.toolName || '');
    return n.includes('brave_web_search');
  });
  if (brainStep?.status !== 'completed') {
    console.error('FAIL: brain did not complete');
    process.exit(1);
  }
  if (!usedBrave) {
    console.error('FAIL: brave_web_search was not called');
    process.exit(1);
  }
  console.log('\nBRAVE_BRAIN_WORKFLOW_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
