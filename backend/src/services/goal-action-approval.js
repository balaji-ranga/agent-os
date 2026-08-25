import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { createActionApprovalGrant } from './action-policy.js';
import { notifyKanbanTaskCreated, clearKanbanTaskNotification } from './platform-notifications.js';

function db() { return getDb(); }

export function ensureGoalActionApprovalTable() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS goal_action_approvals (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      goal_run_id TEXT NOT NULL,
      goal_step_id TEXT NOT NULL,
      kanban_task_id INTEGER,
      tool_name TEXT NOT NULL,
      action_family TEXT NOT NULL,
      args_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      decided_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, goal_run_id, goal_step_id)
    );
    CREATE INDEX IF NOT EXISTS idx_goal_action_approvals_kanban
      ON goal_action_approvals(owner_user_id, kanban_task_id);
  `);
}

function recipientConstraints(args = {}) {
  const recipient = String(args.to || args.recipient || args.email || args.phone || '').trim();
  return recipient ? { allowed_recipients: [recipient] } : {};
}

export function createGoalActionApproval({ ownerUserId, goal, step, toolName, actionFamily, args = {}, error = '' }) {
  ensureGoalActionApprovalTable();
  const existing = db().prepare(
    `SELECT * FROM goal_action_approvals WHERE owner_user_id=? AND goal_run_id=? AND goal_step_id=?`
  ).get(ownerUserId, goal.id, step.id);
  if (existing?.status === 'pending') return existing;

  const title = `Approval required: ${step.label || toolName}`.slice(0, 240);
  const safeArgs = { ...args };
  delete safeArgs.approval_token;
  const description = [
    '[GOAL_ACTION_APPROVAL]',
    `approval_id: gaa-${goal.id}-${step.id}`,
    `goal_run_id: ${goal.id}`,
    `goal_step_id: ${step.id}`,
    `tool: ${toolName}`,
    `action_family: ${actionFamily}`,
    '',
    `Goal: ${goal.title || goal.prompt || goal.id}`,
    `Requested action: ${JSON.stringify(safeArgs, null, 2)}`,
    error ? `Policy reason: ${error}` : '',
    '',
    'Approve to issue one short-lived, one-use grant and resume this exact step. Reject to terminate it.',
  ].filter(Boolean).join('\n');
  const task = db().prepare(
    `INSERT INTO kanban_tasks
      (title,description,status,assigned_user_id,created_by,owner_user_id)
     VALUES (?,?,'awaiting_confirmation',?,'action_policy',?) RETURNING *`
  ).get(title, description, ownerUserId, ownerUserId);
  const id = `gaa-${randomUUID()}`;
  db().prepare(
    `INSERT INTO goal_action_approvals
      (id,owner_user_id,goal_run_id,goal_step_id,kanban_task_id,tool_name,action_family,args_json,status)
     VALUES (?,?,?,?,?,?,?,?, 'pending')
     ON CONFLICT(owner_user_id,goal_run_id,goal_step_id) DO UPDATE SET
       kanban_task_id=excluded.kanban_task_id, tool_name=excluded.tool_name,
       action_family=excluded.action_family, args_json=excluded.args_json,
       status='pending', decided_at=NULL`
  ).run(id, ownerUserId, goal.id, step.id, task.id, toolName, actionFamily, JSON.stringify(safeArgs));
  notifyKanbanTaskCreated({ userId: ownerUserId, task });
  return db().prepare('SELECT * FROM goal_action_approvals WHERE owner_user_id=? AND goal_run_id=? AND goal_step_id=?')
    .get(ownerUserId, goal.id, step.id);
}

export function getGoalActionApprovalByKanban(ownerUserId, kanbanTaskId) {
  ensureGoalActionApprovalTable();
  return db().prepare('SELECT * FROM goal_action_approvals WHERE owner_user_id=? AND kanban_task_id=?')
    .get(ownerUserId, Number(kanbanTaskId));
}

export async function respondToGoalActionApproval({ ownerUserId, kanbanTaskId, decision, comment = '', execute = true }) {
  const row = getGoalActionApprovalByKanban(ownerUserId, kanbanTaskId);
  if (!row) throw Object.assign(new Error('Goal action approval not found'), { status: 404 });
  if (row.status !== 'pending') throw Object.assign(new Error(`Approval already ${row.status}`), { status: 409 });
  const approved = String(decision).toLowerCase() === 'approve';
  const goal = db().prepare('SELECT * FROM agent_goal_runs WHERE id=? AND owner_user_id=?').get(row.goal_run_id, ownerUserId);
  const step = db().prepare('SELECT * FROM agent_goal_steps WHERE id=? AND goal_run_id=?').get(row.goal_step_id, row.goal_run_id);
  if (!goal || !step) throw Object.assign(new Error('Bound goal step no longer exists'), { status: 409 });

  if (!approved) {
    db().transaction(() => {
      db().prepare("UPDATE goal_action_approvals SET status='rejected',decided_at=datetime('now') WHERE id=?").run(row.id);
      db().prepare("UPDATE kanban_tasks SET status='failed',updated_at=datetime('now') WHERE id=?").run(row.kanban_task_id);
      db().prepare("UPDATE agent_goal_steps SET status='failed',error_message='Rejected by CEO',completed_at=datetime('now') WHERE id=?").run(step.id);
      db().prepare("UPDATE agent_goal_runs SET status='failed',error_message='Action rejected by CEO',completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?").run(goal.id);
      db().prepare("INSERT INTO task_messages(task_id,role,content) VALUES (?,'user',?)").run(row.kanban_task_id, `[CEO rejected] ${comment}`.trim());
    })();
    clearKanbanTaskNotification(row.kanban_task_id, ownerUserId);
    return { ok: true, decision: 'rejected', goal_run_id: goal.id, goal_step_id: step.id };
  }

  const args = JSON.parse(row.args_json || '{}');
  const grant = createActionApprovalGrant(ownerUserId, {
    family: row.action_family,
    toolName: row.tool_name,
    constraints: recipientConstraints(args),
    ttlSeconds: 900,
    uses: 1,
  });
  const spec = JSON.parse(step.spec_json || '{}');
  spec.args = { ...(spec.args || {}), ...args, approval_token: grant.token };
  db().transaction(() => {
    db().prepare("UPDATE goal_action_approvals SET status='approved',decided_at=datetime('now') WHERE id=?").run(row.id);
    db().prepare("UPDATE kanban_tasks SET status='completed',updated_at=datetime('now') WHERE id=?").run(row.kanban_task_id);
    db().prepare("INSERT INTO task_messages(task_id,role,content) VALUES (?,'user',?)").run(row.kanban_task_id, `[CEO approved] ${comment}`.trim());
    db().prepare("UPDATE agent_goal_steps SET status='pending',spec_json=?,error_message=NULL,started_at=NULL,completed_at=NULL WHERE id=?")
      .run(JSON.stringify(spec), step.id);
    db().prepare("UPDATE agent_goal_runs SET status='running',error_message=NULL,current_step_index=?,updated_at=datetime('now') WHERE id=?")
      .run(step.step_index, goal.id);
  })();
  clearKanbanTaskNotification(row.kanban_task_id, ownerUserId);
  let execution = { deferred: true };
  if (execute) {
    const { startGoalRunExecution } = await import('./agent-goal-run.js');
    execution = await startGoalRunExecution(goal.id, { ownerUserId });
  }
  return { ok: true, decision: 'approved', goal_run_id: goal.id, goal_step_id: step.id, execution };
}
