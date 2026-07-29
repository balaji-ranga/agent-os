/**
 * SaaS E2E via product APIs only (same as UI): register CEO → list agents →
 * create custom agent → grant tools → create Kanban task for CEO.
 * Usage: node scripts/test-saas-ceo-register-create-agent.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const stamp = Date.now().toString(36);
const email = `saas.ceo.${stamp}@example.com`;
const password = `SaasTest!${stamp}`;
const name = `SaaS CEO ${stamp}`;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

async function api(method, path, body, token, extraHeaders = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log('\n=== 0) Health ===');
const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
assert(!!health?.ok, 'backend up');

console.log('\n=== 1) Register new CEO (UI /api/auth/register) ===');
const reg = await api('POST', '/api/auth/register', {
  email,
  password,
  name,
  region: 'Singapore',
  db_mode: 'tenant',
});
assert(reg.status === 201, `register status=${reg.status} err=${reg.data?.error || ''}`);
assert(!!reg.data?.session?.token, 'session token returned');
assert(!!reg.data?.user?.id, `user id=${reg.data?.user?.id}`);
assert(
  Array.isArray(reg.data?.user?.standard_agents_granted) &&
    reg.data.user.standard_agents_granted.length > 0,
  `standard agents granted count=${reg.data?.user?.standard_agents_granted?.length}`
);
assert(
  reg.data?.openclaw?.count > 0,
  `OpenClaw tenants provisioned count=${reg.data?.openclaw?.count}`
);
const token = reg.data.session.token;
const ceoId = reg.data.user.id;
console.log('CEO', ceoId, email);

console.log('\n=== 2) /auth/me + /agents list ===');
const me = await api('GET', '/api/auth/me', null, token);
assert(me.status === 200, `me status=${me.status}`);
assert(Array.isArray(me.data?.agents) && me.data.agents.length > 0, `me agents=${me.data?.agents?.length}`);
const hasCoo = me.data.agents.some((a) => a.id === 'balserve' || a.is_coo);
assert(hasCoo, 'COO balserve in agent list');

const agentsList = await api('GET', '/api/agents', null, token);
assert(agentsList.status === 200, `agents list status=${agentsList.status}`);
const agents = Array.isArray(agentsList.data) ? agentsList.data : agentsList.data?.agents || [];
assert(agents.length > 0, `GET /agents count=${agents.length}`);

console.log('\n=== 3) Create custom agent (Agent Workspaces Add agent) ===');
const created = await api(
  'POST',
  '/api/agents',
  { name: `Ops Assistant ${stamp}`, role: 'Creates Kanban tasks for the CEO' },
  token
);
assert(created.status === 201, `create agent status=${created.status} err=${created.data?.error || ''}`);
const agentId = created.data?.id;
assert(!!agentId, `agent id=${agentId}`);
assert(created.data?.agent_type === 'custom', `agent_type=${created.data?.agent_type}`);
assert(created.data?.owner_user_id === ceoId, `owner_user_id=${created.data?.owner_user_id}`);
assert(created.data?.granted_to_user_id === ceoId, `granted_to_user_id=${created.data?.granted_to_user_id}`);
assert(!!created.data?.openclaw_runtime_id, `runtime=${created.data?.openclaw_runtime_id}`);
assert(
  String(created.data.openclaw_runtime_id).startsWith(`t-${ceoId}--`),
  'runtime id is tenant-prefixed'
);

const agentsAfter = await api('GET', '/api/agents', null, token);
const listAfter = Array.isArray(agentsAfter.data) ? agentsAfter.data : agentsAfter.data?.agents || [];
assert(
  listAfter.some((a) => a.id === agentId),
  'new agent appears in GET /agents for this CEO'
);

console.log('\n=== 4) Grant tools via workspace API (PUT /agents/:id/tools) ===');
const toolsGet = await api('GET', `/api/agents/${agentId}/tools`, null, token);
assert(toolsGet.status === 200, `tools get status=${toolsGet.status}`);
const current = Array.isArray(toolsGet.data?.grants) ? toolsGet.data.grants : [];
const nextTools = [
  ...new Set([
    ...current,
    'kanban_create_task',
    'kanban_move_status',
    'kanban_reassign_to_coo',
  ]),
];
const toolsPut = await api(
  'PUT',
  `/api/agents/${agentId}/tools`,
  { tools: nextTools, sync_tools_md: true },
  token
);
assert(toolsPut.status === 200, `tools put status=${toolsPut.status} err=${toolsPut.data?.error || ''}`);
assert(
  (toolsPut.data?.grants || []).includes('kanban_create_task'),
  'kanban_create_task granted'
);

console.log('\n=== 5) Agent creates Kanban task for CEO (tool invoke) ===');
const runtimeId = created.data.openclaw_runtime_id;
const createTask = await api(
  'POST',
  '/api/tools/invoke',
  {
    tool_name: 'kanban_create_task',
    caller_agent_id: runtimeId,
    title: `CEO follow-up from ${agentId}`,
    description: 'Created via SaaS E2E agent tool for CEO review',
  },
  token,
  { 'x-openclaw-agent-id': runtimeId }
);
assert(
  createTask.status === 200 && createTask.data?.ok === true,
  `kanban_create_task status=${createTask.status} ${JSON.stringify(createTask.data).slice(0, 220)}`
);
const taskId = createTask.data?.task_id;
assert(!!taskId, `task_id=${taskId}`);
assert(createTask.data?.owner_user_id === ceoId, `task owner=${createTask.data?.owner_user_id}`);

const kanban = await api('GET', '/api/kanban/tasks', null, token);
assert(kanban.status === 200, `kanban list status=${kanban.status}`);
const tasks = Array.isArray(kanban.data) ? kanban.data : kanban.data?.tasks || [];
const found = tasks.find((t) => t.id === taskId);
assert(!!found, 'CEO can see the agent-created Kanban task in list');
assert(found?.status === 'open' || found?.status === 'awaiting_confirmation', `task status=${found?.status}`);

console.log('\n=== 6) Unauthenticated create agent must fail ===');
const unauth = await api('POST', '/api/agents', { name: 'Should Fail' });
assert(unauth.status === 401, `unauth create status=${unauth.status}`);

console.log('\nCEO', ceoId);
console.log('Agent', agentId, runtimeId);
console.log('Task', taskId);
console.log(failed ? `\nFAILED ${failed}` : '\nALL SAAS CEO REGISTER + CREATE AGENT TESTS PASSED');
process.exit(failed ? 1 : 0);
