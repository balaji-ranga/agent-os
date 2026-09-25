import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { getDb } from '../db/schema.js';
import { resolveUserApiKey } from './user-api-keys.js';

export const WORKFLOW_MESSAGING_PROTOCOLS = Object.freeze([
  'amqp091', 'amqp10', 'mqtt', 'stomp', 'kafka', 'jms', 'mock',
]);

const SECRET_REF_FIELDS = Object.freeze([
  'usernameRef', 'passwordRef', 'tokenRef', 'clientIdRef', 'clientSecretRef',
  'caCertRef', 'clientCertRef', 'privateKeyRef',
]);

function db() { return getDb(); }
function json(value, fallback = {}) {
  try { return JSON.parse(value || '') || fallback; } catch { return fallback; }
}
function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function normalizeId(value, label) {
  const out = String(value || '').trim();
  if (!out) throw httpError(`${label} is required`);
  return out;
}

export function ensureWorkflowMessagingSchema() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS workflow_messaging_connections (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      vault_refs_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_messaging_connections_owner
      ON workflow_messaging_connections(owner_user_id, enabled);
    CREATE TABLE IF NOT EXISTS workflow_messaging_deliveries (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      subscription_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      workflow_run_id TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, connection_id, subscription_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_messaging_deliveries_owner
      ON workflow_messaging_deliveries(owner_user_id, created_at DESC);
  `);
}

function validateEndpoint(protocol, endpoint) {
  const raw = normalizeId(endpoint, 'Broker endpoint');
  if (/\s/.test(raw) || /:\/\/[^/]*@/.test(raw)) {
    throw httpError('Broker endpoint must not contain whitespace or inline credentials; use API Keys Vault references');
  }
  const schemes = {
    amqp091: ['amqp:', 'amqps:'], amqp10: ['amqp:', 'amqps:'],
    mqtt: ['mqtt:', 'mqtts:', 'ws:', 'wss:'],
    stomp: ['stomp:', 'stomps:', 'tcp:', 'tls:', 'ws:', 'wss:'],
    kafka: ['kafka:', 'kafka+ssl:'], jms: ['jms:', 'amqp:', 'amqps:', 'tcp:', 'ssl:'],
    mock: ['mock:'],
  };
  if (!schemes[protocol]?.some((scheme) => raw.toLowerCase().startsWith(scheme))) {
    throw httpError(`Endpoint scheme is not valid for ${protocol}`);
  }
  return raw;
}

function sanitizeVaultRefs(value) {
  const refs = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const field of SECRET_REF_FIELDS) {
    const ref = String(refs[field] || '').trim();
    if (ref) out[field] = ref;
  }
  return out;
}

function publicConnection(row) {
  return {
    id: row.id, owner_user_id: row.owner_user_id, name: row.name,
    protocol: row.protocol, endpoint: row.endpoint,
    config: json(row.config_json), vault_refs: json(row.vault_refs_json),
    enabled: !!row.enabled, created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function listMessagingConnections(ownerUserId) {
  ensureWorkflowMessagingSchema();
  return db().prepare(`SELECT * FROM workflow_messaging_connections WHERE owner_user_id = ? ORDER BY name`)
    .all(normalizeId(ownerUserId, 'Owner')).map(publicConnection);
}

export function getMessagingConnection(ownerUserId, id) {
  ensureWorkflowMessagingSchema();
  const row = db().prepare(`SELECT * FROM workflow_messaging_connections WHERE owner_user_id = ? AND id = ?`)
    .get(normalizeId(ownerUserId, 'Owner'), normalizeId(id, 'Connection ID'));
  return row ? publicConnection(row) : null;
}

export function saveMessagingConnection(ownerUserId, input = {}, id = null) {
  ensureWorkflowMessagingSchema();
  const owner = normalizeId(ownerUserId, 'Owner');
  const protocol = String(input.protocol || '').trim().toLowerCase();
  if (!WORKFLOW_MESSAGING_PROTOCOLS.includes(protocol)) throw httpError('Unsupported messaging protocol');
  const connection = {
    id: id || randomUUID(), owner, name: normalizeId(input.name, 'Connection name'), protocol,
    endpoint: validateEndpoint(protocol, input.endpoint),
    config: input.config && typeof input.config === 'object' ? input.config : {},
    refs: sanitizeVaultRefs(input.vault_refs || input.vaultRefs), enabled: input.enabled !== false,
  };
  const forbidden = JSON.stringify(connection.config).match(/"(?:password|secret|token|privateKey|clientSecret)"\s*:/i);
  if (forbidden) throw httpError('Secrets cannot be stored in connection configuration; select API Keys Vault references');
  if (id) {
    const result = db().prepare(`UPDATE workflow_messaging_connections SET name=?, protocol=?, endpoint=?, config_json=?, vault_refs_json=?, enabled=?, updated_at=datetime('now') WHERE id=? AND owner_user_id=?`)
      .run(connection.name, protocol, connection.endpoint, JSON.stringify(connection.config), JSON.stringify(connection.refs), connection.enabled ? 1 : 0, id, owner);
    if (!result.changes) throw httpError('Messaging connection not found', 404);
  } else {
    db().prepare(`INSERT INTO workflow_messaging_connections (id,owner_user_id,name,protocol,endpoint,config_json,vault_refs_json,enabled) VALUES (?,?,?,?,?,?,?,?)`)
      .run(connection.id, owner, connection.name, protocol, connection.endpoint, JSON.stringify(connection.config), JSON.stringify(connection.refs), connection.enabled ? 1 : 0);
  }
  return getMessagingConnection(owner, connection.id);
}

export function deleteMessagingConnection(ownerUserId, id) {
  ensureWorkflowMessagingSchema();
  const owner = normalizeId(ownerUserId, 'Owner');
  const used = db().prepare(`SELECT id, draft_graph_json, published_graph_json FROM agent_workflow_definitions WHERE owner_user_id=?`).all(owner)
    .find((row) => [row.draft_graph_json, row.published_graph_json].some((raw) => {
      const graph = json(raw, null);
      return graph?.nodes?.some((node) => node.data?.messageConnectionId === id || node.data?.taskConfig?.connectionId === id);
    }));
  if (used) throw httpError(`Connection is used by workflow ${used.id}; remove it from the workflow first`, 409);
  return { deleted: db().prepare(`DELETE FROM workflow_messaging_connections WHERE owner_user_id=? AND id=?`).run(owner, id).changes > 0 };
}

export function resolveMessagingConnection(ownerUserId, id) {
  const connection = getMessagingConnection(ownerUserId, id);
  if (!connection) throw httpError('Messaging connection not found', 404);
  if (!connection.enabled) throw httpError('Messaging connection is disabled', 409);
  const credentials = {};
  for (const [field, keyName] of Object.entries(connection.vault_refs)) {
    const resolved = resolveUserApiKey(ownerUserId, keyName);
    if (!resolved?.value) throw httpError(`API Keys Vault entry ${keyName} is unavailable`, 409);
    credentials[field.replace(/Ref$/, '')] = resolved.value;
  }
  return { ...connection, credentials };
}

function serviceToken() {
  return String(process.env.MESSAGING_SERVICE_TOKEN || '').trim();
}
export function assertMessagingServiceRequest(req) {
  const expected = serviceToken();
  if (!expected) throw httpError('Messaging service token is not configured', 503);
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw httpError('Unauthorized messaging service request', 401);
}

function triggerMessageConfig(graph) {
  const node = graph?.nodes?.find((candidate) => candidate.type === 'trigger');
  const config = node?.data?.taskConfig || node?.data?.config || node?.data || {};
  return { node, config };
}

export function listResolvedMessageSubscriptions() {
  ensureWorkflowMessagingSchema();
  const rows = db().prepare(`SELECT id, owner_user_id, published_graph_json FROM agent_workflow_definitions WHERE status='published' AND paused=0 AND trigger_modes LIKE '%message%'`).all();
  const subscriptions = [];
  for (const row of rows) {
    const graph = json(row.published_graph_json, null);
    const { config } = triggerMessageConfig(graph);
    const connectionId = String(config?.messageConnectionId || '').trim();
    const destination = String(config?.messageDestination || '').trim();
    if (!connectionId || !destination) continue;
    try {
      const connection = resolveMessagingConnection(row.owner_user_id, connectionId);
      subscriptions.push({
        id: `${row.id}:${connectionId}:${createHash('sha256').update(destination).digest('hex').slice(0, 12)}`,
        workflowDefinitionId: row.id, ownerUserId: row.owner_user_id,
        connectionId, protocol: connection.protocol, endpoint: connection.endpoint,
        connectionConfig: connection.config, credentials: connection.credentials,
        destination, destinationType: config.messageDestinationType || 'queue',
        consumerGroup: config.messageConsumerGroup || '', options: config.messageOptions || {},
      });
    } catch (error) {
      console.warn('[workflow-messaging] subscription skipped', { workflow: row.id, error: error.message });
    }
  }
  return subscriptions;
}

async function messagingServiceRequest(path, body) {
  const base = String(process.env.MESSAGING_SERVICE_URL || 'http://messaging-listener:8090').replace(/\/$/, '');
  const token = serviceToken();
  if (!token) throw httpError('Messaging service token is not configured', 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.MESSAGING_SERVICE_TIMEOUT_MS || 15000));
  try {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw httpError(result.error || `Messaging service returned ${response.status}`, 502);
    return result;
  } finally { clearTimeout(timeout); }
}

export async function testMessagingConnection(ownerUserId, id) {
  const connection = resolveMessagingConnection(ownerUserId, id);
  return messagingServiceRequest('/v1/test', { connection });
}

export async function publishWorkflowMessage(ownerUserId, input = {}) {
  const connectionId = normalizeId(input.connectionId, 'Messaging connection');
  const destination = normalizeId(input.destination, 'Destination');
  const connection = resolveMessagingConnection(ownerUserId, connectionId);
  return messagingServiceRequest('/v1/publish', {
    connection, destination, destinationType: input.destinationType || 'queue',
    payload: input.payload ?? '', headers: input.headers || {}, key: input.key || '',
    correlationId: input.correlationId || '', replyTo: input.replyTo || '',
    qos: input.qos, persistent: input.persistent, ttlMs: input.ttlMs, partition: input.partition,
  });
}

export async function deliverWorkflowMessage(input = {}) {
  ensureWorkflowMessagingSchema();
  const subscriptionId = normalizeId(input.subscriptionId, 'Subscription ID');
  const subscription = listResolvedMessageSubscriptions().find((item) => item.id === subscriptionId);
  if (!subscription) throw httpError('Subscription is no longer active', 409);
  const envelope = input.envelope && typeof input.envelope === 'object' ? input.envelope : {};
  const messageId = String(envelope.messageId || '').trim() || createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
  const deliveryId = randomUUID();
  try {
    db().prepare(`INSERT INTO workflow_messaging_deliveries (id,owner_user_id,connection_id,subscription_id,message_id) VALUES (?,?,?,?,?)`)
      .run(deliveryId, subscription.ownerUserId, subscription.connectionId, subscriptionId, messageId);
  } catch (error) {
    if (/UNIQUE/i.test(String(error.message))) return { ok: true, duplicate: true, messageId };
    throw error;
  }
  try {
    const { startAgentWorkflowRun } = await import('./agent-workflow-runner.js');
    const run = await startAgentWorkflowRun(subscription.workflowDefinitionId, subscription.ownerUserId, {
      trigger: 'message', input: { ...envelope, messageId },
      actor: { id: 'messaging-listener', name: 'Messaging listener', type: 'internal_service' },
    });
    const runId = run?.id || run?.run_id || null;
    db().prepare(`UPDATE workflow_messaging_deliveries SET status='accepted', workflow_run_id=?, updated_at=datetime('now') WHERE id=?`).run(runId, deliveryId);
    return { ok: true, duplicate: false, messageId, runId };
  } catch (error) {
    db().prepare(`DELETE FROM workflow_messaging_deliveries WHERE id=?`).run(deliveryId);
    throw error;
  }
}
