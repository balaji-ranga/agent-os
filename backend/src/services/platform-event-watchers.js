/**
 * Admin-visible event watchers + safety-net reconcile ticks.
 */
import { getDb } from '../db/schema.js';
import {
  ensureAgentGoalRunTables,
  onWorkflowTerminalForGoalRun,
  nudgeCooOnGoalPlanTerminal,
} from './agent-goal-run.js';
import { isPlatformCronActive } from './platform-cron-registry.js';

const TERMINAL_WF = new Set(['completed', 'failed', 'cancelled', 'paused']);

function db() {
  return getDb();
}

export async function runGoalPlanCompletionNudgeSweep({ limit = 25 } = {}) {
  if (!isPlatformCronActive('goal_plan_completion_nudge')) {
    return { ok: true, skipped: true, reason: 'paused_or_disabled' };
  }
  ensureAgentGoalRunTables();
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const rows = db()
    .prepare(
      "SELECT id, status, context_json FROM agent_goal_runs WHERE status IN ('completed', 'failed') ORDER BY datetime(COALESCE(completed_at, updated_at)) DESC LIMIT ?"
    )
    .all(lim);

  const candidates = [];
  for (const row of rows) {
    let ctx = {};
    try {
      ctx = row.context_json ? JSON.parse(row.context_json) : {};
    } catch (_) {
      ctx = {};
    }
    if (ctx.coo_completion_nudge_at) continue;
    candidates.push(row);
  }

  const results = [];
  for (const row of candidates.slice(0, lim)) {
    try {
      const out = await nudgeCooOnGoalPlanTerminal(row.id, { status: row.status });
      results.push({ id: row.id, ...out });
    } catch (e) {
      results.push({ id: row.id, ok: false, error: e?.message || String(e) });
    }
  }
  if (results.length) {
    console.info('[platform-watcher] goal_plan_completion_nudge sweep', {
      candidates: candidates.length,
      ran: results.length,
    });
  }
  return { ok: true, candidates: candidates.length, results };
}

export async function runWorkflowTerminalGoalAdvanceSweep({ limit = 40 } = {}) {
  if (!isPlatformCronActive('workflow_terminal_watch')) {
    return { ok: true, skipped: true, reason: 'paused_or_disabled' };
  }
  ensureAgentGoalRunTables();
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 100);
  let rows = [];
  try {
    rows = db()
      .prepare(
        "SELECT s.id AS step_id, s.goal_run_id, s.child_workflow_run_id, s.status AS step_status, r.status AS wf_status FROM agent_goal_steps s INNER JOIN agent_workflow_runs r ON r.id = s.child_workflow_run_id WHERE s.step_type = 'workflow_trigger' AND s.status IN ('running', 'pending') AND r.status IN ('completed', 'failed', 'cancelled', 'paused') ORDER BY s.rowid DESC LIMIT ?"
      )
      .all(lim);
  } catch (e) {
    console.warn('[platform-watcher] workflow terminal sweep query failed', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }

  const results = [];
  for (const row of rows) {
    const wfId = Number(row.child_workflow_run_id);
    if (!Number.isFinite(wfId) || !TERMINAL_WF.has(String(row.wf_status || ''))) continue;
    try {
      const out = await onWorkflowTerminalForGoalRun(wfId);
      results.push({ workflow_run_id: wfId, goal_run_id: row.goal_run_id, step_id: row.step_id, ...out });
    } catch (e) {
      results.push({
        workflow_run_id: wfId,
        goal_run_id: row.goal_run_id,
        ok: false,
        error: e?.message || String(e),
      });
    }
  }
  if (results.length) {
    console.info('[platform-watcher] workflow_terminal_watch sweep', { advanced: results.length });
  }
  return { ok: true, candidates: rows.length, results };
}

export async function runWorkflowTimeoutReapOnce() {
  if (!isPlatformCronActive('workflow_timeout_watchdog')) {
    return { ok: true, skipped: true, reason: 'paused_or_disabled' };
  }
  const { reapTimedOutWorkflowSteps } = await import('./agent-workflow-runner.js');
  const reaped = await reapTimedOutWorkflowSteps();
  return { ok: true, reaped: typeof reaped === 'number' ? reaped : reaped?.reaped ?? reaped };
}
