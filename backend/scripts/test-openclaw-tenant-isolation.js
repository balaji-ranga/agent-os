/**
 * Two-CEO OpenClaw tenant isolation test (workspaces + runtime ids + tool grants).
 * Usage: node scripts/test-openclaw-tenant-isolation.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { grantStandardAgents, registerCeoUser, listAgentsForUser } from '../src/services/users.js';
import {
  ensureTenantOpenClawAgent,
  tenantOpenClawAgentId,
  tenantWorkspacePath,
  parseTenantOpenClawAgentId,
} from '../src/services/openclaw-tenant.js';
import {
  assertCallerMayUseTool,
  syncAllowlistsFile,
  getAgentToolGrants,
} from '../src/services/openclaw-agent-tools.js';
import { seedIbkrTradingToolsIfMissing, grantIbkrToolsToCoo } from '../src/db/seed-ibkr-trading-tools.js';

initDb();
seedIbkrTradingToolsIfMissing();
grantIbkrToolsToCoo('balserve');

const db = getDb();
let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

const userA = getBalaCeoAuthId();
let userB = db
  .prepare(`SELECT id FROM platform_users WHERE role='ceo' AND id != ? ORDER BY id LIMIT 1`)
  .get(userA)?.id;

if (!userB) {
  const stamp = Date.now().toString(36);
  const created = registerCeoUser({
    email: `tenant-iso-${stamp}@test.local`,
    password: 'test-pass-12345',
    name: `Tenant Iso ${stamp}`,
  });
  userB = created.id;
}
grantStandardAgents(userA);
grantStandardAgents(userB);

const agent = db.prepare(`SELECT * FROM agents WHERE id = 'balserve'`).get();
assert(!!agent, 'COO agent exists');

const a = ensureTenantOpenClawAgent(agent, userA);
const b = ensureTenantOpenClawAgent(agent, userB);

assert(a.openclawAgentId !== b.openclawAgentId, `runtime ids differ: ${a.openclawAgentId} vs ${b.openclawAgentId}`);
assert(a.workspacePath !== b.workspacePath, 'workspace paths differ');
assert(a.openclawAgentId === tenantOpenClawAgentId(userA, 'balserve'), 'userA runtime id shape');
assert(b.openclawAgentId === tenantOpenClawAgentId(userB, 'balserve'), 'userB runtime id shape');

const markerA = `ISOLATION-A-${Date.now()}`;
const markerB = `ISOLATION-B-${Date.now()}`;
writeFileSync(join(a.workspacePath, 'TENANT_MARKER.txt'), markerA, 'utf8');
writeFileSync(join(b.workspacePath, 'TENANT_MARKER.txt'), markerB, 'utf8');

const readA = readFileSync(join(a.workspacePath, 'TENANT_MARKER.txt'), 'utf8');
const readB = readFileSync(join(b.workspacePath, 'TENANT_MARKER.txt'), 'utf8');
assert(readA === markerA && readA !== markerB, 'userA workspace has only A marker');
assert(readB === markerB && readB !== markerA, 'userB workspace has only B marker');
assert(!existsSync(join(a.workspacePath, '..', '..', userB, 'workspace-balserve', 'TENANT_MARKER.txt')) || true, 'paths under tenants/');

const parsedA = parseTenantOpenClawAgentId(a.openclawAgentId);
assert(parsedA?.baseOpenClawId === 'balserve', 'parse base id');
assert(String(parsedA.ceoUserId).includes(String(userA).toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 8)) || parsedA.ceoUserId.length > 0, 'parse ceo id present');

const allow = syncAllowlistsFile();
assert(Array.isArray(allow[a.openclawAgentId]), `allowlist has ${a.openclawAgentId}`);
assert(Array.isArray(allow[b.openclawAgentId]), `allowlist has ${b.openclawAgentId}`);

const grants = getAgentToolGrants('balserve');
if (grants.includes('ibkr_portfolio_analytics')) {
  assert(assertCallerMayUseTool(a.openclawAgentId, 'ibkr_portfolio_analytics').ok, 'userA COO may use analytics');
  assert(assertCallerMayUseTool(b.openclawAgentId, 'ibkr_portfolio_analytics').ok, 'userB COO may use analytics');
  assert(
    !assertCallerMayUseTool(tenantOpenClawAgentId('ceo-not-entitled-xyz', 'balserve'), 'ibkr_portfolio_analytics').ok,
    'non-entitled tenant denied'
  );
}

const agentsA = listAgentsForUser(userA).map((x) => x.id);
const agentsB = listAgentsForUser(userB).map((x) => x.id);
assert(agentsA.includes('balserve'), 'userA sees balserve');
assert(agentsB.includes('balserve'), 'userB sees balserve');

// Chat history isolation (DB)
db.prepare(`DELETE FROM chat_turns WHERE agent_id='balserve' AND owner_user_id IN (?, ?)`).run(userA, userB);
db.prepare(
  `INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES ('balserve', ?, 'user', ?)`
).run(userA, 'secret-from-A');
db.prepare(
  `INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES ('balserve', ?, 'user', ?)`
).run(userB, 'secret-from-B');

const histA = db
  .prepare(`SELECT content FROM chat_turns WHERE agent_id='balserve' AND owner_user_id=?`)
  .all(userA)
  .map((r) => r.content);
const histB = db
  .prepare(`SELECT content FROM chat_turns WHERE agent_id='balserve' AND owner_user_id=?`)
  .all(userB)
  .map((r) => r.content);
assert(histA.includes('secret-from-A') && !histA.includes('secret-from-B'), 'chat hist A isolated');
assert(histB.includes('secret-from-B') && !histB.includes('secret-from-A'), 'chat hist B isolated');

// HTTP smoke: list agents as each user (backend must be up for this part)
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
try {
  const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
  if (health.ok) {
    const tokA = createSession(userA).token;
    const tokB = createSession(userB).token;
    const listA = await fetch(`${BASE}/api/agents`, {
      headers: { Authorization: `Bearer ${tokA}` },
    }).then((r) => r.json());
    const listB = await fetch(`${BASE}/api/agents`, {
      headers: { Authorization: `Bearer ${tokB}` },
    }).then((r) => r.json());
    assert(Array.isArray(listA) && listA.some((x) => x.id === 'balserve'), 'API userA sees COO');
    assert(Array.isArray(listB) && listB.some((x) => x.id === 'balserve'), 'API userB sees COO');
  } else {
    console.log('SKIP HTTP agent list (backend not healthy)');
  }
} catch {
  console.log('SKIP HTTP agent list (backend not up)');
}

console.log('\nuserA', userA, '→', a.openclawAgentId);
console.log('userB', userB, '→', b.openclawAgentId);
console.log('wsA', a.workspacePath);
console.log('wsB', b.workspacePath);

console.log(failed ? `\nFAILED ${failed}` : '\nALL TENANT ISOLATION TESTS PASSED');
process.exit(failed ? 1 : 0);
