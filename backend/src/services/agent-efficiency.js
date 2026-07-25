/**
 * Per-agent efficiency metrics for Efficiency View → Agent View.
 *
 * Covers internal OpenClaw agents and org leaf members (external / published A2A agents),
 * both addressed by `member_key`. All queries are scoped to the signed-in CEO.
 */
import { getDb } from '../db/schema.js';
import { chatOwnerIdsForRead } from './agent-chat-scope.js';
import { getKanbanScopeIds } from './kanban-user-scope.js';
import { listAgentsForUser } from './users.js';
import { listOrgAgentMembers } from './org-agent-members.js';
import { getMemberBudgetStatus } from './agent-budgets.js';
import { getTokenTimeline, getTokensBySource, monthPeriod } from './token-usage.js';
import { parseEfficiencyRange } from './efficiency.js';

function dayKeys(days) {
  const keys = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - i);
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }
  return keys;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isLeafKey(memberKey) {
  const k = String(memberKey || '');
  return k.startsWith('ext:') || k.startsWith('a2a:');
}

/**
 * Members selectable in Agent View: internal agents + enabled org leaf members,
 * each with its current-month budget state.
 */
export function listEfficiencyMembers(ownerUserId) {
  const internal = listAgentsForUser(ownerUserId).map((a) => ({
    member_key: a.id,
    name: a.name,
    kind: a.is_coo ? 'coo' : 'internal',
    department: a.department || '',
    role: a.role || '',
    parent_id: a.parent_id || '',
  }));
  const leaf = listOrgAgentMembers(ownerUserId, { enabledOnly: false }).map((m) => ({
    member_key: m.id,
    name: m.display_name,
    kind: m.kind,
    department: m.department || '',
    role: m.purpose || '',
    parent_id: m.parent_id || '',
    enabled: m.enabled,
  }));
  const all = [...internal, ...leaf];
  return all.map((m) => {
    let budget = null;
    try {
      budget = getMemberBudgetStatus(ownerUserId, m.member_key);
    } catch (e) {
      console.warn('[agent-efficiency] budget status failed', m.member_key, e?.message || e);
    }
    return {
      ...m,
      budget_state: budget?.state || 'ok',
      tokens_used: budget?.tokens_used ?? 0,
      monthly_token_budget: budget?.monthly_token_budget ?? null,
      failure_rate: budget?.failure_rate ?? null,
      error_budget_pct: budget?.error_budget_pct ?? null,
    };
  });
}

/**
 * Resolve a member key to one of the CEO's own members.
 * Throws a 404-shaped error when the key is not in the caller's org, so callers cannot probe
 * or write budgets for members they are not entitled to.
 */
export function requireEfficiencyMember(ownerUserId, memberKey) {
  const key = String(memberKey || '').trim();
  if (!key) {
    const err = new Error('member key required');
    err.status = 400;
    throw err;
  }
  const member = listEfficiencyMembers(ownerUserId).find((m) => m.member_key === key);
  if (!member) {
    console.warn('[agent-efficiency] member not in caller org owner=%s member=%s', ownerUserId, key);
    const err = new Error('Agent not found');
    err.status = 404;
    throw err;
  }
  return member;
}

function emptySlot(date) {
  return {
    date,
    prompts: 0,
    tool_calls: 0,
    tool_errors: 0,
    tasks_completed: 0,
    tasks_failed: 0,
    tokens: 0,
    tokens_cumulative: 0,
    failure_rate: null,
  };
}

/**
 * Agent View metrics for one member over a range.
 * @param {string} ownerUserId
 * @param {string} memberKey internal agent id or org_agent_members.id
 * @param {{ days?: string|number|null }} [opts]
 */
export function getAgentEfficiency(ownerUserId, memberKey, { days = 30 } = {}) {
  const key = String(memberKey || '').trim();
  if (!key) throw new Error('member key required');
  const range = parseEfficiencyRange(days);
  const windowDays = range.days ?? 90;
  const keys = dayKeys(windowDays);
  const since = keys[0];
  const until = todayKey();
  const db = getDb();
  const ownerIds = chatOwnerIdsForRead(ownerUserId);
  const kanbanIds = getKanbanScopeIds(ownerUserId);
  const ph = ownerIds.map(() => '?').join(',');
  const kph = kanbanIds.map(() => '?').join(',');
  const leaf = isLeafKey(key);

  const byDay = new Map(keys.map((k) => [k, emptySlot(k)]));
  const apply = (day, fn) => {
    const slot = byDay.get(String(day || '').slice(0, 10));
    if (slot) fn(slot);
  };

  let promptRows = [];
  let toolRows = [];
  let feedbackRows = [];
  let taskRows = [];
  let latencyRow = null;

  if (!leaf) {
    promptRows = db
      .prepare(
        `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS c
         FROM chat_turns
         WHERE role = 'user' AND agent_id = ? AND owner_user_id IN (${ph})
           AND date(created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY date(created_at, 'localtime')`
      )
      .all(key, ...ownerIds, since, until);

    toolRows = db
      .prepare(
        `SELECT date(created_at, 'localtime') AS day, status, COUNT(*) AS c, tool_name
         FROM content_tool_logs
         WHERE owner_user_id IN (${ph})
           AND LOWER(COALESCE(source, '')) LIKE ?
           AND date(created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY date(created_at, 'localtime'), status, tool_name`
      )
      .all(...ownerIds, `%${key.toLowerCase()}%`, since, until);

    feedbackRows = db
      .prepare(
        `SELECT rating, COUNT(*) AS c
         FROM agent_response_feedback
         WHERE owner_user_id IN (${ph}) AND agent_id = ?
           AND date(created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY rating`
      )
      .all(...ownerIds, key, since, until);

    taskRows = db
      .prepare(
        `SELECT date(updated_at, 'localtime') AS day, status, COUNT(*) AS c
         FROM kanban_tasks
         WHERE owner_user_id IN (${kph}) AND assigned_agent_id = ?
           AND status IN ('completed', 'failed')
           AND date(updated_at, 'localtime') BETWEEN ? AND ?
         GROUP BY date(updated_at, 'localtime'), status`
      )
      .all(...kanbanIds, key, since, until);

    latencyRow = db
      .prepare(
        `SELECT AVG((julianday(completed_at) - julianday(created_at)) * 86400000) AS avg_ms, COUNT(*) AS c
         FROM agent_delegation_tasks
         WHERE to_agent_id = ? AND completed_at IS NOT NULL
           AND date(created_at, 'localtime') BETWEEN ? AND ?`
      )
      .get(key, since, until);
  } else {
    taskRows = db
      .prepare(
        `SELECT date(created_at, 'localtime') AS day,
                CASE WHEN status = 'ok' THEN 'completed' ELSE 'failed' END AS status,
                COUNT(*) AS c
         FROM org_member_invocations
         WHERE owner_user_id = ? AND member_key = ?
           AND date(created_at, 'localtime') BETWEEN ? AND ?
         GROUP BY date(created_at, 'localtime'), status`
      )
      .all(String(ownerUserId), key, since, until);

    latencyRow = db
      .prepare(
        `SELECT AVG(latency_ms) AS avg_ms, COUNT(*) AS c
         FROM org_member_invocations
         WHERE owner_user_id = ? AND member_key = ? AND latency_ms IS NOT NULL
           AND date(created_at, 'localtime') BETWEEN ? AND ?`
      )
      .get(String(ownerUserId), key, since, until);
  }

  const tokenRows = getTokenTimeline(ownerUserId, key, { since, until });
  const tokensBySource = getTokensBySource(ownerUserId, key, { since, until });

  for (const r of promptRows) apply(r.day, (s) => (s.prompts += Number(r.c) || 0));
  const toolTotals = new Map();
  for (const r of toolRows) {
    const c = Number(r.c) || 0;
    const isError = String(r.status || '').toLowerCase() !== 'success' &&
      String(r.status || '').toLowerCase() !== 'ok';
    apply(r.day, (s) => {
      s.tool_calls += c;
      if (isError) s.tool_errors += c;
    });
    const entry = toolTotals.get(r.tool_name) || { tool_name: r.tool_name, ok: 0, error: 0 };
    if (isError) entry.error += c;
    else entry.ok += c;
    toolTotals.set(r.tool_name, entry);
  }
  for (const r of taskRows) {
    apply(r.day, (s) => {
      if (r.status === 'completed') s.tasks_completed += Number(r.c) || 0;
      else s.tasks_failed += Number(r.c) || 0;
    });
  }
  for (const r of tokenRows) apply(r.day, (s) => (s.tokens += r.tokens));

  let cumTokens = 0;
  let cumOk = 0;
  let cumFailed = 0;
  const timeline = [...byDay.values()].map((slot) => {
    cumTokens += slot.tokens;
    cumOk += slot.tasks_completed;
    cumFailed += slot.tasks_failed;
    const terminal = cumOk + cumFailed;
    return {
      ...slot,
      tokens_cumulative: cumTokens,
      failure_rate: terminal > 0 ? Math.round((cumFailed / terminal) * 1000) / 10 : 0,
    };
  });

  const feedbackUp = feedbackRows.find((r) => r.rating === 'up')?.c || 0;
  const feedbackDown = feedbackRows.find((r) => r.rating === 'down')?.c || 0;
  const feedbackTotal = Number(feedbackUp) + Number(feedbackDown);

  const budget = getMemberBudgetStatus(ownerUserId, key);
  const tasksCompleted = timeline.reduce((a, s) => a + s.tasks_completed, 0);
  const tasksFailed = timeline.reduce((a, s) => a + s.tasks_failed, 0);
  const terminal = tasksCompleted + tasksFailed;

  return {
    member_key: key,
    kind: leaf ? 'leaf' : 'internal',
    range: range.key,
    days: range.days,
    since,
    until,
    period: monthPeriod(),
    budget,
    totals: {
      prompts: timeline.reduce((a, s) => a + s.prompts, 0),
      tool_calls: timeline.reduce((a, s) => a + s.tool_calls, 0),
      tool_errors: timeline.reduce((a, s) => a + s.tool_errors, 0),
      tasks_completed: tasksCompleted,
      tasks_failed: tasksFailed,
      failure_rate: terminal > 0 ? Math.round((tasksFailed / terminal) * 1000) / 10 : null,
      tokens: timeline.reduce((a, s) => a + s.tokens, 0),
      feedback_up: Number(feedbackUp),
      feedback_down: Number(feedbackDown),
      feedback_positive_pct:
        feedbackTotal > 0 ? Math.round((Number(feedbackUp) / feedbackTotal) * 100) : null,
      avg_latency_ms: latencyRow?.avg_ms == null ? null : Math.round(Number(latencyRow.avg_ms)),
      latency_samples: Number(latencyRow?.c) || 0,
    },
    timeline,
    tokens_by_source: tokensBySource,
    top_tools: [...toolTotals.values()].sort((a, b) => b.ok + b.error - (a.ok + a.error)).slice(0, 8),
  };
}
