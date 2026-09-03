/**
 * Owner-scoped Gmail mailbox maintenance through OpenConnector.
 *
 * Cleanup is deliberately two phase: review creates an immutable candidate plan
 * and summary; execute can only trash the exact message ids in that plan. The
 * content-tool action policy separately governs the destructive execute call.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { chatCompletions } from '../config/llm.js';
import { executeConnectorAction } from './openconnector.js';

const MAX_MESSAGES = 500;
const DEFAULT_RECENT = 80;
const DEFAULT_CLEANUP = 200;

export const GMAIL_QUERIES = Object.freeze({
  recent: (days) => `newer_than:${days}d -in:spam -in:trash`,
  spam: 'in:spam',
  // Gmail's Promotions category is its native marketing/promotional classifier.
  // Do not broaden this to arbitrary messages containing "unsubscribe".
  stale_marketing: (days) => `category:promotions older_than:${days}d -in:trash`,
});

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS gmail_mailbox_cleanup_plans (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'reviewed',
      cutoff_days INTEGER NOT NULL DEFAULT 7,
      summary TEXT NOT NULL,
      candidates_json TEXT NOT NULL DEFAULT '[]',
      report_json TEXT NOT NULL DEFAULT '{}',
      execution_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      executed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_gmail_cleanup_owner_created
      ON gmail_mailbox_cleanup_plans(owner_user_id, created_at DESC);
  `);
}

function clamp(value, fallback, max = MAX_MESSAGES) {
  return Math.min(max, Math.max(1, Number(value) || fallback));
}

function unwrapData(out) {
  let value = out?.data ?? out;
  for (let i = 0; i < 4; i += 1) {
    if (Array.isArray(value?.messages)) return value;
    if (value?.data && typeof value.data === 'object') value = value.data;
    else if (value?.result && typeof value.result === 'object') value = value.result;
    else break;
  }
  return value || {};
}

function normalizeMessage(row = {}, bucket = '') {
  const text = String(row.messageText || row.body || row.snippet || '').replace(/\s+/g, ' ').trim();
  return {
    message_id: String(row.messageId || row.id || '').trim(),
    thread_id: String(row.threadId || '').trim(),
    subject: String(row.subject || '(no subject)').trim().slice(0, 300),
    sender: String(row.sender || row.from || '').trim().slice(0, 300),
    timestamp: String(row.messageTimestamp || row.date || '').trim(),
    labels: Array.isArray(row.labelIds) ? row.labelIds.map(String) : [],
    excerpt: text.slice(0, 1200),
    estimated_bytes: Buffer.byteLength(text || row.subject || '', 'utf8'),
    bucket,
  };
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => row.message_id && !seen.has(row.message_id) && seen.add(row.message_id));
}

async function fetchBucket(ownerUserId, query, maxResults, bucket, execute = executeConnectorAction) {
  const out = await execute(ownerUserId, 'gmail.fetch_emails', {
    query,
    maxResults,
    includeSpamTrash: bucket === 'spam',
    detail: 'full',
  });
  const data = unwrapData(out);
  return (Array.isArray(data.messages) ? data.messages : []).map((row) => normalizeMessage(row, bucket));
}

function deterministicSummary({ days, recent, spam, stale }) {
  const bySender = new Map();
  for (const item of recent) bySender.set(item.sender || '(unknown)', (bySender.get(item.sender || '(unknown)') || 0) + 1);
  const top = [...bySender.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return [
    `Gmail ${days}-day mailbox review`,
    `- Recent mail reviewed: ${recent.length}.`,
    `- Spam proposed for Trash: ${spam.length}.`,
    `- Marketing/promotions older than ${days} days proposed for Trash: ${stale.length}.`,
    `- Top recent senders: ${top.map(([name, n]) => `${name} (${n})`).join(', ') || 'none'}.`,
    '- Cleanup is recoverable: messages are moved to Gmail Trash, never permanently deleted by Flolah.',
  ].join('\n');
}

async function summarize(ownerUserId, payload, llm = chatCompletions) {
  const fallback = deterministicSummary(payload);
  const compact = [...payload.recent, ...payload.spam, ...payload.stale]
    .slice(0, 160)
    .map(({ bucket, timestamp, sender, subject, excerpt }) => ({ bucket, timestamp, sender, subject, excerpt: excerpt.slice(0, 500) }));
  try {
    const { content } = await llm({
      ownerUserId,
      toolName: 'gmail_mailbox_review',
      maxTokens: 900,
      messages: [
        { role: 'system', content: 'You are a mailbox operations analyst. Summarize only the supplied Gmail metadata/content. Be concise, group recent mail into action-oriented themes, and separately describe what will be moved to Trash. Never claim deletion has happened.' },
        { role: 'user', content: JSON.stringify({ cutoff_days: payload.days, messages: compact }) },
      ],
    });
    return String(content || '').trim() || fallback;
  } catch (error) {
    return `${fallback}\n- AI grouping unavailable; deterministic review used (${String(error?.message || 'model unavailable').slice(0, 120)}).`;
  }
}

export async function reviewGmailMailbox(ownerUserId, input = {}, deps = {}) {
  ensureTable();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('CEO context required'), { status: 403 });
  const days = Math.min(90, Math.max(1, Number(input.days) || 7));
  const recentLimit = clamp(input.recent_limit, DEFAULT_RECENT);
  const cleanupLimit = clamp(input.cleanup_limit, DEFAULT_CLEANUP);
  const execute = deps.executeConnectorAction || executeConnectorAction;

  // Gmail actions may temporarily seed a CEO-specific OAuth client into the
  // connector gateway. Keep one mailbox review sequential so one company's
  // OAuth lease and refresh cannot race three simultaneous requests.
  const recent = await fetchBucket(owner, GMAIL_QUERIES.recent(days), recentLimit, 'recent', execute);
  const spamRaw = await fetchBucket(owner, GMAIL_QUERIES.spam, cleanupLimit, 'spam', execute);
  const staleRaw = await fetchBucket(owner, GMAIL_QUERIES.stale_marketing(days), cleanupLimit, 'stale_marketing', execute);
  const spam = dedupe(spamRaw);
  const stale = dedupe(staleRaw.filter((row) => !spam.some((item) => item.message_id === row.message_id)));
  const candidates = [...spam, ...stale];
  const summary = await summarize(owner, { days, recent, spam, stale }, deps.chatCompletions || chatCompletions);
  const id = `gcp-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const report = {
    recent_count: recent.length,
    spam_count: spam.length,
    stale_marketing_count: stale.length,
    candidate_count: candidates.length,
    estimated_reclaim_bytes: candidates.reduce((n, row) => n + row.estimated_bytes, 0),
    recent_groups_source: summary.includes('deterministic review used') ? 'deterministic' : 'configured_model',
  };
  getDb().prepare(`INSERT INTO gmail_mailbox_cleanup_plans
    (id, owner_user_id, status, cutoff_days, summary, candidates_json, report_json, expires_at)
    VALUES (?, ?, 'reviewed', ?, ?, ?, ?, ?)`)
    .run(id, owner, days, summary, JSON.stringify(candidates), JSON.stringify(report), expiresAt);
  return {
    ok: true,
    plan_id: id,
    status: 'reviewed',
    expires_at: expiresAt,
    summary,
    report,
    candidates: candidates.map(({ excerpt, ...row }) => row),
    next_step: candidates.length
      ? 'Run gmail_mailbox_cleanup with this plan_id. Effective Action Control must permit the destructive action; otherwise Flolah will request/require CEO authorization.'
      : 'No cleanup candidates found.',
  };
}

export async function executeGmailMailboxCleanup(ownerUserId, input = {}, deps = {}) {
  ensureTable();
  const owner = String(ownerUserId || '').trim();
  const planId = String(input.plan_id || input.planId || '').trim();
  if (!owner) throw Object.assign(new Error('CEO context required'), { status: 403 });
  if (!planId) throw Object.assign(new Error('plan_id required'), { status: 400 });
  const row = getDb().prepare('SELECT * FROM gmail_mailbox_cleanup_plans WHERE id = ? AND owner_user_id = ?').get(planId, owner);
  if (!row) throw Object.assign(new Error('Gmail cleanup plan not found for this company'), { status: 404 });
  if (row.status !== 'reviewed' && row.status !== 'partial') throw Object.assign(new Error(`Gmail cleanup plan is ${row.status}`), { status: 409 });
  if (Date.parse(row.expires_at) <= Date.now()) throw Object.assign(new Error('Gmail cleanup plan expired; review the mailbox again'), { status: 409 });
  if (!String(row.summary || '').trim()) throw Object.assign(new Error('Cleanup blocked: no pre-delete summary exists'), { status: 409 });
  const candidates = JSON.parse(row.candidates_json || '[]');
  const execute = deps.executeConnectorAction || executeConnectorAction;
  getDb().prepare("UPDATE gmail_mailbox_cleanup_plans SET status = 'executing' WHERE id = ? AND owner_user_id = ?").run(planId, owner);

  const results = [];
  for (let offset = 0; offset < candidates.length; offset += 5) {
    const batch = candidates.slice(offset, offset + 5);
    const settled = await Promise.allSettled(batch.map((item) => execute(owner, 'gmail.move_to_trash', { messageId: item.message_id })));
    settled.forEach((out, index) => results.push(out.status === 'fulfilled'
      ? { message_id: batch[index].message_id, bucket: batch[index].bucket, status: 'trashed' }
      : { message_id: batch[index].message_id, bucket: batch[index].bucket, status: 'failed', error: String(out.reason?.message || out.reason).slice(0, 240) }));
  }
  const trashed = results.filter((item) => item.status === 'trashed').length;
  const failed = results.length - trashed;
  const status = failed ? (trashed ? 'partial' : 'failed') : 'completed';
  const execution = { attempted: results.length, trashed, failed, results };
  getDb().prepare(`UPDATE gmail_mailbox_cleanup_plans
    SET status = ?, execution_json = ?, executed_at = datetime('now')
    WHERE id = ? AND owner_user_id = ?`).run(status, JSON.stringify(execution), planId, owner);
  return {
    ok: failed === 0,
    plan_id: planId,
    status,
    pre_delete_summary: row.summary,
    ...execution,
    recoverability: 'Messages were moved to Gmail Trash, not permanently deleted.',
  };
}

export function getGmailCleanupPlan(ownerUserId, planId) {
  ensureTable();
  const row = getDb().prepare('SELECT * FROM gmail_mailbox_cleanup_plans WHERE id = ? AND owner_user_id = ?').get(String(planId || ''), String(ownerUserId || ''));
  if (!row) return null;
  return { ...row, report: JSON.parse(row.report_json || '{}'), execution: JSON.parse(row.execution_json || '{}') };
}
