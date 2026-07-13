/**
 * Verify tenant-scoped OpenClaw list + Add agent for SaaS CEO.
 * Usage: node scripts/test-openclaw-tenant-dashboard.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { authenticateUser } from '../src/services/users.js';

initDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const email = 'saas.ceo.mrhva3wu@example.com';
const password = 'SaasTest!mrhva3wu';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

const user = authenticateUser(email, password);
assert(!!user, `login ${email}`);
const token = createSession(user.id).token;
const ceoId = user.id;

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log('\n=== OpenClaw list scoped to CEO ===');
const list = await api('GET', '/api/openclaw/agents');
assert(list.status === 200, `list status=${list.status} err=${list.data?.error}`);
assert(list.data?.scope === 'tenant', `scope=${list.data?.scope}`);
assert(list.data?.ceo_user_id === ceoId, `ceo=${list.data?.ceo_user_id}`);
const oc = list.data?.openclaw || [];
assert(
  oc.every((a) => String(a.id).startsWith(`t-${ceoId}--`)),
  `all openclaw ids are tenant for this CEO (count=${oc.length})`
);
assert(
  !(oc || []).some((a) => String(a.id).includes('ceo-bala') && !String(a.id).includes(ceoId)),
  'no other CEO tenants in list'
);

console.log('\n=== Add agent under COO + tenant ===');
const stamp = Date.now().toString(36);
const created = await api('POST', '/api/agents', {
  name: `Desk Agent ${stamp}`,
  role: 'Desk helper',
});
assert(created.status === 201, `create status=${created.status} ${created.data?.error || ''}`);
assert(created.data?.parent_id === 'balserve', `parent=${created.data?.parent_id}`);
assert(String(created.data?.openclaw_runtime_id).startsWith(`t-${ceoId}--`), `runtime=${created.data?.openclaw_runtime_id}`);
assert(
  String(created.data?.tenant_workspace_path || created.data?.workspace_path || '').includes(
    join('tenants', ceoId).replace(/\\/g, '/')
  ) ||
    String(created.data?.tenant_workspace_path || '').includes(`tenants\\${ceoId}`) ||
    String(created.data?.tenant_workspace_path || '').includes(`tenants/${ceoId}`),
  `tenant workspace=${created.data?.tenant_workspace_path || created.data?.workspace_path}`
);
assert(existsSync(created.data.tenant_workspace_path || created.data.workspace_path), 'tenant workspace exists on disk');

const list2 = await api('GET', '/api/openclaw/agents');
const found = (list2.data?.openclaw || []).some((a) => a.id === created.data.openclaw_runtime_id);
assert(found, 'new agent appears in tenant OpenClaw list');

const sync = await api('POST', '/api/openclaw/sync', {});
assert(sync.status === 200, `sync status=${sync.status}`);
assert(sync.data?.scope === 'tenant', `sync scope=${sync.data?.scope}`);
assert(sync.data?.ceo_user_id === ceoId, 'sync ceo matches');

const agents = await api('GET', '/api/agents');
const arr = Array.isArray(agents.data) ? agents.data : [];
assert(arr.some((a) => a.id === created.data.id), 'new agent in CEO agents list');

console.log(failed ? `\nFAILED ${failed}` : '\nALL OPENCLAW TENANT DASHBOARD TESTS PASSED');
process.exit(failed ? 1 : 0);
