import { getDb } from '../db/schema.js';

function clip(value, max = 1200) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function boundedDays(value) {
  return Math.max(1, Math.min(365, Math.floor(Number(value) || 7)));
}

export function historyWindowDays(text, fallback = 7) {
  const source = String(text || '');
  const match = source.match(/(?:last|past|previous|over\s+the\s+last)\s+(\d{1,3})\s+days?/i);
  return boundedDays(match?.[1] || fallback);
}

/**
 * Authoritative, owner-scoped history for one AI employee.
 *
 * Kanban is the durable work ledger. Delegation responses are joined only through
 * the task's immutable foreign key; no chat/RAG inference is involved. Keeping
 * the database injectable makes the owner/agent boundary independently testable.
 */
export function listAgentWorkHistory({
  ownerUserId,
  agentId,
  days = 7,
  limit = 50,
  excludeGoalRunId = null,
  database = null,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  if (!agent) throw new Error('agent_id required');
  const db = database || getDb();
  const windowDays = boundedDays(days);
  const rowLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const sinceModifier = `-${windowDays} days`;
  const excludedGoal = String(excludeGoalRunId || '').trim();
  const rows = db.prepare(
    `SELECT k.id, k.title, k.description, k.status, k.goal_run_id,
            k.agent_delegation_task_id, k.created_at, k.updated_at,
            d.response_content, d.error_message AS delegation_error, d.completed_at
       FROM kanban_tasks k
       LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
      WHERE k.owner_user_id = ?
        AND lower(k.assigned_agent_id) = lower(?)
        AND datetime(COALESCE(k.updated_at, k.created_at)) >= datetime('now', ?)
        AND (? = '' OR COALESCE(k.goal_run_id, '') <> ?)
      ORDER BY datetime(COALESCE(k.updated_at, k.created_at)) DESC, k.id DESC
      LIMIT ?`
  ).all(owner, agent, sinceModifier, excludedGoal, excludedGoal, rowLimit);

  const byStatus = {};
  for (const row of rows) byStatus[row.status] = Number(byStatus[row.status] || 0) + 1;
  const items = rows.map((row) => ({
    task_id: row.id,
    title: clip(row.title, 500),
    status: row.status,
    goal_run_id: row.goal_run_id || null,
    delegation_task_id: row.agent_delegation_task_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null,
    outcome: clip(row.response_content || row.delegation_error || row.description, 2000) || null,
  }));
  const activityCount = items.length;
  return {
    owner_user_id: owner,
    agent_id: agent,
    days: windowDays,
    activity_count: activityCount,
    counts: {
      total: activityCount,
      completed: Number(byStatus.completed || 0),
      failed: Number(byStatus.failed || 0),
      in_progress: Number(byStatus.in_progress || 0),
      open: Number(byStatus.open || 0),
      awaiting_confirmation: Number(byStatus.awaiting_confirmation || 0),
      cancelled: Number(byStatus.cancelled || 0),
    },
    items,
    evidence_source: 'owner_scoped_kanban_and_delegation_ledger',
    excluded_goal_run_id: excludedGoal || null,
  };
}

export function compactAgentWorkHistoryEvidence(history, limit = 20) {
  if (!history) return null;
  return {
    evidence_id: history.evidence_id || null,
    captured_at: history.captured_at || null,
    owner_user_id: history.owner_user_id,
    agent_id: history.agent_id,
    days: history.days,
    activity_count: history.activity_count,
    counts: history.counts,
    evidence_source: history.evidence_source,
    excluded_goal_run_id: history.excluded_goal_run_id || null,
    items: (history.items || []).slice(0, Math.max(1, Number(limit) || 20)),
  };
}
