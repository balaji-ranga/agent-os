import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-goal-control-'));
process.env.AGENT_OS_DATA_DIR = dataDir;

const { getDb } = await import('../src/db/schema.js');
const {
  ensureAgentGoalRunTables,
  getGoalRun,
  cancelGoalRun,
  retryGoalRun,
} = await import('../src/services/agent-goal-run.js');
ensureAgentGoalRunTables();
const db = getDb();

db.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)`)
  .run('ceo-control-test', 'control@example.test', 'x', 'Control Test', 'ceo');
db.prepare(`INSERT INTO agents(id,name,role,is_coo,openclaw_agent_id,owner_user_id) VALUES(?,?,?,?,?,?)`)
  .run('coo-control-test', 'Control COO', 'COO', 1, 'coo-control-test', 'ceo-control-test');
db.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)`)
  .run('ceo-control-test', 'coo-control-test');

const addGoal = (id, status) => db.prepare(
  `INSERT INTO agent_goal_runs(id,owner_user_id,agent_id,title,prompt,status,current_step_index)
   VALUES(?,?,?,?,?,?,?)`
).run(id, 'ceo-control-test', 'coo-control-test', id, `Prompt for ${id}`, status, 1);
const addStep = (id, goalId, index, status, result = null) => db.prepare(
  `INSERT INTO agent_goal_steps(id,goal_run_id,step_index,step_type,label,spec_json,status,result_json,started_at)
   VALUES(?,?,?,?,?,?,?,?,datetime('now'))`
).run(id, goalId, index, 'agent_continue', id, JSON.stringify({ step_key: `step_${index}` }), status, result ? JSON.stringify(result) : null);

addGoal('agr-cancel-control', 'running');
addStep('ags-cancel-0', 'agr-cancel-control', 0, 'completed', { ok: true, value: 'preserve' });
addStep('ags-cancel-1', 'agr-cancel-control', 1, 'running');
const cancelled = await cancelGoalRun('agr-cancel-control', 'ceo-control-test', { actorUserId: 'ceo-control-test' });
assert.equal(cancelled.goal.status, 'cancelled');
assert.equal(cancelled.goal.steps[0].status, 'completed');
assert.equal(cancelled.goal.steps[1].status, 'cancelled');

addGoal('agr-retry-control', 'failed');
addStep('ags-retry-0', 'agr-retry-control', 0, 'completed', { ok: true, value: 'preserve' });
addStep('ags-retry-1', 'agr-retry-control', 1, 'failed', { ok: false });
addStep('ags-retry-2', 'agr-retry-control', 2, 'pending');
const executions = [];
const retried = await retryGoalRun('agr-retry-control', 'ceo-control-test', {
  actorUserId: 'ceo-control-test',
  executeGoal: async (goalRunId, options) => {
    executions.push({ goalRunId, options });
    return { ok: true };
  },
});
assert.equal(retried.goal.status, 'pending');
assert.equal(retried.goal.steps[0].id, 'ags-retry-0');
assert.equal(retried.goal.steps[0].result.value, 'preserve');
assert.equal(retried.goal.steps[1].status, 'pending');
assert.notEqual(retried.goal.steps[1].id, 'ags-retry-1');
assert.equal(retried.goal.steps[2].status, 'pending');
assert.deepEqual(executions, [{ goalRunId: 'agr-retry-control', options: { ownerUserId: 'ceo-control-test' } }]);

const wrongOwner = await assert.rejects(
  () => cancelGoalRun('agr-retry-control', 'different-owner'),
  (error) => error.status === 404
);
assert.equal(wrongOwner, undefined);

console.log('goal run cancel/retry control tests passed');
try { db.close(); } catch {}
rmSync(dataDir, { recursive: true, force: true });
