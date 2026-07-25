/**
 * VPS: publish a minimal workflow as a public async A2A agent with callback.
 *
 * Inside backend container:
 *   CALLBACK_URL=https://flolah.cloud/api/a2a-callback-inbox \
 *   KEEP_WORKFLOW=1 \
 *   node scripts/vps-publish-async-a2a-callback-test.js
 *
 * Optional CALLBACK_URL (default: AGENT_OS_PUBLIC_URL/api/a2a-callback-inbox).
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  listPublicationsForWorkflow,
  publishWorkflowAsA2A,
  unpublishWorkflowA2A,
} from '../src/services/workflow-a2a-publish.js';

initDb();

const BASE = String(process.env.AGENT_OS_BASE_URL || 'http://127.0.0.1:3001')
  .replace(/\/$/, '')
  .replace(/\/api$/, '');
const PUBLIC = String(process.env.AGENT_OS_PUBLIC_URL || process.env.PUBLIC_URL || BASE)
  .replace(/\/$/, '')
  .replace(/\/api$/, '');
const CALLBACK_URL =
  String(process.env.CALLBACK_URL || `${PUBLIC}/api/a2a-callback-inbox`).trim();
const WORKFLOW_ID = 'wf-async-a2a-callback-demo';
const KEEP = process.env.KEEP_WORKFLOW === '1' || process.env.KEEP_WORKFLOW === 'true';

function resolveOwner() {
  const db = getDb();
  const byName = db.prepare(`SELECT id, name, email FROM platform_users WHERE name = ?`).get('Balaji Ranganathan');
  if (byName) return byName;
  const byId = db.prepare(`SELECT id, name, email FROM platform_users WHERE id = ?`).get('ceo-bala');
  if (byId) return byId;
  throw new Error('Balaji Ranganathan / ceo-bala not found');
}

async function clearInbox(token) {
  await fetch(`${BASE}/api/a2a-callback-inbox`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
}

const owner = resolveOwner();
const actor = { id: owner.id, name: owner.name || 'CEO', type: 'user' };
const { token } = createSession(owner.id, { userAgent: 'vps-publish-async-a2a' });

const graph = {
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 40, y: 100 },
      data: { label: 'Start', triggerModes: ['manual', 'a2a'] },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

let def = store.getDefinition(WORKFLOW_ID, owner.id);
if (!def) {
  def = store.createDefinition({
    id: WORKFLOW_ID,
    name: 'Async A2A Callback Demo',
    description: 'Minimal workflow published as async A2A with mock callback inbox',
    ownerUserId: owner.id,
    actor,
    graph,
    trigger_modes: ['manual', 'a2a'],
  });
} else {
  store.updateDraft(WORKFLOW_ID, owner.id, { graph, name: 'Async A2A Callback Demo' }, actor);
}
store.publishDefinition(WORKFLOW_ID, owner.id, actor);

for (const p of listPublicationsForWorkflow(WORKFLOW_ID, owner.id)) {
  try {
    unpublishWorkflowA2A(owner.id, WORKFLOW_ID, actor, { publishId: p.id });
  } catch (_) {}
}

await clearInbox(token);

const pub = publishWorkflowAsA2A(
  owner.id,
  WORKFLOW_ID,
  {
    name: 'Async Callback Demo Agent',
    description: 'Public async A2A agent — callback + enquire-progress for AgentExchange / client tests',
    skill_id: 'default',
    auth_mode: 'public',
    invoke_mode: 'async',
    as_new_agent: true,
    callback_url: CALLBACK_URL,
    metadata: { tags: ['async', 'callback', 'demo'], version: '1.0.0' },
  },
  actor
);

const publicEndpoint = `${PUBLIC}/api/a2a/${pub.id}`;
const publicCard = `${publicEndpoint}/.well-known/agent-card.json`;

console.log(JSON.stringify({
  ok: true,
  publish_id: pub.id,
  invoke_mode: pub.invoke_mode,
  callback_url: pub.callback_url,
  endpoint_url: publicEndpoint,
  card_url: publicCard,
  inbox_get: `${PUBLIC}/api/a2a-callback-inbox`,
  enquire_skill: 'enquire-progress',
  keep_workflow: KEEP,
  owner: { id: owner.id, name: owner.name },
}, null, 2));

if (!KEEP) {
  console.log('Note: set KEEP_WORKFLOW=1 to leave published for laptop client tests.');
}
