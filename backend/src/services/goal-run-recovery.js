/**
 * Safety-net recovery for durable goal runs whose normal async callback was
 * lost (for example during a restart). It never re-fires active agent,
 * workflow, human, or approval work.
 */
import { getDb } from '../db/schema.js';
import { getPlatformTimeoutMs } from './platform-timeout-settings.js';
import {
  ensureAgentGoalRunTables,
  onDelegationTerminalForGoalRun,
  onWorkflowTerminalForGoalRun,
  recoverStaleAgentContinueGoalSteps,
  startGoalRunExecution,
} from './agent-goal-run.js';

const activeRecoveries = new Set();

function db() {
  return getDb();
}

function boundedLimit(value) {
  return Math.min(Math.max(Number(value) || 50, 1), 200);
}

function staleModifier(staleMs) {
  const configured = Number(staleMs ?? getPlatformTimeoutMs('goal_wakeup_stale'));
  const milliseconds = Number.isFinite(configured) ? Math.max(1000, configured) : 120000;
  return { milliseconds, sql: `-${Math.ceil(milliseconds / 1000)} seconds` };
}

function claimGoal(row) {
  if (!row?.goal_run_id || activeRecoveries.has(row.goal_run_id)) return false;
  const changed = db().prepare(
    `UPDATE agent_goal_runs
     SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND updated_at = ? AND status IN ('pending','running')`
  ).run(row.goal_run_id, row.goal_updated_at);
  if (!changed.changes) return false;
  activeRecoveries.add(row.goal_run_id);
  return true;
}

async function runClaimed(row, action) {
  if (!claimGoal(row)) return { skipped: true, reason: 'already_claimed_or_changed' };
  try {
    return await action();
  } finally {
    activeRecoveries.delete(row.goal_run_id);
  }
}

export async function recoverStuckGoalRuns({
  limit = 50,
  staleMs = null,
  advanceDelegation = onDelegationTerminalForGoalRun,
  advanceWorkflow = onWorkflowTerminalForGoalRun,
  recoverAgentContinue = recoverStaleAgentContinueGoalSteps,
  executeGoal = startGoalRunExecution,
} = {}) {
  ensureAgentGoalRunTables();
  const lim = boundedLimit(limit);
  const stale = staleModifier(staleMs);
  const details = [];

  const delegationRows = db().prepare(
    `SELECT s.goal_run_id, s.id AS step_id, s.child_delegation_task_id AS child_id,
            g.owner_user_id, g.updated_at AS goal_updated_at
     FROM agent_goal_steps s
     JOIN agent_goal_runs g ON g.id = s.goal_run_id
     JOIN agent_delegation_tasks d ON d.id = s.child_delegation_task_id
     WHERE g.status IN ('pending','running')
       AND s.step_type = 'specialty_task' AND s.status IN ('pending','running')
       AND d.status IN ('completed','failed')
       AND datetime(COALESCE(g.updated_at,g.created_at)) <= datetime('now', ?)
     ORDER BY datetime(COALESCE(g.updated_at,g.created_at)) ASC LIMIT ?`
  ).all(stale.sql, lim);

  for (const row of delegationRows) {
    const result = await runClaimed(row, () => advanceDelegation(Number(row.child_id)));
    details.push({ goal_run_id: row.goal_run_id, step_id: row.step_id, recovery: 'terminal_delegation', result });
  }

  const workflowRows = db().prepare(
    `SELECT s.goal_run_id, s.id AS step_id, s.child_workflow_run_id AS child_id,
            g.owner_user_id, g.updated_at AS goal_updated_at
     FROM agent_goal_steps s
     JOIN agent_goal_runs g ON g.id = s.goal_run_id
     JOIN agent_workflow_runs w ON w.id = s.child_workflow_run_id
     WHERE g.status IN ('pending','running')
       AND s.step_type = 'workflow_trigger' AND s.status IN ('pending','running')
       AND w.status IN ('completed','failed','cancelled','paused')
       AND datetime(COALESCE(g.updated_at,g.created_at)) <= datetime('now', ?)
     ORDER BY datetime(COALESCE(g.updated_at,g.created_at)) ASC LIMIT ?`
  ).all(stale.sql, lim);

  for (const row of workflowRows) {
    const result = await runClaimed(row, () => advanceWorkflow(Number(row.child_id)));
    details.push({ goal_run_id: row.goal_run_id, step_id: row.step_id, recovery: 'terminal_workflow', result });
  }

  // Agent continuation has its own timeout and safe reclaim rules.
  const agentContinue = await recoverAgentContinue({ limit: lim });

  // This is the exact lost-wakeup case: at least one pending step remains, but
  // there is no legitimate running or approval-bound step to wait for.
  const readyRows = db().prepare(
    `SELECT g.id AS goal_run_id, g.owner_user_id, g.updated_at AS goal_updated_at
     FROM agent_goal_runs g
     WHERE g.status IN ('pending','running')
       AND datetime(COALESCE(g.updated_at,g.created_at)) <= datetime('now', ?)
       AND EXISTS (
         SELECT 1 FROM agent_goal_steps p
         WHERE p.goal_run_id = g.id AND p.status = 'pending'
       )
       AND NOT EXISTS (
         SELECT 1 FROM agent_goal_steps b
         WHERE b.goal_run_id = g.id AND b.status IN ('running','awaiting_approval')
       )
     ORDER BY datetime(COALESCE(g.updated_at,g.created_at)) ASC LIMIT ?`
  ).all(stale.sql, lim);

  for (const row of readyRows) {
    const result = await runClaimed(row, () => executeGoal(row.goal_run_id, { ownerUserId: row.owner_user_id }));
    details.push({ goal_run_id: row.goal_run_id, recovery: 'missing_wakeup', result });
  }

  const recovered = details.filter((item) => !item.result?.skipped).length + Number(agentContinue?.recovered || 0);
  return {
    ok: true,
    stale_ms: stale.milliseconds,
    candidates: delegationRows.length + workflowRows.length + readyRows.length + Number(agentContinue?.scanned || 0),
    recovered,
    agent_continue: agentContinue,
    details,
  };
}
