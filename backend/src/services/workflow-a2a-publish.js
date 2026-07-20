/**
 * Publish agent workflows as A2A-compliant agents.
 */
import { randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { startAgentWorkflowRun } from './agent-workflow-runner.js';
import * as store from './agent-workflow-store.js';

const a2aTasks = new Map();

function parseJson(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function slugPublishId(workflowId, name) {
  const base = String(name || workflowId || 'workflow')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36);
  return `wf-a2a-${base || 'agent'}-${randomBytes(3).toString('hex')}`;
}

export function buildA2AUrls(publishId) {
  const base = getPublicBaseUrl();
  const root = `${base}/api/a2a/${publishId}`;
  return {
    endpoint_url: root,
    card_url: `${root}/.well-known/agent-card.json`,
  };
}

export function buildAgentCard(publication, def = null) {
  const urls = buildA2AUrls(publication.id);
  const skillId = publication.skill_id || 'default';
  const card = parseJson(publication.agent_card_json, null) || {};
  const metadata = parseJson(publication.metadata_json, {});
  return {
    name: publication.name || def?.name || 'Agent OS Workflow',
    description:
      publication.description ||
      def?.description ||
      'Published Agent OS workflow exposed via A2A protocol',
    url: urls.endpoint_url,
    version: card.version || metadata.version || '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      ...(card.capabilities || {}),
    },
    defaultInputModes: ['text/plain', 'text'],
    defaultOutputModes: ['text/plain', 'text'],
    skills: [
      {
        id: skillId,
        name: publication.skill_name || publication.name || 'Default',
        description:
          publication.skill_description ||
          publication.description ||
          'Invoke this workflow with a natural-language message',
        tags: ['workflow', 'agent-os', ...(metadata.tags || [])],
        examples: metadata.examples || [`Run ${publication.name || 'workflow'}`],
      },
      ...(Array.isArray(card.skills) ? card.skills.filter((s) => s?.id && s.id !== skillId) : []),
    ],
    ...(card.provider ? { provider: card.provider } : {}),
    ...(metadata.provider ? { provider: metadata.provider } : {}),
  };
}

function sanitizePublication(row, def = null) {
  if (!row) return null;
  const urls = buildA2AUrls(row.id);
  return {
    id: row.id,
    workflow_definition_id: row.workflow_definition_id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    description: row.description,
    skill_id: row.skill_id,
    skill_name: row.skill_name,
    skill_description: row.skill_description,
    status: row.status,
    endpoint_url: urls.endpoint_url,
    card_url: urls.card_url,
    agent_card: buildAgentCard(row, def),
    metadata: parseJson(row.metadata_json, {}),
    has_auth: !!(row.auth_token && String(row.auth_token).trim()),
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getPublicationByWorkflow(workflowId, ownerUserId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM workflow_a2a_publications
       WHERE workflow_definition_id = ? AND owner_user_id = ? AND status = 'published'
       ORDER BY published_at DESC LIMIT 1`
    )
    .get(workflowId, ownerUserId);
  if (!row) return null;
  const def = store.getDefinition(workflowId, ownerUserId);
  return sanitizePublication(row, def);
}

export function getPublicationById(publishId) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ? AND status = 'published'`).get(publishId);
  if (!row) return null;
  const def = store.getDefinition(row.workflow_definition_id, row.owner_user_id);
  return sanitizePublication(row, def);
}

export function listAllPublishedA2AAgents() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.*, u.name AS owner_name, u.email AS owner_email, d.name AS workflow_name
       FROM workflow_a2a_publications p
       LEFT JOIN platform_users u ON u.id = p.owner_user_id
       LEFT JOIN agent_workflow_definitions d ON d.id = p.workflow_definition_id
       WHERE p.status = 'published'
       ORDER BY p.published_at DESC, p.name ASC`
    )
    .all();
  return rows.map((row) => {
    const pub = sanitizePublication(row, { name: row.workflow_name, description: row.description });
    return {
      ...pub,
      owner_name: row.owner_name || row.owner_user_id,
      owner_email: row.owner_email || '',
      workflow_name: row.workflow_name,
    };
  });
}

export function publishWorkflowAsA2A(ownerUserId, workflowId, body = {}, actor = null) {
  const def = store.getDefinition(workflowId, ownerUserId);
  if (!def) throw new Error('Workflow not found');
  if (def.status !== 'published') throw new Error('Workflow must be published before exposing as A2A agent');

  const name = String(body.name || def.name || '').trim();
  if (!name) throw new Error('Agent name is required');

  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id FROM workflow_a2a_publications
       WHERE workflow_definition_id = ? AND owner_user_id = ? AND status = 'published'`
    )
    .get(workflowId, ownerUserId);

  const skillId = String(body.skill_id || body.skillId || 'default').trim() || 'default';
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const agentCardOverrides =
    body.agent_card && typeof body.agent_card === 'object' ? body.agent_card : body.agentCard || {};

  const patch = {
    name,
    description: String(body.description || def.description || '').trim(),
    skill_id: skillId,
    skill_name: String(body.skill_name || body.skillName || name).trim(),
    skill_description: String(body.skill_description || body.skillDescription || body.description || def.description || '').trim(),
    agent_card_json: JSON.stringify(agentCardOverrides),
    metadata_json: JSON.stringify(metadata),
    auth_token: body.auth_token || body.authToken || null,
    status: 'published',
    published_at: new Date().toISOString(),
  };

  let publishId;
  if (existing) {
    publishId = existing.id;
    db.prepare(
      `UPDATE workflow_a2a_publications SET
        name = ?, description = ?, skill_id = ?, skill_name = ?, skill_description = ?,
        agent_card_json = ?, metadata_json = ?, auth_token = COALESCE(?, auth_token),
        status = 'published', published_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      patch.name,
      patch.description,
      patch.skill_id,
      patch.skill_name,
      patch.skill_description,
      patch.agent_card_json,
      patch.metadata_json,
      patch.auth_token,
      patch.published_at,
      publishId
    );
  } else {
    publishId = body.id?.trim() || slugPublishId(workflowId, name);
    db.prepare(
      `INSERT INTO workflow_a2a_publications (
        id, workflow_definition_id, owner_user_id, name, description,
        skill_id, skill_name, skill_description, agent_card_json, metadata_json,
        auth_token, status, published_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, datetime('now'))`
    ).run(
      publishId,
      workflowId,
      ownerUserId,
      patch.name,
      patch.description,
      patch.skill_id,
      patch.skill_name,
      patch.skill_description,
      patch.agent_card_json,
      patch.metadata_json,
      patch.auth_token,
      patch.published_at
    );
  }

  store.appendAudit(workflowId, {
    action: 'a2a_published',
    summary: `Published as A2A agent "${name}" (${publishId})`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });

  return getPublicationById(publishId);
}

export function unpublishWorkflowA2A(ownerUserId, workflowId, actor = null) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM workflow_a2a_publications
       WHERE workflow_definition_id = ? AND owner_user_id = ? AND status = 'published'`
    )
    .get(workflowId, ownerUserId);
  if (!row) throw new Error('No A2A publication found for this workflow');

  db.prepare(
    `UPDATE workflow_a2a_publications SET status = 'unpublished', updated_at = datetime('now') WHERE id = ?`
  ).run(row.id);

  store.appendAudit(workflowId, {
    action: 'a2a_unpublished',
    summary: `Unpublished A2A agent "${row.name}" (${row.id})`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });

  return { ok: true, id: row.id };
}

function extractMessageText(params) {
  const message = params?.message;
  if (!message) return '';
  if (typeof message === 'string') return message.trim();
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((p) => (p?.kind === 'text' || p?.type === 'text' ? String(p.text || p.content || '') : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof message.text === 'string') return message.text.trim();
  return '';
}

async function waitForRunCompletion(runId, ownerUserId, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = store.getRun(runId, ownerUserId);
    if (!run) throw new Error('Workflow run not found');
    if (run.status === 'completed') return run;
    if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(run.error_message || `Workflow run ${run.status}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Workflow run timed out');
}

function extractRunOutputText(run) {
  const steps = run.steps || [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const out = steps[i]?.output;
    if (!out) continue;
    if (typeof out.text === 'string' && out.text.trim()) return out.text.trim();
    if (typeof out.result === 'string' && out.result.trim()) return out.result.trim();
    if (out.result && typeof out.result === 'object') {
      const t = out.result.text || out.result.summary || out.result.message;
      if (typeof t === 'string' && t.trim()) return t.trim();
    }
  }
  return run.status === 'completed' ? 'Workflow completed successfully.' : '';
}

function buildA2ATaskResponse(taskId, state, text, extra = {}) {
  return {
    jsonrpc: '2.0',
    id: extra.rpcId || randomUUID(),
    result: {
      kind: 'message',
      messageId: randomUUID(),
      role: 'agent',
      parts: [{ kind: 'text', text: text || '' }],
      task: {
        id: taskId,
        status: { state },
      },
      ...extra.resultExtras,
    },
  };
}

export async function handleA2AJsonRpc(publishId, body, { authHeader = null } = {}) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ? AND status = 'published'`).get(publishId);
  if (!row) {
    return {
      jsonrpc: '2.0',
      id: body?.id || null,
      error: { code: -32001, message: 'A2A agent not found or unpublished' },
    };
  }

  if (row.auth_token && String(row.auth_token).trim()) {
    const token = String(row.auth_token).trim();
    const auth = String(authHeader || '').trim();
    const bearer = auth.replace(/^Bearer\s+/i, '').trim();
    if (bearer !== token && auth !== token) {
      return {
        jsonrpc: '2.0',
        id: body?.id || null,
        error: { code: -32003, message: 'Unauthorized' },
      };
    }
  }

  const def = store.getDefinition(row.workflow_definition_id, row.owner_user_id);
  if (!def || def.status !== 'published') {
    return {
      jsonrpc: '2.0',
      id: body?.id || null,
      error: { code: -32002, message: 'Underlying workflow is not published' },
    };
  }

  const method = body?.method;
  const params = body?.params || {};
  const rpcId = body?.id ?? randomUUID();

  if (method === 'tasks/get' || method === 'GetTask') {
    const taskId = params.id || params.taskId;
    const task = a2aTasks.get(taskId);
    if (!task) {
      return { jsonrpc: '2.0', id: rpcId, error: { code: -32004, message: 'Task not found' } };
    }
    return buildA2ATaskResponse(taskId, task.state, task.text, { rpcId });
  }

  if (method !== 'message/send' && method !== 'SendMessage') {
    return { jsonrpc: '2.0', id: rpcId, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  const messageText = extractMessageText(params);
  if (!messageText) {
    return { jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'Message text is required' } };
  }

  const skillId = params.metadata?.skillId || params.skillId || row.skill_id || 'default';
  if (row.skill_id && skillId !== row.skill_id) {
    return {
      jsonrpc: '2.0',
      id: rpcId,
      error: { code: -32602, message: `Unknown skillId "${skillId}" — expected "${row.skill_id}"` },
    };
  }

  const taskId = randomUUID();
  a2aTasks.set(taskId, { state: 'working', text: '', publishId, startedAt: Date.now() });

  try {
    const run = await startAgentWorkflowRun(row.workflow_definition_id, row.owner_user_id, {
      trigger: 'manual',
      input: messageText,
      actor: { id: `a2a:${publishId}`, name: row.name, type: 'a2a_client' },
    });
    const finalRun = await waitForRunCompletion(run.id, row.owner_user_id);
    const text = extractRunOutputText(finalRun);
    a2aTasks.set(taskId, { state: 'completed', text, runId: run.id });
    return buildA2ATaskResponse(taskId, 'completed', text, { rpcId });
  } catch (e) {
    a2aTasks.set(taskId, { state: 'failed', text: e.message });
    return buildA2ATaskResponse(taskId, 'failed', e.message || 'Workflow failed', { rpcId });
  }
}
