/**
 * E2E: departments master-data table drives dynamic department list (add/remove).
 * Usage: node scripts/test-departments-master-data-e2e.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const stamp = Date.now().toString(36);
const password = `DeptTest!${stamp}`;

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
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
assert(!!health?.ok, 'backend up');

const reg = await api('POST', '/api/auth/register', {
  email: `dept.${stamp}@example.com`,
  password,
  name: `Dept ${stamp}`,
  db_mode: 'tenant',
  mfa_policy: 'off',
});
assert(reg.status === 201, `register ${reg.status}`);
const token = reg.data.session?.token || reg.data.token;
assert(!!token, 'token');

// Mimic ensureDepartmentsTable
let listed = await api('GET', '/api/master-data/tables', null, token);
assert(listed.status === 200, 'list tables');
let table = (listed.data.tables || []).find((t) => String(t.name).toLowerCase() === 'departments');
if (!table) {
  const created = await api(
    'POST',
    '/api/master-data/tables',
    { name: 'departments', columns: ['name'], description: 'Org departments' },
    token
  );
  assert(created.status === 201, `create departments ${created.status}`);
  table = created.data.table;
  const presets = ['Executive', 'Research', 'Finance', 'Social', 'Engineering', 'Operations', 'Job Pipeline'];
  for (const name of presets) {
    const ins = await api('POST', `/api/master-data/tables/${table.id}/rows`, { data: { name } }, token);
    assert(ins.status === 201, `seed ${name}`);
  }
} else {
  assert(true, 'departments table already exists');
}

const page = await api('GET', `/api/master-data/tables/${table.id}?limit=50&offset=0`, null, token);
assert((page.data.rows || []).length >= 7, `seeded rows=${(page.data.rows || []).length}`);

const add = await api(
  'POST',
  `/api/master-data/tables/${table.id}/rows`,
  { data: { name: `Growth ${stamp}` } },
  token
);
assert(add.status === 201, 'add department');
const rowId = add.data.row?.id;

const q = await api('POST', `/api/master-data/tables/${table.id}/query`, { query: `Growth ${stamp}` }, token);
assert(q.data.total >= 1, 'query finds new dept');

const del = await api('DELETE', `/api/master-data/tables/${table.id}/rows/${rowId}`, null, token);
assert(del.status === 200, 'remove department');

const dup = await api(
  'POST',
  '/api/master-data/tables',
  { name: 'departments', columns: ['name'] },
  token
);
assert(dup.status === 400, `duplicate create rejected ${dup.status}`);
assert(/already exists/i.test(dup.data.error || ''), `dup error=${dup.data.error}`);

console.log(`\n=== Done: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
