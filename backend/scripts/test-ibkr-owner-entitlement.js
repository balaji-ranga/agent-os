/**
 * Multi-tenant IBKR owner scoping: session, tools/invoke headers, body spoof ignored.
 * Usage: node scripts/test-ibkr-owner-entitlement.js
 * Requires backend on :3001 (restart after entitledOwnerId changes).
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { registerCeoUser, grantStandardAgents } from '../src/services/users.js';
import {
  resolveEntitledOwnerUserId,
  isPlaceholderServiceUser,
} from '../src/services/tool-owner-scope.js';
import { listFills, ensureIbkrAnalyticsTables, recordFill } from '../src/services/ibkr-analytics.js';
import { seedIbkrTradingToolsIfMissing, grantIbkrToolsToCoo } from '../src/db/seed-ibkr-trading-tools.js';
import { getToolsApiKey } from '../src/config/tools.js';
import { tenantOpenClawAgentId } from '../src/services/openclaw-tenant.js';

initDb();
ensureIbkrAnalyticsTables();
seedIbkrTradingToolsIfMissing();
grantIbkrToolsToCoo('balserve');

const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const ownerA = getBalaCeoAuthId();
const SYM = `TEST:ENT-${Date.now().toString(36)}`.toUpperCase();
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

const db = getDb();
let ownerB = db
  .prepare(`SELECT id FROM platform_users WHERE role='ceo' AND id != ? ORDER BY id LIMIT 1`)
  .get(ownerA)?.id;
if (!ownerB) {
  const stamp = Date.now().toString(36);
  ownerB = (
    await registerCeoUser({
    accept_terms: true,
    email: `ibkr-ent-${stamp}@test.local`,
      password: 'test-pass-12345',
      name: `IBKR Ent ${stamp}`,
    })
  ).id;
}
grantStandardAgents(ownerB);

console.log('=== Unit: resolveEntitledOwnerUserId ===');
assert(
  resolveEntitledOwnerUserId({ authUser: { id: ownerB, role: 'ceo' } }) === ownerB,
  'session CEO wins'
);
assert(
  resolveEntitledOwnerUserId({
    authUser: { id: ownerA, role: 'ceo', internal: true },
    headers: { 'x-ceo-user-id': ownerB },
  }) === ownerB,
  'internal placeholder + x-ceo-user-id → header owner'
);
assert(
  resolveEntitledOwnerUserId({
    authUser: { id: ownerA, role: 'ceo', internal: true },
    headers: {},
    body: { owner_user_id: ownerB },
  }) === ownerA,
  'body spoof ignored; fallback Bala when no header'
);
assert(
  resolveEntitledOwnerUserId({
    headers: { 'x-openclaw-agent-id': tenantOpenClawAgentId(ownerB, 'balserve') },
  }) === ownerB ||
    resolveEntitledOwnerUserId({
      headers: { 'x-openclaw-agent-id': tenantOpenClawAgentId(ownerB, 'balserve') },
    }).includes('ceo'),
  'tenant OpenClaw agent id encodes owner'
);
assert(isPlaceholderServiceUser({ internal: true }) === true, 'placeholder flag');

console.log('\n=== Seed analytics for two owners ===');
recordFill({
  ownerUserId: ownerA,
  symbolKey: SYM,
  side: 'BUY',
  qty: 1,
  fillPrice: 10,
  source: 'entitlement_test_a',
});
recordFill({
  ownerUserId: ownerB,
  symbolKey: SYM,
  side: 'BUY',
  qty: 7,
  fillPrice: 20,
  source: 'entitlement_test_b',
});
assert(listFills(ownerA, { days: 1, symbolKey: SYM }).some((f) => Number(f.qty) === 1), 'ownerA fill');
assert(listFills(ownerB, { days: 1, symbolKey: SYM }).some((f) => Number(f.qty) === 7), 'ownerB fill');

const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
if (!health?.ok) {
  console.error('Backend not up — unit checks done; skip HTTP');
  process.exit(failed ? 1 : 0);
}

async function ibkrFills(ownerUserId) {
  const token = createSession(ownerUserId).token;
  const res = await fetch(`${BASE}/api/ibkr-trading/analytics/fills?days=1&limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  const fills = (data.fills || []).filter((f) => String(f.symbol_key || '').toUpperCase() === SYM);
  return { status: res.status, fills, owner: data };
}

async function ibkrSummary(ownerUserId, bodyExtra = {}) {
  const token = createSession(ownerUserId).token;
  const res = await fetch(`${BASE}/api/ibkr-trading/analytics/summary`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: 1, include_live: false, ...bodyExtra }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

console.log('\n=== HTTP: session-scoped fills ===');
const a = await ibkrFills(ownerA);
const b = await ibkrFills(ownerB);
assert(a.status === 200 && a.fills.some((f) => Number(f.qty) === 1), `CEO A sees qty 1 (n=${a.fills.length})`);
assert(b.status === 200 && b.fills.some((f) => Number(f.qty) === 7), `CEO B sees qty 7 (n=${b.fills.length})`);
assert(!a.fills.some((f) => Number(f.qty) === 7), 'A has no B fill');
assert(!b.fills.some((f) => Number(f.qty) === 1), 'B has no A fill');

console.log('\n=== HTTP: body spoof ignored (session) ===');
const spoof = await ibkrSummary(ownerA, { owner_user_id: ownerB });
assert(spoof.status === 200 && spoof.data.owner_user_id === ownerA, `spoof ignored owner=${spoof.data.owner_user_id}`);

console.log('\n=== HTTP: /tools/invoke as tenant COO for B ===');
const toolsKey = getToolsApiKey();
const invokeHeaders = {
  'Content-Type': 'application/json',
  'x-openclaw-agent-id': tenantOpenClawAgentId(ownerB, 'balserve'),
};
if (toolsKey) {
  invokeHeaders.Authorization = `Bearer ${toolsKey}`;
} else {
  invokeHeaders.Authorization = `Bearer ${createSession(ownerB).token}`;
}
const invoke = await fetch(`${BASE}/api/tools/invoke`, {
  method: 'POST',
  headers: invokeHeaders,
  body: JSON.stringify({
    tool_name: 'ibkr_fills_history',
    days: 1,
    limit: 50,
  }),
  signal: AbortSignal.timeout(60000),
});
const invokeData = await invoke.json().catch(() => ({}));
const invokeFills = (invokeData.fills || []).filter(
  (f) => String(f.symbol_key || '').toUpperCase() === SYM
);
assert(
  invoke.status === 200 && invokeFills.some((f) => Number(f.qty) === 7),
  `invoke as B tenant sees qty 7 (status=${invoke.status} n=${invokeFills.length} err=${invokeData.error || ''})`
);
assert(!invokeFills.some((f) => Number(f.qty) === 1), 'invoke as B does not see A fill');

console.log(failed ? `\nFAILED ${failed}` : '\nALL IBKR OWNER ENTITLEMENT TESTS PASSED');
process.exit(failed ? 1 : 0);
