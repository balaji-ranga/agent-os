/** Owner-scoped read model across Flolah execution runtimes. */
import { getDb } from '../db/schema.js';

function parseJson(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
}

export function normalizeExecutionStatus(status) {
  const s = String(status || '').toLowerCase();
  if (['completed', 'complete', 'done', 'closed', 'success', 'succeeded'].includes(s)) return 'completed';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(s)) return 'failed';
  if (['blocked', 'blocked_on_input', 'waiting', 'awaiting_approval', 'paused'].includes(s)) return 'blocked';
  if (['running', 'in_progress', 'active', 'recording', 'processing'].includes(s)) return 'running';
  return 'pending';
}

export function verificationFromResult(status, result, error = null) {
  const normalized = normalizeExecutionStatus(status);
  if (normalized === 'failed') return { state: 'failed', evidence: [], error: error || result?.error || null };
  if (normalized !== 'completed') return { state: 'not_due', evidence: [], error: null };
  const r = result && typeof result === 'object' ? result : {};
  const evidence = [];
  const add = (type, value) => { if (value != null && value !== '') evidence.push({ type, value }); };
  add('artifact', r.artifact_id || r.media_artifact_id);
  add('url', r.public_url || r.post_url || r.url);
  add('provider_receipt', r.message_id || r.post_id || r.receipt_id || r.docname || r.record_id);
  if (Array.isArray(r.artifacts)) {
    for (const item of r.artifacts.slice(0, 10)) add('artifact', item?.id || item?.artifact_id || item);
  }
  const explicit = String(r.verification_status || r.acceptance || '').toLowerCase();
  const verified = ['verified', 'accepted', 'qualified'].includes(explicit) || r.verified === true;
  return { state: verified || evidence.length ? 'verified' : 'unverified', evidence, error: null };
}

function safeRows(sql, args = []) {
  try { return getDb().prepare(sql).all(...args); } catch { return []; }
}

function goalExecutions(owner, limit) {
  return safeRows(
    `SELECT id, agent_id, title, prompt, status, outcome_json, error_message, created_at, updated_at, completed_at
     FROM agent_goal_runs WHERE owner_user_id = ? ORDER BY datetime(created_at) DESC LIMIT ?`, [owner, limit]
  ).map((r) => {
    const outcome = parseJson(r.outcome_json, {});
    const accepted = outcome?.last_observation?.class === 'accepted';
    const targetMet = Number(outcome?.target || 0) > 0 && Number(outcome?.current_value || 0) >= Number(outcome.target);
    return {
      id: `goal:${r.id}`, source_type: 'goal_plan', source_id: r.id, title: r.title || r.prompt || 'Goal plan',
      owner_agent_id: r.agent_id || null, status: normalizeExecutionStatus(r.status), raw_status: r.status,
      verification: verificationFromResult(r.status, { verified: accepted || targetMet }, r.error_message),
      progress: { current: outcome?.current_value ?? null, target: outcome?.target ?? null }, error: r.error_message || null,
      created_at: r.created_at, updated_at: r.updated_at, completed_at: r.completed_at,
      detail_path: `/goal-plans/${encodeURIComponent(r.id)}`,
    };
  });
}

function workflowExecutions(owner, limit) {
  return safeRows(
    `SELECT r.id, r.definition_id, r.status, r.progress_pct, r.context_json, r.error_message,
            r.started_at, r.updated_at, r.completed_at, d.name AS definition_name
     FROM agent_workflow_runs r LEFT JOIN agent_workflow_definitions d ON d.id = r.definition_id
     WHERE r.owner_user_id = ? ORDER BY datetime(r.started_at) DESC LIMIT ?`, [owner, limit]
  ).map((r) => ({
    id: `workflow:${r.id}`, source_type: 'workflow', source_id: String(r.id),
    title: r.definition_name || r.definition_id || `Workflow #${r.id}`, owner_agent_id: null,
    status: normalizeExecutionStatus(r.status), raw_status: r.status,
    verification: verificationFromResult(r.status, parseJson(r.context_json, {}), r.error_message),
    progress: { percent: Number(r.progress_pct || 0) }, error: r.error_message || null,
    created_at: r.started_at, updated_at: r.updated_at, completed_at: r.completed_at,
    detail_path: '/workflows',
  }));
}

function browserExecutions(owner, limit) {
  return safeRows(
    `SELECT id, agent_id, goal_text, status, result_json, error, selected_driver_mode, created_at, updated_at
     FROM browser_tasks WHERE ceo_user_id = ? ORDER BY datetime(created_at) DESC LIMIT ?`, [owner, limit]
  ).map((r) => ({
    id: `browser:${r.id}`, source_type: 'browser', source_id: r.id, title: r.goal_text || 'Browser task',
    owner_agent_id: r.agent_id || null, status: normalizeExecutionStatus(r.status), raw_status: r.status,
    verification: verificationFromResult(r.status, parseJson(r.result_json, {}), r.error),
    executor: r.selected_driver_mode || null, progress: null, error: r.error || null,
    created_at: r.created_at, updated_at: r.updated_at,
    completed_at: ['completed', 'failed'].includes(r.status) ? r.updated_at : null, detail_path: '/browser-session',
  }));
}

function kanbanExecutions(owner, limit) {
  return safeRows(
    `SELECT id, title, status, assigned_agent_id, created_at, updated_at
     FROM kanban_tasks WHERE owner_user_id = ? ORDER BY datetime(created_at) DESC LIMIT ?`, [owner, limit]
  ).map((r) => ({
    id: `kanban:${r.id}`, source_type: 'kanban', source_id: String(r.id), title: r.title || `Task #${r.id}`,
    owner_agent_id: r.assigned_agent_id || null, status: normalizeExecutionStatus(r.status), raw_status: r.status,
    verification: verificationFromResult(r.status, {}, null), progress: null, error: null,
    created_at: r.created_at, updated_at: r.updated_at,
    completed_at: normalizeExecutionStatus(r.status) === 'completed' ? r.updated_at : null, detail_path: '/kanban',
  }));
}

export function listCompanyExecutions(ownerUserId, { limit = 30 } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) { const error = new Error('CEO context required'); error.status = 403; throw error; }
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const each = Math.max(lim, 20);
  const executions = [...goalExecutions(owner, each), ...workflowExecutions(owner, each),
    ...browserExecutions(owner, each), ...kanbanExecutions(owner, each)]
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .slice(0, lim);
  const counts = { total: executions.length, pending: 0, running: 0, blocked: 0, failed: 0, completed: 0, unverified: 0 };
  for (const item of executions) {
    counts[item.status] += 1;
    if (item.verification?.state === 'unverified') counts.unverified += 1;
  }
  return { executions, counts, generated_at: new Date().toISOString() };
}
