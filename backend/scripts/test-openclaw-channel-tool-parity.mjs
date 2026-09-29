import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isToolGranted,
  isToolGrantedForSession,
  mergeRuntimeToolDescriptors,
  safeApiSessionKey,
  toolAllowByAgentFromConfig,
} from '../../openclaw-extensions/agent-os-content-tools/runtime-access.js';

const tenantId = 't-ceo-bala--balserve';
const grants = { [tenantId]: ['agent_workflow_list'] };
const descriptors = mergeRuntimeToolDescriptors(
  [{ name: 'marketing_asset_upsert', purpose: 'marketing' }],
  grants
);
assert.equal(descriptors.some((tool) => tool.name === 'agent_workflow_list'), true,
  'a partial mutable catalog must not remove a granted runtime tool');
assert.equal(isToolGranted(tenantId, 'agent_workflow_list', grants, {}), true);
assert.equal(isToolGranted(tenantId, 'email_send', grants, {}), false,
  'Workspace Tool access denial must be enforced');
assert.equal(isToolGranted(null, 'agent_workflow_list', grants, {}), false,
  'missing caller identity must fail closed');
const scopedSession = 'agent:t-ceo-bala--balserve:fixture';
const sessionScopes = {
  [scopedSession]: { tools: ['agent_workflow_list'], expires_at: new Date(Date.now() + 60_000).toISOString() },
};
assert.equal(isToolGrantedForSession(tenantId, 'agent_workflow_list', scopedSession, grants, {}, sessionScopes), true);
assert.equal(isToolGrantedForSession(tenantId, 'email_send', scopedSession, grants, {}, sessionScopes), false);
assert.equal(isToolGrantedForSession(tenantId, 'agent_workflow_list', scopedSession, grants, {}, {
  [scopedSession]: { tools: [], expires_at: new Date(Date.now() + 60_000).toISOString() },
}), false, 'active session scope narrows but never expands permanent grants');
assert.equal(isToolGrantedForSession(tenantId, 'agent_workflow_list', scopedSession, grants, {}, {
  [scopedSession]: { tools: [], expires_at: new Date(Date.now() - 60_000).toISOString() },
}), true, 'expired session scope cannot strand an agent');
assert.equal(isToolGrantedForSession(tenantId, 'agent_workflow_list', `${scopedSession}-other`, grants, {}, sessionScopes), true,
  'one request scope must not narrow another request or tenant session');

const entriesConfig = {
  agents: { entries: { [tenantId]: { tools: { allow: ['agent_workflow_list'] } } } },
};
assert.deepEqual(toolAllowByAgentFromConfig(entriesConfig)[tenantId], ['agent_workflow_list']);
const listConfig = {
  agents: { list: [{ id: tenantId, tools: { allow: ['agent_workflow_list'] } }] },
};
assert.deepEqual(toolAllowByAgentFromConfig(listConfig)[tenantId], ['agent_workflow_list']);
assert.equal(safeApiSessionKey({ getSessionKey() { throw new Error('no ambient session'); }, sessionKey: 'fallback' }), 'fallback');

const seedSource = readFileSync(new URL('../src/db/seed-content-tools-meta.js', import.meta.url), 'utf8');
const reconcileBlock = seedSource.slice(
  seedSource.indexOf('export function seedContentToolsMetaIfEmpty'),
  seedSource.indexOf('/** Add Kanban and intent tools')
);
assert.match(reconcileBlock, /INSERT OR IGNORE INTO content_tools_meta/);
assert.doesNotMatch(reconcileBlock, /if \(count > 0\) return/,
  'partial catalogs must be repaired on startup');

const grantSyncSource = readFileSync(new URL('../src/services/openclaw-agent-tools.js', import.meta.url), 'utf8');
assert.match(grantSyncSource, /config\?\.agents\?\.entries/,
  'Tool access sync must preserve the current OpenClaw agents.entries schema');

console.log('OpenClaw web/WhatsApp tool access parity: OK');
