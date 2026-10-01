import { createHash } from 'crypto';
import { getDb } from '../db/schema.js';
import { executeConnectorAction } from './openconnector.js';
import { fetchIcalendarFeed } from './calendar-url-source.js';
import {
  ensureEventProductivitySchema,
  executeProductivityOperation,
  ingestTrustedProductivityEvent,
  resolveCalendarSubscriptionUrl,
} from './event-productivity.js';

const running = new Set();
const EMAIL_EVENT = 'email.message.received';
const CALENDAR_EVENTS = new Set([
  'calendar.event.created',
  'calendar.event.changed',
  'calendar.event.cancelled',
]);
const FILE_EVENTS = new Set([
  'file.created',
  'file.changed',
  'file.deleted',
]);
const FILE_SNAPSHOT_LIMIT = 250;
const FILE_CURSOR_LIMIT = 5_000;
export { parseIcalendarFeed } from './calendar-url-source.js';

function db() { return getDb(); }
function now() { return new Date().toISOString(); }
function json(value, fallback = {}) { try { return JSON.parse(value || ''); } catch { return fallback; } }
function text(value, max = 20_000) { return String(value ?? '').trim().slice(0, max); }
function hash(value) { return createHash('sha256').update(String(value ?? '')).digest('hex'); }
function timestamp(value, fallback = now()) {
  const n = Number(value);
  const date = /^\d+$/.test(String(value ?? ''))
    ? new Date(n > 10_000_000_000 ? n : n * 1000)
    : new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
function unwrap(value) {
  let current = value?.data ?? value;
  for (let i = 0; i < 6; i += 1) {
    if (Array.isArray(current)) return current;
    for (const key of ['messages', 'events', 'files', 'documents', 'entries', 'children', 'items', 'value', 'results']) {
      if (Array.isArray(current?.[key])) return current[key];
    }
    if (current?.data && typeof current.data === 'object') current = current.data;
    else if (current?.result && typeof current.result === 'object') current = current.result;
    else break;
  }
  return [];
}
function subscription(owner, id) {
  ensureEventProductivitySchema();
  return db().prepare(`SELECT * FROM productivity_event_subscriptions WHERE id=? AND owner_user_id=?`).get(String(id || '').trim(), String(owner || '').trim());
}
function listenerError(message, code = 'LISTENER_UNAVAILABLE') {
  return Object.assign(new Error(message), { status: 409, code });
}
function normalizeEmail(provider, row = {}) {
  const senderValue = row.from?.emailAddress || row.from || row.sender?.emailAddress || row.sender || {};
  const sender = typeof senderValue === 'string' ? senderValue : senderValue.address || senderValue.email || '';
  const body = row.body?.content ?? row.messageText ?? row.text ?? row.body ?? row.snippet ?? row.bodyPreview ?? '';
  return {
    id: text(row.id || row.messageId, 500),
    thread_id: text(row.conversationId || row.threadId, 500),
    internet_message_id: text(row.internetMessageId || row.rfcMessageId || row.headers?.['message-id'], 500),
    subject: text(row.subject || '(no subject)', 500),
    sender: text(sender, 500),
    body_text: text(typeof body === 'string' ? body.replace(/<[^>]+>/g, ' ') : JSON.stringify(body), 20_000),
    received_at: timestamp(row.receivedDateTime || row.messageTimestamp || row.date || row.internalDate || row.timestamp),
    provider,
  };
}
function normalizeCalendar(row = {}) {
  const id = text(row.id || row.eventId || row.uid, 500);
  const status = text(row.status || (row.isCancelled ? 'cancelled' : ''), 40).toLowerCase();
  const createdAt = timestamp(row.createdDateTime || row.created || row.creationTime || row.start?.dateTime || row.start);
  const updatedAt = timestamp(row.lastModifiedDateTime || row.updated || row.modifiedTime || createdAt);
  const payload = {
    provider_event_id: id,
    title: text(row.subject || row.summary || row.title, 500),
    status,
    created_at: createdAt,
    updated_at: updatedAt,
    start: row.start || null,
    end: row.end || null,
    organizer: row.organizer || row.creator || null,
    location: row.location || null,
    sequence: Number(row.sequence || 0),
  };
  return { ...payload, fingerprint: hash(JSON.stringify(payload)) };
}

async function fetchCalendarUrl(sub, cursor, deps) {
  return fetchIcalendarFeed({
    url: resolveCalendarSubscriptionUrl(sub),
    httpCache: cursor.calendar_http || {},
    request: deps.requestCalendarUrl,
  });
}
function normalizeFile(row = {}) {
  const id = text(row.id || row.fileId || row.file_id || row.itemId || row.item_id || row.driveItemId, 500);
  const status = text(row.status || row.state || '', 80).toLowerCase();
  const deleted = Boolean(
    row.deleted || row.isDeleted || row.is_deleted || row.trashed || row.removed || /deleted|trashed|removed/.test(status)
  );
  const createdRaw = row.createdDateTime || row.createdTime || row.created_at || row.created || row.creationTime || '';
  const updatedRaw = row.lastModifiedDateTime || row.modifiedTime || row.updated_at || row.updated || row.modified || createdRaw;
  const createdAt = timestamp(createdRaw, '1970-01-01T00:00:00.000Z');
  const updatedAt = timestamp(updatedRaw, createdAt);
  const parent = row.parentReference || row.parents || row.parent || null;
  const payload = {
    provider_file_id: id,
    name: text(row.name || row.fileName || row.filename || row.title || '(unnamed file)', 1_000),
    status,
    deleted,
    created_at: createdAt,
    updated_at: updatedAt,
    mime_type: text(row.mimeType || row.mime_type || row.file?.mimeType || row.file?.mime_type, 250),
    size: Number(row.size || row.fileSize || row.file_size) || 0,
    is_folder: Boolean(row.folder || row.isFolder || row.is_folder),
    parent,
    web_url: text(row.webUrl || row.web_url || row.url || row.webViewLink, 2_000),
    etag: text(row.eTag || row.etag || row.cTag || row.md5Checksum || row.checksum, 500),
  };
  return { ...payload, fingerprint: hash(JSON.stringify(payload)) };
}
function hasNextPage(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return false;
  if (
    value.nextPageToken || value.next_page_token || value.nextLink || value.next_link || value['@odata.nextLink'] ||
    value.hasMore === true || value.has_more === true
  ) return true;
  for (const key of ['data', 'result', 'response']) {
    if (value[key] && hasNextPage(value[key], depth + 1)) return true;
  }
  return false;
}
function nextPollAt(seconds) { return new Date(Date.now() + Math.max(60, Number(seconds) || 300) * 1000).toISOString(); }

async function fetchEmail(sub, cursor, execute) {
  const since = new Date(cursor.last_seen_at || cursor.enabled_at || sub.updated_at || Date.now());
  let result;
  if (sub.provider === 'google_workspace') {
    result = await execute(sub.owner_user_id, 'gmail.fetch_emails', {
      query: `after:${Math.floor(since.getTime() / 1000)} -in:sent -in:trash`,
      maxResults: 100,
      includeSpamTrash: false,
      detail: 'full',
    }, { connectionName: sub.connection_name || '' });
  } else if (sub.provider === 'microsoft_365') {
    result = await execute(sub.owner_user_id, 'outlook.list_messages', {
      top: 100,
      filter: `receivedDateTime ge ${since.toISOString()}`,
      orderby: 'receivedDateTime asc',
      select: ['id', 'internetMessageId', 'conversationId', 'subject', 'from', 'receivedDateTime', 'body', 'bodyPreview'],
      bodyContentType: 'text',
    }, { connectionName: sub.connection_name || '' });
  } else {
    throw listenerError(`Active email listener is not available for provider ${sub.provider}`);
  }
  return unwrap(result).map((row) => normalizeEmail(sub.provider, row)).filter((row) => row.id);
}

async function fetchCalendar(sub, cursor, execute, deps) {
  if (sub.provider === 'calendar_url') return fetchCalendarUrl(sub, cursor, deps);
  const actionId = sub.provider === 'google_workspace'
    ? 'google_calendar.list_events'
    : sub.provider === 'microsoft_365'
      ? 'outlook_calendar.list_events'
      : '';
  if (!actionId) throw listenerError(`Active calendar listener is not available for provider ${sub.provider}`);
  const since = new Date(cursor.last_checked_at || cursor.enabled_at || sub.updated_at || Date.now());
  const until = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000);
  try {
    const result = await execute(sub.owner_user_id, actionId, {
      timeMin: new Date(since.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      timeMax: until.toISOString(),
      maxResults: 250,
      singleEvents: true,
      showDeleted: true,
      orderBy: 'updated',
    }, { connectionName: sub.connection_name || '' });
    return { rows: unwrap(result).map(normalizeCalendar).filter((row) => row.provider_event_id), not_modified: false, http: null };
  } catch (error) {
    if (/not found|unknown action|action.*missing|404/i.test(String(error?.message || error))) {
      throw listenerError(
        sub.provider === 'microsoft_365'
          ? 'Connect an Outlook Calendar provider that exposes outlook_calendar.list_events before enabling this listener.'
          : 'Connect Google Calendar before enabling this listener.',
        'LISTENER_CONNECTOR_REQUIRED'
      );
    }
    throw error;
  }
}

async function fetchFiles(sub, cursor, deps) {
  const executeOperation = deps.executeProductivityOperation || executeProductivityOperation;
  try {
    const response = await executeOperation(sub.owner_user_id, 'file_search', {
      provider: sub.provider,
      input: {},
      idempotency_key: `file-listener:${sub.id}:${now()}`,
    }, deps.productivityDeps || {});
    const rows = unwrap(response).map(normalizeFile).filter((row) => row.provider_file_id);
    return {
      rows,
      complete_snapshot: !hasNextPage(response) && rows.length < FILE_SNAPSHOT_LIMIT,
      checked_at: now(),
    };
  } catch (error) {
    if (error?.code === 'PRODUCTIVITY_BINDING_REQUIRED' || /no enabled binding/i.test(String(error?.message || error))) {
      throw listenerError(
        `Configure an enabled file_search capability binding for ${sub.provider} before enabling this file listener.`,
        'LISTENER_BINDING_REQUIRED'
      );
    }
    throw error;
  }
}

async function trashSource(sub, message, execute) {
  if (sub.source_disposition !== 'trash') return { status: 'retained' };
  if (sub.provider !== 'google_workspace') throw listenerError('Source Trash is currently supported only for Gmail messages');
  await execute(sub.owner_user_id, 'gmail.move_to_trash', { messageId: message.id }, { connectionName: sub.connection_name || '' });
  return { status: 'trashed' };
}

async function ingestEmailRows(sub, cursor, rows, deps) {
  const ingest = deps.ingestEvent || ingestTrustedProductivityEvent;
  const execute = deps.executeAction || executeConnectorAction;
  const enabledAt = Date.parse(cursor.enabled_at || sub.updated_at || now());
  let maxSeen = cursor.last_seen_at || cursor.enabled_at || sub.updated_at || now();
  const sourceProcessed = new Set(Array.isArray(cursor.source_processed_ids) ? cursor.source_processed_ids : []);
  const result = { fetched: rows.length, emitted: 0, duplicates: 0, source_trashed: 0 };
  for (const message of rows.sort((a, b) => a.received_at.localeCompare(b.received_at))) {
    if (Date.parse(message.received_at) + 1000 < enabledAt) continue;
    const event = await ingest(sub.owner_user_id, sub.id, {
      provider_event_id: message.id,
      event_type: EMAIL_EVENT,
      subject_type: 'email_message',
      subject_id: message.id,
      correlation_key: message.internet_message_id || message.thread_id || message.id,
      occurred_at: message.received_at,
      payload: message,
    }, deps.eventDeps || {});
    if (event.duplicate) result.duplicates += 1;
    else result.emitted += 1;
    if (!sourceProcessed.has(message.id)) {
      const disposition = await trashSource(sub, message, execute);
      if (disposition.status === 'trashed') {
        result.source_trashed += 1;
        sourceProcessed.add(message.id);
      }
    }
    if (message.received_at > maxSeen) maxSeen = message.received_at;
  }
  return { result, cursor: { ...cursor, last_seen_at: maxSeen, last_checked_at: now(), source_processed_ids: [...sourceProcessed].slice(-1000) } };
}

async function ingestCalendarRows(sub, cursor, rows, deps) {
  const ingest = deps.ingestEvent || ingestTrustedProductivityEvent;
  const prior = cursor.objects && typeof cursor.objects === 'object' ? cursor.objects : {};
  const current = {};
  const enabledAt = Date.parse(cursor.enabled_at || sub.updated_at || now());
  const result = { fetched: rows.length, emitted: 0, duplicates: 0 };
  for (const item of rows) {
    current[item.provider_event_id] = { fingerprint: item.fingerprint, updated_at: item.updated_at, status: item.status };
    const before = prior[item.provider_event_id];
    let detected = null;
    if (/cancel|deleted/i.test(item.status)) detected = 'calendar.event.cancelled';
    else if (!before && Date.parse(item.created_at) >= enabledAt) detected = 'calendar.event.created';
    else if ((!before && Date.parse(item.updated_at) >= enabledAt && Date.parse(item.created_at) < enabledAt) || (before && before.fingerprint !== item.fingerprint)) detected = 'calendar.event.changed';
    if (detected !== sub.event_type) continue;
    const event = await ingest(sub.owner_user_id, sub.id, {
      provider_event_id: `${item.provider_event_id}:${item.updated_at}:${detected}`,
      event_type: detected,
      subject_type: 'calendar_event',
      subject_id: item.provider_event_id,
      correlation_key: item.provider_event_id,
      occurred_at: item.updated_at,
      payload: { ...item, fingerprint: undefined },
    }, deps.eventDeps || {});
    if (event.duplicate) result.duplicates += 1;
    else result.emitted += 1;
  }
  const bounded = Object.fromEntries(Object.entries(current).slice(-1000));
  return { result, cursor: { ...cursor, objects: bounded, last_checked_at: now() } };
}

async function processCalendar(sub, cursor, execute, deps) {
  const fetched = await fetchCalendar(sub, cursor, execute, deps);
  if (fetched.not_modified) {
    return {
      result: { fetched: 0, emitted: 0, duplicates: 0, not_modified: true },
      cursor: { ...cursor, last_checked_at: now(), calendar_http: { ...cursor.calendar_http, ...fetched.http } },
    };
  }
  const processed = await ingestCalendarRows(sub, cursor, fetched.rows, deps);
  processed.cursor.calendar_http = { ...cursor.calendar_http, ...(fetched.http || {}) };
  return processed;
}

async function ingestFileRows(sub, cursor, fetched, deps) {
  const ingest = deps.ingestEvent || ingestTrustedProductivityEvent;
  const prior = cursor.objects && typeof cursor.objects === 'object' ? cursor.objects : {};
  const current = {};
  const missingCounts = cursor.missing_counts && typeof cursor.missing_counts === 'object' ? cursor.missing_counts : {};
  const deletedIds = new Set(Array.isArray(cursor.deleted_ids) ? cursor.deleted_ids : []);
  const enabledAt = Date.parse(cursor.enabled_at || sub.updated_at || now());
  const initialized = cursor.files_initialized === true;
  const result = {
    fetched: fetched.rows.length,
    emitted: 0,
    duplicates: 0,
    snapshot_complete: fetched.complete_snapshot,
    pending_deletions: 0,
  };

  const emit = async (item, detected, occurredAt, payload = item) => {
    if (detected !== sub.event_type) return;
    const event = await ingest(sub.owner_user_id, sub.id, {
      provider_event_id: `${item.provider_file_id}:${detected}:${item.fingerprint}`,
      event_type: detected,
      subject_type: 'file',
      subject_id: item.provider_file_id,
      correlation_key: item.provider_file_id,
      occurred_at: occurredAt,
      payload: { ...payload, fingerprint: undefined },
    }, deps.eventDeps || {});
    if (event.duplicate) result.duplicates += 1;
    else result.emitted += 1;
  };

  for (const item of fetched.rows) {
    const before = prior[item.provider_file_id];
    if (item.deleted) {
      await emit(item, 'file.deleted', item.updated_at || fetched.checked_at);
      deletedIds.add(item.provider_file_id);
      delete missingCounts[item.provider_file_id];
      continue;
    }
    deletedIds.delete(item.provider_file_id);
    delete missingCounts[item.provider_file_id];
    current[item.provider_file_id] = {
      fingerprint: item.fingerprint,
      created_at: item.created_at,
      updated_at: item.updated_at,
      name: item.name,
      mime_type: item.mime_type,
      web_url: item.web_url,
    };
    let detected = null;
    if (!before && (initialized || Date.parse(item.created_at) >= enabledAt)) detected = 'file.created';
    else if (before && before.fingerprint !== item.fingerprint) detected = 'file.changed';
    if (detected) await emit(item, detected, item.updated_at || fetched.checked_at);
  }

  const nextObjects = fetched.complete_snapshot ? { ...current } : { ...prior, ...current };
  if (fetched.complete_snapshot) {
    for (const [id, before] of Object.entries(prior)) {
      if (current[id] || deletedIds.has(id)) continue;
      const misses = Number(missingCounts[id] || 0) + 1;
      missingCounts[id] = misses;
      if (misses < 2) {
        nextObjects[id] = before;
        result.pending_deletions += 1;
        continue;
      }
      const tombstone = {
        provider_file_id: id,
        name: before.name || '(deleted file)',
        status: 'deleted',
        deleted: true,
        created_at: before.created_at || '1970-01-01T00:00:00.000Z',
        updated_at: fetched.checked_at,
        mime_type: before.mime_type || '',
        web_url: before.web_url || '',
        fingerprint: hash(JSON.stringify([id, before.fingerprint, 'missing-confirmed'])),
        deletion_detection: 'missing_from_two_complete_snapshots',
      };
      await emit(tombstone, 'file.deleted', fetched.checked_at, tombstone);
      deletedIds.add(id);
      delete missingCounts[id];
      delete nextObjects[id];
    }
  }

  const bounded = Object.fromEntries(Object.entries(nextObjects).slice(-FILE_CURSOR_LIMIT));
  const boundedMissing = Object.fromEntries(Object.entries(missingCounts).slice(-FILE_CURSOR_LIMIT));
  return {
    result,
    cursor: {
      ...cursor,
      files_initialized: true,
      objects: bounded,
      missing_counts: boundedMissing,
      deleted_ids: [...deletedIds].slice(-FILE_CURSOR_LIMIT),
      last_checked_at: fetched.checked_at,
    },
  };
}

export async function pollProductivitySubscription(ownerUserId, subscriptionId, options = {}, deps = {}) {
  const owner = text(ownerUserId, 200);
  const id = text(subscriptionId, 200);
  const sub = subscription(owner, id);
  if (!sub) throw Object.assign(new Error('Subscription not found'), { status: 404 });
  if (!sub.enabled || !sub.listener_enabled) throw listenerError('Enable both the subscription and its listener before checking for events', 'LISTENER_DISABLED');
  if (running.has(id)) return { ok: true, skipped: 'already_running', subscription_id: id };
  running.add(id);
  const checkedAt = now();
  db().prepare(`UPDATE productivity_event_subscriptions SET listener_status='checking',listener_last_check_at=?,listener_last_error=NULL WHERE id=? AND owner_user_id=?`).run(checkedAt, id, owner);
  try {
    const cursor = json(sub.listener_cursor_json, { enabled_at: sub.updated_at || checkedAt });
    const execute = deps.executeAction || executeConnectorAction;
    const processed = sub.event_type === EMAIL_EVENT
      ? await ingestEmailRows(sub, cursor, await fetchEmail(sub, cursor, execute), deps)
      : CALENDAR_EVENTS.has(sub.event_type)
        ? await processCalendar(sub, cursor, execute, deps)
        : FILE_EVENTS.has(sub.event_type)
          ? await ingestFileRows(sub, cursor, await fetchFiles(sub, cursor, deps), deps)
        : (() => { throw listenerError(`No active listener adapter is available for ${sub.event_type}`); })();
    const duplicateCount = Number(sub.listener_duplicate_count || 0) + Number(processed.result.duplicates || 0);
    const successAt = now();
    db().prepare(`UPDATE productivity_event_subscriptions SET listener_status='active',listener_last_success_at=?,listener_last_error=NULL,
      listener_next_poll_at=?,listener_cursor_json=?,listener_duplicate_count=?,last_error=NULL,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(
      successAt, nextPollAt(sub.listener_poll_seconds), JSON.stringify(processed.cursor), duplicateCount, id, owner
    );
    return { ok: true, subscription_id: id, checked_at: checkedAt, ...processed.result };
  } catch (error) {
    db().prepare(`UPDATE productivity_event_subscriptions SET listener_status='error',listener_last_error=?,listener_next_poll_at=?,updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(
      text(error.message, 1000), nextPollAt(sub.listener_poll_seconds), id, owner
    );
    if (options.suppressThrow) return { ok: false, subscription_id: id, error: text(error.message, 1000), code: error.code || null };
    throw error;
  } finally {
    running.delete(id);
  }
}

export async function pollDueProductivitySubscriptions({ limit = 100 } = {}, deps = {}) {
  ensureEventProductivitySchema();
  const rows = db().prepare(`SELECT owner_user_id,id FROM productivity_event_subscriptions
    WHERE enabled=1 AND listener_enabled=1 AND (listener_next_poll_at IS NULL OR datetime(listener_next_poll_at)<=datetime('now'))
    ORDER BY COALESCE(listener_next_poll_at,created_at) LIMIT ?`).all(Math.max(1, Math.min(250, Number(limit) || 100)));
  const results = [];
  for (const row of rows) results.push(await pollProductivitySubscription(row.owner_user_id, row.id, { suppressThrow: true }, deps));
  return { count: results.length, results };
}
