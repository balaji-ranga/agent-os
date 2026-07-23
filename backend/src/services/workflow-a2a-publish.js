/**
 * Publish agent workflows as A2A-compliant agents.
 * Secured agents use OAuth2 client credentials → Bearer access token.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import { startAgentWorkflowRun } from './agent-workflow-runner.js';
import * as store from './agent-workflow-store.js';
import {
  extractInputSchemaFromGraph,
  normalizeInputSchema,
  parseInputSchemaJson,
  WorkflowInputSchemaError,
} from './workflow-input-schema.js';

const a2aTasks = new Map();
const ACCESS_TOKEN_TTL_SEC = Math.max(
  60,
  Number(process.env.A2A_ACCESS_TOKEN_TTL_SEC) || 3600
);

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

function hashAccessToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function generateClientId() {
  return `a2a_${randomBytes(12).toString('hex')}`;
}

function generateClientSecret() {
  return randomBytes(32).toString('base64url');
}

function generateAccessToken() {
  return `aat_${randomBytes(32).toString('base64url')}`;
}

function resolveAuthMode(row) {
  const mode = String(row?.auth_mode || '').trim().toLowerCase();
  if (mode === 'secured' || mode === 'public') return mode;
  if ((row?.auth_token && String(row.auth_token).trim()) || row?.client_secret_hash) return 'secured';
  return 'public';
}

function isSecuredPublication(row) {
  return resolveAuthMode(row) === 'secured';
}

function revokeAccessTokens(db, publishId) {
  db.prepare(`DELETE FROM workflow_a2a_access_tokens WHERE publish_id = ?`).run(publishId);
}

function purgeExpiredAccessTokens(db) {
  db.prepare(`DELETE FROM workflow_a2a_access_tokens WHERE expires_at < datetime('now')`).run();
}

export function buildA2AUrls(publishId) {
  const base = getPublicBaseUrl();
  const root = `${base}/api/a2a/${publishId}`;
  return {
    endpoint_url: root,
    card_url: `${root}/.well-known/agent-card.json`,
    token_url: `${root}/oauth/token`,
  };
}

export function buildAgentCard(publication, def = null) {
  const urls = buildA2AUrls(publication.id);
  const skillId = publication.skill_id || 'default';
  const card = parseJson(publication.agent_card_json, null) || {};
  const metadata = parseJson(publication.metadata_json, {});
  const authMode = resolveAuthMode(publication);
  const secured = authMode === 'secured';
  const hasOauth = secured && publication.client_id;
  const hasLegacyBearer = secured && publication.auth_token && String(publication.auth_token).trim();
  const inputSchema =
    parseInputSchemaJson(publication.input_schema_json) ||
    extractInputSchemaFromGraph(def?.published_graph || def?.draft_graph) ||
    def?.input_schema ||
    null;

  const out = {
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
    defaultInputModes: inputSchema ? ['application/json', 'text/plain', 'text'] : ['text/plain', 'text'],
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
        ...(inputSchema
          ? {
              inputModes: ['application/json', 'text/plain'],
              inputSchema,
            }
          : {}),
      },
      ...(Array.isArray(card.skills) ? card.skills.filter((s) => s?.id && s.id !== skillId) : []),
    ],
    ...(card.provider ? { provider: card.provider } : {}),
    ...(metadata.provider ? { provider: metadata.provider } : {}),
  };

  if (hasOauth) {
    out.securitySchemes = {
      oauth2: {
        type: 'oauth2',
        flows: {
          clientCredentials: {
            tokenUrl: urls.token_url,
            scopes: {},
          },
        },
      },
    };
    out.security = [{ oauth2: [] }];
    out.authentication = {
      schemes: ['oauth2'],
      credentials:
        'OAuth 2.0 client credentials. POST grant_type=client_credentials with client_id and client_secret to tokenUrl, then send Authorization: Bearer <access_token>.',
    };
  } else if (hasLegacyBearer || secured) {
    out.authentication = {
      schemes: ['bearer'],
      credentials: 'Send Authorization: Bearer <token> (or x-a2a-auth).',
    };
  }

  return out;
}

function sanitizePublication(row, def = null, extras = {}) {
  if (!row) return null;
  const urls = buildA2AUrls(row.id);
  const authMode = resolveAuthMode(row);
  const secured = authMode === 'secured';
  const includeClientId = extras.includeClientId !== false;
  const { includeClientId: _omit, ...safeExtras } = extras;
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
    token_url: secured ? urls.token_url : null,
    agent_card: buildAgentCard(row, def),
    input_schema: parseInputSchemaJson(row.input_schema_json) || def?.input_schema || null,
    metadata: parseJson(row.metadata_json, {}),
    auth_mode: authMode,
    has_auth: secured,
    client_id: secured && includeClientId ? row.client_id || null : null,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...safeExtras,
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
    const pub = sanitizePublication(
      row,
      { name: row.workflow_name, description: row.description },
      { includeClientId: false }
    );
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
      `SELECT * FROM workflow_a2a_publications
       WHERE workflow_definition_id = ? AND owner_user_id = ? AND status = 'published'`
    )
    .get(workflowId, ownerUserId);

  const skillId = String(body.skill_id || body.skillId || 'default').trim() || 'default';
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const agentCardOverrides =
    body.agent_card && typeof body.agent_card === 'object' ? body.agent_card : body.agentCard || {};

  let inputSchema = null;
  try {
    if (body.input_schema !== undefined || body.inputSchema !== undefined) {
      inputSchema = normalizeInputSchema(body.input_schema ?? body.inputSchema);
    } else {
      inputSchema =
        def.input_schema ||
        extractInputSchemaFromGraph(def.published_graph || def.draft_graph) ||
        null;
    }
  } catch (e) {
    throw new Error(e.message || 'Invalid input_schema');
  }

  const rawMode = String(body.auth_mode || body.authMode || existing?.auth_mode || 'public')
    .trim()
    .toLowerCase();
  const authMode = rawMode === 'secured' ? 'secured' : 'public';
  const rotateCredentials = !!(body.rotate_credentials || body.rotateCredentials);

  let clientId = existing?.client_id || null;
  let clientSecretHash = existing?.client_secret_hash || null;
  // Legacy plaintext auth_token: keep for existing rows / invoke compat; do not accept new values from API.
  let authToken = existing?.auth_token || null;
  let issuedCredentials = null;

  if (authMode === 'public') {
    clientId = null;
    clientSecretHash = null;
    authToken = null;
  } else {
    const needsNewSecret =
      !existing ||
      resolveAuthMode(existing) !== 'secured' ||
      !clientId ||
      !clientSecretHash ||
      rotateCredentials;

    if (needsNewSecret) {
      clientId = generateClientId();
      const clientSecret = generateClientSecret();
      clientSecretHash = hashPassword(clientSecret);
      issuedCredentials = {
        client_id: clientId,
        client_secret: clientSecret,
        token_url: null,
        expires_in_hint: ACCESS_TOKEN_TTL_SEC,
      };
      // Prefer OAuth credentials over legacy static token.
      authToken = null;
    }
  }

  const patch = {
    name,
    description: String(body.description || def.description || '').trim(),
    skill_id: skillId,
    skill_name: String(body.skill_name || body.skillName || name).trim(),
    skill_description: String(
      body.skill_description || body.skillDescription || body.description || def.description || ''
    ).trim(),
    agent_card_json: JSON.stringify(agentCardOverrides),
    metadata_json: JSON.stringify(metadata),
    input_schema_json: inputSchema ? JSON.stringify(inputSchema) : null,
    auth_mode: authMode,
    client_id: clientId,
    client_secret_hash: clientSecretHash,
    auth_token: authToken,
    status: 'published',
    published_at: new Date().toISOString(),
  };

  let publishId;
  if (existing) {
    publishId = existing.id;
    if (issuedCredentials || authMode === 'public') {
      revokeAccessTokens(db, publishId);
    }
    db.prepare(
      `UPDATE workflow_a2a_publications SET
        name = ?, description = ?, skill_id = ?, skill_name = ?, skill_description = ?,
        agent_card_json = ?, metadata_json = ?, input_schema_json = ?,
        auth_mode = ?, client_id = ?, client_secret_hash = ?,
        auth_token = ?, status = 'published', published_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      patch.name,
      patch.description,
      patch.skill_id,
      patch.skill_name,
      patch.skill_description,
      patch.agent_card_json,
      patch.metadata_json,
      patch.input_schema_json,
      patch.auth_mode,
      patch.client_id,
      patch.client_secret_hash,
      patch.auth_token,
      patch.published_at,
      publishId
    );
  } else {
    publishId = body.id?.trim() || slugPublishId(workflowId, name);
    db.prepare(
      `INSERT INTO workflow_a2a_publications (
        id, workflow_definition_id, owner_user_id, name, description,
        skill_id, skill_name, skill_description, agent_card_json, metadata_json, input_schema_json,
        auth_mode, client_id, client_secret_hash, auth_token, status, published_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, datetime('now'))`
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
      patch.input_schema_json,
      patch.auth_mode,
      patch.client_id,
      patch.client_secret_hash,
      patch.auth_token,
      patch.published_at
    );
  }

  if (issuedCredentials) {
    issuedCredentials.token_url = buildA2AUrls(publishId).token_url;
  }

  store.appendAudit(workflowId, {
    action: 'a2a_published',
    summary: `Published as A2A agent "${name}" (${publishId}, auth=${authMode})`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });

  const row = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ?`).get(publishId);
  return sanitizePublication(row, def, issuedCredentials ? { credentials: issuedCredentials } : {});
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

  revokeAccessTokens(db, row.id);
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

function extractBearerToken(authHeader) {
  const auth = String(authHeader || '').trim();
  if (!auth) return '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

function accessTokenIsValid(db, publishId, bearer) {
  if (!bearer) return false;
  purgeExpiredAccessTokens(db);
  const tokenHash = hashAccessToken(bearer);
  const row = db
    .prepare(
      `SELECT token_hash FROM workflow_a2a_access_tokens
       WHERE token_hash = ? AND publish_id = ? AND expires_at >= datetime('now')`
    )
    .get(tokenHash, publishId);
  return !!row;
}

function authorizeA2AInvoke(row, authHeader) {
  if (!isSecuredPublication(row)) return { ok: true };

  const bearer = extractBearerToken(authHeader);
  const rawAuth = String(authHeader || '').trim();
  const db = getDb();

  if (accessTokenIsValid(db, row.id, bearer)) return { ok: true };

  const legacy = row.auth_token && String(row.auth_token).trim();
  if (legacy && (bearer === legacy || rawAuth === legacy)) return { ok: true };

  return {
    ok: false,
    message: row.client_id
      ? 'Unauthorized — obtain an access token via POST .../oauth/token (client credentials)'
      : 'Unauthorized',
  };
}

/**
 * OAuth2 client-credentials token endpoint for secured A2A publications.
 */
export function issueA2AAccessToken(publishId, { clientId, clientSecret } = {}) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ? AND status = 'published'`).get(publishId);
  if (!row || !isSecuredPublication(row) || !row.client_id || !row.client_secret_hash) {
    const err = new Error('invalid_client');
    err.status = 401;
    err.oauth = { error: 'invalid_client', error_description: 'Unknown or unsecured A2A agent' };
    throw err;
  }

  const id = String(clientId || '').trim();
  const secret = String(clientSecret || '').trim();
  if (!id || !secret || id !== row.client_id || !verifyPassword(secret, row.client_secret_hash)) {
    const err = new Error('invalid_client');
    err.status = 401;
    err.oauth = { error: 'invalid_client', error_description: 'Invalid client credentials' };
    throw err;
  }

  purgeExpiredAccessTokens(db);
  const accessToken = generateAccessToken();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString();
  db.prepare(
    `INSERT INTO workflow_a2a_access_tokens (token_hash, publish_id, expires_at) VALUES (?, ?, ?)`
  ).run(hashAccessToken(accessToken), publishId, expiresAt);

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
  };
}

function extractMessageInput(params) {
  const message = params?.message;
  if (!message) return '';
  if (typeof message === 'string') return message.trim();
  if (Array.isArray(message.parts)) {
    const dataPart = message.parts.find(
      (p) =>
        p &&
        (p.kind === 'data' || p.type === 'data' || p.kind === 'json' || p.mimeType === 'application/json') &&
        (p.data != null || p.json != null || p.content != null)
    );
    if (dataPart) {
      return dataPart.data ?? dataPart.json ?? dataPart.content;
    }
    return message.parts
      .map((p) => (p?.kind === 'text' || p?.type === 'text' ? String(p.text || p.content || '') : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (message.data != null && typeof message.data === 'object') return message.data;
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

  const auth = authorizeA2AInvoke(row, authHeader);
  if (!auth.ok) {
    return {
      jsonrpc: '2.0',
      id: body?.id || null,
      error: { code: -32003, message: auth.message || 'Unauthorized' },
    };
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

  const messageInput = extractMessageInput(params);
  if (
    messageInput === '' ||
    messageInput == null ||
    (typeof messageInput === 'string' && !messageInput.trim())
  ) {
    return { jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'Message text or data is required' } };
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
      trigger: 'a2a',
      input: messageInput,
      publicationSchema: parseInputSchemaJson(row.input_schema_json),
      actor: { id: `a2a:${publishId}`, name: row.name, type: 'a2a_client' },
    });
    const finalRun = await waitForRunCompletion(run.id, row.owner_user_id);
    const text = extractRunOutputText(finalRun);
    a2aTasks.set(taskId, { state: 'completed', text, runId: run.id });
    return buildA2ATaskResponse(taskId, 'completed', text, { rpcId });
  } catch (e) {
    const msg = e?.message || 'Workflow failed';
    a2aTasks.set(taskId, { state: 'failed', text: msg });
    if (e instanceof WorkflowInputSchemaError || e?.code === 'INPUT_SCHEMA_VALIDATION') {
      return {
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32602,
          message: msg,
          data: e.details || null,
        },
      };
    }
    return buildA2ATaskResponse(taskId, 'failed', msg, { rpcId });
  }
}
