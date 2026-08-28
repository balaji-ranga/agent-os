import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-goal-hardening-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
process.env.GOAL_PLAN_COO_COMPLETION_NUDGE = '0';

let database = null;
try {
  const { initDb } = await import('../src/db/schema.js');
  const db = initDb();
  database = db;
  const owner = 'ceo-goal-hardening';
  db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role) VALUES (?,?,?,?,?)`)
    .run(owner, 'goal-hardening@example.test', 'x', 'Goal Hardening', 'ceo');
  const agents = [
    ['coo-test', 'COO', null, 1, 1, 'Operations'],
    ['content-orchestrator', 'Content Orchestrator', 'coo-test', 0, 1, 'Content'],
    ['scene-agent', 'Scene Agent', 'content-orchestrator', 0, 0, 'Content'],
    ['finance-agent', 'Finance Agent', 'coo-test', 0, 0, 'Finance'],
    ['erp-checker', 'ERP Checker', 'coo-test', 0, 0, 'ERP'],
  ];
  for (const [id, name, parent, isCoo, isOrch, department] of agents) {
    db.prepare(
      `INSERT INTO agents (id,name,parent_id,is_coo,is_orchestrator,department,openclaw_agent_id) VALUES (?,?,?,?,?,?,?)`
    ).run(id, name, parent, isCoo, isOrch, department, id);
    db.prepare(`INSERT INTO user_agents (user_id,agent_id,enabled) VALUES (?,?,1)`).run(owner, id);
  }
  for (const tool of ['status_checker', 'email_send', 'brave_web_search']) {
    db.prepare(`INSERT OR IGNORE INTO agent_tool_grants (agent_id,tool_name) VALUES (?,?)`).run('coo-test', tool);
  }
  for (const tool of ['email_send', 'status_checker']) {
    db.prepare(`INSERT OR IGNORE INTO agent_tool_grants (agent_id,tool_name) VALUES (?,?)`).run('erp-checker', tool);
  }

  const { classifyToolFailure } = await import('../src/services/tool-failure-class.js');
  const quota = classifyToolFailure(new Error('Brave Usage limit exceeded current_spend 5.05'), { status: 402 });
  assert.equal(quota.failure_class, 'quota_exhausted');
  assert.equal(quota.retryable, false);
  assert.equal(quota.bounded_retries, 0);
  const clarification = classifyToolFailure(new Error('Needs CEO clarification'));
  assert.equal(clarification.failure_class, 'model_uncertainty');
  assert.equal(clarification.retryable, false);
  const approvalDenial = classifyToolFailure(
    new Error('This action family requires a valid CEO approval grant before execution (missing).'),
    { status: 403, policyDenied: true }
  );
  assert.equal(approvalDenial.failure_class, 'policy_denial');
  assert.equal(approvalDenial.retryable, false);

  const { toolNeedsAgentInterpretation } = await import('../src/services/goal-plan-tool-args.js');
  assert.equal(
    toolNeedsAgentInterpretation('email_send', { hasPriorSteps: true }),
    false,
    'outbound action requires a real endpoint result, never agent prose acknowledgement'
  );

  const { looksStatusOnlyReply, replyHasUnresolvedBlocker } = await import('../src/services/kanban-reply-enrich.js');
  const acknowledgement = "I have updated the task to in_progress. Next, I'll proceed with the research and update you shortly.";
  assert.equal(looksStatusOnlyReply(acknowledgement), true);
  assert.equal(replyHasUnresolvedBlocker('Unable to continue: Brave quota usage limit exceeded.'), true);

  const { delegationSessionUserForPrompt, getPromptForFreshGoalRun } = await import('../src/services/delegation-queue.js');
  const tagged = 'Do this\n[goal_run_id: agr-1]\n[goal_step_id: ags-2]';
  assert.equal(delegationSessionUserForPrompt(tagged, 77), 'goal-agr-1-ags-2');
  assert.equal(delegationSessionUserForPrompt('ordinary task', 77), 'delegation-77');
  assert(!getPromptForFreshGoalRun(tagged).includes('MEMORY.md'));

  const { getAgentsUnderOrchestratorForCeo } = await import('../src/services/org-context.js');
  assert.deepEqual(getAgentsUnderOrchestratorForCeo(owner, 'content-orchestrator').map((a) => a.id), ['scene-agent']);

  const { createGoalRun, completeGoalRun, completeGoalStep, getGoalRun, validateAndRepairGoalPlan } = await import('../src/services/agent-goal-run.js');
  assert.throws(
    () => createGoalRun({
      ownerUserId: owner,
      agentId: 'content-orchestrator',
      prompt: 'Delegate outside the reporting line',
      steps: [{ type: 'specialty_task', agent_id: 'finance-agent', message: 'Do finance work' }],
    }),
    /only to direct reportees/
  );

  const digestPrompt =
    'Every morning collect the company daily status, create a concise status digest, and email the digest to me.';
  const multiSpecialistPlan = validateAndRepairGoalPlan([
    { type: 'specialty_task', agent_id: 'erp-checker', message: 'Prepare the requested result.' },
    { type: 'specialty_task', agent_id: 'finance-agent', message: 'Prepare the requested result.' },
  ], digestPrompt, {
    ownerUserId: owner,
    orchestratorAgentId: 'coo-test',
  });
  assert(multiSpecialistPlan.some((s) => s.spec?.agent_id === 'erp-checker'), 'capable specialist retained');
  assert(!multiSpecialistPlan.some((s) => s.spec?.agent_id === 'finance-agent'), 'unrelated auto-specialist removed');
  assert(
    multiSpecialistPlan.every((s) => s.spec?.selection_rationale),
    'every generated plan step includes a selection rationale'
  );
  const wrongDigestPlan = [{
    type: 'specialty_task',
    agent_id: 'erp-checker',
    label: 'Check status through ERP Checker',
    message: 'Collect company daily status and email the digest.',
  }, {
    type: 'agent_continue',
    label: 'Complete goal (agent interpretation)',
    message: '[Goal run — agent interpretation]\nPrefer tools: email_send.',
  }];
  for (const source of ['adhoc_chat', 'scheduled_goal']) {
    const digestGoal = createGoalRun({
      ownerUserId: owner,
      agentId: 'coo-test',
      prompt: digestPrompt,
      title: `${source} daily digest`,
      steps: wrongDigestPlan,
      source,
    });
    const executable = digestGoal.steps.map((s) => ({
      type: s.type,
      tool: s.spec?.tool_name || null,
      agent: s.spec?.agent_id || null,
    }));
    assert(!executable.some((s) => s.agent === 'erp-checker'), `${source}: incapable ERP delegation removed`);
    assert(executable.some((s) => s.tool === 'status_checker'), `${source}: status collection required`);
    assert(executable.some((s) => s.tool === 'email_send'), `${source}: email delivery required`);
    assert(!executable.some((s) => s.type === 'agent_continue'), `${source}: no duplicate delivery continuation`);
    assert(
      executable.findIndex((s) => s.tool === 'status_checker') < executable.findIndex((s) => s.tool === 'email_send'),
      `${source}: collect status before sending email`
    );
  }

  const { createGoalActionApproval, respondToGoalActionApproval } = await import('../src/services/goal-action-approval.js');
  const approvalGoal = createGoalRun({
    ownerUserId: owner,
    agentId: 'coo-test',
    prompt: 'Send the daily digest by email.',
    steps: [{ type: 'agent_tool', label: 'Send approved email', tool_name: 'email_send', args: { to: 'goal-hardening@example.test', subject: 'Digest', body: 'Status' } }],
  });
  const approvalStep = db.prepare('SELECT * FROM agent_goal_steps WHERE goal_run_id=? ORDER BY step_index LIMIT 1').get(approvalGoal.id);
  db.prepare("UPDATE agent_goal_steps SET status='awaiting_approval' WHERE id=?").run(approvalStep.id);
  db.prepare("UPDATE agent_goal_runs SET status='awaiting_approval' WHERE id=?").run(approvalGoal.id);
  const pendingApproval = createGoalActionApproval({ ownerUserId: owner, goal: approvalGoal, step: approvalStep,
    toolName: 'email_send', actionFamily: 'communicate_external', args: { to: 'goal-hardening@example.test', subject: 'Digest', body: 'Status' } });
  assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(pendingApproval.kanban_task_id).status, 'awaiting_confirmation');
  await respondToGoalActionApproval({ ownerUserId: owner, kanbanTaskId: pendingApproval.kanban_task_id, decision: 'approve', execute: false });
  assert.equal(db.prepare('SELECT status FROM agent_goal_runs WHERE id=?').get(approvalGoal.id).status, 'running');
  assert.equal(db.prepare('SELECT status FROM agent_goal_steps WHERE id=?').get(approvalStep.id).status, 'pending');
  assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(pendingApproval.kanban_task_id).status, 'completed');

  const rejectGoal = createGoalRun({ ownerUserId: owner, agentId: 'coo-test', prompt: 'Publish externally.',
    steps: [{ type: 'agent_tool', label: 'Publish', tool_name: 'email_send', args: { to: 'reject@example.test', body: 'No' } }] });
  const rejectStep = db.prepare('SELECT * FROM agent_goal_steps WHERE goal_run_id=? LIMIT 1').get(rejectGoal.id);
  const rejectApproval = createGoalActionApproval({ ownerUserId: owner, goal: rejectGoal, step: rejectStep,
    toolName: 'email_send', actionFamily: 'communicate_external', args: { to: 'reject@example.test', body: 'No' } });
  await respondToGoalActionApproval({ ownerUserId: owner, kanbanTaskId: rejectApproval.kanban_task_id, decision: 'reject', execute: false });
  assert.equal(db.prepare('SELECT status FROM agent_goal_runs WHERE id=?').get(rejectGoal.id).status, 'failed');
  assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(rejectApproval.kanban_task_id).status, 'failed');

  const { upsertExceptionPolicy } = await import('../src/services/exception-policy.js');
  upsertExceptionPolicy(owner, { retry_limit: 3, create_kanban: false, agent_pickup: false });
  const goal = createGoalRun({
    ownerUserId: owner,
    agentId: 'coo-test',
    prompt: 'Research a target market with Brave.',
    steps: [{ type: 'agent_tool', label: 'Brave research', tool_name: 'brave_web_search' }],
  });
  const terminal = completeGoalStep({
    goalRunId: goal.id,
    stepId: goal.steps[0].id,
    ownerUserId: owner,
    failed: true,
    error: 'Brave Usage limit exceeded',
    result: { status: 402, message: 'Usage limit exceeded' },
  });
  assert.equal(terminal.escalated, true);
  const after = getGoalRun(goal.id, owner);
  assert.equal(after.steps[0].retry_count, 0);
  assert.equal(after.steps[0].status, 'failed');
  const decision = db.prepare(
    `SELECT payload_json FROM goal_mission_events WHERE goal_run_id = ? AND event_type = 'decision' ORDER BY created_at DESC LIMIT 1`
  ).get(goal.id);
  assert.equal(JSON.parse(decision.payload_json).failure_class, 'quota_exhausted');

  const retryGoal = createGoalRun({
    ownerUserId: owner,
    agentId: 'coo-test',
    prompt: 'Complete a retried specialist task.',
    steps: [{ type: 'specialty_task', agent_id: 'finance-agent', message: 'Prepare the result' }],
  });
  db.prepare(`INSERT INTO standups (scheduled_at, owner_user_id, source) VALUES (?,?,?)`)
    .run(new Date().toISOString(), owner, 'goal-retry-test');
  const retryStandupId = db.prepare(`SELECT id FROM standups ORDER BY id DESC LIMIT 1`).get().id;
  for (const attempt of [1, 2]) {
    db.prepare(
      `INSERT INTO agent_delegation_tasks (standup_id,request_id,to_agent_id,prompt,status,owner_user_id) VALUES (?,?,?,?,?,?)`
    ).run(retryStandupId, `req-retry-${attempt}`, 'finance-agent',
      `Attempt ${attempt}\n[goal_run_id: ${retryGoal.id}]\n[goal_step_id: ${retryGoal.steps[0].id}]`,
      attempt === 1 ? 'failed' : 'processing', owner);
    const attemptId = db.prepare(`SELECT id FROM agent_delegation_tasks ORDER BY id DESC LIMIT 1`).get().id;
    db.prepare(
      `INSERT INTO kanban_tasks (title,status,assigned_agent_id,standup_id,agent_delegation_task_id,owner_user_id) VALUES (?,?,?,?,?,?)`
    ).run(`Retry attempt ${attempt}`, attempt === 1 ? 'completed' : 'in_progress', 'finance-agent', retryStandupId, attemptId, owner);
  }
  completeGoalRun(retryGoal.id, { status: 'completed' });
  const retryCards = db.prepare(
    `SELECT k.status FROM kanban_tasks k JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
     WHERE d.prompt LIKE ? ORDER BY k.id`
  ).all(`%[goal_run_id: ${retryGoal.id}]%`);
  assert.deepEqual(retryCards.map((r) => r.status), ['completed', 'completed']);

  db.prepare(`INSERT INTO standups (scheduled_at, owner_user_id, source) VALUES (?,?,?)`)
    .run(new Date().toISOString(), owner, 'test');
  const standupId = db.prepare(`SELECT id FROM standups ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(
    `INSERT INTO agent_delegation_tasks (standup_id,request_id,to_agent_id,prompt,status,owner_user_id) VALUES (?,?,?,?,?,?)`
  ).run(standupId, 'req-hardening', 'scene-agent', 'Recover quota', 'completed', owner);
  const delegationId = db.prepare(`SELECT id FROM agent_delegation_tasks ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(
    `INSERT INTO kanban_tasks (title,status,assigned_agent_id,standup_id,agent_delegation_task_id,owner_user_id) VALUES (?,?,?,?,?,?)`
  ).run('Recover external blocker', 'completed', 'scene-agent', standupId, delegationId, owner);
  const { completePipelineKanbanForDelegation } = await import('../src/services/kanban-workflow-stage.js');
  const retained = completePipelineKanbanForDelegation(delegationId, {
    ok: true,
    replyText: 'Unable to continue because the Brave quota usage limit is still exceeded.',
  });
  assert.equal(retained.status, 'awaiting_confirmation');
  assert.equal(retained.blocked_unresolved, true);

  // completeGoalStep schedules its recovery-card audit asynchronously.
  await new Promise((resolve) => setTimeout(resolve, 150));

  console.log('GOAL_ORCHESTRATION_HARDENING_OK', {
    quota_failure_class: quota.failure_class,
    goal_retry_count: after.steps[0].retry_count,
    isolated_session: delegationSessionUserForPrompt(tagged, 77),
    orchestrator_reportees: ['scene-agent'],
    blocked_kanban_status: retained.status,
    retry_cards: retryCards.map((r) => r.status),
    capability_plan_sources: ['adhoc_chat', 'scheduled_goal'],
  });
} finally {
  try { database?.close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
