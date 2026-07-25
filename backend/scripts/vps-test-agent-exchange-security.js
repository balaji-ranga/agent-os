/**
 * VPS staged HTTP test for AgentExchange security management.
 *
 * ACTION=setup|allow|whitelist|unpublish|status
 * node scripts/vps-test-agent-exchange-security.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  listPublicationsForWorkflow,
  publishWorkflowAsA2A,
  unpublishA2APublicationById,
} from '../src/services/workflow-a2a-publish.js';

initDb();

const BASE = String(process.env.AGENT_OS_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const PUBLIC = String(process.env.AGENT_OS_PUBLIC_URL || BASE).replace(/\/$/, '').replace(/\/api$/, '');
const ACTION = String(process.env.ACTION || 'setup').trim().toLowerCase();
const WORKFLOW_ID = 'wf-agent-exchange-security-vps';

const owner =
  getDb().prepare(`SELECT id, name FROM platform_users WHERE id = 'ceo-bala' LIMIT 1`).get() ||
  getDb().prepare(`SELECT id, name FROM platform_users WHERE role = 'ceo' ORDER BY created_at LIMIT 1`).get();
if (!owner) throw new Error('No CEO user found');

const actor = { id: owner.id, name: owner.name || owner.id, type: 'user' };
const { token } = createSession(owner.id, { userAgent: 'vps-agent-exchange-security-test' });

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Simulate a trusted proxy-provided client address for management display.
      'X-Real-IP': '127.0.0.1',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} failed ${res.status}: ${JSON.stringify(json)}`);
  return { status: res.status, json };
}

function latestPublication({ publishedOnly = true } = {}) {
  return getDb()
    .prepare(
      `SELECT * FROM workflow_a2a_publications
       WHERE workflow_definition_id = ? AND owner_user_id = ?
       ${publishedOnly ? `AND status = 'published'` : ''}
       ORDER BY created_at DESC, published_at DESC LIMIT 1`
    )
    .get(WORKFLOW_ID, owner.id);
}

if (ACTION === 'setup') {
  const graph = {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 20, y: 20 },
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
      name: 'VPS AgentExchange Security Test',
      description: 'Deny/allow/whitelist/unpublish VPS verification',
      ownerUserId: owner.id,
      actor,
      graph,
      trigger_modes: ['manual', 'a2a'],
    });
  } else {
    store.updateDraft(WORKFLOW_ID, owner.id, { graph }, actor);
  }
  store.publishDefinition(WORKFLOW_ID, owner.id, actor);
  for (const pub of listPublicationsForWorkflow(WORKFLOW_ID, owner.id)) {
    unpublishA2APublicationById(owner.id, pub.id, actor);
  }
  const pub = publishWorkflowAsA2A(
    owner.id,
    WORKFLOW_ID,
    {
      name: `VPS A2A Security Test ${Date.now()}`,
      description: 'Temporary AgentExchange security verification agent',
      auth_mode: 'public',
      invoke_mode: 'sync',
      as_new_agent: true,
      metadata: { tags: ['security-test', 'temporary'] },
    },
    actor
  );
  console.log(
    JSON.stringify({
      action: ACTION,
      publish_id: pub.id,
      workflow_id: WORKFLOW_ID,
      access_policy: pub.access_policy,
      endpoint: `${PUBLIC}/api/a2a/${pub.id}`,
    })
  );
} else {
  const pub = latestPublication({ publishedOnly: ACTION !== 'status' });
  if (!pub) throw new Error(`No publication found for action ${ACTION}`);

  if (ACTION === 'allow') {
    const result = await api('PUT', `/agent-exchange/${encodeURIComponent(pub.id)}/access`, {
      access_policy: 'allow_all',
    });
    console.log(JSON.stringify({ action: ACTION, publish_id: pub.id, ...result.json }));
  } else if (ACTION === 'whitelist') {
    const whitelistIp = String(process.env.WHITELIST_IP || '203.0.113.5').trim();
    await api('POST', `/agent-exchange/${encodeURIComponent(pub.id)}/ip-whitelist`, {
      cidr_or_ip: whitelistIp,
      label: process.env.WHITELIST_LABEL || 'VPS test IP',
    });
    const result = await api('PUT', `/agent-exchange/${encodeURIComponent(pub.id)}/access`, {
      access_policy: 'whitelist',
    });
    console.log(JSON.stringify({ action: ACTION, publish_id: pub.id, ...result.json }));
  } else if (ACTION === 'unpublish') {
    const result = await api('DELETE', `/agent-exchange/${encodeURIComponent(pub.id)}`);
    console.log(JSON.stringify({ action: ACTION, publish_id: pub.id, ...result.json }));
  } else if (ACTION === 'status') {
    const definition = store.getDefinition(WORKFLOW_ID, owner.id);
    console.log(
      JSON.stringify({
        action: ACTION,
        publish_id: pub.id,
        publication_status: pub.status,
        workflow_status: definition?.status || null,
        public_lookup_is_null:
          getDb()
            .prepare(
              `SELECT 1 FROM workflow_a2a_publications WHERE id = ? AND status = 'published'`
            )
            .get(pub.id) == null,
      })
    );
  } else {
    throw new Error(`Unknown ACTION ${ACTION}`);
  }
}
