import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-exception-policy-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
process.env.GOAL_PLAN_COO_COMPLETION_NUDGE = '0';
// The new owner-scoped policy is authoritative over this legacy platform-wide switch.
process.env.GOAL_PLAN_FAILURE_KANBAN = '0';

try {
  const { initDb } = await import('../src/db/schema.js');
  const db = initDb();
  const owner = 'ceo-exception-test';
  const other = 'ceo-exception-other';
  for (const [id, email] of [[owner, 'exception@example.test'], [other, 'other@example.test']]) {
    db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)`)
      .run(id, email, 'x', id, 'ceo');
  }

  const {
    getExceptionPolicy,
    upsertExceptionPolicy,
    workflowExceptionDecision,
    enqueueWorkflowExceptionKanban,
  } = await import('../src/services/exception-policy.js');

  assert.deepEqual(
    (({ retry_limit, create_kanban, agent_pickup }) => ({ retry_limit, create_kanban, agent_pickup }))(getExceptionPolicy(owner)),
    { retry_limit: 1, create_kanban: true, agent_pickup: true }
  );
  upsertExceptionPolicy(owner, { retry_limit: 1, create_kanban: true, agent_pickup: false });
  upsertExceptionPolicy(other, { retry_limit: 3, create_kanban: false, agent_pickup: false });
  assert.equal(getExceptionPolicy(owner).retry_limit, 1);
  assert.equal(getExceptionPolicy(other).retry_limit, 3);

  const { createGoalRun, completeGoalStep, getGoalRun } = await import('../src/services/agent-goal-run.js');
  const goal = createGoalRun({
    ownerUserId: owner,
    agentId: 'exception-agent',
    title: 'Exception test goal',
    prompt: 'Run one failing test step',
    steps: [{ type: 'agent_tool', label: 'Failing goal step', tool_name: 'fixture_failure' }],
  });
  const goalStepId = goal.steps[0].id;
  const firstGoalFailure = completeGoalStep({
    goalRunId: goal.id,
    stepId: goalStepId,
    ownerUserId: owner,
    failed: true,
    error: 'fixture failure one',
  });
  assert.equal(firstGoalFailure.recovered, true);
  let goalStep = db.prepare('SELECT * FROM agent_goal_steps WHERE id = ?').get(goalStepId);
  assert.equal(goalStep.status, 'pending');
  assert.equal(goalStep.exception_retry_count, 1);
  assert.equal(getGoalRun(goal.id, owner).status, 'running');

  const secondGoalFailure = completeGoalStep({
    goalRunId: goal.id,
    stepId: goalStepId,
    ownerUserId: owner,
    failed: true,
    error: 'fixture failure two',
  });
  assert.equal(secondGoalFailure.escalated, true);
  let goalCard = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    goalCard = db.prepare('SELECT * FROM kanban_tasks WHERE goal_run_id = ?').get(goal.id);
    if (goalCard) break;
  }
  goalStep = db.prepare('SELECT * FROM agent_goal_steps WHERE id = ?').get(goalStepId);
  assert.equal(goalStep.status, 'failed');
  assert.equal(getGoalRun(goal.id, owner).status, 'failed');
  assert(goalCard?.id, 'goal failure created a Kanban task');
  assert.equal(goalCard.goal_step_id, goalStepId);
  assert.equal(goalCard.status, 'open');
  goalStep = db.prepare('SELECT * FROM agent_goal_steps WHERE id = ?').get(goalStepId);
  assert.equal(goalStep.exception_kanban_id, goalCard.id);

  db.prepare(
    `INSERT INTO agent_workflow_definitions
       (id,name,description,owner_user_id,status,published_graph_json)
     VALUES (?,?,?,?,?,?)`
  ).run(
    'wf-exception-test',
    'Exception workflow',
    'fixture',
    owner,
    'published',
    JSON.stringify({ nodes: [{ id: 'node-fail', type: 'api', data: { label: 'Failing node' } }], edges: [] })
  );
  const workflowGraph = {
    nodes: [
      { id: 'trigger', type: 'trigger', data: { label: 'Start' } },
      { id: 'node-fail', type: 'agent', data: { label: 'Failing node', agentId: 'missing-agent' } },
    ],
    edges: [{ id: 'edge-1', source: 'trigger', target: 'node-fail' }],
  };
  db.prepare('UPDATE agent_workflow_definitions SET published_graph_json = ? WHERE id = ?')
    .run(JSON.stringify(workflowGraph), 'wf-exception-test');
  const { startAgentWorkflowRun } = await import('../src/services/agent-workflow-runner.js');
  const started = await startAgentWorkflowRun('wf-exception-test', owner, { trigger: 'manual', input: 'fixture' });
  const runId = Number(started.id);
  let workflowCard = null;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    workflowCard = db.prepare('SELECT * FROM kanban_tasks WHERE workflow_run_id = ?').get(runId);
    if (workflowCard) break;
  }
  const finalWorkflowRun = db.prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(runId);
  const finalWorkflowStep = db.prepare(
    `SELECT * FROM agent_workflow_run_steps WHERE run_id = ? AND node_id = 'node-fail' ORDER BY id DESC LIMIT 1`
  ).get(runId);
  assert.equal(finalWorkflowRun.status, 'failed');
  assert.equal(finalWorkflowStep.status, 'failed');
  assert.equal(finalWorkflowStep.exception_retry_count, 1);
  assert.equal(workflowExceptionDecision(runId, 'node-fail').action, 'kanban');
  assert(workflowCard?.id, 'workflow failure created a Kanban task after one retry');
  assert.equal(workflowCard.workflow_run_id, runId);
  assert.equal(workflowCard.status, 'open');
  assert.match(workflowCard.description, /Retry from this step/);
  const duplicate = enqueueWorkflowExceptionKanban(runId, 'node-fail', 'fixture workflow failure');
  assert.equal(duplicate.reason, 'already_enqueued');

  db.close();
  console.log('exception policy tests passed');
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
