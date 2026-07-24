/**
 * E2E on VPS/local: Balaji Brave BYOK workflow.
 * - Rebuild/start brave-search-mcp BYOK image (no env key)
 * - Seed MCP registry + workflow for Balaji
 * - Assert MCP tool call WITHOUT key fails
 * - Run workflow with keys passed only as trigger input
 *
 *   docker compose exec -w /opt/agent-os/backend backend \
 *     node scripts/test-balaji-brave-byok-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { connectMcpServer, callMcpServerTool, getMcpServer } from '../src/services/mcp-servers.js';
import * as store from '../src/services/agent-workflow-store.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import { BRAVE_MCP_ID, seedBraveSearchMcp } from './seed-brave-search-mcp.js';
import {
  WORKFLOW_ID,
  seedBalajiBraveByokWorkflow,
} from './seed-balaji-brave-byok-workflow.js';

initDb();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitRun(runId, owner, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = store.getRun(runId, owner);
    if (!run) throw new Error(`run ${runId} missing`);
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    await sleep(1500);
  }
  throw new Error(`run ${runId} timed out`);
}

async function main() {
  const braveKey = String(process.env.BRAVE_API_KEY || '').trim();
  const deepseekKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  const openaiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
  const brainKey = deepseekKey || openaiKey;
  assert(braveKey, 'BRAVE_API_KEY required in env for test *input* only (not injected into MCP container)');
  assert(brainKey, 'DEEPSEEK_API_KEY or OPENAI_API_KEY required for Brain test input');
  if (deepseekKey) process.env.BRAIN_BYOK_PROVIDER = process.env.BRAIN_BYOK_PROVIDER || 'deepseek';
  else process.env.BRAIN_BYOK_PROVIDER = process.env.BRAIN_BYOK_PROVIDER || 'openai';
  console.log('Brain provider for seed:', process.env.BRAIN_BYOK_PROVIDER);

  let owner;
  try {
    owner = process.env.CEO_USER_ID || getBalaCeoAuthId();
  } catch {
    owner = getDb().prepare(`SELECT id FROM platform_users WHERE role='ceo' AND enabled=1 LIMIT 1`).get()?.id;
  }
  assert(owner, 'Balaji / CEO owner id required');
  const ownerName =
    getDb().prepare('SELECT name FROM platform_users WHERE id = ?').get(owner)?.name || owner;
  console.log('Owner:', owner, ownerName);

  const admin =
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' AND enabled = 1 LIMIT 1`).get() || {
      id: owner,
      role: 'ceo',
    };

  console.log('==> seed Brave MCP registry');
  await seedBraveSearchMcp();
  const mcp = await connectMcpServer(BRAVE_MCP_ID, admin);
  assert(mcp?.status === 'healthy' || getMcpServer(BRAVE_MCP_ID, admin)?.status === 'healthy', 'Brave MCP not healthy');

  console.log('==> assert BYOK: tool call without key must fail');
  let denied = false;
  try {
    const bare = await callMcpServerTool(
      BRAVE_MCP_ID,
      'brave_web_search',
      { query: 'test', count: 1 },
      admin,
      null
    );
    if (bare?.is_error || /key required|X-Subscription-Token|Authorization/i.test(bare?.text || '')) {
      denied = true;
    }
  } catch (err) {
    denied = /key required|X-Subscription-Token|Authorization|Brave API key/i.test(err.message || '');
    if (!denied) throw err;
  }
  assert(denied, 'Expected MCP call without key to fail (no platform env fallback)');

  console.log('==> assert BYOK: tool call WITH header key succeeds');
  const withKey = await callMcpServerTool(
    BRAVE_MCP_ID,
    'brave_web_search',
    { query: 'Brave Search API', count: 3 },
    admin,
    {
      headers: { 'X-Subscription-Token': braveKey },
    }
  );
  assert(!withKey.is_error, `MCP with key failed: ${withKey.text || JSON.stringify(withKey)}`);
  assert(/Brave|search|result|url/i.test(withKey.text || ''), 'MCP response looks empty');

  console.log('==> seed workflow for Balaji');
  const def = seedBalajiBraveByokWorkflow(owner, { publish: true });
  assert(def?.id === WORKFLOW_ID, 'workflow seed failed');

  const query = process.env.BRAVE_BYOK_QUERY || 'AgentOSBraveSearch';
  console.log('==> start workflow run with keys as trigger input only');
  const run = await startAgentWorkflowRun(WORKFLOW_ID, owner, {
    trigger: 'manual',
    input: {
      brainApiKey: brainKey,
      braveApiKey: braveKey,
      query,
    },
    actor: { id: 'test-balaji-brave-byok', name: 'BYOK test', type: 'system' },
  });
  console.log('Run id', run.id);
  const finished = await waitRun(run.id, owner);
  console.log('Run status', finished.status, finished.error_message || '');
  assert(finished.status === 'completed', `workflow failed: ${finished.error_message || finished.status}`);

  const steps = getDb()
    .prepare(
      `SELECT node_id, node_type, status, error_message FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id`
    )
    .all(finished.id);
  for (const s of steps) {
    console.log(' step', s.node_id, s.node_type, s.status, s.error_message || '');
  }
  assert(
    steps.every((s) => s.status === 'completed'),
    'not all steps completed'
  );

  console.log('\nBALAJI_BRAVE_BYOK_WORKFLOW_OK');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
