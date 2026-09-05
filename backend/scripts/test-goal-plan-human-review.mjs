import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixture = mkdtempSync(join(tmpdir(), 'flolah-plan-review-'));
process.env.AGENT_OS_DATA_DIR = join(fixture, 'data');
process.env.OPENCLAW_DIR = join(fixture, 'openclaw');
process.env.OPENCLAW_CONFIG_PATH = join(fixture, 'openclaw', 'openclaw.json');
let db;
try {
  const schema = await import('../src/db/schema.js');
  db = schema.getDb();
  db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role)
              VALUES ('review-owner','review-owner@fixture.invalid','disabled','Review Owner','ceo')`).run();
  db.prepare(`INSERT INTO agents (id,name,role,is_coo,is_orchestrator,planning_status)
              VALUES ('review-coo','COO','Company orchestrator',1,1,'production')`).run();
  db.prepare(`INSERT INTO user_agents (user_id,agent_id,enabled) VALUES ('review-owner','review-coo',1)`).run();

  const goals = await import('../src/services/agent-goal-run.js');
  const resolvedContext = goals.resolvePlanReviewContext({ plan_review: { state: 'replanning', validation_errors: ['missing output'] } }, {
    resolution: 'replanned_with_human_guidance', actorUserId: 'review-owner',
  });
  assert.equal(resolvedContext.plan_review.state, 'resolved');
  assert.equal(resolvedContext.plan_review.resolution, 'replanned_with_human_guidance');
  assert.equal(resolvedContext.plan_review.resolved_by, 'review-owner');
  const planning = goals.createGoalPlanningRun({
    ownerUserId: 'review-owner',
    agentId: 'review-coo',
    title: 'Induced invalid planning proposal',
    prompt: 'Run a deliberately unavailable workflow for review-path testing.',
    source: 'test',
  });
  const error = new Error('Goal planning could not establish a complete approved plan after 3 rounds');
  error.code = 'GOAL_PLAN_UNVERIFIED';
  error.details = {
    rounds: [1, 2, 3].map((attempt) => ({ attempt, phase: 'checker', errors: ['Step workflow uses an unavailable workflow'] })),
    last_candidate: [{
      key: 'workflow', type: 'workflow_trigger', label: 'Unavailable workflow', depends_on: [],
      required_inputs: [], produces: [{ key: 'result', kind: 'data', required: true }],
      spec: { workflow_id: 'missing-workflow', phrase: 'run missing', message: '{}', operation_mode: 'trigger' },
    }],
  };
  const awaiting = await goals.awaitGoalPlanningReview(planning.id, 'review-owner', error);
  assert.equal(awaiting.status, 'awaiting_plan_review');
  assert.equal(awaiting.plan_review.state, 'awaiting_plan_review');
  assert.equal(awaiting.plan_review.rounds.length, 3);
  assert.equal(awaiting.plan_review.candidate_schema_valid, false);
  assert(awaiting.context.plan_review_kanban_id > 0);
  assert.equal(goals.getGoalRun(planning.id, 'different-owner'), null, 'Review must remain owner scoped');

  await assert.rejects(
    goals.submitGoalPlanReview(planning.id, 'review-owner', { action: 'approve' }),
    (failure) => failure.status === 422,
    'An invalid human-selected proposal must not bypass deterministic validation'
  );
  const cancelled = await goals.submitGoalPlanReview(planning.id, 'review-owner', { action: 'cancel' });
  assert.equal(cancelled.goal.status, 'cancelled');
  const card = db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(awaiting.context.plan_review_kanban_id);
  assert.equal(card.status, 'cancelled');
  console.log(JSON.stringify({ pass: true, status: 'awaiting_plan_review', rounds: 3, invalid_approval_blocked: true, owner_scoped: true, kanban_closed_on_cancel: true, successful_replan_resolves_review: true }));
} finally {
  db?.close();
  rmSync(fixture, { recursive: true, force: true });
}
