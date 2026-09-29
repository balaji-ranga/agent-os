/**
 * Owner-scoped company Email channels.
 *
 * OAuth tokens remain in OpenConnector. This service stores only connector
 * references, routing policy and privacy-safe processing receipts. Inbound
 * message bodies flow into the existing retention-governed productivity event
 * inbox; the channel receipt never stores the body.
 */
import { createHash, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import {
  executeConnectorAction,
  getConnectorConnectionsForUser,
} from './openconnector.js';
import {
  createEventSubscription,
  ingestTrustedProductivityEvent,
  updateEventSubscription,
} from './event-productivity.js';
import {
  correlateMarketingInbound,
  getMarketingWorkspace,
  upsertMarketingRecord,
} from './marketing-workspace.js';
import { extractMailboxEmail } from './agent-workflow-webhooks.js';

export const COMPANY_EMAIL_PROVIDERS = Object.freeze({
  outlook: {
    label: 'Microsoft 365 / Outlook',
    connector_app_id: 'outlook',
    productivity_provider: 'microsoft_365',
  },
  gmail: {
    label: 'Google Workspace / Gmail',
    connector_app_id: 'gmail',
    productivity_provider: 'google_workspace',
  },
});

const DIRECTIONS = new Set(['inbound', 'outbound', 'both']);
const ROUTING_MODES = new Set(['inbox', 'workflow', 'goal']);
const STATUSES = new Set(['draft', 'enabled', 'disabled', 'error']);
const syncingChannels = new Set();
let ready = false;

function db() { return getDb(); }
function now() { return new Date().toISOString(); }
function text(value, max = 1000) { return String(value ?? '').trim().slice(0, max); }
function json(value, fallback = {}) { try { return JSON.parse(value || ''); } catch { return fallback; } }
function hash(value) { return createHash('sha256').update(String(value || '')).digest('hex'); }
function maskEmail(value) {
  const email = extractMailboxEmail(value);
  if (!email) return '';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
function stripHtml(value) { return text(String(value || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' '), 20_000); }
function ownerId(value) {
  const owner = text(value, 160);
  if (!owner) throw Object.assign(new Error('Company owner context required'), { status: 403 });
  return owner;
}

export function ensureCompanyEmailChannelsSchema() {
  if (ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS company_email_channels (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      mailbox_address TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      direction TEXT NOT NULL DEFAULT 'both',
      status TEXT NOT NULL DEFAULT 'draft',
      connection_name TEXT DEFAULT '',
      default_agent_id TEXT,
      marketing_agent_id TEXT,
      routing_mode TEXT NOT NULL DEFAULT 'inbox',
      routing_target_id TEXT,
      event_subscription_id TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      last_test_at TEXT,
      last_sync_at TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, mailbox_address)
    );
    CREATE INDEX IF NOT EXISTS idx_company_email_channels_owner
      ON company_email_channels(owner_user_id, status, updated_at DESC);
    CREATE TABLE IF NOT EXISTS company_email_channel_receipts (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      internet_message_id TEXT DEFAULT '',
      thread_id TEXT DEFAULT '',
      sender_hash TEXT NOT NULL,
      sender_masked TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      received_at TEXT,
      route_type TEXT NOT NULL DEFAULT 'processing',
      productivity_event_id TEXT,
      campaign_id TEXT,
      lead_id TEXT,
      status TEXT NOT NULL DEFAULT 'processing',
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, channel_id, provider_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_company_email_receipts_owner
      ON company_email_channel_receipts(owner_user_id, channel_id, received_at DESC);
  `);
  ready = true;
}

function assertProvider(value) {
  const provider = text(value, 40).toLowerCase();
  if (!COMPANY_EMAIL_PROVIDERS[provider]) {
    throw Object.assign(new Error('provider must be outlook or gmail'), { status: 400 });
  }
  return provider;
}

function assertMailbox(value) {
  const email = extractMailboxEmail(value);
  if (!email || !email.includes('@') || email.length > 320) {
    throw Object.assign(new Error('A valid mailbox address is required'), { status: 400 });
  }
  return email;
}

function assertAgentOwned(owner, agentId, label, { optional = false } = {}) {
  const id = text(agentId, 160);
  if (!id && optional) return '';
  const row = db().prepare(
    `SELECT a.id FROM agents a
     INNER JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=? AND ua.enabled=1
     WHERE a.id=?`
  ).get(owner, id);
  if (!row) throw Object.assign(new Error(`${label} is not an enabled agent in this company`), { status: 400 });
  return id;
}

function assertWorkflowOwned(owner, workflowId) {
  const id = text(workflowId, 180);
  const row = db().prepare(`SELECT id FROM agent_workflow_definitions WHERE id=? AND owner_user_id=?`).get(id, owner);
  if (!row) throw Object.assign(new Error('Routing workflow is not owned by this company'), { status: 400 });
  return id;
}

function normalizedConfig(input = {}, existing = {}) {
  const merged = { ...existing, ...(input || {}) };
  return {
    initial_lookback_hours: Math.max(1, Math.min(168, Number(merged.initial_lookback_hours) || 24)),
    poll_limit: Math.max(1, Math.min(100, Number(merged.poll_limit) || 50)),
    goal_prompt_template: text(
      merged.goal_prompt_template ||
        'Review inbound company email event {{event_id}}. Determine the sender intent, use company context, and take only actions permitted by Action Control. Do not send an external reply unless policy allows it.',
      4000
    ),
  };
}

function normalizeInput(owner, input = {}, existing = null) {
  const provider = assertProvider(input.provider ?? existing?.provider);
  const mailbox = assertMailbox(input.mailbox_address ?? existing?.mailbox_address);
  const direction = text(input.direction ?? existing?.direction ?? 'both', 20).toLowerCase();
  if (!DIRECTIONS.has(direction)) throw Object.assign(new Error('direction must be inbound, outbound, or both'), { status: 400 });
  const routingMode = text(input.routing_mode ?? existing?.routing_mode ?? 'inbox', 20).toLowerCase();
  if (!ROUTING_MODES.has(routingMode)) throw Object.assign(new Error('routing_mode must be inbox, workflow, or goal'), { status: 400 });
  const defaultAgent = assertAgentOwned(owner, input.default_agent_id ?? existing?.default_agent_id, 'Default routing agent', { optional: routingMode === 'inbox' });
  const marketingAgent = assertAgentOwned(owner, input.marketing_agent_id ?? existing?.marketing_agent_id, 'Marketing routing agent', { optional: true });
  let routingTarget = text(input.routing_target_id ?? existing?.routing_target_id, 180);
  if (routingMode === 'workflow') routingTarget = assertWorkflowOwned(owner, routingTarget);
  if (routingMode === 'goal') routingTarget = defaultAgent;
  if (routingMode === 'inbox') routingTarget = '';
  return {
    provider,
    mailbox_address: mailbox,
    display_name: text(input.display_name ?? existing?.display_name, 160),
    direction,
    connection_name: text(input.connection_name ?? existing?.connection_name, 180),
    default_agent_id: defaultAgent || null,
    marketing_agent_id: marketingAgent || null,
    routing_mode: routingMode,
    routing_target_id: routingTarget || null,
    config: normalizedConfig(input.config, json(existing?.config_json, {})),
  };
}

function getRow(owner, id) {
  ensureCompanyEmailChannelsSchema();
  return db().prepare(`SELECT * FROM company_email_channels WHERE id=? AND owner_user_id=?`).get(text(id, 180), ownerId(owner)) || null;
}

function receiptRows(owner, channelId, limit = 20) {
  return db().prepare(
    `SELECT id,channel_id,provider_message_id,internet_message_id,thread_id,sender_masked,subject,
            received_at,route_type,productivity_event_id,campaign_id,lead_id,status,error,created_at,updated_at
     FROM company_email_channel_receipts
     WHERE owner_user_id=? AND channel_id=? ORDER BY datetime(COALESCE(received_at,created_at)) DESC LIMIT ?`
  ).all(owner, channelId, Math.max(1, Math.min(100, Number(limit) || 20)));
}

function connectionFor(row, connections = []) {
  const appId = COMPANY_EMAIL_PROVIDERS[row.provider]?.connector_app_id;
  return connections.find((item) => text(item.app_id || item.id, 80).toLowerCase() === appId) || null;
}

function publicRow(row, connections = [], { includeReceipts = true } = {}) {
  if (!row) return null;
  const connection = connectionFor(row, connections);
  const oauthConnected = !!connection;
  return {
    id: row.id,
    provider: row.provider,
    provider_label: COMPANY_EMAIL_PROVIDERS[row.provider]?.label || row.provider,
    connector_app_id: COMPANY_EMAIL_PROVIDERS[row.provider]?.connector_app_id || row.provider,
    mailbox_address: row.mailbox_address,
    mailbox_masked: maskEmail(row.mailbox_address),
    display_name: row.display_name,
    direction: row.direction,
    status: row.status,
    connection_name: row.connection_name,
    oauth_connected: oauthConnected,
    connection_label: text(connection?.app_name || connection?.name, 200) || null,
    default_agent_id: row.default_agent_id,
    marketing_agent_id: row.marketing_agent_id,
    routing_mode: row.routing_mode,
    routing_target_id: row.routing_target_id,
    event_subscription_id: row.event_subscription_id,
    config: json(row.config_json, {}),
    inbound_enabled: ['inbound', 'both'].includes(row.direction),
    outbound_enabled: ['outbound', 'both'].includes(row.direction),
    healthy: row.status === 'enabled' && oauthConnected && !row.last_error,
    last_test_at: row.last_test_at,
    last_sync_at: row.last_sync_at,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    recent_receipts: includeReceipts ? receiptRows(row.owner_user_id, row.id, 20) : [],
  };
}

async function connectionsFor(owner, deps = {}) {
  const getter = deps.getConnections || getConnectorConnectionsForUser;
  const result = await getter(owner);
  return Array.isArray(result) ? result : result?.connections || result?.connected || [];
}

function subscriptionInput(row) {
  const provider = COMPANY_EMAIL_PROVIDERS[row.provider];
  const config = json(row.config_json, {});
  return {
    name: `Company Email · ${row.display_name || row.mailbox_address}`,
    provider: provider.productivity_provider,
    connection_name: row.connection_name || '',
    event_type: 'email.message.received',
    filters: {},
    target_type: row.routing_mode,
    target_id: row.routing_target_id || null,
    goal_prompt_template: config.goal_prompt_template,
    enabled: row.status === 'enabled' && ['inbound', 'both'].includes(row.direction),
  };
}

function ensureSubscription(row) {
  if (row.event_subscription_id) {
    try {
      return updateEventSubscription(row.owner_user_id, row.event_subscription_id, subscriptionInput(row));
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  const created = createEventSubscription(row.owner_user_id, subscriptionInput(row));
  db().prepare(`UPDATE company_email_channels SET event_subscription_id=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`)
    .run(created.subscription.id, row.id, row.owner_user_id);
  return created.subscription;
}

function syncMarketingReadiness(row, readyState) {
  try {
    const workspace = getMarketingWorkspace(row.owner_user_id);
    const existing = workspace.records.channels.find((item) => item.channel === 'email');
    const ownedReference = `company-email-channel:${row.id}`;
    if (existing?.account_reference && existing.account_reference !== ownedReference) return;
    upsertMarketingRecord(row.owner_user_id, 'channels', {
      channel: 'email',
      enabled: readyState,
      execution_mode: 'connector',
      connector_type: 'open_connector',
      connector_id: COMPANY_EMAIL_PROVIDERS[row.provider].connector_app_id,
      account_reference: ownedReference,
      sender_reference: maskEmail(row.mailbox_address),
      config: { company_email_channel_id: row.id, inbound_routing: row.routing_mode },
      readiness_status: readyState ? 'ready' : 'not_configured',
      last_verified_at: readyState ? now() : '',
    });
  } catch (error) {
    console.warn('[company-email] marketing readiness sync failed channel=%s: %s', row.id, error?.message || error);
  }
}

export async function listCompanyEmailChannels(ownerUserId, options = {}, deps = {}) {
  ensureCompanyEmailChannelsSchema();
  const owner = ownerId(ownerUserId);
  const connections = await connectionsFor(owner, deps).catch(() => []);
  const rows = db().prepare(`SELECT * FROM company_email_channels WHERE owner_user_id=? ORDER BY updated_at DESC`).all(owner);
  return {
    providers: COMPANY_EMAIL_PROVIDERS,
    channels: rows.map((row) => publicRow(row, connections, { includeReceipts: options.include_receipts !== false })),
    connected_apps: connections.map((item) => ({ app_id: item.app_id || item.id, app_name: item.app_name || item.name || item.app_id || item.id })),
  };
}

export async function getCompanyEmailChannel(ownerUserId, channelId, deps = {}) {
  const owner = ownerId(ownerUserId);
  const row = getRow(owner, channelId);
  if (!row) throw Object.assign(new Error('Company Email channel not found'), { status: 404 });
  const connections = await connectionsFor(owner, deps).catch(() => []);
  return publicRow(row, connections);
}

export function createCompanyEmailChannel(ownerUserId, input = {}) {
  ensureCompanyEmailChannelsSchema();
  const owner = ownerId(ownerUserId);
  const normalized = normalizeInput(owner, input);
  const id = `emailch-${randomUUID()}`;
  try {
    db().prepare(`INSERT INTO company_email_channels
      (id,owner_user_id,provider,mailbox_address,display_name,direction,status,connection_name,default_agent_id,marketing_agent_id,routing_mode,routing_target_id,config_json)
      VALUES (?,?,?,?,?,?,'draft',?,?,?,?,?,?)`).run(
        id, owner, normalized.provider, normalized.mailbox_address, normalized.display_name,
        normalized.direction, normalized.connection_name, normalized.default_agent_id,
        normalized.marketing_agent_id, normalized.routing_mode, normalized.routing_target_id,
        JSON.stringify(normalized.config)
      );
  } catch (error) {
    if (/UNIQUE/i.test(String(error.message))) throw Object.assign(new Error('This mailbox is already configured for the company'), { status: 409 });
    throw error;
  }
  let row = getRow(owner, id);
  ensureSubscription(row);
  row = getRow(owner, id);
  return publicRow(row, []);
}

export function updateCompanyEmailChannel(ownerUserId, channelId, input = {}) {
  const owner = ownerId(ownerUserId);
  const existing = getRow(owner, channelId);
  if (!existing) throw Object.assign(new Error('Company Email channel not found'), { status: 404 });
  const normalized = normalizeInput(owner, input, existing);
  let status = text(input.status ?? existing.status, 20).toLowerCase();
  if (!STATUSES.has(status)) throw Object.assign(new Error('Invalid Email channel status'), { status: 400 });
  if (status === 'enabled' && existing.status !== 'enabled') status = 'draft';
  try {
    db().prepare(`UPDATE company_email_channels SET
      provider=?,mailbox_address=?,display_name=?,direction=?,status=?,connection_name=?,default_agent_id=?,marketing_agent_id=?,routing_mode=?,routing_target_id=?,config_json=?,last_error=NULL,updated_at=datetime('now')
      WHERE id=? AND owner_user_id=?`).run(
        normalized.provider, normalized.mailbox_address, normalized.display_name, normalized.direction,
        status, normalized.connection_name, normalized.default_agent_id, normalized.marketing_agent_id,
        normalized.routing_mode, normalized.routing_target_id, JSON.stringify(normalized.config), existing.id, owner
      );
  } catch (error) {
    if (/UNIQUE/i.test(String(error.message))) throw Object.assign(new Error('This mailbox is already configured for the company'), { status: 409 });
    throw error;
  }
  let row = getRow(owner, existing.id);
  ensureSubscription(row);
  row = getRow(owner, existing.id);
  if (existing.status === 'enabled' && row.status !== 'enabled') syncMarketingReadiness(row, false);
  return publicRow(row, []);
}

export function deleteCompanyEmailChannel(ownerUserId, channelId) {
  const owner = ownerId(ownerUserId);
  const row = getRow(owner, channelId);
  if (!row) throw Object.assign(new Error('Company Email channel not found'), { status: 404 });
  if (row.event_subscription_id) {
    try { updateEventSubscription(owner, row.event_subscription_id, { enabled: false }); } catch { /* old/missing subscription */ }
  }
  syncMarketingReadiness(row, false);
  db().prepare(`DELETE FROM company_email_channels WHERE id=? AND owner_user_id=?`).run(row.id, owner);
  return { deleted: true, id: row.id, receipts_retained_until_company_retention: true };
}

function unwrap(value) {
  let current = value?.data ?? value;
  for (let i = 0; i < 5; i += 1) {
    if (Array.isArray(current)) return current;
    if (Array.isArray(current?.messages)) return current.messages;
    if (Array.isArray(current?.value)) return current.value;
    if (current?.data && typeof current.data === 'object') current = current.data;
    else if (current?.result && typeof current.result === 'object') current = current.result;
    else break;
  }
  return [];
}

function address(value) {
  if (typeof value === 'string') return extractMailboxEmail(value);
  return extractMailboxEmail(value?.emailAddress?.address || value?.address || value?.email || '');
}

function display(value) {
  if (typeof value === 'string') {
    const match = value.match(/^\s*([^<]+)</);
    return text(match?.[1] || '', 200);
  }
  return text(value?.emailAddress?.name || value?.name, 200);
}

function normalizeProviderMessage(provider, row = {}) {
  const fromValue = row.from || row.sender || row.senderAddress || row.replyTo?.[0] || '';
  const bodyValue = row.body?.content ?? row.messageText ?? row.text ?? row.body ?? row.snippet ?? row.bodyPreview ?? '';
  const received = row.receivedDateTime || row.messageTimestamp || row.date || row.internalDate || row.timestamp || now();
  const receivedAt = /^\d+$/.test(String(received))
    ? new Date(Number(received) > 10_000_000_000 ? Number(received) : Number(received) * 1000).toISOString()
    : new Date(received).toString() === 'Invalid Date' ? now() : new Date(received).toISOString();
  return {
    provider_message_id: text(row.id || row.messageId, 500),
    internet_message_id: text(row.internetMessageId || row.rfcMessageId || row.headers?.['message-id'], 500),
    thread_id: text(row.conversationId || row.threadId, 500),
    sender: address(fromValue),
    sender_name: display(fromValue),
    subject: text(row.subject || '(no subject)', 500),
    body_text: provider === 'outlook' && row.body?.contentType === 'html' ? stripHtml(bodyValue) : stripHtml(bodyValue),
    received_at: receivedAt,
  };
}

async function fetchProviderMessages(row, since, deps = {}) {
  if (deps.fetchMessages) return deps.fetchMessages(row, since);
  const execute = deps.executeAction || executeConnectorAction;
  const config = json(row.config_json, {});
  const limit = config.poll_limit || 50;
  let result;
  if (row.provider === 'outlook') {
    result = await execute(row.owner_user_id, 'outlook.list_messages', {
      top: limit,
      filter: `receivedDateTime ge ${since.toISOString()}`,
      orderby: 'receivedDateTime asc',
      select: ['id', 'internetMessageId', 'conversationId', 'subject', 'from', 'receivedDateTime', 'body', 'bodyPreview'],
      bodyContentType: 'text',
    }, { connectionName: row.connection_name || '' });
  } else {
    result = await execute(row.owner_user_id, 'gmail.fetch_emails', {
      query: `after:${Math.floor(since.getTime() / 1000)} -in:sent -in:trash`,
      maxResults: limit,
      includeSpamTrash: false,
      detail: 'full',
    }, { connectionName: row.connection_name || '' });
  }
  return unwrap(result).map((message) => normalizeProviderMessage(row.provider, message));
}

export async function testCompanyEmailChannel(ownerUserId, channelId, deps = {}) {
  const owner = ownerId(ownerUserId);
  const row = getRow(owner, channelId);
  if (!row) throw Object.assign(new Error('Company Email channel not found'), { status: 404 });
  const connections = await connectionsFor(owner, deps);
  const connection = connectionFor(row, connections);
  if (!connection) throw Object.assign(new Error(`Connect ${COMPANY_EMAIL_PROVIDERS[row.provider].label} with OAuth first`), { status: 409, code: 'EMAIL_OAUTH_REQUIRED' });
  const execute = deps.executeAction || executeConnectorAction;
  try {
    if (row.provider === 'outlook') {
      await execute(owner, 'outlook.get_profile', {}, { connectionName: row.connection_name || '' });
    } else {
      await execute(owner, 'gmail.fetch_emails', { query: 'newer_than:1d', maxResults: 1, detail: 'ids' }, { connectionName: row.connection_name || '' });
    }
    const at = now();
    db().prepare(`UPDATE company_email_channels SET last_test_at=?,last_error=NULL,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(at, row.id, owner);
    return { ok: true, tested_at: at, provider: row.provider, mailbox_masked: maskEmail(row.mailbox_address), connection_label: connection.app_name || connection.name || row.provider };
  } catch (error) {
    db().prepare(`UPDATE company_email_channels SET last_test_at=?,last_error=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(now(), text(error.message, 1000), row.id, owner);
    throw error;
  }
}

export async function enableCompanyEmailChannel(ownerUserId, channelId, deps = {}) {
  const owner = ownerId(ownerUserId);
  await testCompanyEmailChannel(owner, channelId, deps);
  db().prepare(`UPDATE company_email_channels SET status='enabled',last_error=NULL,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(channelId, owner);
  let row = getRow(owner, channelId);
  ensureSubscription(row);
  row = getRow(owner, channelId);
  syncMarketingReadiness(row, true);
  return getCompanyEmailChannel(owner, channelId, deps);
}

export async function disableCompanyEmailChannel(ownerUserId, channelId, deps = {}) {
  const owner = ownerId(ownerUserId);
  const row = getRow(owner, channelId);
  if (!row) throw Object.assign(new Error('Company Email channel not found'), { status: 404 });
  db().prepare(`UPDATE company_email_channels SET status='disabled',updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(row.id, owner);
  const disabled = getRow(owner, row.id);
  ensureSubscription(disabled);
  syncMarketingReadiness(disabled, false);
  return getCompanyEmailChannel(owner, row.id, deps);
}

export async function syncCompanyEmailChannel(ownerUserId, channelId, options = {}, deps = {}) {
  ensureCompanyEmailChannelsSchema();
  const owner = ownerId(ownerUserId);
  const row = getRow(owner, channelId);
  if (!row) throw Object.assign(new Error('Company Email channel not found'), { status: 404 });
  if (row.status !== 'enabled' && options.force !== true) throw Object.assign(new Error('Enable the Email channel before synchronizing'), { status: 409 });
  if (!['inbound', 'both'].includes(row.direction)) throw Object.assign(new Error('Inbound synchronization is disabled for this channel'), { status: 409 });
  if (syncingChannels.has(row.id)) return { ok: true, skipped: 'already_running', channel_id: row.id };
  syncingChannels.add(row.id);
  const config = json(row.config_json, {});
  const lastMs = Date.parse(row.last_sync_at || '');
  const since = Number.isFinite(lastMs)
    ? new Date(lastMs - 2 * 60 * 1000)
    : new Date(Date.now() - Number(config.initial_lookback_hours || 24) * 60 * 60 * 1000);
  const result = { ok: true, channel_id: row.id, fetched: 0, processed: 0, duplicates: 0, ignored: 0, marketing: 0, inbox: 0, failed: 0, receipts: [] };
  try {
    const messages = (await fetchProviderMessages(row, since, deps))
      .map((message) => message?.provider_message_id ? message : normalizeProviderMessage(row.provider, message))
      .filter((message) => message.provider_message_id)
      .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
    result.fetched = messages.length;
    const correlate = deps.correlateMarketing || correlateMarketingInbound;
    const ingest = deps.ingestEvent || ingestTrustedProductivityEvent;
    for (const message of messages) {
      if (message.sender && message.sender === row.mailbox_address) { result.ignored += 1; continue; }
      const receiptId = `emailrcpt-${randomUUID()}`;
      const inserted = db().prepare(`INSERT OR IGNORE INTO company_email_channel_receipts
        (id,owner_user_id,channel_id,provider_message_id,internet_message_id,thread_id,sender_hash,sender_masked,subject,received_at,route_type,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,'processing','processing')`).run(
          receiptId, owner, row.id, message.provider_message_id, message.internet_message_id,
          message.thread_id, hash(`${owner}:${message.sender}`), maskEmail(message.sender), message.subject,
          message.received_at
        );
      if (!inserted.changes) { result.duplicates += 1; continue; }
      try {
        let attribution = { matched: false };
        if (message.sender && (message.body_text || message.subject)) {
          attribution = correlate(owner, {
            channel: 'email',
            sender_id: message.sender,
            content: message.body_text || message.subject,
            message_id: message.internet_message_id || message.provider_message_id,
            observed_at: message.received_at,
            owner_agent: row.marketing_agent_id || '',
          }) || { matched: false };
        }
        let routeType = 'inbox';
        let productivityEventId = null;
        if (attribution.matched && !attribution.normal_chat) {
          routeType = 'marketing';
          result.marketing += 1;
        } else {
          const subscription = ensureSubscription(getRow(owner, row.id));
          const event = await ingest(owner, subscription.id, {
            provider_event_id: `${row.id}:${message.provider_message_id}`,
            event_type: 'email.message.received',
            subject_type: 'email_message',
            subject_id: message.provider_message_id,
            correlation_key: message.internet_message_id || message.thread_id || message.provider_message_id,
            occurred_at: message.received_at,
            payload: {
              company_email_channel_id: row.id,
              provider: row.provider,
              mailbox_address: row.mailbox_address,
              sender: message.sender,
              sender_name: message.sender_name,
              subject: message.subject,
              body_text: message.body_text,
              provider_message_id: message.provider_message_id,
              internet_message_id: message.internet_message_id,
              thread_id: message.thread_id,
              marketing_attribution: attribution.matched ? {
                campaign_id: attribution.campaign?.campaign_id || null,
                intent: attribution.classification?.intent || null,
                normal_chat: attribution.normal_chat === true,
              } : null,
            },
          }, deps.eventDeps || {});
          productivityEventId = event?.event?.id || null;
          result.inbox += 1;
        }
        db().prepare(`UPDATE company_email_channel_receipts SET route_type=?,productivity_event_id=?,campaign_id=?,lead_id=?,status='completed',error=NULL,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(
          routeType, productivityEventId, attribution.campaign?.campaign_id || null,
          attribution.lead?.lead_id || null, receiptId, owner
        );
        result.processed += 1;
        result.receipts.push({ id: receiptId, route_type: routeType, campaign_id: attribution.campaign?.campaign_id || null, lead_id: attribution.lead?.lead_id || null, productivity_event_id: productivityEventId });
      } catch (error) {
        result.failed += 1;
        db().prepare(`UPDATE company_email_channel_receipts SET status='failed',error=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(text(error.message, 1000), receiptId, owner);
      }
    }
    const syncedAt = now();
    db().prepare(`UPDATE company_email_channels SET last_sync_at=?,last_error=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(syncedAt, result.failed ? `${result.failed} message(s) failed` : null, row.id, owner);
    return { ...result, synced_at: syncedAt };
  } catch (error) {
    db().prepare(`UPDATE company_email_channels SET last_error=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(text(error.message, 1000), row.id, owner);
    throw error;
  } finally {
    syncingChannels.delete(row.id);
  }
}

export async function syncEnabledCompanyEmailChannels(options = {}, deps = {}) {
  ensureCompanyEmailChannelsSchema();
  const rows = db().prepare(`SELECT owner_user_id,id FROM company_email_channels WHERE status='enabled' AND direction IN ('inbound','both') ORDER BY updated_at`).all();
  const results = [];
  for (const row of rows.slice(0, Math.max(1, Math.min(250, Number(options.limit) || 100)))) {
    try { results.push({ ok: true, ...(await syncCompanyEmailChannel(row.owner_user_id, row.id, {}, deps)) }); }
    catch (error) { results.push({ ok: false, owner_user_id: row.owner_user_id, channel_id: row.id, error: text(error.message, 1000) }); }
  }
  return { count: results.length, results };
}
