import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.GOAL_PLAN_COO_COMPLETION_NUDGE = '0';
const testDataDir = mkdtempSync(join(tmpdir(), 'agent-os-human-delete-'));
process.env.AGENT_OS_DATA_DIR = testDataDir;
process.on('exit', () => {
  try { rmSync(testDataDir, { recursive: true, force: true }); } catch {}
});

const { getDb } = await import('../src/db/schema.js');
const {
  cancelHumanGoalRunsForDeletedKanban,
  reconcileOrphanHumanGoalTasks,
} = await import('../src/services/agent-goal-run.js');

const db = getDb();
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const owner = `delete-human-test-${suffix}`;
reconcileOrphanHumanGoalTasks({ ownerUserId: owner, limit: 1 });
const createdGoals = [];
const createdTasks = [];

function createRunningHumanGoal({ orphan = false } = {}) {
  const goalId = `agr-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const stepId = `ags-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  db.prepare(`INSERT INTO agent_goal_runs
    (id,owner_user_id,agent_id,title,prompt,source,status,current_step_index)
    VALUES (?,?,?,'Deletion lifecycle test','Wait for a human outcome','regression','running',0)`)
    .run(goalId, owner, 'test-coo');
  db.prepare(`INSERT INTO agent_goal_steps
    (id,goal_run_id,step_index,step_type,label,spec_json,status,started_at)
    VALUES (?,?,0,'human_task','Human decision','{}','running',datetime('now'))`)
    .run(stepId, goalId);
  createdGoals.push(goalId);
  if (orphan) {
    db.prepare('UPDATE agent_goal_steps SET human_kanban_task_id = ? WHERE id = ?').run(2147483000, stepId);
    return { goalId, stepId, taskId: null };
  }
  const task = db.prepare(`INSERT INTO kanban_tasks
    (title,description,status,owner_user_id,goal_run_id,goal_step_id,created_by)
    VALUES ('Human decision','Linked goal work','in_progress',?,?,?,'test')`)
    .run(owner, goalId, stepId);
  const taskId = Number(task.lastInsertRowid);
  createdTasks.push(taskId);
  db.prepare('UPDATE agent_goal_steps SET human_kanban_task_id = ? WHERE id = ?').run(taskId, stepId);
  return { goalId, stepId, taskId };
}

try {
  const linked = createRunningHumanGoal();
  const cancelled = cancelHumanGoalRunsForDeletedKanban([linked.taskId], { actorUserId: owner });
  assert.equal(cancelled.cancelled, 1);
  const linkedGoal = db.prepare('SELECT status,completed_at,error_message FROM agent_goal_runs WHERE id=?').get(linked.goalId);
  const linkedStep = db.prepare('SELECT status,result_json,error_message FROM agent_goal_steps WHERE id=?').get(linked.stepId);
  assert.equal(linkedGoal.status, 'cancelled');
  assert(linkedGoal.completed_at, 'cancelled goal must have a terminal timestamp');
  assert.match(linkedGoal.error_message, /deleted/i);
  assert.equal(linkedStep.status, 'failed');
  assert.equal(JSON.parse(linkedStep.result_json).reason, 'human_task_deleted');

  const orphan = createRunningHumanGoal({ orphan: true });
  const repaired = reconcileOrphanHumanGoalTasks({ ownerUserId: owner });
  assert.equal(repaired.cancelled, 1);
  assert.equal(db.prepare('SELECT status FROM agent_goal_runs WHERE id=?').get(orphan.goalId).status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM agent_goal_steps WHERE id=?').get(orphan.stepId).status, 'failed');

  console.log('HUMAN_GOAL_KANBAN_DELETE_LIFECYCLE_OK', JSON.stringify({
    direct_delete_goal: linked.goalId,
    repaired_orphan_goal: orphan.goalId,
    cancelled: cancelled.cancelled,
    repaired: repaired.cancelled,
  }));
} finally {
  for (const taskId of createdTasks) {
    db.prepare('DELETE FROM task_messages WHERE task_id=?').run(taskId);
    db.prepare('DELETE FROM kanban_tasks WHERE id=?').run(taskId);
  }
  for (const goalId of createdGoals) {
    db.prepare('DELETE FROM goal_mission_events WHERE goal_run_id=?').run(goalId);
    db.prepare('DELETE FROM agent_goal_steps WHERE goal_run_id=?').run(goalId);
    db.prepare('DELETE FROM agent_goal_runs WHERE id=?').run(goalId);
  }
}
