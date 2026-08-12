/**
 * Publish an AI employee from Agent Workspace to Agent Exchange.
 *
 * Visibility:
 *   public — listed on Exchange and callable on the public internet as A2A (`/api/a2a/:id`).
 *   flolah — listed on Exchange for Flolah CEOs only; public A2A endpoints are denied.
 *
 * Workflow A2A (`workflow_a2a_publications`, public|private) is unchanged.
 */
import { randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { normalizeAgentAvatar } from '../lib/agent-avatar.js';
import { createFullAgent } from './create-full-agent.js';
import { getAgentToolGrants } from './openclaw-agent-tools.js';
import { tenantOpenClawAgentId } from './openclaw-tenant.js';
import * as workspace from '../workspace/adapter.js';
import * as openclaw from '../gateway/openclaw.js';
import { registerOpenClawSessionOwner, clearActiveDashboardChat } from './tool-owner-scope.js';
import { buildA2AUrls } from './workflow-a2a-publish.js';

export const AGENT_A2A_VISIBILITIES = Object.freeze(['public', 'flolah']);
const WORKSPACE_COPY_FILES = ['soul', 'memory', 'tools', 'identity', 'ops'];

function db() {
  return getDb();
}

function slugPublishId(name) {
  const base = String(name || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  return `ag-a2a-${base || 'agent'}-${randomBytes(3).toString('hex')}`;
}

export function isAgentPublishId(publishId) {
  return String(publishId || '').startsWith('ag-a2a-');
}

export function normalizeAgentA2AVisibility(raw) {
  const v = String(raw || 'flolah').trim().toLowerCase();
  if (v === 'public' || v === 'flolah') return v;
  throw new Error('visibility must be public or flolah');
}

function assertAgentOwned(ownerUserId, agentId) {
  const row = db()
    .prepare(
      `SELECT a.* FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.id = ?`
    )
    .get(String(ownerUserId), String(agentId));
  if (!row) {
    const err = new Error('Agent not found in your workspace');
    err.status = 404;
    throw err;
  }
  return row;
}

function buildAgentCard(row) {
  const urls = buildA2AUrls(row.id);
  return {
    name: row.name,
    description: row.description || `AI employee ${row.name}`,
    url: urls.endpoint_url,
    version: '1.0.0',
    protocolVersion: '0.2.1',
    provider: { organization: 'Flolah', url: getPublicBaseUrl() },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: row.skill_id || 'chat',
        name: 'Chat',
        description: row.description || `Chat with ${row.name}`,
        examples: ['Hello', 'What can you help with?'],
      },
    ],
    metadata: {
      listing_kind: 'agent',
      visibility: row.visibility,
      avatar_image: row.avatar_image || '',
    },
  };
}

function sanitizeAgentPublication(row, extras = {}) {
  if (!row) return null;
  const urls = buildA2AUrls(row.id);
  const visibility = row.visibility === 'public' ? 'public' : 'flolah';
  const publicA2A = visibility === 'public';
  return {
    id: row.id,
    listing_kind: 'agent',
    agent_id: row.agent_id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    description: row.description || '',
    avatar_image: row.avatar_image || '',
    skill_id: row.skill_id || 'chat',
    status: row.status,
    visibility,
    auth_mode: row.auth_mode || 'public',
    has_auth: false,
    access_policy: publicA2A ? row.access_policy || 'allow_all' : 'deny_all',
    invoke_mode: 'sync',
    endpoint_url: urls.endpoint_url,
    card_url: publicA2A ? urls.card_url : null,
    token_url: null,
    agent_card: buildAgentCard(row),
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    owner_name: row.owner_name || null,
    owner_email: row.owner_email || '',
    ...extras,
  };
}

export function getAgentPublicationById(publishId, { includeUnpublished = false } = {}) {
  const sql = includeUnpublished
    ? `SELECT p.*, u.name AS owner_name, u.email AS owner_email
       FROM agent_a2a_publications p
       LEFT JOIN platform_users u ON u.id = p.owner_user_id
       WHERE p.id = ?`
    : `SELECT p.*, u.name AS owner_name, u.email AS owner_email
       FROM agent_a2a_publications p
       LEFT JOIN platform_users u ON u.id = p.owner_user_id
       WHERE p.id = ? AND p.status = 'published'`;
  const row = db().prepare(sql).get(String(publishId || ''));
  return sanitizeAgentPublication(row);
}

export function getAgentPublicationRow(publishId) {
  return db()
    .prepare(`SELECT * FROM agent_a2a_publications WHERE id = ? AND status = 'published'`)
    .get(String(publishId || ''));
}

export function getPublicationForAgent(agentId, ownerUserId) {
  const row = db()
    .prepare(
      `SELECT p.*, u.name AS owner_name, u.email AS owner_email
       FROM agent_a2a_publications p
       LEFT JOIN platform_users u ON u.id = p.owner_user_id
       WHERE p.agent_id = ? AND p.owner_user_id = ? AND p.status = 'published'
       ORDER BY p.published_at DESC
       LIMIT 1`
    )
    .get(String(agentId), String(ownerUserId));
  return sanitizeAgentPublication(row);
}

export function listPublishedAgentListings({ viewerOwnerId = null } = {}) {
  const rows = db()
    .prepare(
      `SELECT p.*, u.name AS owner_name, u.email AS owner_email
       FROM agent_a2a_publications p
       LEFT JOIN platform_users u ON u.id = p.owner_user_id
       WHERE p.status = 'published'
       ORDER BY p.published_at DESC, p.name ASC`
    )
    .all();
  const viewer = viewerOwnerId ? String(viewerOwnerId) : null;
  return rows.map((row) => {
    const pub = sanitizeAgentPublication(row);
    let imported_agent_id = null;
    if (viewer) {
      const imported = db()
        .prepare(
          `SELECT id FROM agents WHERE owner_user_id = ? AND source_publish_id = ? LIMIT 1`
        )
        .get(viewer, row.id);
      imported_agent_id = imported?.id || null;
    }
    return { ...pub, imported_agent_id };
  });
}

export function publishAgentToExchange(ownerUserId, agentId, body = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner required');
  const agent = assertAgentOwned(owner, agentId);
  const name = String(body.name || agent.name || '').trim();
  if (!name) throw new Error('Agent name is required');
  const visibility = normalizeAgentA2AVisibility(body.visibility);
  const description = String(body.description || agent.role || '').trim();
  let avatar = '';
  if (body.avatar_image != null && body.avatar_image !== '') {
    avatar = normalizeAgentAvatar(body.avatar_image);
  } else {
    avatar = String(agent.avatar_image || '').trim();
  }

  const existing = db()
    .prepare(
      `SELECT * FROM agent_a2a_publications
       WHERE agent_id = ? AND owner_user_id = ? AND status = 'published'
       ORDER BY published_at DESC LIMIT 1`
    )
    .get(agent.id, owner);

  if (existing && !body.as_new_agent) {
    db()
      .prepare(
        `UPDATE agent_a2a_publications
         SET name = ?, description = ?, avatar_image = ?, visibility = ?,
             updated_at = datetime('now')
         WHERE id = ? AND owner_user_id = ?`
      )
      .run(name, description, avatar, visibility, existing.id, owner);
    console.log(
      `[agent-a2a] updated publish=${existing.id} agent=${agent.id} owner=${owner} visibility=${visibility}`
    );
    return getAgentPublicationById(existing.id);
  }

  const id = slugPublishId(name);
  const accessPolicy = visibility === 'public' ? 'allow_all' : 'deny_all';
  db()
    .prepare(
      `INSERT INTO agent_a2a_publications
         (id, agent_id, owner_user_id, name, description, avatar_image, visibility,
          auth_mode, access_policy, status, skill_id, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'public', ?, 'published', 'chat', datetime('now'))`
    )
    .run(id, agent.id, owner, name, description, avatar, visibility, accessPolicy);
  console.log(
    `[agent-a2a] published id=${id} agent=${agent.id} owner=${owner} visibility=${visibility}`
  );
  return getAgentPublicationById(id);
}

export function unpublishAgentPublication(ownerUserId, publishId) {
  const owner = String(ownerUserId || '').trim();
  const id = String(publishId || '').trim();
  const row = db()
    .prepare(
      `SELECT * FROM agent_a2a_publications WHERE id = ? AND owner_user_id = ? AND status = 'published'`
    )
    .get(id, owner);
  if (!row) {
    const err = new Error('Agent publication not found or not owned by this user');
    err.status = 404;
    throw err;
  }
  db()
    .prepare(
      `UPDATE agent_a2a_publications
       SET status = 'unpublished', unpublished_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(id);
  console.log(`[agent-a2a] unpublished id=${id} agent=${row.agent_id} owner=${owner}`);
  return { ok: true, id, listing_kind: 'agent' };
}

export function unpublishAgentByWorkspaceAgent(ownerUserId, agentId) {
  const pub = getPublicationForAgent(agentId, ownerUserId);
  if (!pub) return { ok: true, unpublished: false };
  return { ...unpublishAgentPublication(ownerUserId, pub.id), unpublished: true };
}

function assertInternalParent(ownerUserId, parentId) {
  const pid = String(parentId || '').trim();
  if (!pid) throw new Error('reports_to (internal agent) is required');
  const row = db()
    .prepare(
      `SELECT a.id FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.id = ?`
    )
    .get(String(ownerUserId), pid);
  if (!row) throw new Error(`reports_to agent not found in your org: ${pid}`);
  return pid;
}

async function copyPublisherWorkspaceDocs(sourceAgent, destWorkspacePath) {
  const root = sourceAgent?.workspace_path;
  if (!root || !destWorkspacePath) return;
  for (const name of WORKSPACE_COPY_FILES) {
    try {
      const r = await workspace.readWorkspaceFile(name, { workspaceRoot: root });
      if (r?.text) {
        await workspace.writeWorkspaceFile(name, r.text, {
          workspaceRoot: destWorkspacePath,
          backup: false,
        });
      }
    } catch (e) {
      console.warn('[agent-a2a] copy workspace file skipped', name, e?.message || e);
    }
  }
}

/**
 * Import a published AI employee into the signed-in CEO's workspace + org chart.
 * Idempotent per owner + publish id. Does not create a workflow-style org leaf.
 */
export async function importPublishedAgentToOrg(importerUserId, publishId, body = {}) {
  const importer = String(importerUserId || '').trim();
  if (!importer) throw new Error('owner required');
  const pubRow = getAgentPublicationRow(publishId);
  if (!pubRow) {
    const err = new Error('Published agent not found or unpublished');
    err.status = 404;
    throw err;
  }
  if (String(pubRow.owner_user_id) === importer) {
    const err = new Error('This AI employee is already in your workspace');
    err.status = 400;
    throw err;
  }

  const existing = db()
    .prepare(
      `SELECT * FROM agents WHERE owner_user_id = ? AND source_publish_id = ? LIMIT 1`
    )
    .get(importer, pubRow.id);
  const parentId = assertInternalParent(importer, body.parent_id);
  const department = String(body.department || '').trim();
  const displayName = String(body.display_name || pubRow.name || '').trim() || pubRow.name;
  const role = String(body.purpose || pubRow.description || 'AI employee').trim();

  if (existing) {
    db()
      .prepare(
        `UPDATE agents SET name = ?, role = ?, department = ?, parent_id = ?,
           avatar_image = COALESCE(NULLIF(?, ''), avatar_image)
         WHERE id = ? AND owner_user_id = ?`
      )
      .run(
        displayName,
        role,
        department,
        parentId,
        pubRow.avatar_image || '',
        existing.id,
        importer
      );
    console.log(
      `[agent-a2a] updated import agent=${existing.id} publish=${pubRow.id} importer=${importer}`
    );
    return {
      ok: true,
      imported: false,
      updated: true,
      agent: db().prepare('SELECT * FROM agents WHERE id = ?').get(existing.id),
    };
  }

  const source = db().prepare('SELECT * FROM agents WHERE id = ?').get(pubRow.agent_id);
  const sourceTools = source ? getAgentToolGrants(source.id) : [];
  const tools = sourceTools.filter(Boolean);

  const created = await createFullAgent({
    name: displayName,
    role,
    department,
    parent_id: parentId,
    ownerUserId: importer,
    tools: tools.length ? tools : undefined,
    avatar_image: pubRow.avatar_image || source?.avatar_image || '',
    source_kind: 'imported_agent',
    source_publish_id: pubRow.id,
    monthly_token_budget: body.monthly_token_budget ?? null,
    error_budget_pct: body.error_budget_pct ?? null,
  });

  if (source) {
    try {
      await copyPublisherWorkspaceDocs(source, created.tenant_workspace_path || created.workspace_path);
    } catch (e) {
      console.warn('[agent-a2a] workspace copy failed', e?.message || e);
    }
  }

  console.log(
    `[agent-a2a] imported agent=${created.id} publish=${pubRow.id} importer=${importer} from=${pubRow.owner_user_id}`
  );
  return { ok: true, imported: true, updated: false, agent: created };
}

function extractA2AMessageText(params) {
  const msg = params?.message || params || {};
  const parts = msg.parts;
  if (Array.isArray(parts) && parts.length) {
    const texts = parts
      .map((p) => {
        if (!p || typeof p !== 'object') return '';
        if (p.kind === 'text' || p.type === 'text') return String(p.text || '');
        if (p.kind === 'data' && p.data != null) {
          return typeof p.data === 'string' ? p.data : JSON.stringify(p.data);
        }
        return '';
      })
      .filter(Boolean);
    if (texts.length) return texts.join('\n');
  }
  if (typeof params?.message === 'string') return params.message;
  if (typeof params?.input === 'string') return params.input;
  if (typeof params?.text === 'string') return params.text;
  return '';
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * Public A2A invoke for a published AI employee. Flolah listings are always denied here.
 */
export async function handleAgentA2AJsonRpc(publishId, body = {}, { bypassAccessChecks = false } = {}) {
  const rpcId = body?.id ?? null;
  const row = getAgentPublicationRow(publishId);
  if (!row) return jsonRpcError(rpcId, -32001, 'A2A agent not found');
  if (row.visibility !== 'public' && !bypassAccessChecks) {
    return jsonRpcError(
      rpcId,
      -32005,
      'This agent is Flolah-only and is not available on the public internet'
    );
  }

  const method = String(body?.method || 'message/send').trim();
  if (method !== 'message/send' && method !== 'message/stream') {
    return jsonRpcError(rpcId, -32601, `Method not supported: ${method}`);
  }

  const text = extractA2AMessageText(body?.params || {});
  if (!text.trim()) {
    return jsonRpcError(rpcId, -32602, 'message text is required');
  }

  const agent = db().prepare('SELECT * FROM agents WHERE id = ?').get(row.agent_id);
  if (!agent) return jsonRpcError(rpcId, -32001, 'Published agent is no longer available');

  const ownerUserId = String(row.owner_user_id);
  const openclawAgentId = tenantOpenClawAgentId(ownerUserId, agent.openclaw_agent_id || agent.id);
  const sessionUser = openclaw.sessionUserFor(agent.id, `a2a-${row.id}`);
  const sessionKey = openclaw.sessionKeyFor(openclawAgentId, sessionUser);
  registerOpenClawSessionOwner(sessionKey, ownerUserId);

  try {
    const { content } = await openclaw.chatCompletions(
      openclawAgentId,
      [{ role: 'user', content: text }],
      sessionUser,
      false,
      { injectKanbanInstruction: false }
    );
    const reply = String(content || '').trim() || '(empty reply)';
    return {
      jsonrpc: '2.0',
      id: rpcId ?? randomUUID(),
      result: {
        kind: 'message',
        role: 'agent',
        messageId: randomUUID(),
        parts: [{ kind: 'text', text: reply }],
        metadata: {
          listing_kind: 'agent',
          publish_id: row.id,
          agent_id: agent.id,
        },
      },
    };
  } catch (e) {
    console.warn('[agent-a2a] invoke failed', row.id, e?.message || e);
    return jsonRpcError(rpcId, -32603, e.message || 'Agent invoke failed');
  } finally {
    clearActiveDashboardChat(agent.id, ownerUserId);
  }
}

export function denyFlolahPublicAccess(visibility) {
  return String(visibility || '') === 'flolah';
}
