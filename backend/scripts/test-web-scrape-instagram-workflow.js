/**
 * VPS/local e2e: Web Scrape node against Instagram via Crawlee sidecar.
 *
 *   docker compose exec -T -w /opt/agent-os/backend backend \
 *     node scripts/test-web-scrape-instagram-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
config({ path: join(__dirname, '../../deploy/.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { connectMcpServer, getMcpServer } from '../src/services/mcp-servers.js';
import * as store from '../src/services/agent-workflow-store.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import { seedWebScrapeMcp, WEB_SCRAPE_MCP_ID } from './seed-web-scrape-mcp.js';
import { seedWebScrapeInstagramWorkflow, WORKFLOW_ID } from './seed-web-scrape-instagram-workflow.js';

initDb();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitRun(runId, owner, timeoutMs = 240000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = store.getRun(runId, owner);
    if (!run) throw new Error(`run ${runId} missing`);
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    await sleep(2000);
  }
  throw new Error(`run ${runId} timed out`);
}

async function main() {
  let owner;
  try {
    owner = process.env.CEO_USER_ID || getBalaCeoAuthId();
  } catch {
    owner = getDb().prepare(`SELECT id FROM platform_users WHERE role='ceo' AND enabled=1 LIMIT 1`).get()?.id;
  }
  assert(owner, 'CEO owner id required');
  const ownerName = getDb().prepare('SELECT name FROM platform_users WHERE id = ?').get(owner)?.name || owner;
  console.log('Owner:', owner, ownerName);

  const admin =
    getDb().prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' AND enabled = 1 LIMIT 1`).get() || {
      id: owner,
      role: 'ceo',
    };

  console.log('==> seed Web Scrape MCP');
  await seedWebScrapeMcp();
  const mcp = getMcpServer(WEB_SCRAPE_MCP_ID, admin);
  assert(mcp, 'mcp-web-scrape missing');
  if (mcp.status !== 'healthy') {
    try {
      await connectMcpServer(WEB_SCRAPE_MCP_ID, admin);
    } catch (e) {
      console.warn('MCP connect:', e.message);
    }
  }

  console.log('==> seed Instagram scrape workflow');
  const def = seedWebScrapeInstagramWorkflow(owner);
  assert(def?.status === 'published', `workflow not published: ${def?.status}`);

  console.log('==> run workflow', WORKFLOW_ID);
  const started = await startAgentWorkflowRun(WORKFLOW_ID, owner, {
    trigger: 'manual',
    input: '',
    actor: { id: owner, name: ownerName },
  });
  assert(started?.id, 'run id missing');
  console.log('Run id:', started.id);

  const run = await waitRun(started.id, owner);
  const finished = store.getRun(run.id, owner);
  const steps = finished.steps || [];
  const scrape = steps.find((s) => s.node_id === 'scrape-ig' || s.node_type === 'web_scrape');
  const output = scrape?.output || {};
  const stats = output.stats || {};
  const text = String(output.text || '').slice(0, 800);
  const pages = output.pages || [];
  const visited = Number(stats.visited || 0);
  const loginWall = Boolean(stats.login_wall);

  console.log('Run status:', run.status, run.error_message || '');
  console.log('Visited:', visited, 'matched:', stats.matched, 'errors:', stats.errors, 'render:', stats.render);
  console.log('Login wall:', loginWall);
  console.log('Summary:\n', text || '(empty)');
  if (pages[0]) {
    console.log('First page title:', pages[0].title || '(none)', 'url:', pages[0].url);
  }

  assert(run.status === 'completed', `workflow failed: ${run.status} ${run.error_message || ''}`);
  assert(visited >= 1, `sidecar visited 0 pages (blocked or unreachable). stats=${JSON.stringify(stats)}`);
  console.log('PASS web-scrape Instagram workflow');
}

main().catch((e) => {
  console.error('FAIL', e.message || e);
  process.exit(1);
});
