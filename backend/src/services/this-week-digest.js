/**
 * This Week Digest - company week rollup (owner-scoped).
 * Insights come from this-week-digest-insights.js (separate assessor).
 */
import { getDb } from '../db/schema.js';
import { getDbForCeo } from '../db/request-db.js';
import { kanbanOwnerSqlFilter } from './kanban-user-scope.js';
import { listAgentsForUser, getUserById } from './users.js';
import { getBusinessProfile } from './company-business-profile.js';
import { buildThisWeekInsights } from './this-week-digest-insights.js';
import { buildDigestEstimatesExplain } from './this-week-digest-explain.js';
import { listGoalRuns, summarizeGoalProgress } from './agent-goal-run.js';

const COMPLETED = new Set(['completed', 'done']);
const FAILED = new Set(['failed']);
const CANCELLED = new Set(['cancelled', 'canceled', 'archived']);
const IN_PROGRESS = new Set(['in_progress', 'in-progress', 'doing', 'active', 'running', 'blocked', 'review']);

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function parseYmd(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function formatRangeLabel(from, to) {
  try {
    const a = from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const b = to.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return a + ' - ' + b;
  } catch {
    return ymd(from) + ' - ' + ymd(to);
  }
}

/** Monday through Sunday (local) for the requested week. */
export function resolveWeekWindow({ weekStart, weekEnd, offsetWeeks = 0 } = {}) {
  const fromQ = parseYmd(weekStart);
  const toQ = parseYmd(weekEnd);
  if (fromQ && toQ && fromQ <= toQ) {
    const span = Math.round((toQ - fromQ) / (24 * 3600 * 1000));
    const prevEnd = addDays(fromQ, -1);
    const prevStart = addDays(prevEnd, -span);
    return {
      start_date: ymd(fromQ),
      end_date: ymd(toQ),
      prev_start: ymd(prevStart),
      prev_end: ymd(prevEnd),
      label: formatRangeLabel(fromQ, toQ),
    };
  }

  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const dow = local.getDay();
  const monOffset = dow === 0 ? -6 : 1 - dow;
  let monday = addDays(local, monOffset);
  const off = Number(offsetWeeks) || 0;
  if (off) monday = addDays(monday, off * 7);
  const sunday = addDays(monday, 6);
  const prevMonday = addDays(monday, -7);
  const prevSunday = addDays(monday, -1);
  return {
    start_date: ymd(monday),
    end_date: ymd(sunday),
    prev_start: ymd(prevMonday),
    prev_end: ymd(prevSunday),
    label: formatRangeLabel(monday, sunday),
  };
}

function pctChange(cur, prev) {
  if (prev == null || prev === 0) {
    if (cur > 0) return { label: 'up ' + cur };
    return { label: '-' };
  }
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const sign = pct >= 0 ? 'up' : 'down';
  return { label: sign + ' ' + Math.abs(Math.round(pct * 10) / 10) + '% vs last week' };
}

function absDeltaLabel(delta) {
  if (!delta) return '-';
  const sign = delta > 0 ? 'up' : 'down';
  return sign + ' ' + Math.abs(delta) + ' this week';
}

function taskDateInRange(row, start, end) {
  const raw = String(row.updated_at || row.completed_at || row.created_at || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  return raw >= start && raw <= end;
}

function statusBucket(st) {
  const s = String(st || '').toLowerCase();
  if (COMPLETED.has(s)) return 'completed';
  if (FAILED.has(s)) return 'failed';
  if (CANCELLED.has(s)) return 'cancelled';
  if (IN_PROGRESS.has(s)) return 'in_progress';
  return 'in_progress';
}

/**
 * @param {string} ownerUserId
 * @param {{ weekStart?: string, weekEnd?: string, offsetWeeks?: number }} opts
 */
export async function buildThisWeekDigest(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });

  const window = resolveWeekWindow(opts);
  const weekStart = window.start_date;
  const weekEnd = window.end_date;
  const prevStart = window.prev_start;
  const prevEnd = window.prev_end;
  const ownerFilter = kanbanOwnerSqlFilter({ id: owner, role: 'ceo' });
  const ceoDb = getDbForCeo(owner);
  const platformDb = getDb();
  const business = getBusinessProfile(owner);

  let companyName = business?.twenty?.workspace_name || business?.erpnext?.company_name || '';
  try {
    const user = getUserById(owner);
    companyName =
      companyName ||
      user?.company_name ||
      user?.display_name ||
      user?.name ||
      String(user?.email || '').split('@')[0] ||
      'your company';
  } catch {
    companyName = companyName || 'your company';
  }

  let agents = [];
  try {
    agents = listAgentsForUser(owner) || [];
  } catch (e) {
    console.warn('[this-week-digest] agents', e?.message || e);
  }
  const agentCount = agents.length;
  const agentsNewWeek = agents.filter((a) => {
    const raw = String(a.created_at || a.granted_at || '').slice(0, 10);
    return raw >= weekStart && raw <= weekEnd;
  }).length;

  let allTasks = [];
  try {
    allTasks = ceoDb
      .prepare(
        'SELECT k.id, k.title, k.status, k.assigned_agent_id, k.due_date, k.created_at, k.updated_at FROM kanban_tasks k WHERE ' +
          ownerFilter.clause +
          ' ORDER BY COALESCE(k.updated_at, k.created_at) DESC LIMIT 500'
      )
      .all(...ownerFilter.params);
  } catch (e) {
    // Tenant CEO SQLite may predate owner_user_id column — whole DB is already that CEO's.
    if (/owner_user_id/i.test(String(e?.message || e))) {
      try {
        allTasks = ceoDb
          .prepare(
            `SELECT k.id, k.title, k.status, k.assigned_agent_id, k.due_date, k.created_at, k.updated_at
             FROM kanban_tasks k
             ORDER BY COALESCE(k.updated_at, k.created_at) DESC LIMIT 500`
          )
          .all();
      } catch (e2) {
        console.warn('[this-week-digest] kanban fallback', e2?.message || e2);
      }
    } else {
      console.warn('[this-week-digest] kanban', e?.message || e);
    }
  }
  // Agent workflows always write Kanban to the platform DB; tenant CEOs also hold cards there.
  try {
    if (ceoDb !== platformDb) {
      try {
        const platformTasks = platformDb
          .prepare(
            'SELECT k.id, k.title, k.status, k.assigned_agent_id, k.due_date, k.created_at, k.updated_at FROM kanban_tasks k WHERE ' +
              ownerFilter.clause +
              ' ORDER BY COALESCE(k.updated_at, k.created_at) DESC LIMIT 500'
          )
          .all(...ownerFilter.params);
        const seen = new Set(allTasks.map((t) => String(t.id)));
        for (const t of platformTasks) {
          if (!seen.has(String(t.id))) allTasks.push(t);
        }
      } catch (e2) {
        console.warn('[this-week-digest] platform kanban', e2?.message || e2);
      }
    }
  } catch (e) {
    console.warn('[this-week-digest] platform kanban', e?.message || e);
  }

  const weekTasks = allTasks.filter((t) => taskDateInRange(t, weekStart, weekEnd));
  const prevTasks = allTasks.filter((t) => taskDateInRange(t, prevStart, prevEnd));

  let completed = 0;
  let inProg = 0;
  let failed = 0;
  let cancelled = 0;
  for (const t of weekTasks) {
    const b = statusBucket(t.status);
    if (b === 'completed') completed += 1;
    else if (b === 'failed') failed += 1;
    else if (b === 'cancelled') cancelled += 1;
    else inProg += 1;
  }
  const prevCompleted = prevTasks.filter((t) => COMPLETED.has(String(t.status || '').toLowerCase())).length;

  let wfWeek = [];
  let wfPrev = [];
  try {
    wfWeek = platformDb
      .prepare(
        "SELECT r.id, r.status, r.definition_id, r.started_at, r.completed_at, r.updated_at, d.name AS definition_name FROM agent_workflow_runs r LEFT JOIN agent_workflow_definitions d ON d.id = r.definition_id WHERE r.owner_user_id = ? AND date(COALESCE(r.completed_at, r.updated_at, r.started_at), 'localtime') >= ? AND date(COALESCE(r.completed_at, r.updated_at, r.started_at), 'localtime') <= ?"
      )
      .all(owner, weekStart, weekEnd);
    wfPrev = platformDb
      .prepare(
        "SELECT r.id, r.status FROM agent_workflow_runs r WHERE r.owner_user_id = ? AND date(COALESCE(r.completed_at, r.updated_at, r.started_at), 'localtime') >= ? AND date(COALESCE(r.completed_at, r.updated_at, r.started_at), 'localtime') <= ?"
      )
      .all(owner, prevStart, prevEnd);
  } catch (e) {
    console.warn('[this-week-digest] workflows', e?.message || e);
  }

  let wfOk = 0;
  let wfFail = 0;
  for (const r of wfWeek) {
    const s = String(r.status || '').toLowerCase();
    if (s === 'completed') wfOk += 1;
    else if (s === 'failed' || s === 'error') wfFail += 1;
  }

  const tasksCompleted = completed + wfOk;
  const tasksCompletedPrev =
    prevCompleted + wfPrev.filter((r) => String(r.status || '').toLowerCase() === 'completed').length;

  const minPerTask = Math.max(15, Number(process.env.THIS_WEEK_MINUTES_PER_TASK) || 45);
  // Fallback for unassigned tasks + completed workflow runs; hire default for AI employees is 10.
  const defaultHourlyRate = Math.max(0, Number(process.env.THIS_WEEK_VALUE_USD_PER_HOUR) || 10);
  const rateByAgentId = new Map();
  for (const a of agents) {
    const id = String(a.id || '').trim();
    if (!id) continue;
    const raw = a.hourly_rate_usd != null ? Number(a.hourly_rate_usd) : defaultHourlyRate;
    rateByAgentId.set(id, Number.isFinite(raw) && raw >= 0 ? raw : defaultHourlyRate);
  }
  function rateForAgent(agentId) {
    const id = String(agentId || '').trim();
    if (!id || id === '_unassigned') return defaultHourlyRate;
    return rateByAgentId.has(id) ? rateByAgentId.get(id) : defaultHourlyRate;
  }
  function valueForCompletions(taskList, workflowCompletedCount) {
    let value = 0;
    const hoursUnit = minPerTask / 60;
    const byRate = new Map();
    for (const task of taskList) {
      if (!COMPLETED.has(String(task.status || '').toLowerCase())) continue;
      const rate = rateForAgent(task.assigned_agent_id);
      value += hoursUnit * rate;
      byRate.set(rate, (byRate.get(rate) || 0) + 1);
    }
    if (workflowCompletedCount > 0) {
      value += hoursUnit * defaultHourlyRate * workflowCompletedCount;
      byRate.set(defaultHourlyRate, (byRate.get(defaultHourlyRate) || 0) + workflowCompletedCount);
    }
    const ratesSummary = [...byRate.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([rate, count]) => ({ usd_per_hour: rate, completed_units: count }));
    return { value: Math.round(value), ratesSummary };
  }
  const timeSavedHours = Math.round(((tasksCompleted * minPerTask) / 60) * 10) / 10;
  const timeSavedPrev = Math.round(((tasksCompletedPrev * minPerTask) / 60) * 10) / 10;
  const valueNow = valueForCompletions(weekTasks, wfOk);
  const valueBefore = valueForCompletions(prevTasks, wfPrev.filter((r) => String(r.status || '').toLowerCase() === 'completed').length);
  const valueDelivered = valueNow.value;
  const valuePrev = valueBefore.value;
  const ratesSummary = valueNow.ratesSummary;
  const hourlyRate = timeSavedHours > 0 ? Math.round((valueDelivered / timeSavedHours) * 100) / 100 : defaultHourlyRate;
  const defaultHourlyForExplain = defaultHourlyRate;

  let tokensWeek = 0;
  let tokensPrev = 0;
  try {
    tokensWeek =
      platformDb
        .prepare(
          "SELECT COALESCE(SUM(total_tokens), 0) AS n FROM token_usage WHERE owner_user_id = ? AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?"
        )
        .get(owner, weekStart, weekEnd)?.n || 0;
    tokensPrev =
      platformDb
        .prepare(
          "SELECT COALESCE(SUM(total_tokens), 0) AS n FROM token_usage WHERE owner_user_id = ? AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?"
        )
        .get(owner, prevStart, prevEnd)?.n || 0;
  } catch (e) {
    console.warn('[this-week-digest] tokens', e?.message || e);
  }

  let workflowsPublishedWeek = 0;
  let connectorsWeek = 0;
  try {
    workflowsPublishedWeek =
      platformDb
        .prepare(
          "SELECT COUNT(*) AS n FROM agent_workflow_definitions WHERE owner_user_id = ? AND date(COALESCE(updated_at, created_at), 'localtime') >= ? AND date(COALESCE(updated_at, created_at), 'localtime') <= ?"
        )
        .get(owner, weekStart, weekEnd)?.n || 0;
  } catch {
    workflowsPublishedWeek = 0;
  }
  try {
    connectorsWeek =
      platformDb
        .prepare(
          "SELECT COUNT(*) AS n FROM mcp_user_servers WHERE owner_user_id = ? AND date(COALESCE(updated_at, created_at), 'localtime') >= ? AND date(COALESCE(updated_at, created_at), 'localtime') <= ?"
        )
        .get(owner, weekStart, weekEnd)?.n || 0;
  } catch {
    connectorsWeek = 0;
  }

  let knowledgeWeek = 0;
  let knowledgePrev = 0;
  try {
    knowledgeWeek =
      platformDb
        .prepare(
          "SELECT COUNT(*) AS n FROM master_data_documents WHERE owner_user_id = ? AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?"
        )
        .get(owner, weekStart, weekEnd)?.n || 0;
    knowledgePrev =
      platformDb
        .prepare(
          "SELECT COUNT(*) AS n FROM master_data_documents WHERE owner_user_id = ? AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?"
        )
        .get(owner, prevStart, prevEnd)?.n || 0;
  } catch {
    knowledgeWeek = 0;
  }

  const orgHighlights = [];
  if (agentsNewWeek > 0) {
    orgHighlights.push({
      icon: 'user-plus',
      text: agentsNewWeek + ' new AI Worker' + (agentsNewWeek === 1 ? '' : 's') + ' onboarded',
    });
  } else if (agentCount > 0) {
    orgHighlights.push({
      icon: 'users',
      text: agentCount + ' AI Worker' + (agentCount === 1 ? '' : 's') + ' on your team',
    });
  }
  if (workflowsPublishedWeek > 0) {
    orgHighlights.push({
      icon: 'workflow',
      text: workflowsPublishedWeek + ' workflow' + (workflowsPublishedWeek === 1 ? '' : 's') + ' updated or published',
    });
  }
  if (connectorsWeek > 0) {
    orgHighlights.push({
      icon: 'plug',
      text: connectorsWeek + ' connector' + (connectorsWeek === 1 ? '' : 's') + ' changed',
    });
  }
  if (knowledgeWeek > 0) {
    orgHighlights.push({
      icon: 'book',
      text: knowledgeWeek + ' knowledge document' + (knowledgeWeek === 1 ? '' : 's') + ' added',
    });
  }
  orgHighlights.push({
    icon: 'uptime',
    text: 'Platform available for your org this week',
  });

  const agentById = new Map(agents.map((a) => [String(a.id), a]));
  /** Multi-source AI worker activity (Kanban alone under-counts Maker/Checker inside workflows). */
  const perAgent = new Map();
  const bump = (rawId, { tasks = 0, completed = 0 } = {}) => {
    const aid = String(rawId || '').trim();
    if (!aid || aid === '_unassigned') return;
    if (!perAgent.has(aid)) {
      perAgent.set(aid, {
        agent_id: aid,
        tasks: 0,
        completed: 0,
        name: agentById.get(aid)?.name || aid,
      });
    }
    const row = perAgent.get(aid);
    row.tasks += tasks;
    row.completed += completed;
  };

  for (const t of weekTasks) {
    const aid = t.assigned_agent_id;
    const done = COMPLETED.has(String(t.status || '').toLowerCase());
    bump(aid, { tasks: 1, completed: done ? 1 : 0 });
  }

  // Workflow agent nodes + delegations (Maker/Checker on CRM/ERP MC graphs)
  try {
    const delRows = platformDb
      .prepare(
        `SELECT to_agent_id, status, created_at, completed_at
         FROM agent_delegation_tasks
         WHERE owner_user_id = ?
           AND date(COALESCE(completed_at, created_at), 'localtime') >= ?
           AND date(COALESCE(completed_at, created_at), 'localtime') <= ?
         LIMIT 2000`
      )
      .all(owner, weekStart, weekEnd);
    for (const d of delRows) {
      const st = String(d.status || '').toLowerCase();
      const done = st === 'completed' || st === 'done' || st === 'success';
      bump(d.to_agent_id, { tasks: 1, completed: done ? 1 : 0 });
    }
  } catch (e) {
    console.warn('[this-week-digest] delegation ranking', e?.message || e);
  }

  // Parse workflow run graphs for agent node completions (covers agent steps without delegate row visible)
  try {
    for (const r of wfWeek) {
      let graph = null;
      try {
        const full = platformDb
          .prepare('SELECT graph_json, context_json FROM agent_workflow_runs WHERE id = ?')
          .get(r.id);
        graph = full?.graph_json ? JSON.parse(full.graph_json) : null;
      } catch {
        graph = null;
      }
      if (!graph?.nodes?.length) continue;
      const agentNodes = graph.nodes.filter((n) => String(n.type || '') === 'agent');
      if (!agentNodes.length) continue;
      let steps = [];
      try {
        steps = platformDb
          .prepare(
            `SELECT node_id, status FROM agent_workflow_run_steps WHERE run_id = ?`
          )
          .all(r.id);
      } catch {
        steps = [];
      }
      const statusByNode = new Map(steps.map((s) => [String(s.node_id), String(s.status || '').toLowerCase()]));
      for (const n of agentNodes) {
        const aid = n.data?.agentId || n.data?.agent_id || n.agentId || n.agent_id;
        if (!aid) continue;
        const st = statusByNode.get(String(n.id)) || '';
        const done = st === 'completed' || st === 'skipped';
        const counted = st === 'completed' || st === 'in_progress' || st === 'failed' || st === 'pending';
        if (counted || done) bump(aid, { tasks: 1, completed: done && st === 'completed' ? 1 : 0 });
      }
    }
  } catch (e) {
    console.warn('[this-week-digest] workflow agent ranking', e?.message || e);
  }

  // Goal-plan orchestrator (COO / balserve) credited for multi-intent plans they own
  try {
    const goalsWeek = listGoalRuns(owner, { limit: 50 }) || [];
    for (const g of goalsWeek) {
      const day = String(g.created_at || '').slice(0, 10);
      if (day < weekStart || day > weekEnd) continue;
      const prog = summarizeGoalProgress(g);
      bump(g.agent_id, {
        tasks: Math.max(1, prog.total_steps || 1),
        completed: prog.completed_steps || (g.status === 'completed' ? 1 : 0),
      });
    }
  } catch (e) {
    console.warn('[this-week-digest] goal-run ranking', e?.message || e);
  }

  let agentRows = [...perAgent.values()].filter((r) => r.agent_id !== '_unassigned');
  // Prefer entitled agents when name is a bare id, re-resolve names
  for (const r of agentRows) {
    if (agentById.has(r.agent_id)) r.name = agentById.get(r.agent_id).name || r.name;
  }
  // If still empty but the CEO has granted agents, note absence of week volume later;
  // Top Performer stays null rather than inventing zero-task winners.
  const topPerformer = [...agentRows].sort((a, b) => b.completed - a.completed || b.tasks - a.tasks)[0] || null;
  const mostActive = [...agentRows].sort((a, b) => b.tasks - a.tasks || b.completed - a.completed)[0] || null;
  const mostTimeSaved = topPerformer;
  const newThisWeek = agents
    .filter((a) => {
      const raw = String(a.created_at || a.granted_at || '').slice(0, 10);
      return raw >= weekStart && raw <= weekEnd;
    })
    .slice(0, 1)[0];

  let goalPlans = [];
  try {
    goalPlans = (listGoalRuns(owner, { limit: 12 }) || []).map((g) => {
      const progress = summarizeGoalProgress(g);
      return {
        id: g.id,
        title: g.title || (g.prompt || '').slice(0, 80) || g.id,
        source: g.source || null,
        status: g.status,
        agent_id: g.agent_id,
        scheduled_goal_id: g.scheduled_goal_id || null,
        created_at: g.created_at,
        completed_at: g.completed_at,
        progress,
        steps: (g.steps || []).map((s) => ({
          step_index: s.step_index,
          step_type: s.step_type,
          label: s.label,
          status: s.status,
          child_workflow_run_id: s.child_workflow_run_id,
        })),
      };
    });
  } catch (e) {
    console.warn('[this-week-digest] goal plans', e?.message || e);
  }

  const byDef = new Map();
  for (const r of wfWeek) {
    const key = String(r.definition_id || r.definition_name || 'unknown');
    if (!byDef.has(key)) {
      byDef.set(key, {
        id: r.definition_id,
        name: r.definition_name || 'Workflow ' + (r.definition_id || ''),
        runs: 0,
        ok: 0,
      });
    }
    const row = byDef.get(key);
    row.runs += 1;
    if (String(r.status || '').toLowerCase() === 'completed') row.ok += 1;
  }
  const topWorkflows = [...byDef.values()]
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 6)
    .map((w) => ({
      ...w,
      success_rate: w.runs ? Math.round((w.ok / w.runs) * 1000) / 10 : 0,
    }));

  const perfCompleted = completed + wfOk;
  const perfFailed = failed + wfFail;
  const perfInProg = inProg;
  const perfCancelled = cancelled;
  const perfTotal = Math.max(1, perfCompleted + perfInProg + perfFailed + perfCancelled);
  const performance = {
    total: perfCompleted + perfInProg + perfFailed + perfCancelled,
    completed: perfCompleted,
    in_progress: perfInProg,
    failed: perfFailed,
    cancelled: perfCancelled,
    slices: [
      { key: 'completed', label: 'Completed', count: perfCompleted, pct: Math.round((perfCompleted / perfTotal) * 1000) / 10, color: '#22c55e' },
      { key: 'in_progress', label: 'In Progress', count: perfInProg, pct: Math.round((perfInProg / perfTotal) * 1000) / 10, color: '#3b82f6' },
      { key: 'failed', label: 'Failed', count: perfFailed, pct: Math.round((perfFailed / perfTotal) * 1000) / 10, color: '#f43f5e' },
      { key: 'cancelled', label: 'Cancelled', count: perfCancelled, pct: Math.round((perfCancelled / perfTotal) * 1000) / 10, color: '#eab308' },
    ],
  };

  const successRate =
    perfCompleted + perfFailed > 0
      ? Math.round((perfCompleted / (perfCompleted + perfFailed)) * 1000) / 10
      : perfCompleted > 0
        ? 100
        : 0;
  const prevFail =
    prevTasks.filter((t) => FAILED.has(String(t.status || '').toLowerCase())).length +
    wfPrev.filter((r) => ['failed', 'error'].includes(String(r.status || '').toLowerCase())).length;
  const prevOk =
    prevCompleted + wfPrev.filter((r) => String(r.status || '').toLowerCase() === 'completed').length;
  const prevSuccess = prevOk + prevFail > 0 ? Math.round((prevOk / (prevOk + prevFail)) * 1000) / 10 : 0;
  const successDelta = successRate - prevSuccess;

  const names = new Map(agents.map((a) => [String(a.id), a.name || a.id]));
  const activity = [];
  for (const t of weekTasks.slice(0, 40)) {
    const st = String(t.status || '').toLowerCase();
    if (!['completed', 'done', 'failed'].includes(st)) continue;
    const who = names.get(String(t.assigned_agent_id || '')) || 'AI Worker';
    const verb = st === 'failed' ? 'failed a task' : 'completed a task';
    activity.push({
      id: 'k-' + t.id,
      at: t.updated_at || t.created_at,
      icon: st === 'failed' ? 'warning' : 'check',
      text: who + ' ' + verb + ': ' + String(t.title || 'Task').slice(0, 100),
    });
  }
  for (const r of wfWeek.slice(0, 20)) {
    const st = String(r.status || '').toLowerCase();
    if (!['completed', 'failed', 'error'].includes(st)) continue;
    activity.push({
      id: 'w-' + r.id,
      at: r.completed_at || r.updated_at || r.started_at,
      icon: st === 'completed' ? 'workflow' : 'warning',
      text:
        st === 'completed'
          ? 'Workflow ' + (r.definition_name || r.definition_id) + ' completed'
          : 'Workflow ' + (r.definition_name || r.definition_id) + ' failed',
    });
  }
  if (knowledgeWeek > 0) {
    activity.push({
      id: 'knowledge',
      at: weekEnd + 'T12:00:00',
      icon: 'book',
      text: knowledgeWeek + ' document' + (knowledgeWeek === 1 ? '' : 's') + ' added to Knowledge Base',
    });
  }
  activity.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  const kpis = {
    ai_workers: {
      value: agentCount,
      label: 'AI Workers',
      delta_label: agentsNewWeek > 0 ? absDeltaLabel(agentsNewWeek) : agentCount ? agentCount + ' active' : '-',
      icon: 'users',
    },
    tasks_completed: {
      value: tasksCompleted,
      label: 'Tasks Completed',
      delta_label: pctChange(tasksCompleted, tasksCompletedPrev).label,
      icon: 'rocket',
    },
    time_saved: {
      value: timeSavedHours,
      display: timeSavedHours.toLocaleString() + ' hrs',
      label: 'Time Saved',
      delta_label: pctChange(timeSavedHours, timeSavedPrev).label,
      icon: 'clock',
      note: 'Est. ' + minPerTask + ' min/task',
      explain: buildDigestEstimatesExplain({ minutesPerTask: minPerTask, usdPerHour: defaultHourlyForExplain, weightedAvgRate: hourlyRate, ratesSummary }).time_saved,
    },
    value_delivered: {
      value: valueDelivered,
      display: '$' + valueDelivered.toLocaleString(),
      label: 'Est. Value Delivered',
      delta_label: pctChange(valueDelivered, valuePrev).label,
      icon: 'dollar',
      note: 'per AI worker rate (avg $' + hourlyRate + '/hr)',
      explain: buildDigestEstimatesExplain({
        minutesPerTask: minPerTask,
        usdPerHour: defaultHourlyForExplain,
        weightedAvgRate: hourlyRate,
        ratesSummary,
      }).value_delivered,
    },
  };

  const facts = {
    time_saved_hours: timeSavedHours,
    tokens_week: tokensWeek,
    tokens_prev_week: tokensPrev,
    workflows_published_week: workflowsPublishedWeek,
    knowledge_docs_week: knowledgeWeek,
    knowledge_docs_prev: knowledgePrev,
  };

  let insights = [];
  try {
    insights = await buildThisWeekInsights(owner, {
      weekStart,
      weekEnd,
      prevStart,
      prevEnd,
      facts,
    });
  } catch (e) {
    console.warn('[this-week-digest] insights', e?.message || e);
    insights = [
      {
        id: 'insights_error',
        kind: 'suggestion',
        icon: 'bulb',
        title: 'Insights',
        body: 'Insights assessor temporarily unavailable. Metrics above still reflect this week.',
      },
    ];
  }

  console.info(
    '[this-week-digest] owner=%s week=%s..%s tasks=%s agents=%s insights=%s',
    owner,
    weekStart,
    weekEnd,
    tasksCompleted,
    agentCount,
    insights.length
  );

  return {
    company_name: companyName,
    week: {
      start_date: weekStart,
      end_date: weekEnd,
      prev_start: prevStart,
      prev_end: prevEnd,
      label: window.label,
    },
    kpis,
    organization_highlights: orgHighlights,
    ai_worker_highlights: {
      top_performer: topPerformer
        ? {
            name: topPerformer.name,
            agent_id: topPerformer.agent_id,
            tasks: topPerformer.completed,
            label: 'Top Performer',
            metric_note: 'Kanban + workflow agent steps + delegations completed',
          }
        : null,
      most_active: mostActive
        ? {
            name: mostActive.name,
            agent_id: mostActive.agent_id,
            tasks: mostActive.tasks,
            label: 'Most Active',
            metric_note: 'Kanban + workflow steps + delegations + goal plans',
          }
        : null,
      most_time_saved: mostTimeSaved
        ? {
            name: mostTimeSaved.name,
            agent_id: mostTimeSaved.agent_id,
            hours: Math.round(((mostTimeSaved.completed * minPerTask) / 60) * 10) / 10,
            label: 'Most Time Saved',
          }
        : null,
      new_this_week: newThisWeek
        ? { name: newThisWeek.name || newThisWeek.id, label: 'New This Week', badge: 'NEW' }
        : null,
      empty_reason:
        !topPerformer && !mostActive && agentCount > 0
          ? 'No worker activity attributed this week (check Kanban assignees, workflow agents, delegations).'
          : !agentCount
            ? 'No AI workers granted for this CEO yet.'
            : null,
    },
    goal_plans: goalPlans,
    top_workflows: topWorkflows,
    performance: {
      ...performance,
      success_rate: successRate,
      success_delta: successDelta,
      success_delta_label:
        prevSuccess > 0 || successRate > 0
          ? (successDelta >= 0 ? 'up ' : 'down ') + Math.abs(Math.round(successDelta * 10) / 10) + '% vs last week'
          : '-',
    },
    activity: activity.slice(0, 12),
    insights,
    estimates: (() => {
      const explain = buildDigestEstimatesExplain({
        minutesPerTask: minPerTask,
        usdPerHour: defaultHourlyForExplain,
        weightedAvgRate: hourlyRate,
        ratesSummary,
      });
      return {
        minutes_per_task: minPerTask,
        usd_per_hour: defaultHourlyForExplain,
        weighted_avg_usd_per_hour: hourlyRate,
        rates_summary: ratesSummary,
        time_saved_hours: timeSavedHours,
        value_delivered_usd: valueDelivered,
        tasks_completed_count: tasksCompleted,
        formula_time_saved: explain.time_saved.formula,
        formula_value: explain.value_delivered.formula,
        explain,
      };
    })(),
    links: {
      agents: '/workspace',
      workflows: '/agent-workflows',
      activity: '/work',
      ask_ai: '/',
      efficiency: '/efficiency',
      scheduled_goals: '/scheduled-goals',
    },
  };
}
