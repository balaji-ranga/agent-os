/**
 * End-to-end test for workflow input schema across:
 * manual run, webhook, A2A card + invoke, COO-style tool trigger.
 *
 * Prefer in-container (uses createSession, bypasses MFA):
 *   docker exec -w /opt/agent-os/backend -e TOOLS_API_KEY=... agent-os-backend-1 \
 *     node scripts/test-workflow-input-schema-e2e.js
 *
 * Optional HTTP base (default loopback inside container):
 *   AGENT_OS_BASE_URL=http://127.0.0.1:3001
 */
import { initDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { getDb } from '../src/db/schema.js';

initDb();

const BASE = String(process.env.AGENT_OS_BASE_URL || 'http://127.0.0.1:3001')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');
const API = `${BASE}/api`;

const SCHEMA = {
  type: 'object',
  required: ['ticker'],
  properties: {
    ticker: { type: 'string', minLength: 1 },
    qty: { type: 'integer', minimum: 1 },
    message: { type: 'string' },
  },
  additionalProperties: false,
};

function pass(m) {
  console.log('PASS', m);
}
function fail(m, detail) {
  console.error('FAIL', m, detail || '');
  process.exitCode = 1;
}

function resolveOwnerUserId() {
  if (process.env.CEO_USER_ID) return process.env.CEO_USER_ID;
  try {
    return getBalaCeoAuthId();
  } catch {
    const row = getDb()
      .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY created_at ASC LIMIT 1`)
      .get();
    if (!row) throw new Error('No CEO user found');
    return row.id;
  }
}

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function buildGraph() {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: {
          label: 'Start',
          triggerModes: ['manual', 'event', 'chat'],
          chatPhrase: 'run schema e2e',
          inputSchema: SCHEMA,
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function main() {
  console.log('BASE', BASE);
  const ownerUserId = resolveOwnerUserId();
  const token = createSession(ownerUserId).token;
  pass(`session owner=${ownerUserId}`);

  const created = await api(token, 'POST', '/agent-workflows', {
    name: 'Schema E2E',
    description: 'Optional input schema coverage',
    graph: buildGraph(),
    trigger_modes: ['manual', 'event', 'chat'],
    chat_trigger_phrase: 'run schema e2e',
    input_schema: SCHEMA,
  });
  if (created.status >= 400) throw new Error(`create failed ${created.status} ${JSON.stringify(created.json)}`);
  const workflowId = created.json.id;
  pass(`created ${workflowId}`);

  const updated = await api(token, 'PATCH', `/agent-workflows/${workflowId}`, {
    graph: buildGraph(),
    trigger_modes: ['manual', 'event', 'chat'],
    chat_trigger_phrase: 'run schema e2e',
    input_schema: SCHEMA,
  });
  if (updated.status >= 400) throw new Error(`update ${updated.status} ${JSON.stringify(updated.json)}`);
  if (!updated.json.input_schema?.required?.includes('ticker')) {
    fail('definition.input_schema missing', updated.json.input_schema);
  } else pass('definition stores input_schema');

  const pub = await api(token, 'POST', `/agent-workflows/${workflowId}/publish`);
  if (pub.status >= 400) throw new Error(`publish ${pub.status} ${JSON.stringify(pub.json)}`);
  pass('workflow published');

  const badRun = await api(token, 'POST', `/agent-workflows/${workflowId}/run`, { input: { qty: 1 } });
  if (badRun.status === 400 && /schema|required|ticker/i.test(JSON.stringify(badRun.json))) {
    pass('manual run rejects invalid schema');
  } else fail('manual reject', badRun);

  const goodRun = await api(token, 'POST', `/agent-workflows/${workflowId}/run`, {
    input: { ticker: 'AAPL', qty: 3 },
  });
  if (goodRun.status === 201 || goodRun.status === 200) {
    pass(`manual run ok run=${goodRun.json.id || goodRun.json.run_id}`);
  } else fail('manual accept', goodRun);

  const hook = await api(token, 'POST', `/agent-workflows/${workflowId}/hooks/register`);
  if (hook.status >= 400) throw new Error(`hook register ${hook.status} ${JSON.stringify(hook.json)}`);
  const secret = hook.json.webhook_secret;
  pass('hook registered');

  const badHook = await fetch(`${API}/agent-workflows/hooks/${workflowId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workflow-Hook-Secret': secret },
    body: JSON.stringify({ nope: true }),
  });
  const badHookBody = await badHook.json().catch(() => ({}));
  if (badHook.status === 400 && /schema|required|ticker|additional/i.test(JSON.stringify(badHookBody))) {
    pass('webhook rejects invalid schema');
  } else fail('webhook reject', { status: badHook.status, badHookBody });

  const goodHook = await fetch(`${API}/agent-workflows/hooks/${workflowId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workflow-Hook-Secret': secret },
    body: JSON.stringify({ ticker: 'TSLA', qty: 1 }),
  });
  const goodHookBody = await goodHook.json().catch(() => ({}));
  if (goodHook.status === 202 || goodHook.status === 200) pass(`webhook accept run=${goodHookBody.run_id}`);
  else fail('webhook accept', { status: goodHook.status, goodHookBody });

  const a2a = await api(token, 'POST', `/agent-workflows/${workflowId}/publish-a2a`, {
    name: 'Schema E2E A2A',
    description: 'schema test agent',
    skill_id: 'default',
    skill_name: 'Schema E2E',
    skill_description: 'Requires ticker',
    auth_mode: 'public',
    input_schema: SCHEMA,
  });
  if (a2a.status >= 400) throw new Error(`a2a publish ${a2a.status} ${JSON.stringify(a2a.json)}`);
  const publishId = a2a.json.id;
  const cardSkill = a2a.json.agent_card?.skills?.[0];
  if (cardSkill?.inputSchema?.required?.includes('ticker')) pass('A2A card includes inputSchema');
  else fail('A2A card schema', cardSkill);

  const cardRes = await fetch(`${API}/a2a/${publishId}/.well-known/agent-card.json`);
  const card = await cardRes.json();
  if (card?.skills?.[0]?.inputSchema?.properties?.ticker) pass('public agent card has schema');
  else fail('public card', card);

  const badA2a = await fetch(`${API}/a2a/${publishId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'message/send',
      params: { message: { parts: [{ kind: 'text', text: '{"qty":1}' }] } },
    }),
  });
  const badA2aBody = await badA2a.json();
  if (badA2aBody.error && /schema|required|ticker/i.test(JSON.stringify(badA2aBody))) {
    pass('A2A invoke rejects invalid JSON text');
  } else fail('A2A reject', badA2aBody);

  const goodA2a = await fetch(`${API}/a2a/${publishId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'message/send',
      params: {
        message: {
          parts: [{ kind: 'data', data: { ticker: 'NVDA', qty: 5 } }],
        },
      },
    }),
  });
  const goodA2aBody = await goodA2a.json();
  if (!goodA2aBody.error && goodA2aBody.result) pass('A2A invoke accepts data part');
  else fail('A2A accept', goodA2aBody);

  const toolsKey = process.env.TOOLS_API_KEY || '';
  if (toolsKey) {
    const coo =
      getDb().prepare(`SELECT id FROM agents WHERE is_coo = 1 LIMIT 1`).get()?.id ||
      getDb()
        .prepare(`SELECT id FROM agents WHERE lower(id) LIKE '%coo%' OR lower(name) LIKE '%coo%' LIMIT 1`)
        .get()?.id ||
      'coo';
    const toolRes = await fetch(`${API}/tools/agent-workflow-trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tools-api-key': toolsKey,
        'x-openclaw-agent-id': coo,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        message: JSON.stringify({ ticker: 'AMD' }),
      }),
    });
    const toolBody = await toolRes.json().catch(() => ({}));
    if (toolRes.ok && toolBody.ok) pass(`COO tool trigger with JSON message (caller=${coo})`);
    else fail('COO tool', { status: toolRes.status, toolBody, coo });
  } else {
    console.log('SKIP COO tool (TOOLS_API_KEY unset)');
  }

  await api(token, 'DELETE', `/agent-workflows/${workflowId}/a2a-publication`).catch(() => {});
  await api(token, 'DELETE', `/agent-workflows/${workflowId}`).catch(() => {});

  if (process.exitCode) {
    console.error('SCHEMA_E2E_FAILED');
    process.exit(1);
  }
  console.log('SCHEMA_E2E_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
