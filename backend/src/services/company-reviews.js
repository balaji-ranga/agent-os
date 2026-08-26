import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { listAgentsForUser } from './users.js';
import { activateImprovementLearning, ensureAgentLearningRolloutTables, listImprovementLearningVersions, rollbackImprovementLearning } from './agent-learning-rollout.js';

let ready = false;
const TERMINAL_SUCCESS = new Set(['completed', 'success', 'succeeded']);

function db() { return getDb(); }
function parse(raw, fallback = {}) { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
function isoDate(value) { return new Date(value).toISOString().slice(0, 10); }
function clip(value, size = 180) { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > size ? `${text.slice(0, size)}…` : text; }
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /pass(word)?|secret|api.?key|token|authorization/i.test(key) ? '[redacted]' : redact(item)]));
}
function summarizeJson(raw, size = 700) {
  const value = redact(parse(raw, {}));
  if (!value || (typeof value === 'object' && !Object.keys(value).length)) return '';
  return clip(JSON.stringify(value), size);
}

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
    CREATE TABLE IF NOT EXISTS company_review_opinions (
      id TEXT PRIMARY KEY, review_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, evidence_id TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL, agent_id TEXT NOT NULL DEFAULT '', position TEXT NOT NULL, content TEXT NOT NULL,
      proposed_revision TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(review_id) REFERENCES company_reviews(id)
    );
    CREATE INDEX IF NOT EXISTS idx_review_opinions_owner ON company_review_opinions(owner_user_id, review_id, evidence_id);
  `);
  ensureAgentLearningRolloutTables();
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

function evidenceDetail(goal) {
  const steps = db().prepare(`SELECT id,step_index,step_type,label,spec_json,status,result_json,error_message,
    exception_retry_count,started_at,completed_at FROM agent_goal_steps WHERE goal_run_id=? ORDER BY step_index`).all(goal.id).map((step) => ({
      id: step.id, step_index: step.step_index, type: step.step_type, label: step.label,
      status: step.status, retries: Number(step.exception_retry_count || 0),
      input: summarizeJson(step.spec_json), output: summarizeJson(step.result_json), error: clip(step.error_message, 700),
      started_at: step.started_at, completed_at: step.completed_at,
    }));
  const failed = steps.filter((step) => ['failed','awaiting_approval','awaiting_confirmation'].includes(step.status));
  const retried = steps.filter((step) => step.retries > 0);
  const lastOutput = [...steps].reverse().find((step) => step.output || step.error);
  const explanation = failed.length
    ? `${goal.agent_id || 'The assigned agent'} completed ${steps.filter((s) => s.status === 'completed').length}/${steps.length} steps. ${failed.map((s) => `${s.label || s.type}: ${s.error || s.status}`).join(' ')}`
    : retried.length
      ? `${goal.agent_id || 'The assigned agent'} completed the goal after ${retried.reduce((n, s) => n + s.retries, 0)} recorded retry attempt(s). The final evidence was: ${lastOutput?.output || 'completed successfully'}`
      : `${goal.agent_id || 'The assigned agent'} completed all ${steps.length} planned steps without a recorded retry. Final evidence: ${lastOutput?.output || 'completed successfully'}`;
  return { ...goal, steps, input_summary: steps.map((s) => `${s.label || s.type}: ${s.input || '(no structured input)'}`).join('\n'), output_summary: steps.map((s) => `${s.label || s.type}: ${s.error ? `${s.error}${s.output ? ` | captured result: ${s.output}` : ''}` : (s.output || s.status)}`).join('\n'), agent_explanation: clip(explanation, 1200) };
}

function hydrateSnapshot(snapshot) {
  const cache = new Map();
  const hydrate = (item) => {
    if (!item?.id) return item;
    if (!cache.has(item.id)) cache.set(item.id, evidenceDetail(item));
    return cache.get(item.id);
  };
  return { ...snapshot, wins: (snapshot.wins || []).map(hydrate), misses: (snapshot.misses || []).map(hydrate) };
}

function hydrateReview(row) {
  if (!row) return null;
  const feedback = db().prepare('SELECT * FROM company_review_feedback WHERE review_id=? ORDER BY created_at').all(row.id).map((f) => ({ ...f, scope: parse(f.scope_json, []) }));
  const improvements = db().prepare('SELECT * FROM company_review_improvements WHERE review_id=? ORDER BY created_at').all(row.id).map((i) => ({ ...i, scope: parse(i.scope_json, []), evidence: parse(i.evidence_json, []), rollback: parse(i.rollback_json, {}) }));
  const opinions = db().prepare('SELECT * FROM company_review_opinions WHERE review_id=? AND owner_user_id=? ORDER BY created_at').all(row.id, row.owner_user_id);
  for (const improvement of improvements) improvement.learning_versions = listImprovementLearningVersions(row.owner_user_id, improvement.id);
  return { ...row, snapshot: hydrateSnapshot(parse(row.snapshot_json)), feedback, opinions, improvements };
}

function requireMutableReview(ownerUserId, reviewId) {
  const review = getCompanyReview(ownerUserId, reviewId);
  if (!review) throw Object.assign(new Error('Review not found'), { status: 404 });
  if (review.status === 'completed') throw Object.assign(new Error('Completed reviews are locked. Start a new review period to add feedback or improvements.'), { status: 409 });
  return review;
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
  const current = getCompanyReview(ownerUserId, id);
  if (!current) throw Object.assign(new Error('Review not found'), { status: 404 });
  if (current.status === 'completed' && status !== 'completed') throw Object.assign(new Error('Completed reviews are immutable'), { status: 409 });
  if (status === 'completed' && current.improvements.some((item) => ['draft','deferred','refinement_requested'].includes(item.status))) throw Object.assign(new Error('Decide or refine every improvement before finishing the review'), { status: 409 });
  db().prepare(`UPDATE company_reviews SET status=?, started_at=CASE WHEN ?='in_session' THEN COALESCE(started_at,datetime('now')) ELSE started_at END,
    completed_at=CASE WHEN ?='completed' THEN datetime('now') ELSE completed_at END, updated_at=datetime('now') WHERE id=? AND owner_user_id=?`).run(status, status, status, id, ownerUserId);
  return getCompanyReview(ownerUserId, id);
}
export function addReviewOpinion({ ownerUserId, reviewId, evidenceId, actorRole, agentId = '', position, content, proposedRevision = '' }) {
  ensureCompanyReviewTables(); requireMutableReview(ownerUserId, reviewId);
  const roles = new Set(['coo','agent','ceo']); const positions = new Set(['agree','agree_with_revisions','disagree','more_evidence','acknowledge']);
  if (!roles.has(actorRole) || !positions.has(position) || !String(content || '').trim()) throw Object.assign(new Error('Valid actor_role, position, and content are required'), { status: 400 });
  if (agentId) {
    const owned = db().prepare('SELECT 1 FROM user_agents WHERE user_id=? AND agent_id=? AND enabled=1').get(ownerUserId, agentId);
    if (!owned) throw Object.assign(new Error('Agent not found'), { status: 404 });
  }
  db().prepare('INSERT INTO company_review_opinions (id,review_id,owner_user_id,evidence_id,actor_role,agent_id,position,content,proposed_revision) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(`opinion-${randomUUID().replaceAll('-', '').slice(0,16)}`, reviewId, ownerUserId, evidenceId || '', actorRole, agentId, position, String(content).trim(), String(proposedRevision || '').trim());
  return getCompanyReview(ownerUserId, reviewId);
}
export function addReviewFeedback({ ownerUserId, reviewId, evidenceType, evidenceId, agentId, rating, feedback, classification, scope = [] }) {
  ensureCompanyReviewTables(); if (!String(feedback || '').trim()) throw Object.assign(new Error('feedback is required'), { status: 400 });
  requireMutableReview(ownerUserId, reviewId);
  const id = `feedback-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  db().prepare(`INSERT INTO company_review_feedback (id,review_id,owner_user_id,evidence_type,evidence_id,agent_id,rating,feedback,classification,scope_json) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, reviewId, ownerUserId, evidenceType || 'goal', evidenceId || '', agentId || '', rating || 'meets_expectations', String(feedback).trim(), classification || 'reusable_operating_lesson', JSON.stringify(scope));
  return getCompanyReview(ownerUserId, reviewId);
}
export function createImprovement({ ownerUserId, reviewId, title, problem, proposedChange, destination = 'agent_playbook', scope = [], evidence = [], ownerAgentId = '', successMetric = '', evaluationDate = null, validationTest = '' }) {
  ensureCompanyReviewTables();
  if (!String(title || '').trim() || !String(proposedChange || '').trim()) throw Object.assign(new Error('title and proposed_change are required'), { status: 400 });
  requireMutableReview(ownerUserId, reviewId);
  if (destination === 'soul') throw Object.assign(new Error('Soul changes require a separate explicit identity-governance process'), { status: 409 });
  if (String(proposedChange).trim().length < 20 || String(proposedChange).trim().split(/\s+/).length < 4) throw Object.assign(new Error('Proposed change must be a specific, actionable instruction (at least four words and 20 characters)'), { status: 400 });
  const id = `improvement-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  db().prepare(`INSERT INTO company_review_improvements (id,review_id,owner_user_id,title,problem,proposed_change,destination,scope_json,evidence_json,owner_agent_id,success_metric,evaluation_date,validation_test,status,rollback_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?)`).run(id, reviewId, ownerUserId, String(title).trim(), problem || '', String(proposedChange).trim(), destination, JSON.stringify(scope), JSON.stringify(evidence), ownerAgentId, successMetric, evaluationDate, validationTest, JSON.stringify({ previous_version: null, reversible: true }));
  return getCompanyReview(ownerUserId, reviewId);
}
export function decideImprovement({ ownerUserId, improvementId, decision, userId }) {
  ensureCompanyReviewTables();
  const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : decision === 'rollback' ? 'rolled_back' : decision === 'defer' ? 'deferred' : decision === 'refine' ? 'refinement_requested' : null;
  if (!status) throw Object.assign(new Error('decision must be approve, reject, defer, refine, or rollback'), { status: 400 });
  const row = db().prepare('SELECT * FROM company_review_improvements WHERE id=? AND owner_user_id=?').get(improvementId, ownerUserId);
  if (!row) throw Object.assign(new Error('Improvement not found'), { status: 404 });
  if (status === 'approved') {
    const evidenceIds = parse(row.evidence_json, []).map((item) => item.id).filter(Boolean);
    if (evidenceIds.length) {
      const opinions = db().prepare(`SELECT actor_role FROM company_review_opinions WHERE owner_user_id=? AND review_id=? AND evidence_id IN (${evidenceIds.map(() => '?').join(',')})`).all(ownerUserId, row.review_id, ...evidenceIds);
      const roles = new Set(opinions.map((item) => item.actor_role));
      if (!roles.has('coo') || !roles.has('agent')) throw Object.assign(new Error('COO assessment and affected-agent response are required before CEO approval'), { status: 409 });
    }
  }
  const rollback = parse(row.rollback_json, {});
  if (status === 'approved' && !rollback.learning_version_ids?.length) {
    const versions = activateImprovementLearning({ ownerUserId, improvement: row });
    rollback.learning_version_ids = versions.map((item) => item.id); rollback.activated_at = new Date().toISOString(); rollback.rollout_status = versions[0]?.status || 'draft';
  }
  if (status === 'rolled_back') {
    rollback.rolled_back_learning_version_ids = rollbackImprovementLearning({ ownerUserId, improvementId, userId });
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
