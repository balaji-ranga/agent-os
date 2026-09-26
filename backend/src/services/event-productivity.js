import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { getDb } from '../db/schema.js';
import { executeConnectorAction, getConnectedConnectorApps } from './openconnector.js';
import { triggerWorkflowFromHook } from './agent-workflow-webhooks.js';
import { createAndStartGoalRun } from './agent-goal-run.js';

export const PRODUCTIVITY_OPERATIONS = Object.freeze({
  productivity_capabilities: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365', 'slack', 'microsoft_teams'] },
  calendar_list_events: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'] },
  calendar_find_slots: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'] },
  calendar_create_event: { family: 'communicate_external', tier: 'R2', providers: ['google_workspace', 'microsoft_365'] },
  calendar_update_event: { family: 'communicate_external', tier: 'R2', providers: ['google_workspace', 'microsoft_365'] },
  calendar_cancel_event: { family: 'communicate_external', tier: 'R2', providers: ['google_workspace', 'microsoft_365'] },
  file_search: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'] },
  file_get_metadata: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'] },
  document_create: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'] },
  document_read: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'] },
  document_update: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'] },
  document_comment: { family: 'communicate_external', tier: 'R2', providers: ['google_workspace', 'microsoft_365'] },
  document_export: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'] },
  spreadsheet_read: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'] },
  spreadsheet_write: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'] },
  spreadsheet_append: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'] },
  spreadsheet_set_formula: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'] },
  spreadsheet_export: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'] },
  message_search: { family: 'read', tier: 'R0', providers: ['slack', 'microsoft_teams'] },
  message_get_thread: { family: 'read', tier: 'R0', providers: ['slack', 'microsoft_teams'] },
  message_send: { family: 'communicate_external', tier: 'R2', providers: ['slack', 'microsoft_teams'] },
  message_reply: { family: 'communicate_external', tier: 'R2', providers: ['slack', 'microsoft_teams'] },
});

export const PRODUCTIVITY_PROVIDER_CATALOG = Object.freeze({
  google_workspace: {
    label: 'Google Workspace', apps: ['google_calendar', 'google_drive', 'google_docs', 'google_sheets'],
    scopes: ['calendar.readonly', 'calendar.events', 'drive.metadata.readonly', 'drive.file'],
  },
  microsoft_365: {
    label: 'Microsoft 365', apps: ['outlook_calendar', 'onedrive', 'sharepoint', 'word', 'excel'],
    scopes: ['Calendars.Read', 'Calendars.ReadWrite', 'Files.Read.All', 'Files.ReadWrite.All', 'Sites.Read.All'],
  },
  slack: { label: 'Slack', apps: ['slack'], scopes: ['search:read', 'channels:history', 'chat:write'] },
  microsoft_teams: { label: 'Microsoft Teams', apps: ['microsoft_teams'], scopes: ['ChannelMessage.Read.All', 'ChannelMessage.Send'] },
});

let ready = false;
function db() { return getDb(); }
function json(value, fallback = {}) { try { return JSON.parse(value || ''); } catch { return fallback; } }
function clip(value, max = 500) { const s = typeof value === 'string' ? value : JSON.stringify(value ?? null); return s.length > max ? `${s.slice(0, max)}…` : s; }
function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function now() { return new Date().toISOString(); }
function assertOwner(owner) { const value = String(owner || '').trim(); if (!value) throw Object.assign(new Error('Owner context required'), { status: 403 }); return value; }
function sanitizeEventValue(value, depth = 0) {
  if (depth > 8) return '[depth-limited]';
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => sanitizeEventValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 500)) {
      out[key] = /(^|_)(authorization|cookie|password|secret|token|api.?key|refresh.?token)($|_)/i.test(key)
        ? '[redacted]'
        : sanitizeEventValue(item, depth + 1);
    }
    return out;
  }
  return typeof value === 'string' ? clip(value, 20_000) : value;
}
function sanitizeEventPayload(value) {
  const safe = sanitizeEventValue(value && typeof value === 'object' ? value : { value });
  const encoded = JSON.stringify(safe);
  return encoded.length <= 64 * 1024 ? safe : { truncated: true, original_bytes: encoded.length, preview: encoded.slice(0, 60 * 1024) };
}

export function ensureEventProductivitySchema() {
  if (ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS productivity_event_subscriptions (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
      provider TEXT NOT NULL, connection_name TEXT DEFAULT '', event_type TEXT NOT NULL,
      filters_json TEXT NOT NULL DEFAULT '{}', target_type TEXT NOT NULL DEFAULT 'inbox',
      target_id TEXT, goal_prompt_template TEXT DEFAULT '', objective_id TEXT,
      key_result_ids_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
      secret_hash TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')), last_event_at TEXT, last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_productivity_subscriptions_owner ON productivity_event_subscriptions(owner_user_id, enabled);
    CREATE TABLE IF NOT EXISTS productivity_events (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
      provider TEXT NOT NULL, provider_event_id TEXT NOT NULL, event_type TEXT NOT NULL,
      subject_type TEXT DEFAULT '', subject_id TEXT DEFAULT '', correlation_key TEXT DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}', occurred_at TEXT, received_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT, processed_at TEXT, acknowledged_at TEXT, last_error TEXT,
      trigger_run_type TEXT, trigger_run_id TEXT, expires_at TEXT,
      UNIQUE(owner_user_id, provider, provider_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_productivity_events_owner_status ON productivity_events(owner_user_id, status, received_at DESC);
    CREATE TABLE IF NOT EXISTS productivity_action_bindings (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, operation TEXT NOT NULL,
      provider TEXT NOT NULL, app_id TEXT NOT NULL, action_id TEXT NOT NULL,
      connection_name TEXT DEFAULT '', input_template_json TEXT NOT NULL DEFAULT '{}',
      verify_action_id TEXT DEFAULT '', verify_input_template_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')), UNIQUE(owner_user_id, operation, provider)
    );
    CREATE TABLE IF NOT EXISTS productivity_action_receipts (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, binding_id TEXT NOT NULL,
      operation TEXT NOT NULL, provider TEXT NOT NULL, action_id TEXT NOT NULL,
      event_id TEXT, goal_run_id TEXT, workflow_run_id TEXT, idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL, request_summary_json TEXT NOT NULL DEFAULT '{}',
      response_summary_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL,
      external_resource_id TEXT, verification_status TEXT NOT NULL DEFAULT 'not_configured',
      error TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT, UNIQUE(owner_user_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_productivity_receipts_owner ON productivity_action_receipts(owner_user_id, created_at DESC);
  `);
  ready = true;
}

function subscriptionRow(row) {
  if (!row) return null;
  return { ...row, enabled: !!row.enabled, filters: json(row.filters_json), key_result_ids: json(row.key_result_ids_json, []) };
}
function eventRow(row) { return row ? { ...row, payload: json(row.payload_json) } : null; }
function bindingRow(row) { return row ? { ...row, enabled: !!row.enabled, input_template: json(row.input_template_json), verify_input_template: json(row.verify_input_template_json) } : null; }
function receiptRow(row) { return row ? { ...row, request_summary: json(row.request_summary_json), response_summary: json(row.response_summary_json) } : null; }

export function listProductivityCapabilities() {
  return { providers: PRODUCTIVITY_PROVIDER_CATALOG, operations: PRODUCTIVITY_OPERATIONS };
}

export async function getProductivitySummary(ownerUserId) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  const connected = await getConnectedConnectorApps(owner).catch(() => ({ apps: [], connected: [] }));
  const counts = db().prepare(`SELECT status, COUNT(*) count FROM productivity_events WHERE owner_user_id=? GROUP BY status`).all(owner);
  return {
    capabilities: listProductivityCapabilities(),
    connected_apps: (connected.apps || connected.connected || []).filter((app) => app?.connected !== false),
    subscriptions: db().prepare(`SELECT COUNT(*) count FROM productivity_event_subscriptions WHERE owner_user_id=?`).get(owner).count,
    events_by_status: Object.fromEntries(counts.map((r) => [r.status, r.count])),
  };
}

export function createEventSubscription(ownerUserId, input = {}) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  const targetType = String(input.target_type || 'inbox');
  if (!['inbox', 'workflow', 'goal'].includes(targetType)) throw Object.assign(new Error('target_type must be inbox, workflow, or goal'), { status: 400 });
  if (!String(input.name || '').trim() || !String(input.provider || '').trim() || !String(input.event_type || '').trim()) throw Object.assign(new Error('name, provider, and event_type are required'), { status: 400 });
  if (!PRODUCTIVITY_PROVIDER_CATALOG[String(input.provider).trim()]) throw Object.assign(new Error('Unsupported productivity provider'), { status: 400 });
  if (targetType !== 'inbox' && !String(input.target_id || '').trim() && targetType === 'workflow') throw Object.assign(new Error('target_id required for workflow target'), { status: 400 });
  const id = `eps-${randomUUID()}`;
  const secret = `eps_${randomBytes(32).toString('base64url')}`;
  db().prepare(`INSERT INTO productivity_event_subscriptions
    (id,owner_user_id,name,provider,connection_name,event_type,filters_json,target_type,target_id,goal_prompt_template,objective_id,key_result_ids_json,enabled,secret_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, owner, String(input.name).trim(), String(input.provider).trim(), String(input.connection_name || '').trim(),
      String(input.event_type).trim(), JSON.stringify(input.filters || {}), targetType, input.target_id || null,
      String(input.goal_prompt_template || '').trim(), input.objective_id || null, JSON.stringify(input.key_result_ids || []),
      input.enabled === false ? 0 : 1, hash(secret)
    );
  return { subscription: subscriptionRow(db().prepare(`SELECT * FROM productivity_event_subscriptions WHERE id=?`).get(id)), webhook_secret: secret };
}

export function listEventSubscriptions(ownerUserId) {
  ensureEventProductivitySchema();
  return db().prepare(`SELECT * FROM productivity_event_subscriptions WHERE owner_user_id=? ORDER BY created_at DESC`).all(assertOwner(ownerUserId)).map(subscriptionRow);
}

export function updateEventSubscription(ownerUserId, id, input = {}) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  const row = db().prepare(`SELECT * FROM productivity_event_subscriptions WHERE id=? AND owner_user_id=?`).get(id, owner);
  if (!row) throw Object.assign(new Error('Subscription not found'), { status: 404 });
  const merged = { ...subscriptionRow(row), ...input };
  const target = String(merged.target_type || 'inbox');
  if (!['inbox', 'workflow', 'goal'].includes(target)) throw Object.assign(new Error('Invalid target_type'), { status: 400 });
  db().prepare(`UPDATE productivity_event_subscriptions SET name=?,provider=?,connection_name=?,event_type=?,filters_json=?,target_type=?,target_id=?,goal_prompt_template=?,objective_id=?,key_result_ids_json=?,enabled=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(
    merged.name, merged.provider, merged.connection_name || '', merged.event_type, JSON.stringify(merged.filters || {}), target,
    merged.target_id || null, merged.goal_prompt_template || '', merged.objective_id || null, JSON.stringify(merged.key_result_ids || []), merged.enabled === false ? 0 : 1, id, owner
  );
  return subscriptionRow(db().prepare(`SELECT * FROM productivity_event_subscriptions WHERE id=?`).get(id));
}

export function deleteEventSubscription(ownerUserId, id) {
  ensureEventProductivitySchema();
  const info = db().prepare(`DELETE FROM productivity_event_subscriptions WHERE id=? AND owner_user_id=?`).run(id, assertOwner(ownerUserId));
  if (!info.changes) throw Object.assign(new Error('Subscription not found'), { status: 404 });
  return { deleted: true, id };
}

export function rotateEventSubscriptionSecret(ownerUserId, id) {
  ensureEventProductivitySchema();
  const secret = `eps_${randomBytes(32).toString('base64url')}`;
  const info = db().prepare(`UPDATE productivity_event_subscriptions SET secret_hash=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(hash(secret), id, assertOwner(ownerUserId));
  if (!info.changes) throw Object.assign(new Error('Subscription not found'), { status: 404 });
  return { id, webhook_secret: secret };
}

function secretsMatch(provided, expectedHash) {
  const a = Buffer.from(hash(String(provided || '')));
  const b = Buffer.from(String(expectedHash || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function filterMatches(filters, envelope) {
  return Object.entries(filters || {}).every(([key, expected]) => {
    const actual = key.split('.').reduce((value, part) => value && value[part], envelope);
    return Array.isArray(expected) ? expected.map(String).includes(String(actual)) : String(actual ?? '') === String(expected ?? '');
  });
}

export async function ingestProductivityEvent(subscriptionId, providedSecret, input = {}, deps = {}) {
  ensureEventProductivitySchema();
  const sub = db().prepare(`SELECT * FROM productivity_event_subscriptions WHERE id=?`).get(subscriptionId);
  if (!sub || !sub.enabled) throw Object.assign(new Error('Subscription not found or disabled'), { status: 404 });
  if (!secretsMatch(providedSecret, sub.secret_hash)) throw Object.assign(new Error('Invalid webhook secret'), { status: 401 });
  const envelope = {
    event_type: String(input.event_type || sub.event_type), subject_type: String(input.subject_type || ''),
    subject_id: String(input.subject_id || ''), correlation_key: String(input.correlation_key || ''),
    occurred_at: input.occurred_at || now(), payload: sanitizeEventPayload(input.payload && typeof input.payload === 'object' ? input.payload : input),
  };
  if (envelope.event_type !== sub.event_type || !filterMatches(json(sub.filters_json), envelope)) return { accepted: false, ignored: true, reason: 'event_filter_mismatch' };
  const providerEventId = String(input.provider_event_id || '').trim() || hash(JSON.stringify(stable({ subscriptionId, ...envelope })));
  const id = `epe-${randomUUID()}`;
  const inserted = db().prepare(`INSERT OR IGNORE INTO productivity_events
    (id,owner_user_id,subscription_id,provider,provider_event_id,event_type,subject_type,subject_id,correlation_key,payload_json,occurred_at,received_at,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`).run(id, sub.owner_user_id, sub.id, sub.provider, providerEventId, envelope.event_type, envelope.subject_type, envelope.subject_id, envelope.correlation_key, JSON.stringify(envelope.payload), envelope.occurred_at, now());
  db().prepare(`UPDATE productivity_event_subscriptions SET last_event_at=datetime('now'),last_error=NULL WHERE id=?`).run(sub.id);
  if (!inserted.changes) {
    const existing = db().prepare(`SELECT * FROM productivity_events WHERE owner_user_id=? AND provider=? AND provider_event_id=?`).get(sub.owner_user_id, sub.provider, providerEventId);
    return { accepted: true, duplicate: true, event: eventRow(existing) };
  }
  const event = eventRow(db().prepare(`SELECT * FROM productivity_events WHERE id=?`).get(id));
  const processed = await processProductivityEvent(sub.owner_user_id, id, deps);
  return { accepted: true, duplicate: false, event: processed || event };
}

export async function processProductivityEvent(ownerUserId, eventId, deps = {}) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  const event = db().prepare(`SELECT * FROM productivity_events WHERE id=? AND owner_user_id=?`).get(eventId, owner);
  if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });
  const sub = db().prepare(`SELECT * FROM productivity_event_subscriptions WHERE id=? AND owner_user_id=?`).get(event.subscription_id, owner);
  if (!sub) throw Object.assign(new Error('Subscription not found'), { status: 404 });
  db().prepare(`UPDATE productivity_events SET status='processing',attempts=attempts+1,last_error=NULL WHERE id=?`).run(eventId);
  try {
    let runType = null;
    let runId = null;
    const normalized = { id: event.id, provider: event.provider, event_type: event.event_type, subject_type: event.subject_type, subject_id: event.subject_id, correlation_key: event.correlation_key, occurred_at: event.occurred_at, payload: json(event.payload_json) };
    if (sub.target_type === 'workflow') {
      const workflow = db().prepare(`SELECT owner_user_id FROM agent_workflow_definitions WHERE id=?`).get(sub.target_id);
      if (!workflow || workflow.owner_user_id !== owner) throw Object.assign(new Error('Workflow target is not owned by this company'), { status: 403 });
      const result = await (deps.triggerWorkflow || triggerWorkflowFromHook)(sub.target_id, normalized, { actor: { id: 'event-productivity', name: 'Event & Productivity', type: 'system' } });
      runType = 'workflow'; runId = result?.id || result?.run?.id || result?.run_id || null;
    } else if (sub.target_type === 'goal') {
      const prompt = String(sub.goal_prompt_template || `Handle ${event.event_type} event from ${event.provider}.`).replaceAll('{{event_id}}', event.id).replaceAll('{{event_type}}', event.event_type);
      const result = await (deps.createGoal || createAndStartGoalRun)({ ownerUserId: owner, agentId: sub.target_id || 'balserve', title: `Event: ${event.event_type}`, prompt, source: 'productivity_event', context: { productivity_event: normalized, objective_id: sub.objective_id, key_result_ids: json(sub.key_result_ids_json, []) }, backgroundPlanning: true });
      runType = 'goal'; runId = result?.goal_run_id || result?.id || null;
    }
    db().prepare(`UPDATE productivity_events SET status='completed',processed_at=datetime('now'),trigger_run_type=?,trigger_run_id=?,next_retry_at=NULL WHERE id=?`).run(runType, runId, eventId);
  } catch (error) {
    const attempts = Number(event.attempts || 0) + 1;
    const terminal = attempts >= 5;
    const retryAt = new Date(Date.now() + Math.min(300, 2 ** attempts * 5) * 1000).toISOString();
    db().prepare(`UPDATE productivity_events SET status=?,last_error=?,next_retry_at=? WHERE id=?`).run(terminal ? 'dead_letter' : 'failed', clip(error.message), terminal ? null : retryAt, eventId);
    db().prepare(`UPDATE productivity_event_subscriptions SET last_error=? WHERE id=?`).run(clip(error.message), sub.id);
    if (!deps.suppressThrow) throw error;
  }
  return eventRow(db().prepare(`SELECT * FROM productivity_events WHERE id=?`).get(eventId));
}

export async function processDueProductivityEvents({ limit = 25 } = {}) {
  ensureEventProductivitySchema();
  const rows = db().prepare(`SELECT id,owner_user_id FROM productivity_events WHERE status='failed' AND next_retry_at IS NOT NULL AND datetime(next_retry_at)<=datetime('now') ORDER BY received_at LIMIT ?`).all(Math.max(1, Math.min(100, Number(limit) || 25)));
  const results = [];
  for (const row of rows) results.push(await processProductivityEvent(row.owner_user_id, row.id, { suppressThrow: true }));
  return { processed: results.length, results };
}

export function listProductivityEvents(ownerUserId, { status = '', limit = 100 } = {}) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  const n = Math.max(1, Math.min(250, Number(limit) || 100));
  const rows = status ? db().prepare(`SELECT * FROM productivity_events WHERE owner_user_id=? AND status=? ORDER BY received_at DESC LIMIT ?`).all(owner, status, n) : db().prepare(`SELECT * FROM productivity_events WHERE owner_user_id=? ORDER BY received_at DESC LIMIT ?`).all(owner, n);
  return rows.map(eventRow);
}

export function getProductivityEvent(ownerUserId, id) {
  ensureEventProductivitySchema();
  const row = db().prepare(`SELECT * FROM productivity_events WHERE id=? AND owner_user_id=?`).get(id, assertOwner(ownerUserId));
  if (!row) throw Object.assign(new Error('Event not found'), { status: 404 });
  return eventRow(row);
}

export function acknowledgeProductivityEvent(ownerUserId, id) {
  getProductivityEvent(ownerUserId, id);
  db().prepare(`UPDATE productivity_events SET acknowledged_at=datetime('now'),status=CASE WHEN status='dead_letter' THEN 'acknowledged' ELSE status END WHERE id=? AND owner_user_id=?`).run(id, assertOwner(ownerUserId));
  return getProductivityEvent(ownerUserId, id);
}

export function listProductivityBindings(ownerUserId) {
  ensureEventProductivitySchema();
  return db().prepare(`SELECT * FROM productivity_action_bindings WHERE owner_user_id=? ORDER BY operation,provider`).all(assertOwner(ownerUserId)).map(bindingRow);
}

export function upsertProductivityBinding(ownerUserId, input = {}) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  const operation = String(input.operation || '').trim();
  const provider = String(input.provider || '').trim();
  if (!PRODUCTIVITY_OPERATIONS[operation] || operation === 'productivity_capabilities') throw Object.assign(new Error('Unsupported productivity operation'), { status: 400 });
  if (!PRODUCTIVITY_OPERATIONS[operation].providers.includes(provider)) throw Object.assign(new Error('Provider does not support this operation'), { status: 400 });
  if (!String(input.action_id || '').trim() || !String(input.app_id || '').trim()) throw Object.assign(new Error('app_id and action_id are required'), { status: 400 });
  const existing = db().prepare(`SELECT id FROM productivity_action_bindings WHERE owner_user_id=? AND operation=? AND provider=?`).get(owner, operation, provider);
  const id = existing?.id || `epb-${randomUUID()}`;
  db().prepare(`INSERT INTO productivity_action_bindings
    (id,owner_user_id,operation,provider,app_id,action_id,connection_name,input_template_json,verify_action_id,verify_input_template_json,enabled)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,operation,provider) DO UPDATE SET app_id=excluded.app_id,action_id=excluded.action_id,connection_name=excluded.connection_name,input_template_json=excluded.input_template_json,verify_action_id=excluded.verify_action_id,verify_input_template_json=excluded.verify_input_template_json,enabled=excluded.enabled,updated_at=datetime('now')`).run(
      id, owner, operation, provider, String(input.app_id).trim(), String(input.action_id).trim(), String(input.connection_name || '').trim(), JSON.stringify(input.input_template || {}), String(input.verify_action_id || '').trim(), JSON.stringify(input.verify_input_template || {}), input.enabled === false ? 0 : 1
    );
  return bindingRow(db().prepare(`SELECT * FROM productivity_action_bindings WHERE owner_user_id=? AND operation=? AND provider=?`).get(owner, operation, provider));
}

export function deleteProductivityBinding(ownerUserId, id) {
  ensureEventProductivitySchema();
  const info = db().prepare(`DELETE FROM productivity_action_bindings WHERE id=? AND owner_user_id=?`).run(id, assertOwner(ownerUserId));
  if (!info.changes) throw Object.assign(new Error('Binding not found'), { status: 404 });
  return { deleted: true, id };
}

function applyTemplate(template, input) { return { ...(template || {}), ...(input || {}) }; }
function externalId(data) { const value = data?.data || data; return value?.id || value?.eventId || value?.event_id || value?.fileId || value?.file_id || value?.messageId || value?.message_id || null; }

export async function executeProductivityOperation(ownerUserId, operation, input = {}, deps = {}) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  if (operation === 'productivity_capabilities') return getProductivitySummary(owner);
  const spec = PRODUCTIVITY_OPERATIONS[operation];
  if (!spec) throw Object.assign(new Error('Unsupported productivity operation'), { status: 400 });
  const provider = String(input.provider || '').trim();
  const binding = db().prepare(`SELECT * FROM productivity_action_bindings WHERE owner_user_id=? AND operation=? AND provider=? AND enabled=1`).get(owner, operation, provider);
  if (!binding) throw Object.assign(new Error(`No enabled binding for ${operation} on ${provider}`), { status: 409, code: 'PRODUCTIVITY_BINDING_REQUIRED' });
  const actionInput = applyTemplate(json(binding.input_template_json), input.input || input.parameters || {});
  const requestHash = hash(JSON.stringify(stable(actionInput)));
  const contextKey = String(input.event_id || input.goal_run_id || input.workflow_run_id || '').trim();
  const idempotencyKey = String(input.idempotency_key || '').trim() || (contextKey
    ? hash(JSON.stringify([operation, provider, requestHash, input.event_id || '', input.goal_run_id || '', input.workflow_run_id || '']))
    : `ephemeral-${randomUUID()}`);
  const existing = db().prepare(`SELECT * FROM productivity_action_receipts WHERE owner_user_id=? AND idempotency_key=?`).get(owner, idempotencyKey);
  if (existing) return { duplicate: true, receipt: receiptRow(existing) };
  const receiptId = `epr-${randomUUID()}`;
  db().prepare(`INSERT INTO productivity_action_receipts
    (id,owner_user_id,binding_id,operation,provider,action_id,event_id,goal_run_id,workflow_run_id,idempotency_key,request_hash,request_summary_json,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'running')`).run(receiptId, owner, binding.id, operation, provider, binding.action_id, input.event_id || null, input.goal_run_id || null, input.workflow_run_id || null, idempotencyKey, requestHash, JSON.stringify({ keys: Object.keys(actionInput), bytes: JSON.stringify(actionInput).length }));
  try {
    const execute = deps.executeAction || executeConnectorAction;
    const result = await execute(owner, binding.action_id, actionInput, { connectionName: binding.connection_name });
    let verificationStatus = 'not_configured';
    let verify = null;
    if (binding.verify_action_id) {
      const verifyInput = applyTemplate(json(binding.verify_input_template_json), { ...actionInput, external_resource_id: externalId(result) });
      verify = await execute(owner, binding.verify_action_id, verifyInput, { connectionName: binding.connection_name });
      verificationStatus = verify?.ok === false ? 'failed' : 'verified';
    }
    const resourceId = externalId(result);
    db().prepare(`UPDATE productivity_action_receipts SET status='completed',external_resource_id=?,verification_status=?,response_summary_json=?,completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).run(resourceId, verificationStatus, JSON.stringify({ ok: result?.ok !== false, transport: result?.transport || null, external_resource_id: resourceId, verification_ok: verify ? verify?.ok !== false : null }), receiptId);
    return { duplicate: false, result, verification: verify, receipt: receiptRow(db().prepare(`SELECT * FROM productivity_action_receipts WHERE id=?`).get(receiptId)) };
  } catch (error) {
    db().prepare(`UPDATE productivity_action_receipts SET status='failed',error=?,updated_at=datetime('now') WHERE id=?`).run(clip(error.message), receiptId);
    throw error;
  }
}

export function listProductivityReceipts(ownerUserId, limit = 100) {
  ensureEventProductivitySchema();
  return db().prepare(`SELECT * FROM productivity_action_receipts WHERE owner_user_id=? ORDER BY created_at DESC LIMIT ?`).all(assertOwner(ownerUserId), Math.max(1, Math.min(250, Number(limit) || 100))).map(receiptRow);
}

export function resetEventProductivitySchemaForTests() { ready = false; }
