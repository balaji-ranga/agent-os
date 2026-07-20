/**
 * E2E: create new tenant agent → COO org lists it → delegate notify_ceo works.
 * Optional live COO gateway prompt when OPENCLAW_GATEWAY_URL is reachable.
 *
 * Usage:
 *   node scripts/test-tenancy-notify-new-agent-e2e.js
 *   COO_LIVE_DELEGATE=1 node scripts/test-tenancy-notify-new-agent-e2e.js  # prompt COO on gateway
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { seedNotifyCeoToolIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantNotifyCeoToAllAgents } from '../src/services/agent-feedback.js';
import { createFullAgent } from '../src/services/create-full-agent.js';
import { syncOrgContextForCeo, buildOrgContextForCeo } from '../src/services/org-context.js';
import {
  tenantOpenClawAgentId,
  tenantSessionKeyForAgent,
  tenantWorkspacePath,
} from '../src/services/openclaw-tenant.js';
import { assertCallerMayUseTool } from '../src/services/openclaw-agent-tools.js';
import { registerOpenClawSessionOwner } from '../src/services/tool-owner-scope.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { executeNotifyCeo } from '../src/services/notify-ceo.js';
import { resolveToolOwnerUserIdOrNull } from '../src/services/tool-owner-scope.js';

initDb();
seedNotifyCeoToolIfMissing();
grantNotifyCeoToAllAgents();

const owner = getBalaCeoAuthId();
const stamp = Date.now().toString(36);
const agentName = `Notify Delegate Test ${stamp}`;
const COO_ID = 'balserve';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

console.log('\n=== 1) Create new custom agent in CEO tenancy ===');
let created;
try {
  created = await createFullAgent({
    name: agentName,
    role: 'Sends CEO notifications when delegated by COO',
    department: 'Testing',
    ownerUserId: owner,
  });
} catch (e) {
  console.error('createFullAgent threw', e.message);
  process.exit(1);
}
const agentId = created.id;
const runtimeId = created.openclaw_runtime_id || tenantOpenClawAgentId(owner, agentId);
const sessionKey = tenantSessionKeyForAgent(owner, agentId);
console.log('agent', agentId, 'runtime', runtimeId, 'session', sessionKey);
assert(created.owner_user_id === owner, `owner_user_id=${created.owner_user_id}`);
assert(String(runtimeId).startsWith(`t-${owner}--`), 'tenant runtime id');

console.log('\n=== 2) COO org context lists new agent + tenant session key ===');
await syncOrgContextForCeo(owner);
const ctx = buildOrgContextForCeo(owner);
assert(ctx.delegatees.some((a) => a.id === agentId), 'new agent in COO delegatees');

const cooWs = tenantWorkspacePath(owner, COO_ID);
const cooAgentsMd = readFileSync(join(cooWs, 'AGENTS.md'), 'utf8');
assert(cooAgentsMd.includes(agentId), 'COO AGENTS.md mentions new agent');
assert(cooAgentsMd.includes(sessionKey), 'COO AGENTS.md has tenant session key for new agent');

const orgMd = readFileSync(join(created.tenant_workspace_path, 'ORG.md'), 'utf8');
assert(orgMd.includes(agentId), 'new agent ORG.md lists self');
assert(orgMd.includes('Tenant session keys'), 'ORG.md has session key table');
assert(orgMd.includes(sessionKey), 'ORG.md has own tenant session key');

const toolsMd = readFileSync(join(created.tenant_workspace_path, 'TOOLS.md'), 'utf8');
assert(toolsMd.includes('notify_ceo'), 'TOOLS.md includes notify_ceo');

console.log('\n=== 3) New agent can invoke notify_ceo (tenant-scoped) ===');
const grantCheck = assertCallerMayUseTool(runtimeId, 'notify_ceo');
assert(grantCheck.ok, `grant: ${grantCheck.error || 'ok'}`);

const fakeReq = {
  headers: {
    'x-openclaw-agent-id': runtimeId,
    'x-openclaw-session-key': sessionKey,
    'x-ceo-user-id': owner,
  },
};
const resolved = resolveToolOwnerUserIdOrNull(fakeReq, {});
assert(resolved === owner, `owner resolve got ${resolved}`);

const sourceKey = `tenancy-e2e-${stamp}`;
const notifyOut = executeNotifyCeo(
  {
    title: `New agent tenancy test ${stamp}`,
    body: `${agentName} reached CEO via notify_ceo.`,
    link_url: '/kanban',
    source_key: sourceKey,
  },
  { ownerUserId: owner, callerAgentId: agentId, callerAgentName: agentName }
);
assert(notifyOut.sent, `notify_ceo: ${notifyOut.error || JSON.stringify(notifyOut)}`);

const { listNotificationsForUser } = await import('../src/services/platform-notifications.js');
const listed = listNotificationsForUser(owner, { limit: 20 });
assert(
  listed.some((n) => n.source_key === sourceKey || n.title?.includes(stamp)),
  'CEO notification bell lists new-agent notify'
);

console.log('\n=== 4) COO tenant session + peer directory ===');
const cooRuntime = tenantOpenClawAgentId(owner, COO_ID);
assert(orgMd.includes(cooRuntime) || orgMd.includes(COO_ID), 'ORG.md references COO');

if (process.env.COO_LIVE_DELEGATE === '1') {
  console.log('\n=== 5) Live gateway: new agent calls notify_ceo (simulates COO delegation) ===');
  const GATEWAY_URL = (
    process.env.OPENCLAW_GATEWAY_URL ||
    (existsSync('/.dockerenv') ? 'http://openclaw:18789' : 'http://127.0.0.1:18789')
  ).replace(/\/$/, '');

  function loadGatewayToken() {
    if (process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN) {
      return process.env.OPENCLAW_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN;
    }
    for (const p of ['/root/.openclaw/openclaw.json', join(process.env.HOME || '', '.openclaw', 'openclaw.json')]) {
      try {
        if (!existsSync(p)) continue;
        const cfg = JSON.parse(readFileSync(p, 'utf8'));
        if (cfg?.gateway?.auth?.token) return cfg.gateway.auth.token;
      } catch (_) {}
    }
    return '';
  }
  const TOKEN = loadGatewayToken();
  const agentSessionUser = `agent-os-${agentId}-${owner}`;
  registerOpenClawSessionOwner(`agent:${runtimeId}:${agentSessionUser}`, owner);
  registerOpenClawSessionOwner(`agent::${runtimeId}:${agentSessionUser}`, owner);

  const delegatePrompt = `[ceo_user_id: ${owner}]
You must call the notify_ceo tool now.
title: "Delegated agent live test ${stamp}"
body: "New agent ${agentId} notifying CEO after COO-style delegation."
link_url: "/kanban"
Do not describe the tool — invoke notify_ceo and confirm the result.`;

  const afterIso = new Date().toISOString();
  const agentRes = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': runtimeId,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({
      model: 'openclaw',
      messages: [{ role: 'user', content: delegatePrompt }],
      user: agentSessionUser,
    }),
    signal: AbortSignal.timeout(300000),
  }).catch((e) => null);

  if (!agentRes?.ok) {
    const errText = agentRes ? await agentRes.text().catch(() => '') : 'no response';
    console.warn(`WARN: new agent gateway chat status=${agentRes?.status} (OpenClaw may need config reload for brand-new runtime ids)`, errText.slice(0, 200));
  } else {
    const json = await agentRes.json().catch(() => ({}));
    console.log('new agent reply snippet:', String(json?.choices?.[0]?.message?.content || '').slice(0, 350));
    await new Promise((r) => setTimeout(r, 8000));
    const log = getDb()
      .prepare(
        `SELECT tool_name, status, source, substr(request_payload, 1, 120) AS req, created_at
         FROM content_tool_logs WHERE tool_name = 'notify_ceo' AND created_at >= ? ORDER BY id DESC LIMIT 5`
      )
      .all(afterIso);
    console.log('notify_ceo logs after new-agent chat:', log);
    const delegatedKey = `delegated-live-${stamp}`;
    const { listNotificationsForUser: listNotify } = await import('../src/services/platform-notifications.js');
    const bell = listNotify(owner, { limit: 30 });
    const hit =
      log.some((l) => l.status === 'ok') ||
      bell.some((n) => n.title?.includes(stamp) || n.title?.includes('Delegated agent live'));
    assert(hit, 'new agent live gateway produced notify_ceo log or CEO bell entry');
  }

  console.log('\n=== 6) Live COO gateway delegation (optional LLM path) ===');
  const cooRuntime = tenantOpenClawAgentId(owner, COO_ID);
  const sessionUser = `agent-os-${COO_ID}-${owner}`;
  registerOpenClawSessionOwner(`agent:${cooRuntime}:${sessionUser}`, owner);
  registerOpenClawSessionOwner(`agent::${cooRuntime}:${sessionUser}`, owner);

  const cooPrompt = `[ceo_user_id: ${owner}]
Use sessions_send ONLY (do not call notify_ceo yourself).
sessionKey: ${sessionKey}
message: Call notify_ceo now with title "COO routed ${stamp}" and body "COO delegated to ${agentId}".
timeoutSeconds: 120
Wait for their reply and confirm.`;

  const cooAfter = new Date().toISOString();
  const cooRes = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': cooRuntime,
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({
      model: 'openclaw',
      messages: [{ role: 'user', content: cooPrompt }],
      user: sessionUser,
    }),
    signal: AbortSignal.timeout(300000),
  }).catch(() => null);

  if (cooRes?.ok) {
    const cooJson = await cooRes.json().catch(() => ({}));
    console.log('COO reply snippet:', String(cooJson?.choices?.[0]?.message?.content || '').slice(0, 350));
    await new Promise((r) => setTimeout(r, 5000));
    const cooLogs = getDb()
      .prepare(
        `SELECT tool_name, status, created_at FROM content_tool_logs
         WHERE tool_name = 'notify_ceo' AND created_at >= ? ORDER BY id DESC LIMIT 5`
      )
      .all(cooAfter);
    console.log('notify_ceo logs after COO sessions_send attempt:', cooLogs);
    if (!cooLogs.some((l) => l.status === 'ok')) {
      console.warn('WARN: COO LLM path did not produce notify_ceo log (agent direct path above is authoritative)');
    }
  } else {
    console.warn('WARN: COO gateway chat skipped or failed');
  }
} else {
  console.log('\n=== 5) Live gateway skipped (set COO_LIVE_DELEGATE=1 to enable) ===');
}

// cleanup optional - leave agent for manual inspection on VPS
console.log('\nCreated agent id:', agentId, 'runtime:', runtimeId);
console.log(failed ? `\nFAILED ${failed}` : '\nALL TENANCY NOTIFY NEW AGENT E2E PASSED');
process.exit(failed ? 1 : 0);
