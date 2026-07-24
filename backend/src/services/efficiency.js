/**
 * Efficiency View — CEO ops metrics (agents, tasks, feedback, workflows) over time.
 */
import { getDb } from '../db/schema.js';
import { chatOwnerIdsForRead } from './agent-chat-scope.js';
import { getKanbanScopeIds } from './kanban-user-scope.js';
import { listAgentsForUser } from './users.js';

/** @typedef {'7' | '14' | '30' | '90' | 'all'} EfficiencyRange */

const RANGE_TO_DAYS = {
  7: 7,
  14: 14,
  30: 30,
  90: 90,
};

/**
 * @param {string|number|undefined|null} raw
 * @returns {{ key: string, days: number|null }}
 */
export function parseEfficiencyRange(raw) {
  const s = String(raw ?? '14').trim().toLowerCase();
  if (s === 'all' || s === '0') return { key: 'all', days: null };
  if (s === '1m' || s === '1month' || s === 'month') return { key: '30', days: 30 };
  if (s === '3m' || s === '3months' || s === 'quarter') return { key: '90', days: 90 };
  const n = Number(s);
  if (n === 7 || n === 14 || n === 30 || n === 90) return { key: String(n), days: RANGE_TO_DAYS[n] };
  if (Number.isFinite(n) && n >= 1 && n <= 365) return { key: String(Math.floor(n)), days: Math.floor(n) };
  return { key: '14', days: 14 };
}

/** Local calendar YYYY-MM-DD keys (oldest → today). */
function dayKeys(days) {
  const keys = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    keys.push(`${yyyy}-${mm}-${dd}`);
  }
  return keys;
}

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function ownerPlaceholders(ids) {
  return ids.map(() => '?').join(',');
}

function sumField(rows, field) {
  return rows.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
}

function emptySlot(date) {
  return {
    date,
    tasks_created: 0,
    tasks_completed: 0,
    tasks_failed: 0,
    feedback_up: 0,
    feedback_down: 0,
    feedback_score: 0,
    workflow_runs: 0,
    workflow_completed: 0,
    workflow_failed: 0,
  };
}

/**
 * Build consecutive day keys from startDay..until (inclusive), capped at maxDays.
 * If span is huge, use monthly buckets keyed as YYYY-MM-01.
 */
function buildTimelineKeys(startDay, untilDay, maxDaily = 120) {
  if (!startDay || !untilDay) return dayKeys(30);

  const start = new Date(`${startDay}T12:00:00`);
  const end = new Date(`${untilDay}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return dayKeys(30);
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const spanDays = Math.floor((end - start) / dayMs) + 1;

  if (spanDays <= maxDaily) {
    const keys = [];
    for (let t = start.getTime(); t <= end.getTime(); t += dayMs) {
      const d = new Date(t);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      keys.push(`${yyyy}-${mm}-${dd}`);
    }
    return keys;
  }

  // Monthly buckets for long "All" ranges
  const keys = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  const endY = end.getFullYear();
  const endM = end.getMonth();
  while (y < endY || (y === endY && m <= endM)) {
    const mm = String(m + 1).padStart(2, '0');
    keys.push(`${y}-${mm}-01`);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return keys;
}

function bucketKey(day, monthly) {
  const d = String(day || '').slice(0, 10);
  if (!monthly) return d;
  return `${d.slice(0, 7)}-01`;
}

/**
 * @param {string} ownerUserId
 * @param {{ days?: string|number|null }} [opts]
 */
export function getEfficiencySummary(ownerUserId, { days = 14 } = {}) {
  const range = parseEfficiencyRange(days);
  const ownerIds = chatOwnerIdsForRead(ownerUserId);
  const kanbanIds = getKanbanScopeIds(ownerUserId);
  const db = getDb();
  const ph = ownerPlaceholders(ownerIds);
  const kph = ownerPlaceholders(kanbanIds);
  const until = todayKey();

  let startDay = null;
  let keys;
  let monthly = false;

  if (range.days != null) {
    keys = dayKeys(range.days);
    startDay = keys[0];
  } else {
    // Earliest activity across scoped tables
    const earliest = db
      .prepare(
        `SELECT MIN(d) AS d FROM (
           SELECT MIN(date(created_at, 'localtime')) AS d FROM kanban_tasks
             WHERE owner_user_id IN (${kph})
           UNION ALL
           SELECT MIN(date(created_at, 'localtime')) FROM agent_response_feedback
             WHERE owner_user_id IN (${ph})
           UNION ALL
           SELECT MIN(date(started_at, 'localtime')) FROM agent_workflow_runs
             WHERE owner_user_id IN (${ph})
           UNION ALL
           SELECT MIN(date(created_at, 'localtime')) FROM agent_workflow_definitions
             WHERE owner_user_id IN (${ph})
         )`
      )
      .get(...kanbanIds, ...ownerIds, ...ownerIds, ...ownerIds);
    startDay = String(earliest?.d || until).slice(0, 10);
    const s = new Date(`${startDay}T12:00:00`);
    const e = new Date(`${until}T12:00:00`);
    const spanDays =
      Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())
        ? 30
        : Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
    monthly = spanDays > 120;
    keys = buildTimelineKeys(startDay, until, 120);
  }

  const dayFilterCreated = startDay
    ? `date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?`
    : '1=1';
  const dayFilterStarted = startDay
    ? `date(started_at, 'localtime') >= ? AND date(started_at, 'localtime') <= ?`
    : '1=1';
  const dayFilterUpdated = startDay
    ? `date(updated_at, 'localtime') >= ? AND date(updated_at, 'localtime') <= ?`
    : '1=1';
  const dayParams = startDay ? [startDay, until] : [];

  // --- Agents (account entitled; active = had assigned completed/failed task or chat not needed) ---
  const agentsEntitled = listAgentsForUser(ownerUserId).length;

  // --- Kanban tasks automated (assigned to an agent) ---
  const taskCreatedRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS c
       FROM kanban_tasks
       WHERE owner_user_id IN (${kph})
         AND assigned_agent_id IS NOT NULL
         AND TRIM(assigned_agent_id) != ''
         AND ${dayFilterCreated}
       GROUP BY date(created_at, 'localtime')`
    )
    .all(...kanbanIds, ...dayParams);

  const taskOutcomeRows = db
    .prepare(
      `SELECT date(updated_at, 'localtime') AS day, status, COUNT(*) AS c
       FROM kanban_tasks
       WHERE owner_user_id IN (${kph})
         AND assigned_agent_id IS NOT NULL
         AND TRIM(assigned_agent_id) != ''
         AND status IN ('completed', 'failed')
         AND ${dayFilterUpdated}
       GROUP BY date(updated_at, 'localtime'), status`
    )
    .all(...kanbanIds, ...dayParams);

  const taskTotalsCreated = db
    .prepare(
      `SELECT COUNT(*) AS automated
       FROM kanban_tasks
       WHERE owner_user_id IN (${kph})
         AND assigned_agent_id IS NOT NULL
         AND TRIM(assigned_agent_id) != ''
         AND ${dayFilterCreated}`
    )
    .get(...kanbanIds, ...dayParams);

  const taskTotalsOutcome = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM kanban_tasks
       WHERE owner_user_id IN (${kph})
         AND assigned_agent_id IS NOT NULL
         AND TRIM(assigned_agent_id) != ''
         AND status IN ('completed', 'failed')
         AND ${dayFilterUpdated}`
    )
    .get(...kanbanIds, ...dayParams);

  // --- Feedback ---
  const feedbackRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, rating, COUNT(*) AS c
       FROM agent_response_feedback
       WHERE owner_user_id IN (${ph})
         AND ${dayFilterCreated}
       GROUP BY date(created_at, 'localtime'), rating`
    )
    .all(...ownerIds, ...dayParams);

  // --- Workflows ---
  const workflowsAutomated = db
    .prepare(
      `SELECT COUNT(*) AS c FROM agent_workflow_definitions
       WHERE owner_user_id IN (${ph})`
    )
    .get(...ownerIds);

  const workflowsPublished = db
    .prepare(
      `SELECT COUNT(*) AS c FROM agent_workflow_definitions
       WHERE owner_user_id IN (${ph}) AND status = 'published'`
    )
    .get(...ownerIds);

  const runStatusRows = db
    .prepare(
      `SELECT date(started_at, 'localtime') AS day, status, COUNT(*) AS c
       FROM agent_workflow_runs
       WHERE owner_user_id IN (${ph})
         AND ${dayFilterStarted}
       GROUP BY date(started_at, 'localtime'), status`
    )
    .all(...ownerIds, ...dayParams);

  const runTotalsRow = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM agent_workflow_runs
       WHERE owner_user_id IN (${ph})
         AND ${dayFilterStarted}`
    )
    .get(...ownerIds, ...dayParams);

  const byDay = new Map();
  for (const key of keys) {
    byDay.set(key, emptySlot(key));
  }

  const applyDay = (day, fn) => {
    const raw = String(day || '').slice(0, 10);
    const key = bucketKey(raw, monthly);
    if (!byDay.has(key)) return;
    fn(byDay.get(key));
  };

  for (const r of taskCreatedRows) {
    applyDay(r.day, (slot) => {
      slot.tasks_created += Number(r.c) || 0;
    });
  }
  for (const r of taskOutcomeRows) {
    applyDay(r.day, (slot) => {
      if (r.status === 'completed') slot.tasks_completed += Number(r.c) || 0;
      if (r.status === 'failed') slot.tasks_failed += Number(r.c) || 0;
    });
  }
  for (const r of feedbackRows) {
    applyDay(r.day, (slot) => {
      if (r.rating === 'up') slot.feedback_up += Number(r.c) || 0;
      if (r.rating === 'down') slot.feedback_down += Number(r.c) || 0;
    });
  }
  for (const r of runStatusRows) {
    applyDay(r.day, (slot) => {
      const c = Number(r.c) || 0;
      slot.workflow_runs += c;
      if (r.status === 'completed') slot.workflow_completed += c;
      if (r.status === 'failed') slot.workflow_failed += c;
    });
  }

  // Cumulative feedback score (up - down) for "improvements over time"
  let cumUp = 0;
  let cumDown = 0;
  const timeline = [...byDay.values()].map((slot) => {
    cumUp += slot.feedback_up;
    cumDown += slot.feedback_down;
    const totalFb = slot.feedback_up + slot.feedback_down;
    const periodScore = totalFb > 0 ? Math.round((slot.feedback_up / totalFb) * 100) : null;
    return {
      ...slot,
      feedback_score: cumUp - cumDown,
      feedback_positive_pct: periodScore,
      feedback_up_cum: cumUp,
      feedback_down_cum: cumDown,
    };
  });

  const feedbackUp = feedbackRows.filter((r) => r.rating === 'up').reduce((a, r) => a + (Number(r.c) || 0), 0);
  const feedbackDown = feedbackRows.filter((r) => r.rating === 'down').reduce((a, r) => a + (Number(r.c) || 0), 0);
  const feedbackTotal = feedbackUp + feedbackDown;

  const totals = {
    agents: agentsEntitled,
    tasks_automated: Number(taskTotalsCreated?.automated) || sumField(taskCreatedRows, 'c'),
    tasks_completed: Number(taskTotalsOutcome?.completed) || 0,
    tasks_failed: Number(taskTotalsOutcome?.failed) || 0,
    feedback_up: feedbackUp,
    feedback_down: feedbackDown,
    feedback_total: feedbackTotal,
    feedback_positive_pct: feedbackTotal > 0 ? Math.round((feedbackUp / feedbackTotal) * 100) : null,
    feedback_net: feedbackUp - feedbackDown,
    workflows: Number(workflowsAutomated?.c) || 0,
    workflows_published: Number(workflowsPublished?.c) || 0,
    workflow_runs: Number(runTotalsRow?.total) || 0,
    workflow_runs_completed: Number(runTotalsRow?.completed) || 0,
    workflow_runs_failed: Number(runTotalsRow?.failed) || 0,
  };

  return {
    range: range.key,
    days: range.days,
    owner_user_id: ownerUserId,
    owner_ids: ownerIds,
    since: startDay,
    until,
    timeline_granularity: monthly ? 'month' : 'day',
    totals,
    timeline,
  };
}
