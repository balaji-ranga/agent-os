/**
 * E2E: agent org hierarchy — department + reportingTo (parent_id) + recursive tree.
 * Usage: node scripts/test-org-hierarchy-e2e.js
 * Requires backend on AGENT_OS_API_URL (default http://127.0.0.1:3001).
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { seedAgentDepartmentsIfMissing } from '../src/db/seed-default-agents.js';

const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const stamp = Date.now().toString(36);
const password = `OrgTest!${stamp}`;

/** Minimal recursive tree for assertions (mirrors frontend buildOrgTree). */
function buildTree(agents) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const childrenOf = new Map();
  for (const a of agents) {
    const parent = a.parent_id && byId.has(a.parent_id) ? a.parent_id : '__ceo__';
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(a);
  }
  function node(agent, depth) {
    return {
      id: agent.id,
      depth,
      children: (childrenOf.get(agent.id) || []).map((c) => node(c, depth + 1)),
    };
  }
  return (childrenOf.get('__ceo__') || []).map((a) => node(a, 1));
}

function findInForest(forest, id) {
  for (const n of forest) {
    if (n.id === id) return n;
    const hit = findInForest(n.children || [], id);
    if (hit) return hit;
  }
  return null;
}

let failed = 0;
let passed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else {
    passed += 1;
    console.log('OK:', msg);
  }
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

initDb();
seedAgentDepartmentsIfMissing();

console.log('\n=== 0) Health ===');
const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
assert(!!health?.ok, 'backend up');

console.log('\n=== 1) Seeded departments on standard agents ===');
const balserve = getDb().prepare(`SELECT department FROM agents WHERE id = 'balserve'`).get();
assert(balserve?.department === 'Executive' || !!balserve?.department, `balserve dept=${balserve?.department}`);

console.log('\n=== 2) Register CEO ===');
const email = `org.ceo.${stamp}@example.com`;
const reg = await api('POST', '/api/auth/register', {
  email,
  password,
  name: `Org CEO ${stamp}`,
  db_mode: 'tenant',
  mfa_policy: 'off',
});
assert(reg.status === 201 || reg.status === 200, `register ${reg.status}`);
const token = reg.data.session?.token || reg.data.token;
const userId = reg.data.user?.id || reg.data.session?.user?.id;
assert(!!token && !!userId, `session user=${userId}`);

console.log('\n=== 3) Create agent with department + parent_id ===');
const agentsList0 = await api('GET', '/api/agents', null, token);
assert(agentsList0.status === 200, 'list agents');
const agents0 = Array.isArray(agentsList0.data) ? agentsList0.data : agentsList0.data?.agents || [];
const coo = agents0.find((a) => a.is_coo);
assert(!!coo, 'COO present in list');

const create1 = await api(
  'POST',
  '/api/agents',
  {
    name: `Research Lead ${stamp}`,
    role: 'Lead researcher',
    department: 'Research',
    parent_id: coo.id,
  },
  token
);
assert(create1.status === 201, `create agent ${create1.status} ${create1.data.error || ''}`);
assert(create1.data.department === 'Research', `department=${create1.data.department}`);
assert(create1.data.parent_id === coo.id, `parent_id=${create1.data.parent_id}`);
const leadId = create1.data.id;

console.log('\n=== 4) Create child via reportingTo alias ===');
const create2 = await api(
  'POST',
  '/api/agents',
  {
    name: `Research Intern ${stamp}`,
    role: 'Intern',
    department: 'Research',
    reportingTo: leadId,
  },
  token
);
assert(create2.status === 201, `create child ${create2.status} ${create2.data.error || ''}`);
assert(create2.data.parent_id === leadId, `child parent_id=${create2.data.parent_id}`);
const internId = create2.data.id;

console.log('\n=== 5) PATCH department + reportingTo ===');
const patch = await api(
  'PATCH',
  `/api/agents/${internId}`,
  { department: 'Engineering', reportingTo: coo.id },
  token
);
assert(patch.status === 200, `patch ${patch.status}`);
assert(patch.data.department === 'Engineering', 'patched department');
assert(patch.data.parent_id === coo.id, 'patched parent via reportingTo');

// Move intern back under lead for tree assert
await api('PATCH', `/api/agents/${internId}`, { parent_id: leadId, department: 'Research' }, token);

console.log('\n=== 6) List includes department; recursive tree ===');
const list = await api('GET', '/api/agents', null, token);
const agents = Array.isArray(list.data) ? list.data : list.data?.agents || [];
assert(agents.some((a) => a.id === leadId && a.department === 'Research'), 'lead in list with dept');
assert(agents.some((a) => a.id === internId && a.parent_id === leadId), 'intern reports to lead');

const forest = buildTree(agents);
const leadNode = findInForest(forest, leadId);
const internNode = findInForest(forest, internId);
assert(!!leadNode, 'lead in tree');
assert(!!internNode, 'intern in tree');
assert(internNode.depth > leadNode.depth, `depths lead=${leadNode.depth} intern=${internNode.depth}`);
assert(
  (leadNode.children || []).some((c) => c.id === internId),
  'intern is child of lead in recursive tree'
);

console.log(`\n=== Done: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
