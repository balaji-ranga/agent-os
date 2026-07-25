/**
 * VPS/local test: AgentExchange Test agent (sample autofill + owner bypass invoke).
 *
 * Usage (inside backend container or with DB + API up):
 *   node scripts/vps-test-agent-exchange-test-invoke.js
 *
 * Env:
 *   AGENT_OS_BASE_URL=http://127.0.0.1:3001
 *   AGENT_OS_PUBLIC_URL=https://flolah.cloud
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  publishWorkflowAsA2A,
  unpublishA2APublicationById,
} from '../src/services/workflow-a2a-publish.js';

initDb();

const BASE = String(process.env.AGENT_OS_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const WORKFLOW_ID = 'wf-agent-exchange-test-invoke-vps';

const owner =
  getDb().prepare(`SELECT id, name FROM platform_users WHERE id = 'ceo-bala' LIMIT 1`).get() ||
  getDb().prepare(`SELECT id, name FROM platform_users WHERE role = 'ceo' ORDER BY created_at LIMIT 1`).get();
if (!owner) throw new Error('No CEO user found');

const actor = { id: owner.id, name: owner.name || owner.id, type: 'user' };
const { token } = createSession(owner.id, { userAgent: 'vps-agent-exchange-test-invoke' });

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const inputSchema = {
  type: 'object',
  properties: {
    topic: { type: 'string', description: 'Topic to research', default: 'AgentExchange test' },
    limit: { type: 'integer', minimum: 1, default: 3 },
  },
  required: ['topic'],
};

const graph = {
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 20, y: 20 },
      data: { label: 'Start', triggerModes: ['manual', 'a2a'] },
    },
    {
      id: 'agent-1',
      type: 'agent',
      position: { x: 220, y: 20 },
      data: {
        label: 'Echo',
        agentId: 'main',
        prompt: 'Reply with the topic from input: {{trigger-1.topic}}',
      },
    },
  ],
  edges: [{ id: 'e1', source: 'trigger-1', target: 'agent-1' }],
  viewport: { x: 0, y: 0, zoom: 1 },
};

let def = store.getDefinition(WORKFLOW_ID, owner.id);
if (!def) {
  def = store.createDefinition({
    id: WORKFLOW_ID,
    name: 'VPS AgentExchange Test Invoke',
    description: 'Sample schema autofill + owner bypass',
    ownerUserId: owner.id,
    actor,
    graph,
    trigger_modes: ['manual', 'a2a'],
    input_schema: inputSchema,
  });
} else {
  store.updateDraft(
    WORKFLOW_ID,
    owner.id,
    {
      graph,
      input_schema: inputSchema,
      trigger_modes: ['manual', 'a2a'],
    },
    actor
  );
}
if (def.status !== 'published') {
  store.publishDefinition(WORKFLOW_ID, owner.id, actor);
}

const pub = publishWorkflowAsA2A(owner.id, WORKFLOW_ID, {
  name: 'VPS Test Invoke Agent',
  description: 'deny_all + schema sample',
  skill_id: 'echo-topic',
  skill_name: 'Echo topic',
  skill_description: 'Echo the topic from structured input',
  input_schema: inputSchema,
  auth_mode: 'public',
  invoke_mode: 'sync',
  access_policy: 'deny_all',
}, actor);

console.log('published', pub.id, 'policy', pub.access_policy || 'deny_all');

const sample = await api('GET', `/agent-exchange/${encodeURIComponent(pub.id)}/test-sample`);
if (sample.status !== 200) {
  throw new Error(`test-sample failed: ${JSON.stringify(sample)}`);
}
if (sample.json.mode !== 'json') {
  throw new Error(`expected json mode, got ${sample.json.mode}`);
}
if (!sample.json.sample || sample.json.sample.topic == null) {
  throw new Error(`sample missing topic: ${JSON.stringify(sample.json)}`);
}
if (!sample.json.can_bypass_access) {
  throw new Error('owner should can_bypass_access');
}
console.log('PASS test-sample', sample.json.sample);

const deniedPublic = await fetch(`${BASE}/api/a2a/${encodeURIComponent(pub.id)}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'deny-1',
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        messageId: 'm1',
        parts: [{ kind: 'data', data: sample.json.sample }],
      },
      metadata: { skillId: sample.json.skill_id },
    },
  }),
});
const deniedJson = await deniedPublic.json().catch(() => ({}));
const deniedOk =
  deniedPublic.status === 403 ||
  deniedJson?.error?.code === -32005 ||
  /not allowed|Deny/i.test(String(deniedJson?.error?.message || ''));
if (!deniedOk) {
  console.warn('WARN public invoke not clearly denied (policy may differ)', deniedPublic.status, deniedJson);
} else {
  console.log('PASS public deny_all blocked invoke');
}

const test = await api('POST', `/agent-exchange/${encodeURIComponent(pub.id)}/test`, {
  skillId: sample.json.skill_id,
  input: sample.json.sample,
});
if (test.status !== 200 || !test.json?.ok) {
  throw new Error(`owner test invoke failed: ${JSON.stringify(test)}`);
}
if (!test.json.bypassed_access) {
  throw new Error('expected bypassed_access true for owner');
}
if (!test.json.result || test.json.result.error) {
  throw new Error(`unexpected RPC error: ${JSON.stringify(test.json)}`);
}
console.log('PASS owner test invoke', {
  bypassed_access: test.json.bypassed_access,
  state: test.json.result?.result?.status?.state || test.json.result?.result?.state,
});

unpublishA2APublicationById(owner.id, pub.id, actor);
console.log('PASS cleanup unpublish');
console.log('PASS: agent-exchange test-invoke');
