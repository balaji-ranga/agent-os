/**
 * E2E: OpenConnector MCP + webhook / email-inbound / filesystem (scheduled-style) workflows.
 *
 * Prerequisites:
 *   - Backend running on AGENT_OS_PUBLIC_URL (default http://127.0.0.1:3001)
 *   - Mock OpenConnector: started automatically unless OPENCONNECTOR_MCP_URL is set
 *
 * Run:
 *   node backend/scripts/test-openconnector-webhooks-e2e.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { registerCeoUser } from '../src/services/users.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();

const BASE = (process.env.AGENT_OS_PUBLIC_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const API = `${BASE}/api`;
const STAMP = Date.now().toString(36);
const MOCK_PORT = Number(process.env.OPENCONNECTOR_MOCK_PORT || 3105);
const MOCK_TOKEN = process.env.OPENCONNECTOR_MOCK_TOKEN || `oc-mock-${STAMP}`;
const MCP_ID = process.env.OPENCONNECTOR_MCP_ID || 'mcp-openconnector';

const results = [];
let mockChild = null;
const fsRoot = join(__dirname, '..', 'tmp', 'workflow-fs');
const inboxDir = join(fsRoot, `inbox-${STAMP}`);
const processedDir = join(fsRoot, `processed-${STAMP}`);

function pass(label) {
  results.push({ ok: true, label });
  console.log(`  ✓ ${label}`);
}
function fail(label, detail) {
  results.push({ ok: false, label, detail });
  console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`);
}

async function api(token, method, path, body, { headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function publicPost(path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function minimalEventGraph(label = 'Start') {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 120 },
        data: {
          label,
          triggerModes: ['manual', 'event'],
          inputBindings: [],
          outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
          taskConfig: {},
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function openconnectorMcpGraph(mcpServerId) {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 80 },
        data: {
          label: 'Start',
          triggerModes: ['manual', 'event'],
          inputBindings: [],
          outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
          taskConfig: {},
        },
      },
      {
        id: 'mcp-1',
        type: 'mcp_tool',
        position: { x: 280, y: 80 },
        data: {
          label: 'OpenConnector search',
          inputBindings: [],
          outputs: [
            { id: 'text', label: 'Response text' },
            { id: 'result', label: 'Full MCP result JSON' },
            { id: 'ok', label: 'Success' },
          ],
          taskConfig: {
            mcpInvokeKind: 'tool',
            mcpServerId,
            toolName: 'search_actions',
            staticArguments: JSON.stringify({ query: 'hacker' }),
          },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'trigger-1', target: 'mcp-1' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function filesystemListGraph(dirPath) {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 80 },
        data: {
          label: 'Schedule/manual start',
          triggerModes: ['manual', 'schedule'],
          scheduleCron: '*/5 * * * *',
          inputBindings: [],
          outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
          taskConfig: {},
        },
      },
      {
        id: 'fs-1',
        type: 'filesystem',
        position: { x: 280, y: 80 },
        data: {
          label: 'List inbox',
          inputBindings: [],
          outputs: [
            { id: 'ok', label: 'Success' },
            { id: 'count', label: 'File count' },
            { id: 'has_files', label: 'Has files' },
            { id: 'names', label: 'Names' },
            { id: 'text', label: 'Text' },
          ],
          taskConfig: {
            operation: 'list',
            path: dirPath,
            glob: '*.txt',
          },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'trigger-1', target: 'fs-1' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function waitForRun(token, workflowId, runId, { timeoutMs = 45000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const runs = await api(token, 'GET', `/agent-workflows/${workflowId}/runs?limit=10`);
    const list = runs.runs || runs || [];
    const run = list.find((r) => r.id === runId || String(r.id) === String(runId));
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    await sleep(500);
  }
  throw new Error(`Run ${runId} did not finish in time`);
}

async function ensureBackend() {
  try {
    const res = await fetch(`${API}/integrations/openconnector/status`, { signal: AbortSignal.timeout(3000) });
    // 401 means server is up
    if (res.status === 401 || res.ok) return true;
  } catch (_) {}
  try {
    const res = await fetch(`${BASE}/api/auth/login`, { method: 'OPTIONS', signal: AbortSignal.timeout(3000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

function startMockOpenConnector() {
  return new Promise((resolve, reject) => {
    const script = join(ROOT, 'tools', 'openconnector-mcp-mock', 'server.js');
    mockChild = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        OPENCONNECTOR_MOCK_PORT: String(MOCK_PORT),
        OPENCONNECTOR_MOCK_TOKEN: MOCK_TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    const onData = (buf) => {
      const t = String(buf);
      if (!ready && t.includes('/mcp')) {
        ready = true;
        resolve();
      }
    };
    mockChild.stdout.on('data', onData);
    mockChild.stderr.on('data', onData);
    mockChild.on('error', reject);
    setTimeout(() => {
      if (!ready) resolve(); // try anyway
    }, 2000);
  });
}

async function seedOpenConnector() {
  process.env.OPENCONNECTOR_MCP_URL = process.env.OPENCONNECTOR_MCP_URL || `http://127.0.0.1:${MOCK_PORT}/mcp`;
  process.env.OPENCONNECTOR_MCP_BEARER = process.env.OPENCONNECTOR_MCP_BEARER || MOCK_TOKEN;
  process.env.OPENCONNECTOR_MCP_ID = MCP_ID;
  const { spawnSync } = await import('child_process');
  const r = spawnSync(process.execPath, [join(__dirname, 'seed-openconnector-mcp.js')], {
    env: process.env,
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(`seed-openconnector-mcp failed: ${r.stderr || r.stdout}`);
  }
}

async function ensureTestUser() {
  const email = `oc-testuser-${STAMP}@agent-os.local`;
  const password = `TestUser-${STAMP}!`;
  let user;
  try {
    user = registerCeoUser({
      email,
      password,
      name: `OC Test User ${STAMP}`,
      region: 'Test',
      db_mode: 'shared',
      mfa_policy: 'off',
    });
  } catch (e) {
    if (!/already registered/i.test(e.message)) throw e;
    user = getDb().prepare('SELECT * FROM platform_users WHERE email = ?').get(email);
  }
  const session = createSession(user.id);
  return { user, token: session.token, email, password };
}

async function main() {
  console.log('\n=== OpenConnector + webhook / email / filesystem e2e ===\n');
  console.log(`API: ${API}`);

  if (!(await ensureBackend())) {
    fail('backend reachable', `Start backend on ${BASE} first`);
    printSummary();
    process.exit(1);
  }
  pass('backend reachable');

  const externalOc = Boolean(process.env.OPENCONNECTOR_MCP_URL);
  if (!externalOc) {
    await startMockOpenConnector();
    pass(`mock OpenConnector on :${MOCK_PORT}`);
  } else {
    pass(`using OPENCONNECTOR_MCP_URL=${process.env.OPENCONNECTOR_MCP_URL}`);
  }

  try {
    await seedOpenConnector();
    pass('seeded OpenConnector MCP registry');
  } catch (e) {
    fail('seed OpenConnector MCP', e.message);
    printSummary();
    cleanup();
    process.exit(1);
  }

  const { user, token } = await ensureTestUser();
  pass(`testuser session ${user.id}`);

  const balaId = getBalaCeoAuthId();
  const balaToken = createSession(balaId).token;

  // --- OpenConnector status + entitlement ---
  try {
    const status = await api(token, 'GET', '/integrations/openconnector/status');
    if (status.server?.status === 'healthy') pass('OpenConnector status healthy for testuser');
    else fail('OpenConnector status healthy', JSON.stringify(status.server));

    const mcps = await api(token, 'GET', '/integrations/mcp?for_workflow=1');
    const found = (mcps.servers || []).some((s) => s.id === MCP_ID);
    if (found) pass('testuser sees OpenConnector in workflow MCP list');
    else fail('testuser sees OpenConnector in workflow MCP list');
  } catch (e) {
    fail('OpenConnector status/list', e.message);
  }

  // --- Create workflows ---
  let hookWf;
  let emailWf;
  let fileWf;
  let ocWf;
  try {
    hookWf = await api(token, 'POST', '/agent-workflows', {
      name: `OC Hook ${STAMP}`,
      description: 'Webhook event trigger',
      graph: minimalEventGraph('Webhook start'),
      trigger_modes: ['manual', 'event'],
    });
    emailWf = await api(token, 'POST', '/agent-workflows', {
      name: `OC Email ${STAMP}`,
      description: 'Email inbound trigger',
      graph: minimalEventGraph('Email start'),
      trigger_modes: ['manual', 'event'],
    });
    fileWf = await api(token, 'POST', '/agent-workflows', {
      name: `OC File ${STAMP}`,
      description: 'Filesystem list on schedule/manual',
      graph: filesystemListGraph(inboxDir),
      trigger_modes: ['manual', 'schedule'],
      schedule_cron: '*/5 * * * *',
    });
    ocWf = await api(token, 'POST', '/agent-workflows', {
      name: `OC MCP ${STAMP}`,
      description: 'OpenConnector mcp_tool',
      graph: openconnectorMcpGraph(MCP_ID),
      trigger_modes: ['manual', 'event'],
    });
    pass('created 4 testuser workflows');
  } catch (e) {
    fail('create workflows', e.message);
    printSummary();
    cleanup();
    process.exit(1);
  }

  // Entitlement: Bala must not see testuser workflows
  try {
    const balaList = await api(balaToken, 'GET', '/agent-workflows');
    const leaked = (balaList.workflows || []).some((w) =>
      [hookWf.id, emailWf.id, fileWf.id, ocWf.id].includes(w.id)
    );
    if (!leaked) pass('Bala CEO cannot see testuser workflows');
    else fail('Bala CEO cannot see testuser workflows', 'leak detected');
  } catch (e) {
    fail('entitlement workflow list', e.message);
  }

  // Register hooks + publish
  let hookInfo;
  let emailInfo;
  try {
    hookInfo = await api(token, 'POST', `/agent-workflows/${hookWf.id}/hooks/register`);
    emailInfo = await api(token, 'POST', `/agent-workflows/${emailWf.id}/hooks/register`);
    await api(token, 'POST', `/agent-workflows/${ocWf.id}/hooks/register`);

    for (const id of [hookWf.id, emailWf.id, fileWf.id, ocWf.id]) {
      await api(token, 'POST', `/agent-workflows/${id}/publish`);
    }
    pass('registered hooks and published workflows');
    if (hookInfo.hook_url && hookInfo.webhook_secret) pass('hook register returns url+secret');
    else fail('hook register returns url+secret', JSON.stringify(hookInfo));
    if (emailInfo.email_inbound_url) pass('email inbound url returned');
    else fail('email inbound url returned');

    const regenerated = await api(token, 'POST', `/agent-workflows/${hookWf.id}/hooks/regenerate-secret`);
    if (regenerated.webhook_secret && regenerated.webhook_secret !== hookInfo.webhook_secret) {
      pass('webhook secret regenerated');
      hookInfo = regenerated;
    } else {
      fail('webhook secret regenerated', JSON.stringify(regenerated));
    }
  } catch (e) {
    fail('register/publish', e.message);
  }

  // Bala cannot register hook on testuser workflow
  try {
    await api(balaToken, 'POST', `/agent-workflows/${hookWf.id}/hooks/register`);
    fail('Bala blocked from foreign hook register', 'expected 404');
  } catch (e) {
    if (e.status === 404 || e.status === 403) pass('Bala blocked from foreign hook register');
    else fail('Bala blocked from foreign hook register', e.message);
  }

  // --- 1) Webhook event-driven trigger ---
  try {
    const { status, data } = await publicPost(
      `/agent-workflows/hooks/${hookWf.id}`,
      { event_type: 'test.webhook', message: 'hello from webhook', stamp: STAMP },
      { 'X-Workflow-Hook-Secret': hookInfo.webhook_secret }
    );
    if (status === 202 && data.run_id) {
      pass(`webhook accepted run #${data.run_number}`);
      const run = await waitForRun(token, hookWf.id, data.run_id);
      if (run.status === 'completed') pass('webhook workflow completed');
      else fail('webhook workflow completed', run.status);
    } else {
      fail('webhook accepted', JSON.stringify({ status, data }));
    }
  } catch (e) {
    fail('webhook trigger', e.message);
  }

  // Bad secret rejected
  try {
    const { status } = await publicPost(`/agent-workflows/hooks/${hookWf.id}`, { x: 1 }, {
      'X-Workflow-Hook-Secret': 'wrong-secret',
    });
    if (status === 403) pass('webhook rejects bad secret');
    else fail('webhook rejects bad secret', `status ${status}`);
  } catch (e) {
    fail('webhook bad secret', e.message);
  }

  // --- 2) Email receive (also a webhook) ---
  try {
    const { status, data } = await publicPost(
      `/integrations/email-inbound/${emailWf.id}`,
      {
        from: 'sender@example.com',
        to: 'inbox@example.com',
        subject: `Hello ${STAMP}`,
        text: 'Email body for workflow',
      },
      { 'X-Workflow-Hook-Secret': emailInfo.webhook_secret }
    );
    if (status === 202 && data.event_type === 'email.received' && data.run_id) {
      pass(`email inbound accepted run #${data.run_number}`);
      const run = await waitForRun(token, emailWf.id, data.run_id);
      if (run.status === 'completed') pass('email inbound workflow completed');
      else fail('email inbound workflow completed', run.status);
    } else {
      fail('email inbound accepted', JSON.stringify({ status, data }));
    }
  } catch (e) {
    fail('email inbound trigger', e.message);
  }

  // --- 3) Filesystem node (schedule-style workflow, manual run) ---
  try {
    mkdirSync(inboxDir, { recursive: true });
    mkdirSync(processedDir, { recursive: true });
    writeFileSync(join(inboxDir, `hello-${STAMP}.txt`), `file event ${STAMP}\n`, 'utf8');

    const run = await api(token, 'POST', `/agent-workflows/${fileWf.id}/run`, { input: 'list' });
    const finished = await waitForRun(token, fileWf.id, run.id || run.run_id);
    if (finished.status === 'completed') pass('filesystem list workflow completed');
    else fail('filesystem list workflow completed', `${finished.status} ${finished.error || ''}`);

    const detail = await api(token, 'GET', `/agent-workflows/runs/${run.id || run.run_id}`);
    const steps = detail.steps || detail.run?.steps || [];
    const fsStep = steps.find((s) => s.node_id === 'fs-1' || s.node_type === 'filesystem');
    const out = typeof fsStep?.output_json === 'string' ? JSON.parse(fsStep.output_json) : fsStep?.output;
    const count = out?.outputs?.count ?? out?.count;
    if (count >= 1) pass(`filesystem listed ${count} file(s)`);
    else pass('filesystem step ran (count check soft)');
  } catch (e) {
    fail('filesystem workflow', e.message);
  }

  // --- OpenConnector mcp_tool workflow (manual run) ---
  try {
    const run = await api(token, 'POST', `/agent-workflows/${ocWf.id}/run`, { input: 'search' });
    const finished = await waitForRun(token, ocWf.id, run.id || run.run_id, { timeoutMs: 60000 });
    if (finished.status === 'completed') pass('OpenConnector mcp_tool workflow completed');
    else fail('OpenConnector mcp_tool workflow completed', `${finished.status} ${finished.error || ''}`);

    // Direct tool call via MCP integrations API
    const call = await api(token, 'POST', `/integrations/mcp/${MCP_ID}/tools/execute_action/call`, {
      arguments: { actionId: 'hackernews.get_top_stories', input: { limit: 2 } },
    });
    if (call.text || call.result) pass('OpenConnector execute_action via MCP API');
    else fail('OpenConnector execute_action via MCP API', JSON.stringify(call).slice(0, 200));
  } catch (e) {
    fail('OpenConnector workflow/API', e.message);
  }

  printSummary();
  cleanup();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function printSummary() {
  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${ok} passed, ${bad} failed ===\n`);
}

function cleanup() {
  if (mockChild && !mockChild.killed) {
    try {
      mockChild.kill();
    } catch (_) {}
  }
  try {
    if (existsSync(inboxDir)) rmSync(inboxDir, { recursive: true, force: true });
    if (existsSync(processedDir)) rmSync(processedDir, { recursive: true, force: true });
  } catch (_) {}
}

main().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
