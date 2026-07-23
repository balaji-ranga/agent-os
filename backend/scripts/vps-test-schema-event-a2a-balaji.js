/**
 * VPS: Balaji Ranganathan — event webhook + A2A with name (string) + DOB (date) schema.
 *
 * Run inside backend container:
 *   docker compose exec -T backend node scripts/vps-test-schema-event-a2a-balaji.js
 *
 * Optional:
 *   KEEP_WORKFLOW=1  — leave published workflow/A2A for manual inspection
 *   AGENT_OS_BASE_URL=http://127.0.0.1:3001
 *   AGENT_OS_PUBLIC_URL=https://flolah.cloud  — also hit public HTTPS URLs
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';

initDb();

const BASE = String(process.env.AGENT_OS_BASE_URL || 'http://127.0.0.1:3001')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');
const API = `${BASE}/api`;
const PUBLIC = String(process.env.AGENT_OS_PUBLIC_URL || process.env.PUBLIC_URL || '')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');

const SCHEMA = {
  type: 'object',
  required: ['name', 'DOB'],
  properties: {
    name: { type: 'string', minLength: 1, description: 'Full name' },
    DOB: { type: 'string', format: 'date', description: 'Date of birth YYYY-MM-DD' },
  },
  additionalProperties: false,
};

const VALID = { name: 'Balaji Ranganathan', DOB: '1985-06-15' };
const INVALID_CASES = [
  { label: 'missing DOB', body: { name: 'Balaji Ranganathan' } },
  { label: 'missing name', body: { DOB: '1985-06-15' } },
  { label: 'bad DOB format', body: { name: 'Balaji', DOB: '15/06/1985' } },
  { label: 'DOB not a date', body: { name: 'Balaji', DOB: 'not-a-date' } },
  { label: 'extra property', body: { name: 'Balaji', DOB: '1985-06-15', age: 40 } },
  { label: 'wrong type name', body: { name: 123, DOB: '1985-06-15' } },
];

let failed = 0;
function pass(m) {
  console.log('  PASS:', m);
}
function fail(m, detail) {
  failed++;
  console.error('  FAIL:', m, detail != null ? JSON.stringify(detail).slice(0, 400) : '');
}

function resolveBalaji() {
  const db = getDb();
  const byName = db.prepare(`SELECT id, name, email FROM platform_users WHERE name = ?`).get('Balaji Ranganathan');
  if (byName) return byName;
  const byId = db.prepare(`SELECT id, name, email FROM platform_users WHERE id = ?`).get('ceo-bala');
  if (byId) return byId;
  throw new Error('Balaji Ranganathan / ceo-bala not found');
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

function looksLikeSchemaError(status, body) {
  const s = JSON.stringify(body || {});
  return (
    status === 400 ||
    (body && body.error && /schema|required|DOB|name|format date|additional|validation/i.test(s))
  );
}

function buildGraph() {
  return {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 40, y: 120 },
        data: {
          label: 'Start (event)',
          triggerModes: ['manual', 'event'],
          scheduleCron: '',
          chatPhrase: '',
          inputSchema: SCHEMA,
        },
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
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

async function main() {
  console.log('=== VPS schema event + A2A (Balaji) ===');
  console.log('BASE', BASE, 'PUBLIC', PUBLIC || '(none)');

  const user = resolveBalaji();
  console.log('Owner', user.id, user.name, user.email || '');
  const token = createSession(user.id).token;

  const stamp = Date.now().toString(36);
  const name = `Schema name+DOB event/A2A ${stamp}`;

  const created = await api(token, 'POST', '/agent-workflows', {
    name,
    description: 'VPS test: event webhook + A2A with name (string) and DOB (date) schema',
    graph: buildGraph(),
    trigger_modes: ['manual', 'event'],
    input_schema: SCHEMA,
  });
  if (created.status >= 400) throw new Error(`create ${created.status} ${JSON.stringify(created.json)}`);
  const workflowId = created.json.id;
  pass(`created workflow ${workflowId}`);

  if (!created.json.input_schema?.required?.includes('DOB')) {
    // ensure schema persisted
    const patched = await api(token, 'PATCH', `/agent-workflows/${workflowId}`, {
      graph: buildGraph(),
      trigger_modes: ['manual', 'event'],
      input_schema: SCHEMA,
    });
    if (patched.status >= 400) throw new Error(`patch ${patched.status}`);
  }
  const got = await api(token, 'GET', `/agent-workflows/${workflowId}`);
  if (got.json?.input_schema?.properties?.DOB?.format === 'date') pass('definition has name+DOB date schema');
  else fail('schema on definition', got.json?.input_schema);

  const pub = await api(token, 'POST', `/agent-workflows/${workflowId}/publish`);
  if (pub.status >= 400) throw new Error(`publish ${pub.status} ${JSON.stringify(pub.json)}`);
  pass('published');

  // --- Event webhook ---
  console.log('\n--- Event HTTP webhook ---');
  const hook = await api(token, 'POST', `/agent-workflows/${workflowId}/hooks/register`);
  if (hook.status >= 400) throw new Error(`hook ${hook.status} ${JSON.stringify(hook.json)}`);
  const secret = hook.json.webhook_secret;
  const hookPath = `/agent-workflows/hooks/${workflowId}`;
  const hookUrlInternal = `${API}${hookPath}`;
  const hookUrlPublic = PUBLIC ? `${PUBLIC}/api${hookPath}` : null;
  pass(`hook registered secret_len=${String(secret || '').length}`);
  console.log('  hook_url_internal', hookUrlInternal);
  if (hookUrlPublic) console.log('  hook_url_public', hookUrlPublic);

  for (const inv of INVALID_CASES) {
    const r = await postJson(hookUrlInternal, { 'X-Workflow-Hook-Secret': secret }, inv.body);
    if (looksLikeSchemaError(r.status, r.json) && r.status === 400) {
      pass(`webhook rejects: ${inv.label}`);
    } else fail(`webhook should reject: ${inv.label}`, r);
  }

  const goodHook = await postJson(hookUrlInternal, { 'X-Workflow-Hook-Secret': secret }, VALID);
  if (goodHook.status === 202 || goodHook.status === 200) {
    pass(`webhook accepts valid JSON run=${goodHook.json?.run_id || goodHook.json?.id || '?'}`);
  } else fail('webhook accept valid', goodHook);

  if (hookUrlPublic) {
    const badPub = await postJson(hookUrlPublic, { 'X-Workflow-Hook-Secret': secret }, { name: 'x' });
    if (looksLikeSchemaError(badPub.status, badPub.json) && badPub.status === 400) {
      pass('public HTTPS webhook rejects invalid');
    } else fail('public HTTPS webhook reject', badPub);

    const goodPub = await postJson(hookUrlPublic, { 'X-Workflow-Hook-Secret': secret }, VALID);
    if (goodPub.status === 202 || goodPub.status === 200) pass('public HTTPS webhook accepts valid');
    else fail('public HTTPS webhook accept', goodPub);
  }

  // --- A2A ---
  console.log('\n--- A2A Agent Exchange ---');
  const a2a = await api(token, 'POST', `/agent-workflows/${workflowId}/publish-a2a`, {
    name: `Person registry ${stamp}`,
    description: 'Requires JSON { name, DOB } with DOB as YYYY-MM-DD',
    skill_id: 'person-registry',
    skill_name: 'Register person',
    skill_description: 'name (string) + DOB (date)',
    auth_mode: 'public',
    input_schema: SCHEMA,
  });
  if (a2a.status >= 400) throw new Error(`a2a ${a2a.status} ${JSON.stringify(a2a.json)}`);
  const publishId = a2a.json.id;
  pass(`A2A published ${publishId}`);

  const cardSkill = a2a.json.agent_card?.skills?.[0];
  if (cardSkill?.inputSchema?.properties?.DOB?.format === 'date' && cardSkill?.inputSchema?.required?.includes('name')) {
    pass('A2A card includes name+DOB schema');
  } else fail('A2A card schema', cardSkill?.inputSchema);

  const cardRes = await fetch(`${API}/a2a/${publishId}/.well-known/agent-card.json`);
  const card = await cardRes.json();
  if (card?.skills?.[0]?.inputSchema?.properties?.name) pass('public agent-card.json has schema');
  else fail('public agent card', card?.skills?.[0]?.inputSchema);

  async function a2aInvoke(dataOrText, { asData = true } = {}) {
    const parts = asData
      ? [{ kind: 'data', data: dataOrText }]
      : [{ kind: 'text', text: typeof dataOrText === 'string' ? dataOrText : JSON.stringify(dataOrText) }];
    return postJson(`${API}/a2a/${publishId}`, {}, {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'message/send',
      params: { message: { parts } },
    });
  }

  for (const inv of INVALID_CASES) {
    const r = await a2aInvoke(inv.body, { asData: true });
    const errText = JSON.stringify(r.json || {});
    if (r.json?.error || (r.status >= 400 && /schema|required|DOB|name|format|additional/i.test(errText))) {
      pass(`A2A rejects: ${inv.label}`);
    } else fail(`A2A should reject: ${inv.label}`, r);
  }

  const goodA2a = await a2aInvoke(VALID, { asData: true });
  if (!goodA2a.json?.error && (goodA2a.json?.result || goodA2a.status < 400)) {
    pass('A2A accepts valid name+DOB data part');
  } else fail('A2A accept valid', goodA2a);

  const goodA2aText = await a2aInvoke(JSON.stringify(VALID), { asData: false });
  if (!goodA2aText.json?.error && (goodA2aText.json?.result || goodA2aText.status < 400)) {
    pass('A2A accepts valid JSON text part');
  } else fail('A2A accept valid text', goodA2aText);

  if (PUBLIC) {
    const pubBad = await postJson(`${PUBLIC}/api/a2a/${publishId}`, {}, {
      jsonrpc: '2.0',
      id: 9,
      method: 'message/send',
      params: { message: { parts: [{ kind: 'data', data: { name: 'only' } }] } },
    });
    if (pubBad.json?.error || pubBad.status === 400) pass('public HTTPS A2A rejects invalid');
    else fail('public HTTPS A2A reject', pubBad);

    const pubGood = await postJson(`${PUBLIC}/api/a2a/${publishId}`, {}, {
      jsonrpc: '2.0',
      id: 10,
      method: 'message/send',
      params: { message: { parts: [{ kind: 'data', data: VALID }] } },
    });
    if (!pubGood.json?.error) pass('public HTTPS A2A accepts valid');
    else fail('public HTTPS A2A accept', pubGood);
  }

  console.log('\n--- Summary ---');
  console.log('workflow_id', workflowId);
  console.log('a2a_publish_id', publishId);
  console.log('schema', JSON.stringify(SCHEMA));
  console.log('valid_payload', JSON.stringify(VALID));

  if (process.env.KEEP_WORKFLOW === '1') {
    console.log('KEEP_WORKFLOW=1 — leaving workflow + A2A published');
  } else {
    await api(token, 'DELETE', `/agent-workflows/${workflowId}/a2a-publication`).catch(() => {});
    await api(token, 'DELETE', `/agent-workflows/${workflowId}`).catch(() => {});
    pass('cleaned up workflow + A2A');
  }

  if (failed) {
    console.error(`\nSCHEMA_EVENT_A2A_FAILED (${failed})`);
    process.exit(1);
  }
  console.log('\nSCHEMA_EVENT_A2A_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
