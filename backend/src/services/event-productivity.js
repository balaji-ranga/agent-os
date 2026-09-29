import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { getDb } from '../db/schema.js';
import { parsePublicHttpsUrl } from '../lib/ssrf.js';
import { executeConnectorAction, getConnectedConnectorApps } from './openconnector.js';
import { triggerWorkflowFromHook } from './agent-workflow-webhooks.js';
import { createAndStartGoalRun } from './agent-goal-run.js';

const CALENDAR_APPS = ['google_calendar', 'outlook_calendar'];
const EMAIL_APPS = ['gmail', 'outlook'];
const FILE_APPS = ['google_drive', 'onedrive', 'sharepoint'];
const DOCUMENT_APPS = ['google_docs', 'google_drive', 'word', 'onedrive', 'sharepoint'];
const SPREADSHEET_APPS = ['google_sheets', 'google_drive', 'excel', 'onedrive', 'sharepoint'];
const MESSAGE_APPS = ['slack', 'microsoft_teams'];

export const PRODUCTIVITY_OPERATIONS = Object.freeze({
  productivity_capabilities: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365', 'slack', 'microsoft_teams'], apps: [] },
  email_list_messages: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'], apps: EMAIL_APPS },
  calendar_list_events: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'], apps: CALENDAR_APPS },
  calendar_find_slots: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'], apps: CALENDAR_APPS },
  calendar_create_event: { family: 'communicate_external', tier: 'R2', providers: ['google_workspace', 'microsoft_365'], apps: CALENDAR_APPS },
  calendar_update_event: { family: 'communicate_external', tier: 'R2', providers: ['google_workspace', 'microsoft_365'], apps: CALENDAR_APPS },
  calendar_cancel_event: { family: 'communicate_external', tier: 'R2', providers: ['google_workspace', 'microsoft_365'], apps: CALENDAR_APPS },
  file_search: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'], apps: FILE_APPS },
  file_get_metadata: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'], apps: FILE_APPS },
  document_create: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'], apps: DOCUMENT_APPS },
  document_read: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'], apps: DOCUMENT_APPS },
  document_update: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'], apps: DOCUMENT_APPS },
  document_comment: { family: 'communicate_external', tier: 'R2', providers: ['google_workspace', 'microsoft_365'], apps: DOCUMENT_APPS },
  document_export: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'], apps: DOCUMENT_APPS },
  spreadsheet_read: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'], apps: SPREADSHEET_APPS },
  spreadsheet_write: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'], apps: SPREADSHEET_APPS },
  spreadsheet_append: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'], apps: SPREADSHEET_APPS },
  spreadsheet_set_formula: { family: 'write_internal', tier: 'R1', providers: ['google_workspace', 'microsoft_365'], apps: SPREADSHEET_APPS },
  spreadsheet_export: { family: 'read', tier: 'R0', providers: ['google_workspace', 'microsoft_365'], apps: SPREADSHEET_APPS },
  message_search: { family: 'read', tier: 'R0', providers: ['slack', 'microsoft_teams'], apps: MESSAGE_APPS },
  message_get_thread: { family: 'read', tier: 'R0', providers: ['slack', 'microsoft_teams'], apps: MESSAGE_APPS },
  message_send: { family: 'communicate_external', tier: 'R2', providers: ['slack', 'microsoft_teams'], apps: MESSAGE_APPS },
  message_reply: { family: 'communicate_external', tier: 'R2', providers: ['slack', 'microsoft_teams'], apps: MESSAGE_APPS },
});

export const PRODUCTIVITY_PROVIDER_CATALOG = Object.freeze({
  calendar_url: {
    label: 'Published calendar URL (ICS)', apps: [], scopes: [], read_only: true,
  },
  google_workspace: {
    label: 'Google Workspace', apps: ['gmail', 'google_calendar', 'google_drive', 'google_docs', 'google_sheets'],
    scopes: ['gmail.readonly', 'gmail.send', 'calendar.readonly', 'calendar.events', 'drive.metadata.readonly', 'drive.file'],
  },
  microsoft_365: {
    label: 'Microsoft 365', apps: ['outlook', 'outlook_calendar', 'onedrive', 'sharepoint', 'word', 'excel'],
    scopes: ['Mail.Read', 'Mail.Send', 'Calendars.Read', 'Calendars.ReadWrite', 'Files.Read.All', 'Files.ReadWrite.All', 'Sites.Read.All'],
  },
  slack: { label: 'Slack', apps: ['slack'], scopes: ['search:read', 'channels:history', 'chat:write'] },
  microsoft_teams: { label: 'Microsoft Teams', apps: ['microsoft_teams'], scopes: ['ChannelMessage.Read.All', 'ChannelMessage.Send'] },
});

export const PRODUCTIVITY_EVENT_TYPES = Object.freeze({
  calendar_url: Object.freeze([
    { id: 'calendar.event.created', label: 'Calendar event created' },
    { id: 'calendar.event.changed', label: 'Calendar event changed' },
    { id: 'calendar.event.cancelled', label: 'Calendar event cancelled' },
  ]),
  google_workspace: Object.freeze([
    { id: 'email.message.received', label: 'Email message received' },
    { id: 'calendar.event.created', label: 'Calendar event created' },
    { id: 'calendar.event.changed', label: 'Calendar event changed' },
    { id: 'calendar.event.cancelled', label: 'Calendar event cancelled' },
    { id: 'file.created', label: 'File created' },
    { id: 'file.changed', label: 'File changed' },
    { id: 'file.deleted', label: 'File deleted' },
  ]),
  microsoft_365: Object.freeze([
    { id: 'email.message.received', label: 'Email message received' },
    { id: 'calendar.event.created', label: 'Calendar event created' },
    { id: 'calendar.event.changed', label: 'Calendar event changed' },
    { id: 'calendar.event.cancelled', label: 'Calendar event cancelled' },
    { id: 'file.created', label: 'File created' },
    { id: 'file.changed', label: 'File changed' },
    { id: 'file.deleted', label: 'File deleted' },
  ]),
  slack: Object.freeze([
    { id: 'message.created', label: 'Message created' },
    { id: 'message.updated', label: 'Message updated' },
    { id: 'message.flagged', label: 'Message flagged' },
    { id: 'reaction.added', label: 'Reaction added' },
  ]),
  microsoft_teams: Object.freeze([
    { id: 'message.created', label: 'Message created' },
    { id: 'message.updated', label: 'Message updated' },
    { id: 'message.flagged', label: 'Message flagged' },
    { id: 'reaction.added', label: 'Reaction added' },
  ]),
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
const CALENDAR_URL_ENCRYPTION_PREFIX = 'enc:calendar-url:v1:';
function calendarUrlKey() {
  const value = String(process.env.USER_API_KEYS_KEK || '').trim();
  if (!value) throw Object.assign(new Error('Calendar URL encryption requires USER_API_KEYS_KEK'), { status: 503 });
  return createHash('sha256').update(value, 'utf8').digest();
}
function normalizeCalendarSourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw Object.assign(new Error('A published calendar ICS URL is required'), { status: 400 });
  const normalized = raw.replace(/^webcal:\/\//i, 'https://');
  let parsed;
  try { parsed = new URL(normalized); } catch { throw Object.assign(new Error('Enter a valid published calendar ICS URL'), { status: 400 }); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw Object.assign(new Error('Published calendar URLs must use HTTPS'), { status: 400 });
  }
  if (parsed.hostname === 'calendar.google.com' && /^\/calendar\/u\//.test(parsed.pathname) && parsed.searchParams.has('cid')) {
    throw Object.assign(new Error('This is a Google Calendar viewing link. In Google Calendar settings, copy the Secret address in iCal format or Public address in iCal format.'), { status: 400 });
  }
  parsePublicHttpsUrl(parsed.toString());
  return parsed.toString();
}
function encryptCalendarSourceUrl(owner, subscriptionId, value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', calendarUrlKey(), iv);
  cipher.setAAD(Buffer.from(`${owner}:${subscriptionId}`, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(normalizeCalendarSourceUrl(value), 'utf8'), cipher.final()]);
  return CALENDAR_URL_ENCRYPTION_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function resolveCalendarSubscriptionUrl(row) {
  const stored = String(row?.source_url_encrypted || '');
  if (!stored.startsWith(CALENDAR_URL_ENCRYPTION_PREFIX)) throw Object.assign(new Error('Published calendar URL is not configured'), { status: 409 });
  const packed = Buffer.from(stored.slice(CALENDAR_URL_ENCRYPTION_PREFIX.length), 'base64');
  if (packed.length < 29) throw new Error('Published calendar URL is invalid');
  const decipher = createDecipheriv('aes-256-gcm', calendarUrlKey(), packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${row.owner_user_id}:${row.id}`, 'utf8'));
  decipher.setAuthTag(packed.subarray(12, 28));
  return decipher.update(packed.subarray(28), undefined, 'utf8') + decipher.final('utf8');
}
function assertOwner(owner) { const value = String(owner || '').trim(); if (!value) throw Object.assign(new Error('Owner context required'), { status: 403 }); return value; }
function assertSupportedEventType(provider, eventType) {
  const providerId = String(provider || '').trim();
  const eventTypeId = String(eventType || '').trim();
  if (!PRODUCTIVITY_PROVIDER_CATALOG[providerId]) throw Object.assign(new Error('Unsupported productivity provider'), { status: 400 });
  if (!(PRODUCTIVITY_EVENT_TYPES[providerId] || []).some((event) => event.id === eventTypeId)) {
    throw Object.assign(new Error(`Unsupported event_type "${eventTypeId}" for provider "${providerId}"`), { status: 400 });
  }
  return { providerId, eventTypeId };
}
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
      UNIQUE(owner_user_id, subscription_id, provider_event_id)
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
  const subscriptionColumns = new Set(db().prepare('PRAGMA table_info(productivity_event_subscriptions)').all().map((column) => column.name));
  const listenerColumns = {
    listener_enabled: 'INTEGER NOT NULL DEFAULT 0',
    listener_status: "TEXT NOT NULL DEFAULT 'disabled'",
    listener_poll_seconds: 'INTEGER NOT NULL DEFAULT 300',
    listener_next_poll_at: 'TEXT',
    listener_last_check_at: 'TEXT',
    listener_last_success_at: 'TEXT',
    listener_last_error: 'TEXT',
    listener_cursor_json: "TEXT NOT NULL DEFAULT '{}'",
    listener_duplicate_count: 'INTEGER NOT NULL DEFAULT 0',
    dedupe_mode: "TEXT NOT NULL DEFAULT 'provider_object_id'",
    source_disposition: "TEXT NOT NULL DEFAULT 'retain'",
    source_url_encrypted: "TEXT NOT NULL DEFAULT ''",
  };
  for (const [column, definition] of Object.entries(listenerColumns)) {
    if (!subscriptionColumns.has(column)) db().exec(`ALTER TABLE productivity_event_subscriptions ADD COLUMN ${column} ${definition}`);
  }
  const eventsTableSql = String(db().prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='productivity_events'`).get()?.sql || '').replace(/\s+/g, '').toLowerCase();
  if (eventsTableSql.includes('unique(owner_user_id,provider,provider_event_id)')) {
    db().transaction(() => {
      db().exec(`
        ALTER TABLE productivity_events RENAME TO productivity_events_legacy_unique;
        CREATE TABLE productivity_events (
          id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, subscription_id TEXT NOT NULL,
          provider TEXT NOT NULL, provider_event_id TEXT NOT NULL, event_type TEXT NOT NULL,
          subject_type TEXT DEFAULT '', subject_id TEXT DEFAULT '', correlation_key TEXT DEFAULT '',
          payload_json TEXT NOT NULL DEFAULT '{}', occurred_at TEXT, received_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at TEXT, processed_at TEXT, acknowledged_at TEXT, last_error TEXT,
          trigger_run_type TEXT, trigger_run_id TEXT, expires_at TEXT,
          UNIQUE(owner_user_id, subscription_id, provider_event_id)
        );
        INSERT INTO productivity_events
          (id,owner_user_id,subscription_id,provider,provider_event_id,event_type,subject_type,subject_id,correlation_key,payload_json,occurred_at,received_at,status,attempts,next_retry_at,processed_at,acknowledged_at,last_error,trigger_run_type,trigger_run_id,expires_at)
        SELECT id,owner_user_id,subscription_id,provider,provider_event_id,event_type,subject_type,subject_id,correlation_key,payload_json,occurred_at,received_at,status,attempts,next_retry_at,processed_at,acknowledged_at,last_error,trigger_run_type,trigger_run_id,expires_at
        FROM productivity_events_legacy_unique;
        DROP TABLE productivity_events_legacy_unique;
        CREATE INDEX idx_productivity_events_owner_status ON productivity_events(owner_user_id, status, received_at DESC);
      `);
    })();
  }
  db().exec(`CREATE INDEX IF NOT EXISTS idx_productivity_subscriptions_listener
    ON productivity_event_subscriptions(listener_enabled, listener_next_poll_at)`);
  ready = true;
}

function subscriptionRow(row) {
  if (!row) return null;
  const pollSeconds = Math.max(60, Number(row.listener_poll_seconds) || 300);
  const lastSuccessMs = Date.parse(row.listener_last_success_at || '');
  const listenerFresh = Number.isFinite(lastSuccessMs) && Date.now() - lastSuccessMs <= Math.max(pollSeconds * 3, 300) * 1000;
  const { source_url_encrypted, ...safeRow } = row;
  let sourceUrlHost = '';
  if (source_url_encrypted) {
    try { sourceUrlHost = new URL(resolveCalendarSubscriptionUrl(row)).hostname; } catch { sourceUrlHost = 'configured'; }
  }
  return {
    ...safeRow,
    source_url_configured: !!source_url_encrypted,
    source_url_host: sourceUrlHost,
    enabled: !!row.enabled,
    listener_enabled: !!row.listener_enabled,
    listener_active: !!row.listener_enabled && row.listener_status === 'active' && listenerFresh,
    listener_poll_seconds: pollSeconds,
    filters: json(row.filters_json),
    key_result_ids: json(row.key_result_ids_json, []),
  };
}
function eventRow(row) { return row ? { ...row, payload: json(row.payload_json) } : null; }
function bindingRow(row) { return row ? { ...row, enabled: !!row.enabled, input_template: json(row.input_template_json), verify_input_template: json(row.verify_input_template_json) } : null; }
function receiptRow(row) { return row ? { ...row, request_summary: json(row.request_summary_json), response_summary: json(row.response_summary_json) } : null; }

export function listProductivityCapabilities() {
  return { providers: PRODUCTIVITY_PROVIDER_CATALOG, event_types: PRODUCTIVITY_EVENT_TYPES, operations: PRODUCTIVITY_OPERATIONS };
}

function workflowSupportsEvents(triggerModes) {
  const modes = Array.isArray(triggerModes)
    ? triggerModes
    : String(triggerModes || '').split(',').map((value) => value.trim()).filter(Boolean);
  return modes.includes('event');
}

function assertSubscriptionTarget(ownerUserId, targetType, targetId) {
  const owner = assertOwner(ownerUserId);
  const id = String(targetId || '').trim();
  if (targetType === 'inbox') return null;
  if (!id) throw Object.assign(new Error(`${targetType === 'workflow' ? 'Workflow' : 'Goal orchestrator'} target is required`), { status: 400 });
  if (targetType === 'workflow') {
    const workflow = db().prepare(`SELECT id,owner_user_id,status,paused,trigger_modes FROM agent_workflow_definitions WHERE id=?`).get(id);
    if (!workflow || workflow.owner_user_id !== owner) throw Object.assign(new Error('Workflow target is not owned by this company'), { status: 403 });
    if (workflow.status !== 'published' || Number(workflow.paused) === 1 || !workflowSupportsEvents(workflow.trigger_modes)) {
      throw Object.assign(new Error('Workflow target must be published, active, and allow event triggers'), { status: 400 });
    }
    return id;
  }
  const agent = db().prepare(`SELECT a.id FROM agents a JOIN user_agents ua ON ua.agent_id=a.id WHERE a.id=? AND ua.user_id=? AND ua.enabled=1`).get(id, owner);
  if (!agent) throw Object.assign(new Error('Goal orchestrator is not enabled for this company'), { status: 403 });
  return id;
}

function eventPathValue(event, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length || parts[0] !== 'event' || parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part))) return undefined;
  return parts.slice(1).reduce((value, part) => value != null && typeof value === 'object' ? value[part] : undefined, event);
}

export function renderProductivityEventPrompt(template, event) {
  const source = String(template || `Handle {{event.event_type}} from {{event.provider}}. Review the complete structured event in context.productivity_event and report the outcome with evidence.`);
  const legacy = source.replaceAll('{{event_id}}', String(event?.id || '')).replaceAll('{{event_type}}', String(event?.event_type || ''));
  return legacy.replace(/\{\{\s*(event(?:\.[A-Za-z0-9_]+)+)\s*\}\}/g, (_match, path) => {
    const value = eventPathValue(event, path);
    if (value == null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
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
  const { providerId, eventTypeId } = assertSupportedEventType(input.provider, input.event_type);
  const targetId = assertSubscriptionTarget(owner, targetType, input.target_id);
  const id = `eps-${randomUUID()}`;
  const secret = `eps_${randomBytes(32).toString('base64url')}`;
  const listenerEnabled = input.listener_enabled === true;
  const pollSeconds = Math.max(60, Math.min(3600, Number(input.listener_poll_seconds) || 300));
  const dedupeMode = String(input.dedupe_mode || 'provider_object_id');
  if (dedupeMode !== 'provider_object_id') throw Object.assign(new Error('dedupe_mode must be provider_object_id'), { status: 400 });
  const sourceDisposition = String(input.source_disposition || 'retain');
  if (!['retain', 'trash'].includes(sourceDisposition)) throw Object.assign(new Error('source_disposition must be retain or trash'), { status: 400 });
  if (sourceDisposition === 'trash' && !(providerId === 'google_workspace' && eventTypeId === 'email.message.received')) {
    throw Object.assign(new Error('Move source to Trash is supported only for Gmail message events'), { status: 400 });
  }
  const listenerCursor = listenerEnabled ? { enabled_at: now() } : {};
  const sourceUrlEncrypted = providerId === 'calendar_url' ? encryptCalendarSourceUrl(owner, id, input.source_url) : '';
  db().prepare(`INSERT INTO productivity_event_subscriptions
    (id,owner_user_id,name,provider,connection_name,event_type,filters_json,target_type,target_id,goal_prompt_template,objective_id,key_result_ids_json,enabled,secret_hash,
     listener_enabled,listener_status,listener_poll_seconds,listener_next_poll_at,listener_cursor_json,dedupe_mode,source_disposition,source_url_encrypted)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, owner, String(input.name).trim(), providerId, String(input.connection_name || '').trim(),
      eventTypeId, JSON.stringify(input.filters || {}), targetType, targetId,
      String(input.goal_prompt_template || '').trim(), input.objective_id || null, JSON.stringify(input.key_result_ids || []),
      input.enabled === false ? 0 : 1, hash(secret), listenerEnabled ? 1 : 0, listenerEnabled ? 'starting' : 'disabled',
      pollSeconds, listenerEnabled ? now() : null, JSON.stringify(listenerCursor), dedupeMode, sourceDisposition, sourceUrlEncrypted
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
  if (!String(merged.name || '').trim()) throw Object.assign(new Error('name is required'), { status: 400 });
  const { providerId, eventTypeId } = assertSupportedEventType(merged.provider, merged.event_type);
  const targetId = assertSubscriptionTarget(owner, target, merged.target_id);
  const listenerEnabled = merged.listener_enabled === true;
  const listenerWasEnabled = !!row.listener_enabled;
  const pollSeconds = Math.max(60, Math.min(3600, Number(merged.listener_poll_seconds) || 300));
  const dedupeMode = String(merged.dedupe_mode || 'provider_object_id');
  if (dedupeMode !== 'provider_object_id') throw Object.assign(new Error('dedupe_mode must be provider_object_id'), { status: 400 });
  const sourceDisposition = String(merged.source_disposition || 'retain');
  if (!['retain', 'trash'].includes(sourceDisposition)) throw Object.assign(new Error('source_disposition must be retain or trash'), { status: 400 });
  if (sourceDisposition === 'trash' && !(providerId === 'google_workspace' && eventTypeId === 'email.message.received')) {
    throw Object.assign(new Error('Move source to Trash is supported only for Gmail message events'), { status: 400 });
  }
  const listenerStatus = listenerEnabled ? (listenerWasEnabled ? row.listener_status || 'starting' : 'starting') : 'disabled';
  const listenerNextPollAt = listenerEnabled ? (!listenerWasEnabled ? now() : row.listener_next_poll_at || now()) : null;
  const listenerCursor = listenerEnabled && !listenerWasEnabled ? { enabled_at: now() } : json(row.listener_cursor_json);
  const sourceUrlEncrypted = providerId === 'calendar_url'
    ? (String(input.source_url || '').trim() ? encryptCalendarSourceUrl(owner, id, input.source_url) : row.source_url_encrypted)
    : '';
  if (providerId === 'calendar_url' && !sourceUrlEncrypted) throw Object.assign(new Error('A published calendar ICS URL is required'), { status: 400 });
  db().prepare(`UPDATE productivity_event_subscriptions SET name=?,provider=?,connection_name=?,event_type=?,filters_json=?,target_type=?,target_id=?,goal_prompt_template=?,objective_id=?,key_result_ids_json=?,enabled=?,
    listener_enabled=?,listener_status=?,listener_poll_seconds=?,listener_next_poll_at=?,listener_cursor_json=?,listener_last_error=?,dedupe_mode=?,source_disposition=?,source_url_encrypted=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(
    String(merged.name).trim(), providerId, merged.connection_name || '', eventTypeId, JSON.stringify(merged.filters || {}), target,
    targetId, merged.goal_prompt_template || '', merged.objective_id || null, JSON.stringify(merged.key_result_ids || []), merged.enabled === false ? 0 : 1,
    listenerEnabled ? 1 : 0, listenerStatus, pollSeconds, listenerNextPollAt, JSON.stringify(listenerCursor), listenerEnabled ? row.listener_last_error : null,
    dedupeMode, sourceDisposition, sourceUrlEncrypted, id, owner
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

async function ingestForSubscription(sub, input = {}, deps = {}) {
  const envelope = {
    event_type: String(input.event_type || sub.event_type), subject_type: String(input.subject_type || ''),
    subject_id: String(input.subject_id || ''), correlation_key: String(input.correlation_key || ''),
    occurred_at: input.occurred_at || now(), payload: sanitizeEventPayload(input.payload && typeof input.payload === 'object' ? input.payload : input),
  };
  if (envelope.event_type !== sub.event_type || !filterMatches(json(sub.filters_json), envelope)) return { accepted: false, ignored: true, reason: 'event_filter_mismatch' };
  const providerEventId = String(input.provider_event_id || '').trim() || hash(JSON.stringify(stable({ subscriptionId: sub.id, ...envelope })));
  const id = `epe-${randomUUID()}`;
  const inserted = db().prepare(`INSERT OR IGNORE INTO productivity_events
    (id,owner_user_id,subscription_id,provider,provider_event_id,event_type,subject_type,subject_id,correlation_key,payload_json,occurred_at,received_at,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending')`).run(id, sub.owner_user_id, sub.id, sub.provider, providerEventId, envelope.event_type, envelope.subject_type, envelope.subject_id, envelope.correlation_key, JSON.stringify(envelope.payload), envelope.occurred_at, now());
  db().prepare(`UPDATE productivity_event_subscriptions SET last_event_at=datetime('now'),last_error=NULL WHERE id=?`).run(sub.id);
  if (!inserted.changes) {
    const existing = db().prepare(`SELECT * FROM productivity_events WHERE owner_user_id=? AND subscription_id=? AND provider_event_id=?`).get(sub.owner_user_id, sub.id, providerEventId);
    return { accepted: true, duplicate: true, event: eventRow(existing) };
  }
  const event = eventRow(db().prepare(`SELECT * FROM productivity_events WHERE id=?`).get(id));
  const processed = await processProductivityEvent(sub.owner_user_id, id, deps);
  return { accepted: true, duplicate: false, event: processed || event };
}

export async function ingestProductivityEvent(subscriptionId, providedSecret, input = {}, deps = {}) {
  ensureEventProductivitySchema();
  const sub = db().prepare(`SELECT * FROM productivity_event_subscriptions WHERE id=?`).get(subscriptionId);
  if (!sub || !sub.enabled) throw Object.assign(new Error('Subscription not found or disabled'), { status: 404 });
  if (!secretsMatch(providedSecret, sub.secret_hash)) throw Object.assign(new Error('Invalid webhook secret'), { status: 401 });
  return ingestForSubscription(sub, input, deps);
}

/**
 * Trusted internal event ingestion for platform-owned adapters such as the
 * company Email channel poller. The caller must supply the authenticated CEO
 * owner; the subscription is still resolved and checked against that owner.
 * This deliberately does not accept an owner from provider payload data.
 */
export async function ingestTrustedProductivityEvent(ownerUserId, subscriptionId, input = {}, deps = {}) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  const sub = db().prepare(
    `SELECT * FROM productivity_event_subscriptions WHERE id=? AND owner_user_id=?`
  ).get(String(subscriptionId || '').trim(), owner);
  if (!sub || !sub.enabled) {
    throw Object.assign(new Error('Subscription not found or disabled for this company'), { status: 404 });
  }
  return ingestForSubscription(sub, input, deps);
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
      assertSubscriptionTarget(owner, 'workflow', sub.target_id);
      const result = await (deps.triggerWorkflow || triggerWorkflowFromHook)(sub.target_id, normalized, { actor: { id: 'event-productivity', name: 'Event & Productivity', type: 'system' } });
      runType = 'workflow'; runId = result?.id || result?.run?.id || result?.run_id || null;
    } else if (sub.target_type === 'goal') {
      const agentId = assertSubscriptionTarget(owner, 'goal', sub.target_id);
      const prompt = renderProductivityEventPrompt(sub.goal_prompt_template, normalized);
      const result = await (deps.createGoal || createAndStartGoalRun)({ ownerUserId: owner, agentId, title: `Event: ${event.event_type}`, prompt, source: 'productivity_event', context: { productivity_event: normalized, objective_id: sub.objective_id, key_result_ids: json(sub.key_result_ids_json, []) }, backgroundPlanning: true });
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

export function listProductivityEvents(ownerUserId, { status = '', subscription_id: subscriptionIdInput = '', limit = 100 } = {}) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  const n = Math.max(1, Math.min(250, Number(limit) || 100));
  const subscriptionId = String(subscriptionIdInput || '').trim();
  const clauses = ['owner_user_id=?'];
  const params = [owner];
  if (status) { clauses.push('status=?'); params.push(status); }
  if (subscriptionId) { clauses.push('subscription_id=?'); params.push(subscriptionId); }
  const rows = db().prepare(`SELECT * FROM productivity_events WHERE ${clauses.join(' AND ')} ORDER BY received_at DESC LIMIT ?`).all(...params, n);
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

function assertProductivityBindingCompatibility(operation, provider, appId, actionId, verifyActionId = '') {
  const spec = PRODUCTIVITY_OPERATIONS[operation];
  if (!spec || operation === 'productivity_capabilities') throw Object.assign(new Error('Unsupported productivity operation'), { status: 400 });
  if (!spec.providers.includes(provider)) throw Object.assign(new Error('Provider does not support this operation'), { status: 400 });
  if (!(PRODUCTIVITY_PROVIDER_CATALOG[provider]?.apps || []).includes(appId) || !(spec.apps || []).includes(appId)) {
    throw Object.assign(new Error(`App "${appId}" does not support ${operation}`), { status: 400, code: 'PRODUCTIVITY_BINDING_INCOMPATIBLE' });
  }
  if (!actionId.startsWith(`${appId}.`) || (verifyActionId && !verifyActionId.startsWith(`${appId}.`))) {
    throw Object.assign(new Error('Action IDs must belong to the selected app'), { status: 400, code: 'PRODUCTIVITY_BINDING_INCOMPATIBLE' });
  }
}

export function upsertProductivityBinding(ownerUserId, input = {}) {
  ensureEventProductivitySchema();
  const owner = assertOwner(ownerUserId);
  const operation = String(input.operation || '').trim();
  const provider = String(input.provider || '').trim();
  if (!String(input.action_id || '').trim() || !String(input.app_id || '').trim()) throw Object.assign(new Error('app_id and action_id are required'), { status: 400 });
  const appId = String(input.app_id).trim();
  const actionId = String(input.action_id).trim();
  const verifyActionId = String(input.verify_action_id || '').trim();
  assertProductivityBindingCompatibility(operation, provider, appId, actionId, verifyActionId);
  const existing = db().prepare(`SELECT id FROM productivity_action_bindings WHERE owner_user_id=? AND operation=? AND provider=?`).get(owner, operation, provider);
  const id = existing?.id || `epb-${randomUUID()}`;
  db().prepare(`INSERT INTO productivity_action_bindings
    (id,owner_user_id,operation,provider,app_id,action_id,connection_name,input_template_json,verify_action_id,verify_input_template_json,enabled)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,operation,provider) DO UPDATE SET app_id=excluded.app_id,action_id=excluded.action_id,connection_name=excluded.connection_name,input_template_json=excluded.input_template_json,verify_action_id=excluded.verify_action_id,verify_input_template_json=excluded.verify_input_template_json,enabled=excluded.enabled,updated_at=datetime('now')`).run(
      id, owner, operation, provider, appId, actionId, String(input.connection_name || '').trim(), JSON.stringify(input.input_template || {}), verifyActionId, JSON.stringify(input.verify_input_template || {}), input.enabled === false ? 0 : 1
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
  assertProductivityBindingCompatibility(operation, provider, binding.app_id, binding.action_id, binding.verify_action_id);
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
