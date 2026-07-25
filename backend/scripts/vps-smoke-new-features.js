/**
 * VPS smoke: email_send + notify_ceo + org sync + workflow A2A publish.
 * Usage: node scripts/vps-smoke-new-features.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { seedEmailSendToolIfMissing, seedNotifyCeoToolIfMissing, seedMasterDataToolsIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantNotifyCeoToAllAgents, grantMasterDataToolsToAllAgents } from '../src/services/agent-feedback.js';
import { executeNotifyCeo } from '../src/services/notify-ceo.js';
import { listNotificationsForUser, markNotificationsRead, deleteNotificationsBySource } from '../src/services/platform-notifications.js';
import { syncOrgContextForCeo, buildOrgContextForCeo } from '../src/services/org-context.js';
import { ensureAllTenantOpenClawAgentsForCeo } from '../src/services/openclaw-tenant.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  publishWorkflowAsA2A,
  listAllPublishedA2AAgents,
  handleA2AJsonRpc,
  issueA2AAccessToken,
} from '../src/services/workflow-a2a-publish.js';
import { setA2AAccessPolicy } from '../src/services/workflow-a2a-access.js';
import { listRowsForAgent } from '../src/services/master-data-tools.js';
import { dismissAgentResponseNotifications } from '../src/services/agent-response-notifications.js';
import { healAgentWorkspacePaths, resolveAgentWorkspaceRoot, readWorkspaceFile } from '../src/workspace/adapter.js';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';

initDb();
seedEmailSendToolIfMissing();
seedNotifyCeoToolIfMissing();
seedMasterDataToolsIfMissing();
grantNotifyCeoToAllAgents();
grantMasterDataToolsToAllAgents();

const heal = healAgentWorkspacePaths(getDb());
console.log('OK workspace path heal', heal);

const coo = getDb().prepare(`SELECT * FROM agents WHERE is_coo = 1 OR id = 'balserve' ORDER BY is_coo DESC LIMIT 1`).get();
if (!coo) throw new Error('COO agent missing');
const wsRoot = resolveAgentWorkspaceRoot(coo, { healDb: false });
const soul = await readWorkspaceFile('soul', { workspaceRoot: wsRoot });
if (!existsSync(wsRoot) || !(soul.text || '').trim()) {
  throw new Error(`COO workspace MD not loading: root=${wsRoot}`);
}
console.log('OK workspace SOUL.md', { agent: coo.id, root: wsRoot, bytes: soul.text.length });

const row = getDb().prepare(`SELECT name, endpoint, enabled FROM content_tools_meta WHERE name = 'email_send'`).get();
if (!row) throw new Error('email_send missing from content_tools_meta');
console.log('OK email_send meta', row);

const emailGrants = getDb().prepare(`SELECT COUNT(*) AS n FROM agent_tool_grants WHERE tool_name = 'email_send'`).get().n;
console.log('OK email_send grants', emailGrants);

const notifyMeta = getDb()
  .prepare(`SELECT name, endpoint, enabled FROM content_tools_meta WHERE name = 'notify_ceo'`)
  .get();
if (!notifyMeta) throw new Error('notify_ceo missing from content_tools_meta');
console.log('OK notify_ceo meta', notifyMeta);

const notifyGrants = getDb()
  .prepare(`SELECT COUNT(*) AS n FROM agent_tool_grants WHERE tool_name = 'notify_ceo'`)
  .get().n;
if (!notifyGrants) throw new Error('notify_ceo not granted to any agents');
console.log('OK notify_ceo grants', notifyGrants);

const mdTools = getDb()
  .prepare(`SELECT COUNT(*) AS n FROM content_tools_meta WHERE name LIKE 'master_data_%'`)
  .get().n;
if (mdTools < 7) throw new Error(`expected 7 master_data tools in meta, got ${mdTools}`);
console.log('OK master_data tools meta', mdTools);

const mdGrants = getDb()
  .prepare(`SELECT COUNT(*) AS n FROM agent_tool_grants WHERE tool_name LIKE 'master_data_%'`)
  .get().n;
if (!mdGrants) throw new Error('master_data tools not granted to any agents');
console.log('OK master_data grants', mdGrants);

const platformHelp = getDb().prepare(`SELECT id, name, agent_type FROM agents WHERE id = 'platformhelp'`).get();
if (!platformHelp || platformHelp.agent_type !== 'standard') {
  throw new Error('platformhelp standard agent missing');
}
const helpRagGrants = getDb()
  .prepare(
    `SELECT COUNT(*) AS n FROM agent_tool_grants WHERE agent_id = 'platformhelp' AND tool_name IN ('master_data_rag','master_data_list_documents')`
  )
  .get().n;
if (helpRagGrants < 2) throw new Error('platformhelp missing RAG tool grants');
console.log('OK platformhelp agent + RAG grants', platformHelp.name);

const owner = getBalaCeoAuthId();
const deptOut = listRowsForAgent(owner, { table_name: 'departments', limit: 3 });
const deptNames = (deptOut.rows || []).map((r) => r.data?.name).filter(Boolean);
console.log('OK master_data_list_rows departments sample', deptNames.slice(0, 3).join(', ') || '(none)');

const dismissTbl = getDb()
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user_feed_dismissals'`)
  .get();
if (!dismissTbl) throw new Error('user_feed_dismissals table missing');
const dismissOut = dismissAgentResponseNotifications(owner, []);
if (dismissOut.dismissed !== 0) throw new Error('empty dismiss should return dismissed=0');
// Composite standup+agent dismiss key must be present in service
const { readFileSync } = await import('fs');
const dismissSrc = readFileSync(
  new URL('../src/services/agent-response-notifications.js', import.meta.url),
  'utf8'
);
if (!dismissSrc.includes('agentStandupDismissKey')) {
  throw new Error('agentStandupDismissKey missing from agent-response-notifications.js');
}
console.log('OK notification dismiss table + service + composite keys');

const sourceKey = `vps-smoke-notify-ceo:${Date.now()}`;
const notifyOut = executeNotifyCeo(
  {
    title: 'VPS notify_ceo smoke',
    body: 'Post-deploy smoke notification.',
    link_url: '/kanban',
    source_key: sourceKey,
  },
  { ownerUserId: owner, callerAgentId: 'balserve', callerAgentName: 'BalServe COO' }
);
if (!notifyOut.sent) throw new Error(`notify_ceo failed: ${notifyOut.error || JSON.stringify(notifyOut)}`);
if (notifyOut.notified_user_id !== owner) throw new Error('notify_ceo targeted wrong user');
const listed = listNotificationsForUser(owner, { limit: 30 });
if (!listed.some((n) => n.source_key === sourceKey || n.title === 'VPS notify_ceo smoke')) {
  throw new Error('notify_ceo notification not listed for CEO');
}
markNotificationsRead(owner, listed.filter((n) => n.source_key === sourceKey).map((n) => n.id));
deleteNotificationsBySource('agent_notify', sourceKey, owner);
console.log('OK notify_ceo delivered to', owner);

const tenantEnsured = ensureAllTenantOpenClawAgentsForCeo(owner);
const workspacesSynced = await syncOrgContextForCeo(owner);
const ctx = buildOrgContextForCeo(owner);
if (!workspacesSynced) throw new Error('org sync returned 0 workspaces');
if (!ctx.agents?.length) throw new Error('org context has no agents');
console.log('OK org sync', {
  owner,
  workspaces_synced: workspacesSynced,
  tenant_agents_ensured: tenantEnsured,
  agents: ctx.agents.length,
  delegatees: ctx.delegatees.length,
});

const id = 'test-a2a-publish-smoke';
const graph = {
  nodes: [{ id: 'trigger-1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Start', triggerModes: ['manual'] } }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};
let def = store.getDefinition(id, owner);
const actor = { id: 'vps-smoke', name: 'VPS Smoke' };
if (!def) {
  def = store.createDefinition({
    id,
    name: 'A2A Publish Smoke Test',
    ownerUserId: owner,
    actor,
    graph,
    trigger_modes: ['manual'],
  });
} else {
  store.updateDraft(id, owner, { graph }, actor);
}
store.publishDefinition(id, owner, actor);

const pub = publishWorkflowAsA2A(
  owner,
  id,
  { name: 'VPS A2A Smoke', description: 'VPS smoke test agent', skill_id: 'default', auth_mode: 'public' },
  actor
);
setA2AAccessPolicy(pub.id, owner, 'allow_all');
console.log('OK a2a published', pub.id, 'auth_mode=', pub.auth_mode);
console.log('   card', pub.card_url);

const listedA2a = listAllPublishedA2AAgents();
if (!listedA2a.some((a) => a.id === pub.id)) throw new Error('missing from AgentExchange list');
console.log('OK agent exchange count', listedA2a.length);

const rpc = await handleA2AJsonRpc(pub.id, {
  jsonrpc: '2.0',
  id: randomUUID(),
  method: 'message/send',
  params: {
    message: { role: 'user', messageId: randomUUID(), parts: [{ kind: 'text', text: 'vps smoke' }] },
    metadata: { skillId: 'default' },
  },
});
if (rpc.error) throw new Error(rpc.error.message);
console.log('OK a2a public invoke', (rpc.result?.parts?.[0]?.text || '').slice(0, 80));

const secured = publishWorkflowAsA2A(
  owner,
  id,
  {
    name: 'VPS A2A Secured Smoke',
    description: 'Secured A2A smoke',
    skill_id: 'default',
    auth_mode: 'secured',
  },
  actor
);
setA2AAccessPolicy(secured.id, owner, 'allow_all');
if (secured.auth_mode !== 'secured' || !secured.credentials?.client_secret) {
  throw new Error('secured A2A publish must return client credentials once');
}
if (!secured.agent_card?.securitySchemes?.oauth2) {
  throw new Error('secured agent card missing oauth2 securitySchemes');
}
const denied = await handleA2AJsonRpc(secured.id, {
  jsonrpc: '2.0',
  id: randomUUID(),
  method: 'message/send',
  params: {
    message: { role: 'user', messageId: randomUUID(), parts: [{ kind: 'text', text: 'no token' }] },
    metadata: { skillId: 'default' },
  },
});
if (denied.error?.code !== -32003) throw new Error('secured invoke without token must be Unauthorized');
const token = issueA2AAccessToken(secured.id, {
  clientId: secured.credentials.client_id,
  clientSecret: secured.credentials.client_secret,
});
const securedRpc = await handleA2AJsonRpc(
  secured.id,
  {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: { role: 'user', messageId: randomUUID(), parts: [{ kind: 'text', text: 'with token' }] },
      metadata: { skillId: 'default' },
    },
  },
  { authHeader: `Bearer ${token.access_token}` }
);
if (securedRpc.error?.code === -32003) throw new Error('secured invoke with access token failed');
console.log('OK a2a oauth client_credentials + Bearer invoke');

console.log('VPS_SMOKE_NEW_FEATURES_OK');
