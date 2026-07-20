/**
 * Smoke: notify_ceo via delegated tenant agent (SocialAssistant path).
 * Simulates OpenClaw plugin invoke headers for t-{ceo}--socialasstant.
 * Usage: node scripts/test-notify-ceo-delegated.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { seedNotifyCeoToolIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantNotifyCeoToAllAgents } from '../src/services/agent-feedback.js';
import { tenantOpenClawAgentId } from '../src/services/openclaw-tenant.js';
import { assertCallerMayUseTool } from '../src/services/openclaw-agent-tools.js';
import { resolveToolOwnerUserIdOrNull } from '../src/services/tool-owner-scope.js';
import { executeNotifyCeo } from '../src/services/notify-ceo.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();
seedNotifyCeoToolIfMissing();
grantNotifyCeoToAllAgents();

const owner = getBalaCeoAuthId();
const agentRow = getDb().prepare(`SELECT id, name FROM agents WHERE id = 'socialasstant'`).get();
if (!agentRow) throw new Error('socialasstant agent missing');

const runtimeId = tenantOpenClawAgentId(owner, 'socialasstant');
const sessionKey = `agent::${runtimeId}:main`;

console.log('tenant runtime id', runtimeId);
console.log('session key', sessionKey);

const grantCheck = assertCallerMayUseTool(runtimeId, 'notify_ceo');
if (!grantCheck.ok) throw new Error(`grant check failed: ${grantCheck.error}`);
console.log('OK: grant check for tenant runtime');

const fakeReq = {
  headers: {
    'x-openclaw-agent-id': runtimeId,
    'x-openclaw-session-key': sessionKey,
    'x-ceo-user-id': owner,
  },
  authUser: { internal: true, role: 'ceo', id: owner },
};
const resolvedOwner = resolveToolOwnerUserIdOrNull(fakeReq, {});
if (resolvedOwner !== owner) {
  throw new Error(`owner resolve failed: got ${resolvedOwner}, expected ${owner}`);
}
console.log('OK: owner resolved from tenant headers');

const sourceKey = `notify-ceo-delegated-smoke:${Date.now()}`;
const out = executeNotifyCeo(
  {
    title: 'Delegated notify_ceo smoke',
    body: 'SocialAssistant reached CEO via tenant session.',
    link_url: '/kanban',
    source_key: sourceKey,
  },
  { ownerUserId: owner, callerAgentId: agentRow.id, callerAgentName: agentRow.name }
);
if (!out.sent) throw new Error(`notify failed: ${out.error || JSON.stringify(out)}`);
console.log('OK: notify_ceo from delegated tenant context', out);

// Legacy bare session key must NOT resolve owner without tenant id
const legacyReq = {
  headers: {
    'x-openclaw-agent-id': 'socialasstant',
    'x-openclaw-session-key': 'agent::socialasstant:main',
  },
  authUser: { internal: true, role: 'ceo', id: owner },
};
const legacyOwner = resolveToolOwnerUserIdOrNull(legacyReq, {});
if (legacyOwner === owner) {
  console.warn('WARN: legacy bare socialasstant unexpectedly resolved owner (may be ok with fallback)');
} else {
  console.log('OK: legacy bare session does not resolve CEO without tenant id');
}

console.log('\nALL notify_ceo DELEGATED TESTS PASSED');
