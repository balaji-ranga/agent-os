/**
 * End-to-end VPS/local test for workflow input schema across:
 * manual run, webhook, A2A card + invoke, COO-style tool trigger.
 *
 * Env:
 *   AGENT_OS_BASE_URL (default http://127.0.0.1:3001)
 *   AGENT_OS_ADMIN_EMAIL / AGENT_OS_ADMIN_PASSWORD (or CEO login)
 *   Or: CEO_TOKEN
 *
 * Usage: node scripts/test-workflow-input-schema-e2e.js
 */

const BASE = String(process.env.AGENT_OS_BASE_URL || process.env.AGENT_OS_PUBLIC_URL || 'http://127.0.0.1:3001')
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

const WF_ID = `schema-e2e-${Date.now().toString(36)}`;

function pass(m) {
  console.log('PASS', m);
}
function fail(m, detail) {
  console.error('FAIL', m, detail || '');
  process.exitCode = 1;
}

async function login() {
  if (process.env.CEO_TOKEN) return process.env.CEO_TOKEN;
  const email = process.env.AGENT_OS_ADMIN_EMAIL || process.env.CEO_EMAIL || 'admin@agent-os.local';
  const password = process.env.AGENT_OS_ADMIN_PASSWORD || process.env.CEO_PASSWORD || 'change-me-admin-password';
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login failed: ${res.status} ${JSON.stringify(body)}`);
  return body.token || body.access_token || body.session_token;
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
  const token = await login();
  pass('login');

  const created = await api(token, 'POST', '/agent-workflows', {
    id: WF_ID,
    name: 'Schema E2E',
    description: 'Optional input schema coverage',
    graph: buildGraph(),
    trigger_modes: ['manual', 'event', 'chat'],
    chat_trigger_phrase: 'run schema e2e',
    input_schema: SCHEMA,
  });
  if (created.status >= 400) {
    // fallback without forced id
    const c2 = await api(token, 'POST', '/agent-workflows', {
      name: 'Schema E2E',
      description: 'Optional input schema coverage',
      graph: buildGraph(),
      trigger_modes: ['manual', 'event', 'chat'],
      chat_trigger_phrase: 'run schema e2e',
      input_schema: SCHEMA,
    });
    if (c2.status >= 400) throw new Error(`create failed ${c2.status} ${JSON.stringify(c2.json)}`);
    Object.assign(created, c2);
  }
  const workflowId = created.json.id || WF_ID;
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

  // Manual run — reject
  const badRun = await api(token, 'POST', `/agent-workflows/${workflowId}/run`, { input: { qty: 1 } });
  if (badRun.status === 400 && /schema|required|ticker/i.test(JSON.stringify(badRun.json))) {
    pass('manual run rejects invalid schema');
  } else fail('manual reject', badRun);

  // Manual run — accept
  const goodRun = await api(token, 'POST', `/agent-workflows/${workflowId}/run`, {
    input: { ticker: 'AAPL', qty: 3 },
  });
  if (goodRun.status === 201 || goodRun.status === 200) pass(`manual run ok run=${goodRun.json.id || goodRun.json.run_id}`);
  else fail('manual accept', goodRun);

  // Hook register
  const hook = await api(token, 'POST', `/agent-workflows/${workflowId}/hooks/register`);
  if (hook.status >= 400) throw new Error(`hook register ${hook.status} ${JSON.stringify(hook.json)}`);
  const secret = hook.json.webhook_secret;
  const hookUrl = hook.json.hook_url;
  pass('hook registered');

  const hookPath = hookUrl.includes('/api/')
    ? hookUrl.slice(hookUrl.indexOf('/api/') + 4)
    : `/agent-workflows/hooks/${workflowId}`;

  const badHook = await fetch(`${API}${hookPath.startsWith('/') ? hookPath : `/${hookPath}`}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workflow-Hook-Secret': secret },
    body: JSON.stringify({ nope: true }),
  });
  const badHookBody = await badHook.json().catch(() => ({}));
  if (badHook.status === 400 && /schema|required|ticker|additional/i.test(JSON.stringify(badHookBody))) {
    pass('webhook rejects invalid schema');
  } else fail('webhook reject', { status: badHook.status, badHookBody });

  const goodHook = await fetch(`${API}${hookPath.startsWith('/') ? hookPath : `/${hookPath}`}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Workflow-Hook-Secret': secret },
    body: JSON.stringify({ ticker: 'TSLA', qty: 1 }),
  });
  const goodHookBody = await goodHook.json().catch(() => ({}));
  if (goodHook.status === 202 || goodHook.status === 200) pass(`webhook accept run=${goodHookBody.run_id}`);
  else fail('webhook accept', { status: goodHook.status, goodHookBody });

  // A2A publish
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

  // COO tool trigger with JSON input
  const toolsKey = process.env.TOOLS_API_KEY || '';
  if (toolsKey) {
    const toolRes = await fetch(`${API}/tools/agent-workflow-trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tools-api-key': toolsKey,
        'x-openclaw-agent-id': 'coo',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workflow_id: workflowId,
        message: JSON.stringify({ ticker: 'AMD' }),
      }),
    });
    const toolBody = await toolRes.json().catch(() => ({}));
    if (toolRes.ok && toolBody.ok) pass('COO tool trigger with JSON message');
    else fail('COO tool', { status: toolRes.status, toolBody });
  } else {
    console.log('SKIP COO tool (TOOLS_API_KEY unset)');
  }

  // cleanup best-effort
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
