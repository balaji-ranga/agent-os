import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { listAgentsForUser } from './users.js';
import { deleteFeedbackById, storeFeedback } from './agent-feedback.js';

let ready = false;
const TERMINAL_SUCCESS = new Set(['completed', 'success', 'succeeded']);

function db() { return getDb(); }
function parse(raw, fallback = {}) { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function isoDate(value) { return new Date(value).toISOString().slice(0, 10); }
function clip(value, size = 180) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > size ? `${text.slice(0, size)}…` : text; }

export function ensureCompanyReviewTables() {
  if (ready) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS company_reviews (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      cadence TEXT NOT NULL DEFAULT 'weekly',
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      prepared_by_agent_id TEXT,
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, cadence, period_start, period_end)
    );
    CREATE INDEX IF NOT EXISTS idx_company_reviews_owner ON company_reviews(owner_user_id, period_end DESC);
    CREATE TABLE IF NOT EXISTS company_review_feedback (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      evidence_type TEXT NOT NULL DEFAULT 'goal',
      evidence_id TEXT NOT NULL DEFAULT '',
      agent_id TEXT NOT NULL DEFAULT '',
      rating TEXT NOT NULL DEFAULT 'meets_expectations',
      feedback TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'reusable_operating_lesson',
      scope_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(review_id) REFERENCES company_reviews(id)
    );
    CREATE TABLE IF NOT EXISTS company_review_improvements (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      problem TEXT NOT NULL DEFAULT '',
      proposed_change TEXT NOT NULL DEFAULT '',
      destination TEXT NOT NULL DEFAULT 'agent_playbook',
      scope_json TEXT NOT NULL DEFAULT '[]',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      owner_agent_id TEXT NOT NULL DEFAULT '',
      success_metric TEXT NOT NULL DEFAULT '',
      evaluation_date TEXT,
      validation_test TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      rollback_json TEXT NOT NULL DEFAULT '{}',
      approved_by_user_id TEXT,
      approved_at TEXT,
      evaluated_at TEXT,
      evaluation_result TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(review_id) REFERENCES company_reviews(id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_improvements_owner ON company_review_improvements(owner_user_id, status, created_at DESC);
  `);
  ready = true;
}

export function reviewPeriod(cadence = 'weekly', anchor = new Date()) {
  const end = new Date(anchor); end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  if (cadence === 'monthly') start.setDate(1);
  else { const day = start.getDay() || 7; start.setDate(start.getDate() - day + 1); }
  start.setHours(0, 0, 0, 0);
  return { start: isoDate(start), end: isoDate(end) };
}

function goalEvidence(ownerUserId, start, end) {
  const goals = db().prepare(`
    SELECT g.*, COUNT(s.id) step_count,
      SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) completed_steps,
      SUM(COALESCE(s.exception_retry_count,0)) retry_count,
      SUM(CASE WHEN s.status IN ('failed','awaiting_approval') THEN 1 ELSE 0 END) attention_steps
    FROM agent_goal_runs g LEFT JOIN agent_goal_steps s ON s.goal_run_id=g.id
    WHERE g.owner_user_id=? AND date(g.created_at) BETWEEN date(?) AND date(?)
    GROUP BY g.id ORDER BY g.created_at DESC
  `).all(ownerUserId, start, end);
  return goals.map((g) => ({
    id: g.id, type: 'goal', title: clip(g.title || g.prompt), agent_id: g.agent_id,
    status: g.status, success: TERMINAL_SUCCESS.has(String(g.status).toLowerCase()),
    step_count: Number(g.step_count || 0), completed_steps: Number(g.completed_steps || 0),
    retries: Number(g.retry_count || 0), attention_steps: Number(g.attention_steps || 0),
    error: clip(g.error_message), link: `/goal-plans/${encodeURIComponent(g.id)}`,
    created_at: g.created_at, completed_at: g.completed_at,
  }));
}

function buildSnapshot(ownerUserId, cadence, start, end) {
  const goals = goalEvidence(ownerUserId, start, end);
  const tools = db().prepare(`SELECT status, COUNT(*) count FROM content_tool_logs
    WHERE owner_user_id=? AND date(created_at) BETWEEN date(?) AND date(?) GROUP BY status`).all(ownerUserId, start, end);
  const kanban = db().prepare(`SELECT status, COUNT(*) count FROM kanban_tasks
    WHERE owner_user_id=? AND date(created_at) BETWEEN date(?) AND date(?) GROUP BY status`).all(ownerUserId, start, end);
  const agents = listAgentsForUser(ownerUserId).map((a) => ({ id: a.id, name: a.name, role: a.role || '', is_orchestrator: !!a.is_coo || !!a.is_orchestrator }));
  const succeeded = goals.filter((g) => g.success);
  const attention = goals.filter((g) => !g.success || g.retries || g.attention_steps);
  const completedCards = kanban.find((r) => r.status === 'completed')?.count || 0;
  const failedTools = tools.filter((r) => ['error', 'failed', 'blocked', 'denied'].includes(String(r.status).toLowerCase())).reduce((n, r) => n + r.count, 0);
  const delivered = succeeded.length;
  const total = goals.length;
  return {
    cadence, period_start: start, period_end: end, generated_at: new Date().toISOString(),
    summary: { outcomes_delivered: delivered, outcomes_total: total, completion_rate: total ? Math.round(delivered * 100 / total) : 0, goals_completed: delivered, needs_attention: attention.length, kanban_completed: completedCards, tool_failures: failedTools },
    wins: succeeded.slice(0, 8), misses: attention.slice(0, 8),
    improvement_candidates: attention.slice(0, 6).map((g) => ({ id: g.id, title: g.error ? `Resolve: ${g.title}` : `Improve reliability: ${g.title}`, reason: g.error || `${g.retries} retries and ${g.attention_steps} attention steps`, agent_id: g.agent_id, evidence: [{ type: 'goal', id: g.id, link: g.link }] })),
    agents,
  };
}

function hydrateReview(row) {
  if (!row) return null;
  const feedback = db().prepare('SELECT * FROM company_review_feedback WHERE review_id=? ORDER BY created_at').all(row.id).map((f) => ({ ...f, scope: parse(f.scope_json, []) }));
  const improvements = db().prepare('SELECT * FROM company_review_improvements WHERE review_id=? ORDER BY created_at').all(row.id).map((i) => ({ ...i, scope: parse(i.scope_json, []), evidence: parse(i.evidence_json, []), rollback: parse(i.rollback_json, {}) }));
  return { ...row, snapshot: parse(row.snapshot_json), feedback, improvements };
}

export function prepareCompanyReview({ ownerUserId, cadence = 'weekly', periodStart, periodEnd, preparedByAgentId = '' }) {
  ensureCompanyReviewTables();
  if (!preparedByAgentId) {
    preparedByAgentId = listAgentsForUser(ownerUserId).find((agent) => agent.is_coo || agent.is_orchestrator)?.id || '';
  }
  const period = periodStart && periodEnd ? { start: periodStart, end: periodEnd } : reviewPeriod(cadence);
  const snapshot = buildSnapshot(ownerUserId, cadence, period.start, period.end);
  const existing = db().prepare('SELECT id FROM company_reviews WHERE owner_user_id=? AND cadence=? AND period_start=? AND period_end=?').get(ownerUserId, cadence, period.start, period.end);
  const id = existing?.id || `review-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  db().prepare(`INSERT INTO company_reviews (id,owner_user_id,cadence,period_start,period_end,status,prepared_by_agent_id,snapshot_json)
    VALUES (?,?,?,?,?,'ready',?,?) ON CONFLICT(owner_user_id,cadence,period_start,period_end) DO UPDATE SET
    snapshot_json=CASE WHEN company_reviews.status IN ('completed','in_session') THEN company_reviews.snapshot_json ELSE excluded.snapshot_json END,
    prepared_by_agent_id=CASE WHEN company_reviews.status IN ('completed','in_session') THEN company_reviews.prepared_by_agent_id ELSE excluded.prepared_by_agent_id END,
    status=CASE WHEN company_reviews.status IN ('completed','in_session') THEN company_reviews.status ELSE 'ready' END, updated_at=datetime('now')`)
    .run(id, ownerUserId, cadence, period.start, period.end, preparedByAgentId, JSON.stringify(snapshot));
  return getCompanyReview(ownerUserId, id);
}

export function listCompanyReviews(ownerUserId, limit = 20) {
  ensureCompanyReviewTables();
  return db().prepare('SELECT * FROM company_reviews WHERE owner_user_id=? ORDER BY period_end DESC LIMIT ?').all(ownerUserId, limit).map(hydrateReview);
}
export function getCompanyReview(ownerUserId, id) { ensureCompanyReviewTables(); return hydrateReview(db().prepare('SELECT * FROM company_reviews WHERE id=? AND owner_user_id=?').get(id, ownerUserId)); }
export function setReviewStatus(ownerUserId, id, status) {
  ensureCompanyReviewTables();
  const allowed = new Set(['ready', 'in_session', 'completed']); if (!allowed.has(status)) throw Object.assign(new Error('Invalid review status'), { status: 400 });
  db().prepare(`UPDATE company_reviews SET status=?, started_at=CASE WHEN ?='in_session' THEN COALESCE(started_at,datetime('now')) ELSE started_at END,
    completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END, updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(status, status, status, id, ownerUserId);
  return getCompanyReview(ownerUserId, id);
}
export function addReviewFeedback({ ownerUserId, reviewId, evidenceType, evidenceId, agentId, rating, feedback, classification, scope = [] }) {
  ensureCompanyReviewTables(); if (!String(feedback || '').trim()) throw Object.assign(new Error('feedback is required'), { status: 400 });
  if (!getCompanyReview(ownerUserId, reviewId)) throw Object.assign(new Error('Review not found'), { status: 404 });
  const id = `feedback-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  db().prepare(`INSERT INTO company_review_feedback (id,review_id,owner_user_id,evidence_type,evidence_id,agent_id,rating,feedback,classification,scope_json) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, reviewId, ownerUserId, evidenceType || 'goal', evidenceId || '', agentId || '', rating || 'meets_expectations', String(feedback).trim(), classification || 'reusable_operating_lesson', JSON.stringify(scope));
  return getCompanyReview(ownerUserId, reviewId);
}
export function createImprovement({ ownerUserId, reviewId, title, problem, proposedChange, destination = 'agent_playbook', scope = [], evidence = [], ownerAgentId = '', successMetric = '', evaluationDate = null, validationTest = '' }) {
  ensureCompanyReviewTables();
  if (!String(title || '').trim() || !String(proposedChange || '').trim()) throw Object.assign(new Error('title and proposed_change are required'), { status: 400 });
  if (destination === 'soul') throw Object.assign(new Error('Soul changes require a separate explicit identity-governance process'), { status: 409 });
  const id = `improvement-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  db().prepare(`INSERT INTO company_review_improvements (id,review_id,owner_user_id,title,problem,proposed_change,destination,scope_json,evidence_json,owner_agent_id,success_metric,evaluation_date,validation_test,status,rollback_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)`).run(id, reviewId, ownerUserId, String(title).trim(), problem || '', String(proposedChange).trim(), destination, JSON.stringify(scope), JSON.stringify(evidence), ownerAgentId, successMetric, evaluationDate, validationTest, JSON.stringify({ previous_version: null, reversible: true }));
  return getCompanyReview(ownerUserId, reviewId);
}
export function decideImprovement({ ownerUserId, improvementId, decision, userId }) {
  ensureCompanyReviewTables();
  const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : decision === 'rollback' ? 'rolled_back' : null;
  if (!status) throw Object.assign(new Error('decision must be approve, reject, or rollback'), { status: 400 });
  const row = db().prepare('SELECT * FROM company_review_improvements WHERE id=? AND owner_user_id=?').get(improvementId, ownerUserId);
  if (!row) throw Object.assign(new Error('Improvement not found'), { status: 404 });
  const rollback = parse(row.rollback_json, {});
  if (status === 'approved' && row.destination === 'agent_playbook' && !rollback.feedback_ids?.length) {
    const scope = parse(row.scope_json, []);
    const feedbackIds = [];
    for (const agentId of scope) {
      const signal = storeFeedback({
        ownerUserId, agentId, source: 'other', rating: 'down',
        messageId: row.id, messageRole: 'system', messageContent: row.problem,
        comment: `Approved performance-review learning: ${row.proposed_change}`,
        context: { company_review_id: row.review_id, improvement_id: row.id, governed: true },
      });
      feedbackIds.push(signal.id);
    }
    rollback.feedback_ids = feedbackIds;
    rollback.activated_at = new Date().toISOString();
  }
  if (status === 'rolled_back') {
    for (const feedbackId of rollback.feedback_ids || []) deleteFeedbackById(ownerUserId, feedbackId);
    rollback.rolled_back_at = new Date().toISOString();
  }
  db().prepare(`UPDATE company_review_improvements SET status=?, approved_by_user_id=CASE WHEN ?='approved' THEN ? ELSE approved_by_user_id END,
    approved_at=CASE WHEN ?='approved' THEN datetime('now') ELSE approved_at END, rollback_json=?, updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(status, status, userId, status, JSON.stringify(rollback), improvementId, ownerUserId);
  return getCompanyReview(ownerUserId, row.review_id);
}

export function prepareDueCompanyReviews() {
  ensureCompanyReviewTables();
  const owners = db().prepare("SELECT id FROM platform_users WHERE role='ceo' AND enabled=1").all();
  const results = [];
  for (const owner of owners) {
    for (const cadence of ['weekly', 'monthly']) {
      try {
        const review = prepareCompanyReview({ ownerUserId: owner.id, cadence });
        results.push({ owner_user_id: owner.id, cadence, review_id: review.id, status: review.status });
      } catch (error) {
        results.push({ owner_user_id: owner.id, cadence, error: error.message });
      }
    }
  }
  return { ok: results.every((item) => !item.error), owners: owners.length, reviews: results };
}
