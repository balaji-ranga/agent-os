import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-goal-recovery-'));
process.env.AGENT_OS_DATA_DIR = dataDir;

const { getDb } = await import('../src/db/schema.js');
const {
  createGoalPlanningRun,
  ensureAgentGoalRunTables,
  startGoalRunExecution,
} = await import('../src/services/agent-goal-run.js');
const { recoverStuckGoalRuns } = await import('../src/services/goal-run-recovery.js');
ensureAgentGoalRunTables();
const db = getDb();

db.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)`)
  .run('ceo-recovery-test', 'recovery@example.test', 'x', 'Recovery Test', 'ceo');
db.prepare(`INSERT INTO agents(id,name,role,is_coo,openclaw_agent_id,owner_user_id) VALUES(?,?,?,?,?,?)`)
  .run('coo-recovery-test', 'Recovery COO', 'COO', 1, 'coo-recovery-test', 'ceo-recovery-test');
db.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)`)
  .run('ceo-recovery-test', 'coo-recovery-test');

const planningPrompt = 'Create the same durable planning request exactly once.';
const planningOne = createGoalPlanningRun({
  ownerUserId: 'ceo-recovery-test',
  agentId: 'coo-recovery-test',
  prompt: planningPrompt,
  source: 'retrying_client',
});
const planningTwo = createGoalPlanningRun({
  ownerUserId: 'ceo-recovery-test',
  agentId: 'coo-recovery-test',
  prompt: planningPrompt,
  source: 'retrying_client',
});
assert.equal(planningTwo.id, planningOne.id, 'an overlapping identical planning request must reuse its durable goal');
assert.equal(planningTwo.reused_active, true);
const planningGuard = await startGoalRunExecution(planningOne.id, { ownerUserId: 'ceo-recovery-test' });
assert.equal(planningGuard.reason, 'planning_in_progress', 'planning telemetry must never execute as a business step');

const old = '2020-01-01T00:00:00.000Z';
const addGoal = (id, status = 'running') => db.prepare(
  `INSERT INTO agent_goal_runs(id,owner_user_id,agent_id,title,prompt,status,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?)`
).run(id, 'ceo-recovery-test', 'coo-recovery-test', id, id, status, old, old);
const addStep = (id, goalId, index, type, status) => db.prepare(
  `INSERT INTO agent_goal_steps(id,goal_run_id,step_index,step_type,label,status,started_at)
   VALUES(?,?,?,?,?,?,?)`
).run(id, goalId, index, type, id, status, status === 'running' ? old : null);

addGoal('agr-lost-wakeup');
addStep('ags-lost-1', 'agr-lost-wakeup', 0, 'specialty_task', 'completed');
addStep('ags-lost-2', 'agr-lost-wakeup', 1, 'agent_tool', 'pending');

addGoal('agr-active-human');
addStep('ags-human-1', 'agr-active-human', 0, 'human_task', 'running');
addStep('ags-human-2', 'agr-active-human', 1, 'notify_ceo', 'pending');

addGoal('agr-active-agent');
addStep('ags-agent-1', 'agr-active-agent', 0, 'specialty_task', 'running');
addStep('ags-agent-2', 'agr-active-agent', 1, 'notify_ceo', 'pending');

addGoal('agr-active-workflow');
addStep('ags-workflow-1', 'agr-active-workflow', 0, 'workflow_trigger', 'running');
addStep('ags-workflow-2', 'agr-active-workflow', 1, 'notify_ceo', 'pending');

addGoal('agr-awaiting-approval', 'awaiting_approval');
addStep('ags-approval-1', 'agr-awaiting-approval', 0, 'agent_tool', 'awaiting_approval');
addStep('ags-approval-2', 'agr-awaiting-approval', 1, 'notify_ceo', 'pending');

addGoal('agr-abandoned-planning', 'planning');
addStep('ags-planning-1', 'agr-abandoned-planning', 0, 'planning', 'running');

addGoal('agr-abandoned-tool');
addStep('ags-tool-1', 'agr-abandoned-tool', 0, 'agent_tool', 'running');
addStep('ags-tool-2', 'agr-abandoned-tool', 1, 'notify_ceo', 'pending');

const executions = [];
const retries = [];
const dependencies = {
  executeGoal: async (goalRunId, options) => {
    executions.push({ goalRunId, options });
    return { ok: true, goal_run_id: goalRunId };
  },
  advanceDelegation: async () => ({ ok: true }),
  advanceWorkflow: async () => ({ ok: true }),
  recoverAgentContinue: async () => ({ scanned: 0, recovered: 0, details: [] }),
  retryGoal: async (goalRunId, ownerUserId, options) => {
    retries.push({ goalRunId, ownerUserId, options });
    db.prepare(`UPDATE agent_goal_steps SET started_at=datetime('now') WHERE goal_run_id=? AND status='running'`).run(goalRunId);
    return { ok: true, queued: true, goal_run_id: goalRunId };
  },
};

const first = await recoverStuckGoalRuns({ staleMs: 1000, ...dependencies });
assert.equal(first.recovered, 4);
assert.deepEqual(executions, [{
  goalRunId: 'agr-lost-wakeup',
  options: { ownerUserId: 'ceo-recovery-test' },
}]);
assert.deepEqual(retries.map((entry) => entry.goalRunId).sort(), [
  'agr-abandoned-planning',
  'agr-abandoned-tool',
  'agr-active-workflow',
]);
assert.ok(first.details.some((entry) => entry.recovery === 'missing_wakeup'));
assert.ok(first.details.some((entry) => entry.recovery === 'abandoned_planning'));
assert.ok(first.details.some((entry) => entry.recovery === 'abandoned_synchronous_step'));

// The compare-and-update claim refreshes updated_at, so a second overlapping
// sweep cannot immediately execute the same goal again.
const second = await recoverStuckGoalRuns({ staleMs: 1000, ...dependencies });
assert.equal(second.recovered, 0);
assert.equal(executions.length, 1);
assert.equal(retries.length, 3);

console.log('stuck goal wake-up recovery tests passed');
try { db.close(); } catch {}
rmSync(dataDir, { recursive: true, force: true });
