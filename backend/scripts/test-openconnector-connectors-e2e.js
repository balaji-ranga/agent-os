/**
 * E2E: OpenConnector facade + connector workflow node.
 *
 * Prerequisites:
 *   - Backend running on AGENT_OS_PUBLIC_URL (default http://127.0.0.1:3001)
 *   - Mock OpenConnector MCP started automatically unless OPENCONNECTOR_MCP_URL is set
 *
 * Run:
 *   node backend/scripts/test-openconnector-connectors-e2e.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { registerCeoUser } from '../src/services/users.js';

initDb();

const ROOT = join(__dirname, '..', '..');
const BASE = (process.env.AGENT_OS_PUBLIC_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const API = `${BASE}/api`;
const STAMP = Date.now().toString(36);
const MOCK_PORT = Number(process.env.OPENCONNECTOR_MOCK_PORT || 3105);
const MOCK_TOKEN =
  process.env.OPENCONNECTOR_MCP_BEARER ||
  process.env.OPENCONNECTOR_MOCK_TOKEN ||
  `oc-mock-${STAMP}`;
const MCP_ID = process.env.OPENCONNECTOR_MCP_ID || 'mcp-openconnector';

const results = [];
let mockChild = null;

function pass(label) {
  results.push({ ok: true, label });
  console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
  results.push({ ok: false, label, detail });
  console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`);
}

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function connectorGraph() {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 50, y: 80 },
        data: {
          label: 'Start',
          triggerModes: ['manual'],
          inputBindings: [],
          outputs: [{ id: 'trigger_input', label: 'Trigger payload' }],
          taskConfig: {},
        },
      },
      {
        id: 'connector-1',
        type: 'connector',
        position: { x: 300, y: 80 },
        data: {
          label: 'Hacker News',
          inputBindings: [
            {
              id: 'input',
              label: 'Action input',
              mode: 'static',
              value: JSON.stringify({ print: 'pretty' }),
              sourceNodeId: '',
              sourceOutputKey: 'result',
            },
          ],
          outputs: [
            { id: 'text', label: 'Connector response text' },
            { id: 'result', label: 'Full connector result JSON' },
            { id: 'ok', label: 'Success' },
          ],
          taskConfig: {
            appId: 'hackernews',
            appName: 'Hacker News',
            actionId: 'hackernews.get_top_stories',
            connectionName: '',
          },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'trigger-1', target: 'connector-1' }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function waitForRun(token, workflowId, runId, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await api(token, 'GET', `/agent-workflows/${workflowId}/runs?limit=10`);
    const run = (data.runs || []).find((x) => String(x.id) === String(runId));
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    await sleep(500);
  }
  throw new Error(`Run ${runId} did not finish in time`);
}

async function ensureBackend() {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
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
      if (!ready) resolve();
    }, 2000);
  });
}

async function seedOpenConnector() {
  process.env.OPENCONNECTOR_URL = process.env.OPENCONNECTOR_URL || `http://127.0.0.1:${MOCK_PORT}`;
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
  const email = `oc-connector-${STAMP}@agent-os.local`;
  const password = `TestUser-${STAMP}!`;
  const user = await registerCeoUser({
    accept_terms: true,
    email,
    password,
    name: `Connector Test ${STAMP}`,
    region: 'Test',
    db_mode: 'shared',
    mfa_policy: 'off',
  });
  const session = createSession(user.id);
  return { user, token: session.token };
}

function cleanup() {
  if (mockChild && !mockChild.killed) {
    try {
      mockChild.kill();
    } catch {}
  }
}

function printSummary() {
  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok).length;
  console.log(`\n=== Summary: ${ok} passed, ${bad} failed ===\n`);
}

async function main() {
  console.log('\n=== OpenConnector connectors e2e ===\n');
  if (!(await ensureBackend())) {
    fail('backend reachable', `Start backend on ${BASE} first`);
    printSummary();
    process.exit(1);
  }
  pass('backend reachable');

  if (!process.env.OPENCONNECTOR_MCP_URL) {
    await startMockOpenConnector();
    pass(`mock OpenConnector on :${MOCK_PORT}`);
  }
  await seedOpenConnector();
  pass('seeded OpenConnector MCP registry');

  const { user, token } = await ensureTestUser();
  pass(`created CEO session ${user.id}`);

  try {
    const link = await api(token, 'POST', '/integrations/openconnector/link', {
      runtime_token: MOCK_TOKEN,
      connection_name: `ceo-${user.id}`,
    });
    if (link.runtime_token_set && link.connection_name) pass('linked per-CEO runtime token');
    else fail('linked per-CEO runtime token', JSON.stringify(link));
  } catch (e) {
    fail('link runtime token', e.message);
  }

  try {
    const status = await api(token, 'GET', '/integrations/openconnector/status');
    if (status.link?.runtime_token_set) pass('status returns CEO link');
    else fail('status returns CEO link', JSON.stringify(status.link));
  } catch (e) {
    fail('status route', e.message);
  }

  try {
    const connected = await api(token, 'GET', '/integrations/openconnector/apps');
    const searched = await api(token, 'GET', '/integrations/openconnector/apps/search?q=hackernews');
    const hasCatalog =
      (connected.apps || []).length >= 1 ||
      (searched.apps || []).some((a) => a.id === 'hackernews' || a.name?.toLowerCase?.().includes('hacker'));
    if (hasCatalog) pass('connected/search apps returned catalog');
    else fail('connected/search apps returned catalog', JSON.stringify({ connected, searched }));

    if ((searched.apps || []).some((a) => a.id === 'github')) pass('search apps returned GitHub');
    else pass('search apps (GitHub optional on real OC without connection)');

    const actions = await api(token, 'GET', '/integrations/openconnector/apps/hackernews/actions');
    if ((actions.actions || []).some((a) => a.id === 'hackernews.get_top_stories')) {
      pass('app actions returned Hacker News action');
    } else {
      fail('app actions returned Hacker News action', JSON.stringify(actions.actions || []));
    }

    const guide = await api(token, 'GET', '/integrations/openconnector/actions/hackernews.get_top_stories/guide');
    if ((guide.guide || '').includes('hackernews.get_top_stories') || (guide.guide || '').length > 20) {
      pass('action guide returned markdown');
    } else fail('action guide returned markdown', JSON.stringify(guide));
  } catch (e) {
    fail('catalog facade routes', e.message);
  }

  try {
    const exec = await api(token, 'POST', '/integrations/openconnector/actions/hackernews.get_top_stories/execute', {
      input: {},
    });
    if (exec.ok && (exec.transport === 'mcp' || exec.transport === 'http')) {
      pass(`execute route succeeded via ${exec.transport}`);
    } else {
      fail('execute route succeeded', JSON.stringify(exec));
    }
  } catch (e) {
    fail('execute route', e.message);
  }

  try {
    const listed = await api(token, 'POST', '/tools/connector-list-apps', {});
    if (listed.ok) pass('connector_list_apps content tool');
    else fail('connector_list_apps content tool', JSON.stringify(listed));

    const searched = await api(token, 'POST', '/tools/connector-search-actions', { query: 'hackernews' });
    if (searched.ok && (searched.apps || []).length >= 1) pass('connector_search_actions content tool');
    else fail('connector_search_actions content tool', JSON.stringify(searched));

    const toolExec = await api(token, 'POST', '/tools/connector-execute-action', {
      action_id: 'hackernews.get_top_stories',
      input: {},
    });
    if (toolExec.ok) pass('connector_execute_action content tool');
    else fail('connector_execute_action content tool', JSON.stringify(toolExec));
  } catch (e) {
    fail('connector content tools', e.message);
  }

  try {
    const conns = await api(token, 'GET', '/integrations/openconnector/connections');
    if (Array.isArray(conns.connections)) pass('connections route');
    else fail('connections route', JSON.stringify(conns));
  } catch (e) {
    fail('connections route', e.message);
  }

  try {
    const wf = await api(token, 'POST', '/agent-workflows', {
      name: `Connector Workflow ${STAMP}`,
      description: 'Connector node e2e',
      graph: connectorGraph(),
      trigger_modes: ['manual'],
    });
    await api(token, 'POST', `/agent-workflows/${wf.id}/publish`, {});
    const run = await api(token, 'POST', `/agent-workflows/${wf.id}/run`, { input: 'go' });
    const finished = await waitForRun(token, wf.id, run.id || run.run_id);
    if (finished.status === 'completed') pass('connector workflow node completed');
    else fail('connector workflow node completed', finished.status);
  } catch (e) {
    fail('connector workflow e2e', e.message);
  }

  printSummary();
  cleanup();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  cleanup();
  process.exit(1);
});
