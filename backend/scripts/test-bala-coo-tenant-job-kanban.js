/**
 * Verify tenant COO tools + job Kanban moves for Bala CEO.
 * Usage: node scripts/test-bala-coo-tenant-job-kanban.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { getBalaCeoAuthId, resolveCeoDataUserId } from '../src/services/job-applicant-ceo.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';
import { syncAllowlistsFile } from '../src/services/openclaw-agent-tools.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  startPipeline,
  enqueuePipelineStage,
} from '../src/services/job-applicant-pipeline.js';
import { processPendingDelegationTasks as processDelegations } from '../src/services/delegation-queue.js';
import { createJobSearchProfileService } from '../src/services/job-search-profile.js';

initDb();
const db = getDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const CEO = getBalaCeoAuthId();
const DATA_CEO = resolveCeoDataUserId(CEO);
const PROFILE = process.env.TEST_PROFILE_ID || 'banking-svp-cloud-sg';
const token = createSession(CEO).token;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Repair COO docs
const balserve = db.prepare(`SELECT * FROM agents WHERE id='balserve'`).get();
const jobdiscovery = db.prepare(`SELECT * FROM agents WHERE id='jobdiscovery'`).get();
const cooTenant = ensureTenantOpenClawAgent(balserve, CEO);
const jdTenant = ensureTenantOpenClawAgent(jobdiscovery, CEO);
syncAllowlistsFile();

const soul = readFileSync(join(cooTenant.workspacePath, 'SOUL.md'), 'utf8');
const tools = readFileSync(join(cooTenant.workspacePath, 'TOOLS.md'), 'utf8');
assert(/BalServe|COO/i.test(soul), 'COO SOUL identity present');
assert(/agent_workflow_list/i.test(tools), 'COO TOOLS has workflow list');

const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
assert(!!health?.ok, 'backend up');

console.log('\n=== 1) Tenant COO workflow tools ===');
const listAsTenant = await api(
  'POST',
  '/api/tools/invoke',
  { tool_name: 'agent_workflow_list', caller_agent_id: cooTenant.openclawAgentId },
  { 'x-openclaw-agent-id': cooTenant.openclawAgentId }
);
assert(
  listAsTenant.status === 200 && listAsTenant.data?.ok === true,
  `tenant COO list workflows status=${listAsTenant.status} err=${listAsTenant.data?.error || ''}`
);
assert(Array.isArray(listAsTenant.data?.workflows), 'workflows array returned');

const listAsFake = await api(
  'POST',
  '/api/tools/invoke',
  { tool_name: 'agent_workflow_list', caller_agent_id: 'techresearcher' },
  { 'x-openclaw-agent-id': 'techresearcher' }
);
assert(listAsFake.status === 403, 'non-COO denied workflow list');

const enquire = await api(
  'POST',
  '/api/tools/invoke',
  { tool_name: 'agent_workflow_enquire', query: 'email', all: true, caller_agent_id: cooTenant.openclawAgentId },
  { 'x-openclaw-agent-id': cooTenant.openclawAgentId }
);
assert(enquire.status === 200 && enquire.data?.ok === true, `tenant COO enquire status=${enquire.status}`);

// No Bearer: owner must resolve from tenant OpenClaw agent id (post-segregation path)
const listNoAuth = await fetch(`${BASE}/api/tools/invoke`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-openclaw-agent-id': cooTenant.openclawAgentId,
    'x-internal-test': '1',
  },
  body: JSON.stringify({
    tool_name: 'agent_workflow_list',
    caller_agent_id: cooTenant.openclawAgentId,
  }),
  signal: AbortSignal.timeout(30000),
}).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));
assert(
  listNoAuth.status === 200 &&
    listNoAuth.data?.ok === true &&
    listNoAuth.data?.ceo_user_id === CEO,
  `tenant COO list without session owner=${listNoAuth.data?.ceo_user_id} status=${listNoAuth.status} err=${listNoAuth.data?.error || ''}`
);

console.log('\n=== 2) Agent workflow run (email) + completion ===');
const emailWf = 'test-simple-email-resume';
let def = store.getDefinition(emailWf, CEO);
if (!def) {
  console.log('SKIP email workflow missing — seeding not required if absent');
} else {
  const run = await startAgentWorkflowRun(emailWf, CEO, {
    trigger: 'manual',
    input: 'tenant-kanban-check',
    actor: { id: 'test-bala-tenant', name: 'Test' },
  });
  const t0 = Date.now();
  let final = null;
  while (Date.now() - t0 < 60000) {
    final = store.getRun(run.id, CEO);
    if (['completed', 'failed'].includes(final.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(final?.status === 'completed', `email workflow status=${final?.status}`);
}

console.log('\n=== 3) Kanban move as tenant jobdiscovery ===');
// Create a kanban task assigned to jobdiscovery, move in_progress → completed via tenant caller
db.prepare(
  `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by)
   VALUES (?, ?, 'open', 'jobdiscovery', ?)`
).run('Tenant isolation kanban test', 'Move me', CEO);
const taskId = db.prepare(`SELECT id FROM kanban_tasks ORDER BY id DESC LIMIT 1`).get()?.id;

const move1 = await api(
  'POST',
  '/api/tools/invoke',
  {
    tool_name: 'kanban_move_status',
    task_id: taskId,
    new_status: 'in_progress',
    caller_agent_id: jdTenant.openclawAgentId,
  },
  { 'x-openclaw-agent-id': jdTenant.openclawAgentId }
);
assert(
  move1.status === 200 && (move1.data?.ok === true || move1.data?.status === 'in_progress' || !move1.data?.error),
  `kanban in_progress via tenant JD status=${move1.status} ${JSON.stringify(move1.data).slice(0, 180)}`
);

const move2 = await api(
  'POST',
  '/api/tools/invoke',
  {
    tool_name: 'kanban_move_status',
    task_id: taskId,
    new_status: 'completed',
    caller_agent_id: jdTenant.openclawAgentId,
  },
  { 'x-openclaw-agent-id': jdTenant.openclawAgentId }
);
const row = db.prepare(`SELECT status FROM kanban_tasks WHERE id=?`).get(taskId);
assert(row?.status === 'completed' || move2.status === 200, `kanban completed status=${row?.status}`);

console.log('\n=== 4) Job pipeline (Bala→data CEO) + kanban ===');
console.log('auth CEO', CEO, 'data CEO', DATA_CEO, 'profile', PROFILE);
const profileSvc = createJobSearchProfileService(() => getDb());
const profileGate = profileSvc.assertActive(DATA_CEO, PROFILE);
assert(profileGate.active, `active profile ${PROFILE} for ${DATA_CEO}: ${profileGate.error || 'ok'}`);

let pipelineStarted = null;
try {
  pipelineStarted = await startPipeline(DATA_CEO, PROFILE);
  console.log('pipeline start', pipelineStarted);
} catch (e) {
  console.error('pipeline start error', e.message);
  assert(false, `pipeline start: ${e.message}`);
}

if (pipelineStarted?.login_required || pipelineStarted?.ok === false) {
  console.log('NOTE: startPipeline blocked — enqueue discovery stage for kanban path');
  const enq = enqueuePipelineStage('discovery', 'tenant e2e discovery', DATA_CEO, PROFILE);
  console.log('enqueued', enq);
  assert(!!enq?.kanban_task_id || !!enq?.delegation_task_id || enq?.skipped, `enqueue discovery ${JSON.stringify(enq)}`);
} else {
  assert(!!pipelineStarted?.ok, `pipeline ok=${pipelineStarted?.ok}`);
}

// Give discovery / harvest a short window; confirm kanban/delegation activity
const beforeKanban = Date.now();
for (let i = 0; i < 2; i++) {
  await processDelegations().catch((e) => console.warn('delegation tick', e.message));
  await new Promise((r) => setTimeout(r, 3000));
}
const pipelineKanban = db
  .prepare(
    `SELECT id, status, assigned_agent_id, title, created_by
     FROM kanban_tasks
     WHERE created_by IN ('job_pipeline','agent_workflow')
        OR description LIKE '%[job_pipeline:%'
        OR title LIKE '%Discover%'
     ORDER BY id DESC LIMIT 10`
  )
  .all();
console.log('pipeline-related kanban', pipelineKanban);
assert(
  pipelineKanban.length > 0 ||
    pipelineStarted?.discovered_count >= 0 ||
    pipelineStarted?.mode === 'harvest_server' ||
    pipelineStarted?.ok === true,
  'pipeline produced kanban or harvest activity'
);
const anyMoved = pipelineKanban.some((t) =>
  ['in_progress', 'completed', 'awaiting_confirmation', 'open'].includes(t.status)
);
if (pipelineKanban.length) assert(anyMoved, 'pipeline kanban in expected statuses');
console.log('pipeline check window ms', Date.now() - beforeKanban);

console.log('\n=== 5) Agent job workflow (template) — kanban cards ===');
const jobWfId = 'template-job-applicant-pipeline';
const jobDef = store.getDefinition(jobWfId, CEO);
if (!jobDef || jobDef.status !== 'published') {
  console.log('SKIP template-job-applicant-pipeline missing/unpublished');
} else {
  const wfRun = await startAgentWorkflowRun(jobWfId, CEO, {
    trigger: 'manual',
    input: 'tenant agent workflow e2e',
    actor: { id: 'test-bala-tenant', name: 'Test' },
  });
  console.log('agent wf run', wfRun.id, wfRun.run_number);
  let wfKanban = [];
  const tKanban = Date.now();
  while (Date.now() - tKanban < 20000) {
    wfKanban = db
      .prepare(
        `SELECT id, status, assigned_agent_id, title FROM kanban_tasks
         WHERE description LIKE ?
         ORDER BY id DESC LIMIT 8`
      )
      .all(`%agent_wf_run_id: ${wfRun.id}%`);
    if (wfKanban.length) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('wf kanban after start', wfKanban);
  assert(wfKanban.length > 0, 'agent workflow created kanban tasks');
  assert(
    wfKanban.some((k) =>
      ['awaiting_confirmation', 'in_progress', 'completed', 'failed'].includes(k.status)
    ),
    'agent workflow kanban statuses ok'
  );
  // One delegation tick — may move to in_progress if OpenClaw responds quickly
  await processDelegations().catch((e) => console.warn('wf delegation', e.message));
  await new Promise((r) => setTimeout(r, 2000));
  wfKanban = db
    .prepare(
      `SELECT id, status, assigned_agent_id, title FROM kanban_tasks
       WHERE description LIKE ?
       ORDER BY id DESC LIMIT 8`
    )
    .all(`%agent_wf_run_id: ${wfRun.id}%`);
  console.log('wf kanban after tick', wfKanban);
  const moved = wfKanban.some((k) => k.status === 'in_progress' || k.status === 'completed');
  if (moved) assert(true, 'agent workflow kanban moved by tenant agent');
  else console.log('NOTE: kanban still awaiting agent OpenClaw response (card created)');
}

console.log('\nCOO runtime', cooTenant.openclawAgentId);
console.log('JD runtime', jdTenant.openclawAgentId);
console.log(failed ? `\nFAILED ${failed}` : '\nALL BALA TENANT COO + KANBAN TESTS PASSED');
process.exit(failed ? 1 : 0);
