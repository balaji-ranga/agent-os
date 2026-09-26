import { getDb } from '../db/schema.js';

function clip(value, max = 1200) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function boundedDays(value) {
  return Math.max(1, Math.min(365, Math.floor(Number(value) || 7)));
}

function boundedLimit(value, fallback = 25) {
  return Math.max(1, Math.min(100, Math.floor(Number(value) || fallback)));
}

function boundedOffset(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function delegationSessionId(prompt, delegationTaskId) {
  const text = String(prompt || '');
  const goalRunId = text.match(/\[goal_run_id:\s*([^\]\s]+)\]/i)?.[1] || '';
  const goalStepId = text.match(/\[goal_step_id:\s*([^\]\s]+)\]/i)?.[1] || '';
  return goalRunId && goalStepId
    ? `goal-${goalRunId}-${goalStepId}`
    : delegationTaskId
      ? `delegation-${delegationTaskId}`
      : null;
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

/**
 * Paginated UI projection of the same owner-scoped work ledger.
 *
 * Unlike archived chat sessions, these records represent work assigned through
 * Kanban/delegation. They remain isolated from the agent's active conversation,
 * but are discoverable from that agent's History panel.
 */
export function listAgentDelegatedWorkHistory({
  ownerUserId,
  agentId,
  days = 90,
  limit = 25,
  offset = 0,
  database = null,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  if (!agent) throw new Error('agent_id required');
  const db = database || getDb();
  const windowDays = boundedDays(days);
  const rowLimit = boundedLimit(limit);
  const rowOffset = boundedOffset(offset);
  const sinceModifier = `-${windowDays} days`;
  const where = `k.owner_user_id = ?
        AND lower(k.assigned_agent_id) = lower(?)
        AND datetime(COALESCE(k.updated_at, k.created_at)) >= datetime('now', ?)`;
  const total = Number(db.prepare(
    `SELECT COUNT(*) AS count FROM kanban_tasks k WHERE ${where}`
  ).get(owner, agent, sinceModifier)?.count || 0);
  const rows = db.prepare(
    `SELECT k.id, k.title, k.description, k.status, k.goal_run_id,
            k.agent_delegation_task_id, k.created_at, k.updated_at,
            d.prompt AS delegation_prompt, d.response_content,
            d.error_message AS delegation_error, d.completed_at
       FROM kanban_tasks k
       LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
      WHERE ${where}
      ORDER BY datetime(COALESCE(d.completed_at, k.updated_at, k.created_at)) DESC, k.id DESC
      LIMIT ? OFFSET ?`
  ).all(owner, agent, sinceModifier, rowLimit, rowOffset);

  return {
    owner_user_id: owner,
    agent_id: agent,
    days: windowDays,
    total,
    limit: rowLimit,
    offset: rowOffset,
    has_more: rowOffset + rows.length < total,
    items: rows.map((row) => ({
      task_id: row.id,
      title: clip(row.title, 500) || `Task #${row.id}`,
      status: row.status,
      goal_run_id: row.goal_run_id || null,
      delegation_task_id: row.agent_delegation_task_id || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at || null,
      request_preview: clip(row.delegation_prompt || row.description, 600) || null,
      outcome_preview: clip(row.response_content || row.delegation_error, 1200) || null,
      has_execution_transcript: Boolean(row.agent_delegation_task_id),
    })),
  };
}

/** Return one owner+agent-scoped Kanban work item and its isolated execution turns. */
export function getAgentDelegatedWorkHistory({
  ownerUserId,
  agentId,
  taskId,
  days = 90,
  database = null,
} = {}) {
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  const task = Number(taskId);
  if (!owner) throw new Error('owner_user_id required');
  if (!agent) throw new Error('agent_id required');
  if (!Number.isSafeInteger(task) || task <= 0) throw new Error('valid task_id required');
  const db = database || getDb();
  const windowDays = boundedDays(days);
  const row = db.prepare(
    `SELECT k.id, k.title, k.description, k.status, k.goal_run_id,
            k.agent_delegation_task_id, k.created_at, k.updated_at,
            d.prompt AS delegation_prompt, d.response_content,
            d.error_message AS delegation_error, d.status AS delegation_status,
            d.created_at AS delegation_created_at, d.completed_at
       FROM kanban_tasks k
       LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
      WHERE k.id = ? AND k.owner_user_id = ?
        AND lower(k.assigned_agent_id) = lower(?)
        AND datetime(COALESCE(k.updated_at, k.created_at)) >= datetime('now', ?)`
  ).get(task, owner, agent, `-${windowDays} days`);
  if (!row) return null;

  const sessionId = delegationSessionId(row.delegation_prompt, row.agent_delegation_task_id);
  const turns = sessionId
    ? db.prepare(
        `SELECT id, role, content, created_at
           FROM chat_turns
          WHERE owner_user_id = ? AND lower(agent_id) = lower(?) AND session_id = ?
          ORDER BY datetime(created_at) ASC, id ASC
          LIMIT 250`
      ).all(owner, agent, sessionId)
    : [];
  const messages = db.prepare(
    `SELECT id, role, content, created_at
       FROM task_messages WHERE task_id = ?
      ORDER BY datetime(created_at) ASC, id ASC LIMIT 250`
  ).all(task);

  return {
    task_id: row.id,
    title: row.title || `Task #${row.id}`,
    description: row.description || '',
    status: row.status,
    goal_run_id: row.goal_run_id || null,
    delegation_task_id: row.agent_delegation_task_id || null,
    delegation_status: row.delegation_status || null,
    request: row.delegation_prompt || row.description || '',
    response: row.response_content || '',
    error: row.delegation_error || null,
    session_id: sessionId,
    created_at: row.created_at,
    updated_at: row.updated_at,
    delegation_created_at: row.delegation_created_at || null,
    completed_at: row.completed_at || null,
    turns,
    task_messages: messages,
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
