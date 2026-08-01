/**
 * Platform bugs / feedback / enhancement tracker (Admin + COO / Platform Help tools).
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

const STATUSES = new Set(['open', 'implemented', 'rejected']);
const CATEGORIES = new Set(['bug', 'feedback', 'enhancement']);

export function ensurePlatformFeedbackTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_feedback (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('bug', 'feedback', 'enhancement')),
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'implemented', 'rejected')),
      status_reason TEXT DEFAULT '',
      initiator_user_id TEXT,
      initiator_name TEXT,
      initiator_email TEXT,
      initiator_agent_id TEXT,
      owner_user_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_platform_feedback_status ON platform_feedback(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_platform_feedback_owner ON platform_feedback(owner_user_id, created_at DESC);
  `);
}

function normalizeCategory(raw) {
  const c = String(raw || 'feedback').trim().toLowerCase();
  if (CATEGORIES.has(c)) return c;
  if (c === 'feature' || c === 'enhancements') return 'enhancement';
  if (c === 'bugs' || c === 'defect') return 'bug';
  return 'feedback';
}

function normalizeStatus(raw) {
  const s = String(raw || 'open').trim().toLowerCase();
  if (STATUSES.has(s)) return s;
  if (s === 'done' || s === 'fixed' || s === 'closed') return 'implemented';
  if (s === 'wontfix' || s === 'declined') return 'rejected';
  return 'open';
}

/**
 * COO / agent tool: submit platform feedback.
 */
export function submitPlatformFeedback(body = {}, ctx = {}) {
  ensurePlatformFeedbackTables();
  const title = String(body.title || body.summary || '').trim();
  const detail = String(body.body || body.description || body.details || '').trim();
  if (!title) {
    const err = new Error('title required');
    err.status = 400;
    throw err;
  }
  const category = normalizeCategory(body.category || body.type);
  const id = 'pfb-' + randomUUID().replace(/-/g, '').slice(0, 16);
  const db = getDb();
  db.prepare(
    `INSERT INTO platform_feedback
      (id, category, title, body, status, initiator_user_id, initiator_name, initiator_email, initiator_agent_id, owner_user_id)
     VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
  ).run(
    id,
    category,
    title.slice(0, 240),
    detail.slice(0, 8000),
    ctx.ownerUserId || ctx.userId || null,
    ctx.initiatorName || ctx.userName || null,
    ctx.initiatorEmail || ctx.userEmail || null,
    ctx.agentId || null,
    ctx.ownerUserId || null
  );
  console.info('[platform-feedback] submitted', { id, category, agent: ctx.agentId || null });
  return {
    ok: true,
    id,
    category,
    title,
    status: 'open',
    message: 'Feedback recorded for Admin review.',
  };
}

export function listPlatformFeedback(filters = {}) {
  ensurePlatformFeedbackTables();
  const db = getDb();
  const where = [];
  const params = [];
  if (filters.status) {
    where.push('status = ?');
    params.push(normalizeStatus(filters.status));
  }
  if (filters.category) {
    where.push('category = ?');
    params.push(normalizeCategory(filters.category));
  }
  if (filters.id) {
    where.push('id = ?');
    params.push(String(filters.id).trim());
  }
  if (filters.q) {
    where.push('(title LIKE ? OR body LIKE ? OR initiator_name LIKE ? OR initiator_email LIKE ?)');
    const q = `%${String(filters.q).trim()}%`;
    params.push(q, q, q, q);
  }
  const sql =
    `SELECT * FROM platform_feedback` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY datetime(created_at) DESC LIMIT ?`;
  params.push(Math.min(200, Math.max(1, Number(filters.limit) || 50)));
  return db.prepare(sql).all(...params);
}

/**
 * Enquiry tool for COO / Platform Help.
 */
export function enquirePlatformFeedback(body = {}) {
  ensurePlatformFeedbackTables();
  const id = String(body.id || body.feedback_id || '').trim();
  if (id) {
    const row = listPlatformFeedback({ id, limit: 1 })[0];
    if (!row) {
      return { ok: false, error: 'Feedback not found', id };
    }
    return { ok: true, feedback: row };
  }
  const rows = listPlatformFeedback({
    status: body.status,
    category: body.category || body.type,
    q: body.query || body.q,
    limit: body.limit,
  });
  return {
    ok: true,
    count: rows.length,
    items: rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      status: r.status,
      status_reason: r.status_reason || '',
      initiator_name: r.initiator_name,
      initiator_email: r.initiator_email,
      initiator_agent_id: r.initiator_agent_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  };
}

export function updatePlatformFeedbackStatus(id, { status, status_reason, actor } = {}) {
  ensurePlatformFeedbackTables();
  const next = normalizeStatus(status);
  const reason = String(status_reason || '').trim();
  if (next === 'rejected' && !reason) {
    const err = new Error('status_reason required when rejecting feedback');
    err.status = 400;
    throw err;
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM platform_feedback WHERE id = ?').get(String(id || '').trim());
  if (!row) {
    const err = new Error('Feedback not found');
    err.status = 404;
    throw err;
  }
  db.prepare(
    `UPDATE platform_feedback
     SET status = ?, status_reason = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(next, next === 'rejected' ? reason : reason || row.status_reason || '', row.id);
  console.info('[platform-feedback] status', {
    id: row.id,
    from: row.status,
    to: next,
    by: actor?.id || null,
  });
  return db.prepare('SELECT * FROM platform_feedback WHERE id = ?').get(row.id);
}
