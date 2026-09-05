/**
 * Owner-scoped human communications: direct web chat, browser WebRTC signalling,
 * and short-lived call invitations. SQLite is authoritative; clients poll the
 * event timeline so this remains compatible with the existing Express runtime.
 */
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { sendPlatformNotifications } from './platform-notifications.js';

const INVITE_TTL_SECONDS = 10 * 60;
const MAX_MESSAGE = 12_000;

function db() { return getDb(); }
function id(prefix) { return `${prefix}-${randomBytes(10).toString('hex')}`; }
function hash(value) { return createHash('sha256').update(String(value || '')).digest('hex'); }
function json(value, fallback = null) { try { return JSON.parse(String(value || '')); } catch { return fallback; } }

function safeCall(row) {
  const started = Date.parse(row.answered_at || row.created_at || '');
  const ended = Date.parse(row.ended_at || '');
  return {
    id: row.id, conversation_id: row.conversation_id || null, status: row.status,
    caller_user_id: row.caller_user_id || null, caller_name: row.caller_name || (row.caller_user_id ? 'Company user' : 'Guest'),
    callee_user_id: row.callee_user_id, callee_name: row.callee_name || '',
    created_at: row.created_at, answered_at: row.answered_at, ended_at: row.ended_at,
    duration_seconds: Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : null,
    guest_call: !row.caller_user_id,
  };
}

export function ensureHumanCommunicationsSchema() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS human_conversations (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'direct',
      title TEXT DEFAULT '',
      created_by_user_id TEXT NOT NULL,
      archived_at TEXT,
      summary_text TEXT DEFAULT '',
      summary_updated_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS human_conversation_participants (
      conversation_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT DEFAULT (datetime('now')),
      last_read_message_id INTEGER,
      archived_at TEXT,
      PRIMARY KEY (conversation_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS human_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS human_calls (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      owner_user_id TEXT NOT NULL,
      caller_user_id TEXT,
      callee_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ringing',
      offer_json TEXT,
      answer_json TEXT,
      caller_candidates_json TEXT DEFAULT '[]',
      callee_candidates_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      answered_at TEXT,
      ended_at TEXT,
      expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS human_call_invites (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      requested_by_user_id TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS org_user_channels (
      owner_user_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      web_chat_enabled INTEGER NOT NULL DEFAULT 1,
      voice_enabled INTEGER NOT NULL DEFAULT 1,
      presence_visibility TEXT NOT NULL DEFAULT 'company',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(owner_user_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_human_messages_conversation ON human_messages(conversation_id, id);
    CREATE INDEX IF NOT EXISTS idx_human_calls_callee ON human_calls(owner_user_id, callee_user_id, status);
  `);
  db().prepare(`UPDATE human_calls SET status='expired',ended_at=COALESCE(ended_at,datetime('now')),
    offer_json=NULL,answer_json=NULL,caller_candidates_json='[]',callee_candidates_json='[]'
    WHERE status='ringing' AND expires_at IS NOT NULL AND datetime(expires_at)<=datetime('now')`).run();
  db().prepare(`UPDATE human_calls SET offer_json=NULL,answer_json=NULL,
    caller_candidates_json='[]',callee_candidates_json='[]'
    WHERE status IN ('ended','declined','expired') AND
      (offer_json IS NOT NULL OR answer_json IS NOT NULL OR caller_candidates_json<>'[]' OR callee_candidates_json<>'[]')`).run();
}

function assertCompanyUser(ownerUserId, userId) {
  ensureHumanCommunicationsSchema();
  const row = db().prepare(
    `SELECT id,email,name,role,role_title,department,parent_id,enabled,owner_user_id
     FROM platform_users WHERE id=? AND enabled=1`
  ).get(userId);
  const belongs = row && (row.id === ownerUserId || row.owner_user_id === ownerUserId);
  if (!belongs) throw Object.assign(new Error('Company user not found'), { status: 404 });
  return row;
}

export function listHumanDirectory(ownerUserId, requestingUserId) {
  ensureHumanCommunicationsSchema();
  assertCompanyUser(ownerUserId, requestingUserId);
  const rows = db().prepare(
    `SELECT id,email,name,role,role_title,department,parent_id,enabled,owner_user_id,
            COALESCE(specialty,'') AS specialty, COALESCE(purpose,'') AS purpose
     FROM platform_users
     WHERE enabled=1 AND (id=? OR owner_user_id=?) AND role IN ('ceo','org_user')
     ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END, name`
  ).all(ownerUserId, ownerUserId, ownerUserId);
  const channels = db().prepare('SELECT * FROM org_user_channels WHERE owner_user_id=?').all(ownerUserId);
  const byUser = new Map(channels.map((row) => [row.user_id, row]));
  return rows.map((row) => {
    const channel = byUser.get(row.id) || {};
    return {
      id: row.id, name: row.name, email: row.email, role: row.role,
      role_title: row.role_title || '', department: row.department || '', parent_id: row.parent_id || '',
      specialty: row.specialty || '', purpose: row.purpose || '',
      channels: { web_chat: channel.web_chat_enabled !== 0, voice: channel.voice_enabled !== 0 },
      is_self: row.id === requestingUserId,
    };
  });
}

export function updateHumanChannels(ownerUserId, userId, patch = {}) {
  assertCompanyUser(ownerUserId, userId);
  db().prepare(
    `INSERT INTO org_user_channels(owner_user_id,user_id,web_chat_enabled,voice_enabled,presence_visibility,updated_at)
     VALUES(?,?,?,?,?,datetime('now'))
     ON CONFLICT(owner_user_id,user_id) DO UPDATE SET
       web_chat_enabled=excluded.web_chat_enabled, voice_enabled=excluded.voice_enabled,
       presence_visibility=excluded.presence_visibility, updated_at=datetime('now')`
  ).run(ownerUserId, userId, patch.web_chat === false ? 0 : 1, patch.voice === false ? 0 : 1,
    ['company','department','private'].includes(patch.presence_visibility) ? patch.presence_visibility : 'company');
  return listHumanDirectory(ownerUserId, ownerUserId).find((row) => row.id === userId);
}

function participant(conversationId, ownerUserId, userId) {
  return db().prepare(
    'SELECT 1 FROM human_conversation_participants WHERE conversation_id=? AND owner_user_id=? AND user_id=?'
  ).get(conversationId, ownerUserId, userId);
}

export function getOrCreateDirectConversation(ownerUserId, actorUserId, otherUserId) {
  assertCompanyUser(ownerUserId, actorUserId);
  const other = assertCompanyUser(ownerUserId, otherUserId);
  if (actorUserId === otherUserId) throw Object.assign(new Error('Choose another company user'), { status: 400 });
  const found = db().prepare(
    `SELECT c.* FROM human_conversations c
     JOIN human_conversation_participants a ON a.conversation_id=c.id AND a.user_id=?
     JOIN human_conversation_participants b ON b.conversation_id=c.id AND b.user_id=?
     WHERE c.owner_user_id=? AND c.kind='direct'
       AND (SELECT COUNT(*) FROM human_conversation_participants p WHERE p.conversation_id=c.id)=2
     LIMIT 1`
  ).get(actorUserId, otherUserId, ownerUserId);
  if (found) return serializeConversation(found, actorUserId);
  const conversationId = id('hconv');
  const tx = db().transaction(() => {
    db().prepare(
      `INSERT INTO human_conversations(id,owner_user_id,kind,title,created_by_user_id) VALUES(?,?,'direct',?,?)`
    ).run(conversationId, ownerUserId, other.name || '', actorUserId);
    const ins = db().prepare(
      'INSERT INTO human_conversation_participants(conversation_id,owner_user_id,user_id) VALUES(?,?,?)'
    );
    ins.run(conversationId, ownerUserId, actorUserId);
    ins.run(conversationId, ownerUserId, otherUserId);
  });
  tx();
  return serializeConversation(db().prepare('SELECT * FROM human_conversations WHERE id=?').get(conversationId), actorUserId);
}

function serializeConversation(row, viewerUserId) {
  const people = db().prepare(
    `SELECT u.id,u.name,u.role,u.role_title,u.department,p.last_read_message_id,p.archived_at
     FROM human_conversation_participants p JOIN platform_users u ON u.id=p.user_id
     WHERE p.conversation_id=? ORDER BY u.name`
  ).all(row.id);
  const last = db().prepare('SELECT * FROM human_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1').get(row.id);
  const mine = people.find((p) => p.id === viewerUserId);
  const unread = db().prepare(
    'SELECT COUNT(*) AS n FROM human_messages WHERE conversation_id=? AND sender_user_id<>? AND id>COALESCE(?,0)'
  ).get(row.id, viewerUserId, mine?.last_read_message_id).n;
  return { ...row, participants: people, last_message: last || null, unread: Number(unread || 0), archived: !!mine?.archived_at };
}

export function listHumanConversations(ownerUserId, userId, { archived = false, limit = 50, offset = 0 } = {}) {
  assertCompanyUser(ownerUserId, userId);
  const lim = Math.min(100, Number(limit) || 50);
  const off = Math.max(0, Number(offset) || 0);
  const total = db().prepare(
    `SELECT COUNT(*) AS n FROM human_conversations c JOIN human_conversation_participants p ON p.conversation_id=c.id
     WHERE c.owner_user_id=? AND p.user_id=? AND ${archived ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL'}`
  ).get(ownerUserId, userId)?.n ?? 0;
  const rows = db().prepare(
    `SELECT c.* FROM human_conversations c JOIN human_conversation_participants p ON p.conversation_id=c.id
     WHERE c.owner_user_id=? AND p.user_id=? AND ${archived ? 'p.archived_at IS NOT NULL' : 'p.archived_at IS NULL'}
     ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`
  ).all(ownerUserId, userId, lim, off);
  const conversations = rows.map((row) => serializeConversation(row, userId));
  return { conversations, total, limit: lim, offset: off, has_more: off + conversations.length < total };
}

export function listHumanMessages(ownerUserId, userId, conversationId, { after = 0, before = 0, limit = 100 } = {}) {
  if (!participant(conversationId, ownerUserId, userId)) throw Object.assign(new Error('Conversation not found'), { status: 404 });
  const lim = Math.min(250, Number(limit) || 100);
  const afterId = Math.max(0, Number(after) || 0);
  const beforeId = Math.max(0, Number(before) || 0);
  let rows;
  if (afterId) {
    rows = db().prepare(`SELECT m.*,u.name AS sender_name FROM human_messages m JOIN platform_users u ON u.id=m.sender_user_id WHERE m.conversation_id=? AND m.owner_user_id=? AND m.id>? ORDER BY m.id ASC LIMIT ?`).all(conversationId, ownerUserId, afterId, lim);
  } else {
    const beforeSql = beforeId ? ' AND m.id<?' : '';
    const params = beforeId ? [conversationId, ownerUserId, beforeId, lim] : [conversationId, ownerUserId, lim];
    rows = db().prepare(`SELECT m.*,u.name AS sender_name FROM human_messages m JOIN platform_users u ON u.id=m.sender_user_id WHERE m.conversation_id=? AND m.owner_user_id=?${beforeSql} ORDER BY m.id DESC LIMIT ?`).all(...params).reverse();
  }
  const messages = rows.map((row) => ({ ...row, metadata: json(row.metadata_json, {}) }));
  const firstId = messages[0]?.id || beforeId || Number.MAX_SAFE_INTEGER;
  const hasOlder = !!db().prepare('SELECT 1 FROM human_messages WHERE conversation_id=? AND owner_user_id=? AND id<? LIMIT 1').get(conversationId, ownerUserId, firstId);
  return { messages, limit: lim, has_more_older: hasOlder };
}

export function sendHumanMessage(ownerUserId, userId, conversationId, body, metadata = {}) {
  if (!participant(conversationId, ownerUserId, userId)) throw Object.assign(new Error('Conversation not found'), { status: 404 });
  const text = String(body || '').trim().slice(0, MAX_MESSAGE);
  if (!text) throw Object.assign(new Error('Message is required'), { status: 400 });
  const out = db().prepare(
    `INSERT INTO human_messages(conversation_id,owner_user_id,sender_user_id,body,metadata_json) VALUES(?,?,?,?,?)`
  ).run(conversationId, ownerUserId, userId, text, JSON.stringify(metadata || {}));
  db().prepare("UPDATE human_conversations SET updated_at=datetime('now') WHERE id=?").run(conversationId);
  const message = listHumanMessages(ownerUserId, userId, conversationId, { after: Number(out.lastInsertRowid) - 1, limit: 1 }).messages[0];
  const recipients = db().prepare('SELECT user_id FROM human_conversation_participants WHERE conversation_id=? AND user_id<>?').all(conversationId, userId).map((r) => r.user_id);
  if (recipients.length) {
    try { sendPlatformNotifications({ userIds: recipients, title: `Message from ${message.sender_name}`, body: text.slice(0, 240), linkUrl: `/people/${encodeURIComponent(userId)}/chat`, createdBy: userId, source: 'human_message', sourceKey: `${conversationId}:${message.id}` }); } catch (e) { console.warn('[human-comms] message notification failed', e?.message || e); }
  }
  return message;
}

export function markHumanConversationRead(ownerUserId, userId, conversationId, messageId) {
  if (!participant(conversationId, ownerUserId, userId)) throw Object.assign(new Error('Conversation not found'), { status: 404 });
  db().prepare(
    'UPDATE human_conversation_participants SET last_read_message_id=? WHERE conversation_id=? AND owner_user_id=? AND user_id=?'
  ).run(Number(messageId) || null, conversationId, ownerUserId, userId);
  return { ok: true };
}

export function archiveHumanConversation(ownerUserId, userId, conversationId, archived = true) {
  if (!participant(conversationId, ownerUserId, userId)) throw Object.assign(new Error('Conversation not found'), { status: 404 });
  if (archived) {
    const recent = db().prepare(`SELECT u.name,m.body FROM human_messages m JOIN platform_users u ON u.id=m.sender_user_id WHERE m.conversation_id=? ORDER BY m.id DESC LIMIT 12`).all(conversationId).reverse();
    const summary = recent.map((m) => `${m.name}: ${String(m.body || '').replace(/\s+/g, ' ').slice(0, 220)}`).join('\n').slice(0, 3000);
    db().prepare("UPDATE human_conversations SET summary_text=?,summary_updated_at=datetime('now') WHERE id=? AND owner_user_id=?").run(summary, conversationId, ownerUserId);
  }
  db().prepare(
    `UPDATE human_conversation_participants SET archived_at=${archived ? "datetime('now')" : 'NULL'}
     WHERE conversation_id=? AND owner_user_id=? AND user_id=?`
  ).run(conversationId, ownerUserId, userId);
  return { ok: true, archived };
}

export function createHumanCall(ownerUserId, callerUserId, { calleeUserId, conversationId = null, offer = null } = {}) {
  assertCompanyUser(ownerUserId, callerUserId);
  assertCompanyUser(ownerUserId, calleeUserId);
  if (conversationId && (!participant(conversationId, ownerUserId, callerUserId) || !participant(conversationId, ownerUserId, calleeUserId))) {
    throw Object.assign(new Error('Conversation not found'), { status: 404 });
  }
  const callId = id('hcall');
  db().prepare(
    `INSERT INTO human_calls(id,conversation_id,owner_user_id,caller_user_id,callee_user_id,status,offer_json,expires_at)
     VALUES(?,?,?,?,?,'ringing',?,datetime('now','+5 minutes'))`
  ).run(callId, conversationId, ownerUserId, callerUserId, calleeUserId, offer ? JSON.stringify(offer) : null);
  if (conversationId) sendHumanMessage(ownerUserId, callerUserId, conversationId, 'Voice call started', { call_id: callId, event: 'call_started' });
  return getHumanCall(ownerUserId, callerUserId, callId);
}

export function getHumanCall(ownerUserId, userId, callId) {
  const row = db().prepare('SELECT * FROM human_calls WHERE id=? AND owner_user_id=?').get(callId, ownerUserId);
  if (!row || (row.caller_user_id !== userId && row.callee_user_id !== userId)) throw Object.assign(new Error('Call not found'), { status: 404 });
  return { ...row, offer: json(row.offer_json), answer: json(row.answer_json), caller_candidates: json(row.caller_candidates_json, []), callee_candidates: json(row.callee_candidates_json, []) };
}

export function listIncomingHumanCalls(ownerUserId, userId) {
  assertCompanyUser(ownerUserId, userId);
  return db().prepare(
    `SELECT c.*,u.name AS caller_name FROM human_calls c LEFT JOIN platform_users u ON u.id=c.caller_user_id
     WHERE c.owner_user_id=? AND c.callee_user_id=? AND c.status IN ('ringing','answered')
       AND datetime(c.expires_at)>datetime('now') ORDER BY c.created_at DESC LIMIT 20`
  ).all(ownerUserId, userId).map((row) => ({ ...row, offer: json(row.offer_json), answer: json(row.answer_json) }));
}

export function updateHumanCall(ownerUserId, userId, callId, patch = {}) {
  const row = getHumanCall(ownerUserId, userId, callId);
  const updates = [], values = [];
  if (patch.offer && row.caller_user_id === userId) { updates.push('offer_json=?'); values.push(JSON.stringify(patch.offer)); }
  if (patch.answer && row.callee_user_id === userId) { updates.push("answer_json=?,status='answered',answered_at=datetime('now')"); values.push(JSON.stringify(patch.answer)); }
  if (patch.candidate) {
    const col = row.caller_user_id === userId ? 'caller_candidates_json' : 'callee_candidates_json';
    const current = row.caller_user_id === userId ? row.caller_candidates : row.callee_candidates;
    updates.push(`${col}=?`); values.push(JSON.stringify([...(current || []), patch.candidate].slice(-100)));
  }
  if (['declined','ended'].includes(patch.status)) {
    updates.push("status=?,ended_at=datetime('now'),offer_json=NULL,answer_json=NULL,caller_candidates_json='[]',callee_candidates_json='[]'");
    values.push(patch.status);
  }
  if (updates.length) { values.push(callId, ownerUserId); db().prepare(`UPDATE human_calls SET ${updates.join(',')} WHERE id=? AND owner_user_id=?`).run(...values); }
  return getHumanCall(ownerUserId, userId, callId);
}

/** Owner-scoped operational record for COO/CEO. Signalling secrets are never returned. */
export function listCompanyCommunicationHistory(ownerUserId, { limit = 50, offset = 0, conversationId = null } = {}) {
  ensureHumanCommunicationsSchema();
  const owner = String(ownerUserId || '').trim();
  const take = Math.min(100, Math.max(1, Number(limit) || 50));
  const skip = Math.max(0, Number(offset) || 0);
  const conversations = db().prepare(
    `SELECT c.* FROM human_conversations c WHERE c.owner_user_id=?
     ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`
  ).all(owner, take, skip).map((row) => serializeConversation(row, owner));
  let messages = [];
  if (conversationId) {
    const exists = db().prepare('SELECT 1 FROM human_conversations WHERE id=? AND owner_user_id=?').get(String(conversationId), owner);
    if (!exists) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    messages = db().prepare(
      `SELECT m.id,m.conversation_id,m.sender_user_id,u.name AS sender_name,m.body,m.message_type,m.created_at
       FROM human_messages m JOIN platform_users u ON u.id=m.sender_user_id
       WHERE m.owner_user_id=? AND m.conversation_id=? ORDER BY m.id DESC LIMIT ?`
    ).all(owner, String(conversationId), take).reverse();
  }
  const calls = db().prepare(
    `SELECT c.*,caller.name AS caller_name,callee.name AS callee_name
       FROM human_calls c
       LEFT JOIN platform_users caller ON caller.id=c.caller_user_id
       LEFT JOIN platform_users callee ON callee.id=c.callee_user_id
      WHERE c.owner_user_id=? ORDER BY c.created_at DESC LIMIT ? OFFSET ?`
  ).all(owner, take, skip).map(safeCall);
  return { conversations, messages, calls, limit: take, offset: skip };
}

export function createHumanVoiceInvite(ownerUserId, requestedByUserId, targetUserId, { ttlSeconds = INVITE_TTL_SECONDS } = {}) {
  assertCompanyUser(ownerUserId, requestedByUserId);
  const target = assertCompanyUser(ownerUserId, targetUserId);
  const token = randomBytes(24).toString('base64url');
  const seconds = Math.max(60, Math.min(3600, Number(ttlSeconds) || INVITE_TTL_SECONDS));
  const inviteId = id('hvinv');
  db().prepare(
    `INSERT INTO human_call_invites(id,owner_user_id,target_user_id,requested_by_user_id,token_hash,expires_at)
     VALUES(?,?,?,?,?,datetime('now',?))`
  ).run(inviteId, ownerUserId, targetUserId, requestedByUserId, hash(token), `+${seconds} seconds`);
  return { id: inviteId, url: `${getPublicBaseUrl()}/call/user/${encodeURIComponent(token)}`, target: { id: target.id, name: target.name }, expires_in_seconds: seconds };
}

export function resolveHumanVoiceInvite(token) {
  ensureHumanCommunicationsSchema();
  const row = db().prepare(
    `SELECT i.*,u.name AS target_name,u.role_title,u.department FROM human_call_invites i
     JOIN platform_users u ON u.id=i.target_user_id WHERE i.token_hash=? AND datetime(i.expires_at)>datetime('now')`
  ).get(hash(token));
  if (!row) throw Object.assign(new Error('Invitation is invalid or expired'), { status: 404 });
  return { id: row.id, owner_user_id: row.owner_user_id, target_user_id: row.target_user_id, target_name: row.target_name, role_title: row.role_title || '', department: row.department || '', expires_at: row.expires_at };
}

export function createGuestHumanCall(token, offer) {
  const invite = resolveHumanVoiceInvite(token);
  const callId = id('hcall');
  db().prepare(
    `INSERT INTO human_calls(id,owner_user_id,caller_user_id,callee_user_id,status,offer_json,expires_at)
     VALUES(?,?,NULL,?,'ringing',?,datetime('now','+5 minutes'))`
  ).run(callId, invite.owner_user_id, invite.target_user_id, offer ? JSON.stringify(offer) : null);
  db().prepare("UPDATE human_call_invites SET consumed_at=COALESCE(consumed_at,datetime('now')) WHERE id=?").run(invite.id);
  return { call_id: callId, target_name: invite.target_name };
}

export function getGuestHumanCall(token, callId) {
  const invite = resolveHumanVoiceInvite(token);
  const row = db().prepare('SELECT * FROM human_calls WHERE id=? AND owner_user_id=? AND callee_user_id=? AND caller_user_id IS NULL').get(callId, invite.owner_user_id, invite.target_user_id);
  if (!row) throw Object.assign(new Error('Call not found'), { status: 404 });
  return { id: row.id, status: row.status, answer: json(row.answer_json), callee_candidates: json(row.callee_candidates_json, []) };
}

export function updateGuestHumanCall(token, callId, patch = {}) {
  const invite = resolveHumanVoiceInvite(token);
  const row = db().prepare('SELECT * FROM human_calls WHERE id=? AND owner_user_id=? AND callee_user_id=? AND caller_user_id IS NULL').get(callId, invite.owner_user_id, invite.target_user_id);
  if (!row) throw Object.assign(new Error('Call not found'), { status: 404 });
  if (patch.candidate) {
    const candidates = json(row.caller_candidates_json, []);
    db().prepare('UPDATE human_calls SET caller_candidates_json=? WHERE id=?').run(JSON.stringify([...candidates, patch.candidate].slice(-100)), callId);
  }
  if (patch.status === 'ended') db().prepare("UPDATE human_calls SET status='ended',ended_at=datetime('now'),offer_json=NULL,answer_json=NULL,caller_candidates_json='[]',callee_candidates_json='[]' WHERE id=?").run(callId);
  return getGuestHumanCall(token, callId);
}
