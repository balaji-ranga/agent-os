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
import {
  ENQUIRE_SKILL_ID,
  buildEnquireSkill,
  buildRunMetadata,
  createA2ATaskRow,
  extractRunOutputText,
  finalizeA2ATask,
  getA2ATaskRow,
  getA2ATasksByRunId,
  updateA2ATaskRow,
  waitForRunCompletion,
  watchA2ATaskInBackground,
} from './workflow-a2a-async.js';
import { checkA2AClientIp, normalizeA2AVisibility } from './workflow-a2a-access.js';
import { removeA2AScopedWhitelistEntries } from './owner-ip-whitelist.js';
import { deleteOrgAgentMembersByRef } from './org-agent-members.js';

/** In-memory cache for quick sync lookups; durable source of truth is workflow_a2a_tasks. */
const a2aTasks = new Map();
const ACCESS_TOKEN_TTL_SEC = Math.max(
  60,
  Number(process.env.A2A_ACCESS_TOKEN_TTL_SEC) || 3600
);
const SYNC_INVOKE_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.A2A_SYNC_TIMEOUT_MS) || 120000
);
const ASYNC_WATCH_TIMEOUT_MS = Math.max(
  SYNC_INVOKE_TIMEOUT_MS,
  Number(process.env.A2A_ASYNC_WATCH_TIMEOUT_MS) || 24 * 60 * 60 * 1000
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

function resolveInvokeMode(rowOrBody) {
  const mode = String(rowOrBody?.invoke_mode || rowOrBody?.invokeMode || 'sync')
    .trim()
    .toLowerCase();
  return mode === 'async' ? 'async' : 'sync';
}

function normalizeCallbackUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('callback_url must be a valid absolute URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('callback_url must use http or https');
  }
  return parsed.toString();
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
  const invokeMode = resolveInvokeMode(publication);
  const callbackUrl = publication.callback_url ? String(publication.callback_url).trim() : '';
  const inputSchema =
    parseInputSchemaJson(publication.input_schema_json) ||
    extractInputSchemaFromGraph(def?.published_graph || def?.draft_graph) ||
    def?.input_schema ||
    null;

  const primarySkill = {
    id: skillId,
    name: publication.skill_name || publication.name || 'Default',
    description:
      publication.skill_description ||
      publication.description ||
      'Invoke this workflow with a natural-language message',
    tags: ['workflow', 'agent-os', invokeMode, ...(metadata.tags || [])],
    examples: metadata.examples || [`Run ${publication.name || 'workflow'}`],
    ...(inputSchema
      ? {
          inputModes: ['application/json', 'text/plain'],
          inputSchema,
        }
      : {}),
  };

  const extraSkills = Array.isArray(card.skills)
    ? card.skills.filter(
        (s) => s?.id && s.id !== skillId && s.id !== ENQUIRE_SKILL_ID
      )
    : [];

  const skills = [primarySkill, ...extraSkills];
  if (invokeMode === 'async') {
    skills.push(buildEnquireSkill());
  }

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
      pushNotifications: invokeMode === 'async' && !!callbackUrl,
      ...(card.capabilities || {}),
    },
    defaultInputModes: inputSchema ? ['application/json', 'text/plain', 'text'] : ['text/plain', 'text'],
    defaultOutputModes: ['text/plain', 'text', 'application/json'],
    skills,
    metadata: {
      invokeMode,
      ...(callbackUrl ? { callbackUrlConfigured: true } : {}),
      ...(metadata || {}),
    },
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
  const invokeMode = resolveInvokeMode(row);
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
    invoke_mode: invokeMode,
    callback_url: row.callback_url || null,
    access_policy: row.access_policy || 'deny_all',
    visibility: normalizeA2AVisibility(row.visibility),
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

export function listPublicationsForWorkflow(workflowId, ownerUserId) {
  const db = getDb();
  const def = store.getDefinition(workflowId, ownerUserId);
  if (!def) return [];
  const rows = db
    .prepare(
      `SELECT * FROM workflow_a2a_publications
       WHERE workflow_definition_id = ? AND owner_user_id = ? AND status = 'published'
       ORDER BY published_at DESC, created_at DESC`
    )
    .all(workflowId, ownerUserId);
  return rows.map((row) => sanitizePublication(row, def));
}

export function getPublicationByWorkflow(workflowId, ownerUserId) {
  const pubs = listPublicationsForWorkflow(workflowId, ownerUserId);
  return pubs[0] || null;
}

export function getPublicationById(publishId) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ? AND status = 'published'`).get(publishId);
  if (!row) return null;
  const def = store.getDefinition(row.workflow_definition_id, row.owner_user_id);
  return sanitizePublication(row, def);
}

export function listAllPublishedA2AAgents({ includePrivateForOwnerId = null, limit = null, offset = 0 } = {}) {
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
  const ownerFilter = includePrivateForOwnerId ? String(includePrivateForOwnerId) : null;
  const all = rows
    .map((row) => {
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
    })
    .filter((agent) => {
      if (agent.visibility !== 'private') return true;
      // Private listings are only visible to the owning CEO (and admins impersonating them).
      return ownerFilter && agent.owner_user_id === ownerFilter;
    });
  if (limit == null) return all;
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const agents = all.slice(off, off + lim);
  return {
    agents,
    total: all.length,
    count: all.length,
    limit: lim,
    offset: off,
    has_more: off + agents.length < all.length,
  };
}

export function publishWorkflowAsA2A(ownerUserId, workflowId, body = {}, actor = null) {
  const def = store.getDefinition(workflowId, ownerUserId);
  if (!def) throw new Error('Workflow not found');
  if (def.status !== 'published') throw new Error('Workflow must be published before exposing as A2A agent');

  const name = String(body.name || def.name || '').trim();
  if (!name) throw new Error('Agent name is required');

  const db = getDb();
  const publishedRows = db
    .prepare(
      `SELECT * FROM workflow_a2a_publications
       WHERE workflow_definition_id = ? AND owner_user_id = ? AND status = 'published'
       ORDER BY published_at DESC`
    )
    .all(workflowId, ownerUserId);

  const asNewAgent = !!(body.as_new_agent || body.asNewAgent || body.create_new);
  const requestedPublishId = String(body.publish_id || body.publishId || body.id || '').trim();

  let existing = null;
  if (!asNewAgent) {
    if (requestedPublishId) {
      existing = publishedRows.find((r) => r.id === requestedPublishId) || null;
      if (!existing) {
        const any = db
          .prepare(
            `SELECT * FROM workflow_a2a_publications
             WHERE id = ? AND workflow_definition_id = ? AND owner_user_id = ?`
          )
          .get(requestedPublishId, workflowId, ownerUserId);
        if (any && any.status === 'published') existing = any;
        else throw new Error(`A2A publication not found: ${requestedPublishId}`);
      }
    } else if (publishedRows.length === 1) {
      existing = publishedRows[0];
    } else if (publishedRows.length > 1) {
      throw new Error(
        'Multiple A2A agents are published for this workflow. Pass publish_id to update one, or as_new_agent:true to create another.'
      );
    }
  }

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

  const invokeMode = resolveInvokeMode({
    invoke_mode: body.invoke_mode ?? body.invokeMode ?? existing?.invoke_mode ?? 'sync',
  });
  let callbackUrl = null;
  if (invokeMode === 'async') {
    if (body.callback_url !== undefined || body.callbackUrl !== undefined) {
      callbackUrl = normalizeCallbackUrl(body.callback_url ?? body.callbackUrl);
    } else if (existing?.callback_url) {
      callbackUrl = existing.callback_url;
    }
  }

  const visibility = normalizeA2AVisibility(
    body.visibility ?? existing?.visibility ?? 'public'
  );

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
    invoke_mode: invokeMode,
    callback_url: callbackUrl,
    visibility,
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
        auth_token = ?, invoke_mode = ?, callback_url = ?, visibility = ?,
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
      patch.input_schema_json,
      patch.auth_mode,
      patch.client_id,
      patch.client_secret_hash,
      patch.auth_token,
      patch.invoke_mode,
      patch.callback_url,
      patch.visibility,
      patch.published_at,
      publishId
    );
  } else {
    // Never reuse body.id when creating a second agent for the same workflow — always mint a new id
    // unless caller is republishing a previously unpublished row (handled above).
    publishId = slugPublishId(workflowId, name);
    db.prepare(
      `INSERT INTO workflow_a2a_publications (
        id, workflow_definition_id, owner_user_id, name, description,
        skill_id, skill_name, skill_description, agent_card_json, metadata_json, input_schema_json,
        auth_mode, client_id, client_secret_hash, auth_token, invoke_mode, callback_url, visibility,
        status, published_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, datetime('now'))`
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
      patch.invoke_mode,
      patch.callback_url,
      patch.visibility,
      patch.published_at
    );
  }

  if (issuedCredentials) {
    issuedCredentials.token_url = buildA2AUrls(publishId).token_url;
  }

  store.appendAudit(workflowId, {
    action: 'a2a_published',
    summary: `Published as A2A agent "${name}" (${publishId}, auth=${authMode}, invoke=${invokeMode}, visibility=${visibility})`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });

  const row = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ?`).get(publishId);
  return sanitizePublication(row, def, issuedCredentials ? { credentials: issuedCredentials } : {});
}

export function unpublishWorkflowA2A(ownerUserId, workflowId, actor = null, opts = {}) {
  const db = getDb();
  const publishId = String(opts.publishId || opts.publish_id || '').trim();
  let row;
  if (publishId) {
    row = db
      .prepare(
        `SELECT * FROM workflow_a2a_publications
         WHERE id = ? AND workflow_definition_id = ? AND owner_user_id = ? AND status = 'published'`
      )
      .get(publishId, workflowId, ownerUserId);
  } else {
    const rows = db
      .prepare(
        `SELECT * FROM workflow_a2a_publications
         WHERE workflow_definition_id = ? AND owner_user_id = ? AND status = 'published'
         ORDER BY published_at DESC`
      )
      .all(workflowId, ownerUserId);
    if (rows.length > 1) {
      throw new Error(
        'Multiple A2A agents are published for this workflow. Pass publish_id to unpublish a specific agent.'
      );
    }
    row = rows[0] || null;
  }
  if (!row) throw new Error('No A2A publication found for this workflow');

  revokeAccessTokens(db, row.id);
  try {
    removeA2AScopedWhitelistEntries(row.id, row.owner_user_id);
  } catch (_) {}
  try {
    db.prepare(`DELETE FROM workflow_a2a_ip_whitelist WHERE publish_id = ?`).run(row.id);
  } catch (_) {}
  db.prepare(
    `UPDATE workflow_a2a_publications SET status = 'unpublished', updated_at = datetime('now') WHERE id = ?`
  ).run(row.id);

  try {
    deleteOrgAgentMembersByRef('a2a_publish', row.id);
  } catch (e) {
    console.warn('[a2a-publish] org member cascade failed', row.id, e?.message || e);
  }

  store.appendAudit(workflowId, {
    action: 'a2a_unpublished',
    summary: `Unpublished A2A agent "${row.name}" (${row.id})`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });

  return { ok: true, id: row.id };
}

/**
 * Owner-scoped AgentExchange unpublish. The workflow definition remains published
 * and usable through authenticated UI/API; only this A2A publication becomes private.
 */
export function unpublishA2APublicationById(ownerUserId, publishId, actor = null) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM workflow_a2a_publications
       WHERE id = ? AND owner_user_id = ? AND status = 'published'`
    )
    .get(publishId, ownerUserId);
  if (!row) throw new Error('A2A publication not found or not owned by this user');

  revokeAccessTokens(db, row.id);
  try {
    removeA2AScopedWhitelistEntries(row.id, row.owner_user_id);
  } catch (_) {
    /* best-effort cleanup of central A2A scoped IPs */
  }
  try {
    db.prepare(`DELETE FROM workflow_a2a_ip_whitelist WHERE publish_id = ?`).run(row.id);
  } catch (_) {}
  db.prepare(
    `UPDATE workflow_a2a_publications
     SET status = 'unpublished', updated_at = datetime('now')
     WHERE id = ? AND owner_user_id = ?`
  ).run(row.id, ownerUserId);

  try {
    deleteOrgAgentMembersByRef('a2a_publish', row.id);
  } catch (e) {
    console.warn('[a2a-publish] org member cascade failed', row.id, e?.message || e);
  }

  store.appendAudit(row.workflow_definition_id, {
    action: 'a2a_unpublished',
    summary: `Unpublished A2A agent "${row.name}" (${row.id}); workflow remains private to authenticated UI/API`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });

  return {
    ok: true,
    id: row.id,
    workflow_definition_id: row.workflow_definition_id,
    workflow_remains_published: true,
  };
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

function buildA2ATaskResponse(taskId, state, text, extra = {}) {
  const runMeta = extra.runMetadata || null;
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
      metadata: {
        ...(runMeta ? { run: runMeta } : {}),
        ...(extra.metadata || {}),
      },
      ...extra.resultExtras,
    },
  };
}

function resolveEnquireIds(messageInput, params) {
  let taskId =
    params?.id ||
    params?.taskId ||
    params?.metadata?.taskId ||
    params?.metadata?.task_id ||
    null;
  let runId =
    params?.runId ||
    params?.metadata?.runId ||
    params?.metadata?.run_id ||
    null;
  if (messageInput && typeof messageInput === 'object' && !Array.isArray(messageInput)) {
    taskId = taskId || messageInput.taskId || messageInput.task_id || null;
    runId = runId || messageInput.runId || messageInput.run_id || null;
  }
  if (typeof messageInput === 'string') {
    const m = messageInput.match(
      /(?:task[_ ]?id|taskId)\s*[:=]\s*([0-9a-f-]{8,})/i
    );
    if (m) taskId = taskId || m[1];
    const r = messageInput.match(/(?:run[_ ]?id|runId)\s*[:=]\s*(\d+)/i);
    if (r) runId = runId || Number(r[1]);
  }
  return { taskId: taskId ? String(taskId).trim() : null, runId: runId != null ? Number(runId) : null };
}

function taskResponseFromRow(taskRow, rpcId, publishId) {
  if (!taskRow || taskRow.publish_id !== publishId) {
    return { jsonrpc: '2.0', id: rpcId, error: { code: -32004, message: 'Task not found' } };
  }
  // Refresh from run if still working
  if (['working', 'submitted'].includes(taskRow.state)) {
    const run = store.getRun(taskRow.run_id, taskRow.owner_user_id);
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) {
      // sync finalize without waiting for async callback path
      const text =
        run.status === 'completed'
          ? extractRunOutputText(run)
          : run.error_message || `Workflow run ${run.status}`;
      const meta = buildRunMetadata(run);
      const state =
        run.status === 'completed' ? 'completed' : run.status === 'cancelled' ? 'cancelled' : 'failed';
      updateA2ATaskRow(taskRow.task_id, { state, output_text: text, run_metadata: meta });
      a2aTasks.set(taskRow.task_id, { state, text, runId: run.id });
      void finalizeA2ATask(taskRow.task_id).catch(() => {});
      taskRow = getA2ATaskRow(taskRow.task_id);
    } else if (run) {
      const meta = buildRunMetadata(run);
      updateA2ATaskRow(taskRow.task_id, { run_metadata: meta });
      taskRow = getA2ATaskRow(taskRow.task_id);
      return buildA2ATaskResponse(taskRow.task_id, 'working', 'Workflow still running.', {
        rpcId,
        runMetadata: meta,
        metadata: { invoke_mode: 'async', run_id: run.id },
      });
    }
  }
  return buildA2ATaskResponse(taskRow.task_id, taskRow.state, taskRow.output_text || '', {
    rpcId,
    runMetadata: taskRow.run_metadata || null,
    metadata: {
      run_id: taskRow.run_id,
      callback_delivered: !!taskRow.callback_at,
    },
  });
}

export async function handleA2AJsonRpc(
  publishId,
  body,
  { authHeader = null, clientIp = '', bypassAccessChecks = false } = {}
) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ? AND status = 'published'`).get(publishId);
  if (!row) {
    return {
      jsonrpc: '2.0',
      id: body?.id || null,
      error: { code: -32001, message: 'A2A agent not found or unpublished' },
    };
  }

  if (!bypassAccessChecks) {
    const ipAccess = checkA2AClientIp(row, clientIp);
    if (!ipAccess.ok) {
      return {
        jsonrpc: '2.0',
        id: body?.id || null,
        error: {
          code: -32005,
          message: ipAccess.reason || 'Client IP is not allowed',
          data: { access_policy: ipAccess.policy, visibility: ipAccess.visibility || row.visibility },
        },
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
  const invokeMode = resolveInvokeMode(row);

  if (method === 'tasks/get' || method === 'GetTask' || method === 'tasks/enquire') {
    const { taskId, runId } = resolveEnquireIds(null, params);
    let taskRow = taskId ? getA2ATaskRow(taskId) : null;
    if (!taskRow && runId) {
      taskRow = getA2ATasksByRunId(runId).find((t) => t.publish_id === publishId) || null;
    }
    if (!taskRow) {
      const mem = taskId ? a2aTasks.get(taskId) : null;
      if (mem) {
        return buildA2ATaskResponse(taskId, mem.state, mem.text || '', {
          rpcId,
          metadata: { run_id: mem.runId || null },
        });
      }
      return { jsonrpc: '2.0', id: rpcId, error: { code: -32004, message: 'Task not found' } };
    }
    return taskResponseFromRow(taskRow, rpcId, publishId);
  }

  if (method !== 'message/send' && method !== 'SendMessage') {
    return { jsonrpc: '2.0', id: rpcId, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  const skillId = params.metadata?.skillId || params.skillId || row.skill_id || 'default';
  const messageInput = extractMessageInput(params);

  if (skillId === ENQUIRE_SKILL_ID) {
    const { taskId, runId } = resolveEnquireIds(messageInput, params);
    let taskRow = taskId ? getA2ATaskRow(taskId) : null;
    if (!taskRow && runId) {
      taskRow = getA2ATasksByRunId(runId).find((t) => t.publish_id === publishId) || null;
    }
    if (!taskRow) {
      return { jsonrpc: '2.0', id: rpcId, error: { code: -32004, message: 'Task not found — pass taskId or runId' } };
    }
    return taskResponseFromRow(taskRow, rpcId, publishId);
  }

  if (
    messageInput === '' ||
    messageInput == null ||
    (typeof messageInput === 'string' && !messageInput.trim())
  ) {
    return { jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: 'Message text or data is required' } };
  }

  if (row.skill_id && skillId !== row.skill_id) {
    return {
      jsonrpc: '2.0',
      id: rpcId,
      error: { code: -32602, message: `Unknown skillId "${skillId}" — expected "${row.skill_id}" or "${ENQUIRE_SKILL_ID}"` },
    };
  }

  let invokeCallbackUrl = row.callback_url || null;
  try {
    const override =
      params.metadata?.callbackUrl ||
      params.metadata?.callback_url ||
      params.callbackUrl ||
      params.callback_url;
    if (override) invokeCallbackUrl = normalizeCallbackUrl(override);
  } catch (e) {
    return { jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: e.message } };
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

    createA2ATaskRow({
      taskId,
      publishId,
      runId: run.id,
      ownerUserId: row.owner_user_id,
      callbackUrl: invokeMode === 'async' ? invokeCallbackUrl : null,
    });
    a2aTasks.set(taskId, { state: 'working', text: '', publishId, runId: run.id, startedAt: Date.now() });

    if (invokeMode === 'async') {
      watchA2ATaskInBackground(taskId, row.owner_user_id, ASYNC_WATCH_TIMEOUT_MS);
      const acceptingText =
        'Accepted. Workflow is running asynchronously. Enquire with skill enquire-progress or method tasks/get using this task id' +
        (invokeCallbackUrl ? '; final result will also POST to your callback URL.' : '.');
      return buildA2ATaskResponse(taskId, 'working', acceptingText, {
        rpcId,
        runMetadata: buildRunMetadata(run),
        metadata: {
          invoke_mode: 'async',
          run_id: run.id,
          callback_url: invokeCallbackUrl || null,
          enquire: {
            skillId: ENQUIRE_SKILL_ID,
            methods: ['tasks/get', 'tasks/enquire'],
            taskId,
          },
        },
      });
    }

    const finalRun = await waitForRunCompletion(run.id, row.owner_user_id, SYNC_INVOKE_TIMEOUT_MS);
    const text = extractRunOutputText(finalRun);
    const meta = buildRunMetadata(finalRun);
    updateA2ATaskRow(taskId, { state: 'completed', output_text: text, run_metadata: meta });
    a2aTasks.set(taskId, { state: 'completed', text, runId: run.id });
    return buildA2ATaskResponse(taskId, 'completed', text, {
      rpcId,
      runMetadata: meta,
      metadata: { invoke_mode: 'sync', run_id: run.id },
    });
  } catch (e) {
    const msg = e?.message || 'Workflow failed';
    a2aTasks.set(taskId, { state: 'failed', text: msg });
    const existingTask = getA2ATaskRow(taskId);
    if (existingTask) {
      const run = store.getRun(existingTask.run_id, row.owner_user_id);
      updateA2ATaskRow(taskId, {
        state: 'failed',
        output_text: msg,
        run_metadata: buildRunMetadata(run) || { error_message: msg },
      });
      if (invokeMode === 'async') {
        void finalizeA2ATask(taskId).catch(() => {});
      }
    }
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
    const failedTask = getA2ATaskRow(taskId);
    return buildA2ATaskResponse(taskId, 'failed', msg, {
      rpcId,
      runMetadata: failedTask?.run_metadata || null,
      metadata: {
        invoke_mode: invokeMode,
        run_id: failedTask?.run_id || null,
      },
    });
  }
}
