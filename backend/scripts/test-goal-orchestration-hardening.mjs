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
  const incompleteEvidence = classifyToolFailure(
    Object.assign(new Error('Required browser recovery could not be independently verified.'), { code: 'EVIDENCE_INCOMPLETE' }),
    { status: 503, code: 'EVIDENCE_INCOMPLETE' }
  );
  assert.equal(incompleteEvidence.failure_class, 'transient');
  assert.equal(incompleteEvidence.retryable, true);

  const { toolNeedsAgentInterpretation } = await import('../src/services/goal-plan-tool-args.js');
  assert.equal(
    toolNeedsAgentInterpretation('email_send', { hasPriorSteps: true }),
    false,
    'outbound action requires a real endpoint result, never agent prose acknowledgement'
  );

  const { looksStatusOnlyReply, replyHasUnresolvedBlocker } = await import('../src/services/kanban-reply-enrich.js');
  const acknowledgement = "I have updated the task to in_progress. Next, I'll proceed with the research and update you shortly.";
  assert.equal(looksStatusOnlyReply(acknowledgement), true);
  assert.equal(looksStatusOnlyReply('### Task Completion\n\nThe Kanban task has been successfully updated to **completed** status.\n\nIf there is anything else you need, let me know!'), true);
  assert.equal(replyHasUnresolvedBlocker('Unable to continue: Brave quota usage limit exceeded.'), true);

  const { delegationSessionUserForPrompt, getPromptForFreshGoalRun } = await import('../src/services/delegation-queue.js');
  const tagged = 'Do this\n[goal_run_id: agr-1]\n[goal_step_id: ags-2]';
  assert.equal(delegationSessionUserForPrompt(tagged, 77), 'goal-agr-1-ags-2');
  assert.equal(delegationSessionUserForPrompt('ordinary task', 77), 'delegation-77');
  assert(!getPromptForFreshGoalRun(tagged).includes('MEMORY.md'));

  const { attachToolCallsToChatTurns } = await import('../src/services/chat-tool-calls.js');
  const toolLogInsert = db.prepare(`INSERT INTO content_tool_logs
    (tool_name,source,request_payload,response_payload,status,owner_user_id,created_at)
    VALUES (?,?,?,?,?,?,?)`);
  for (let i = 0; i < 180; i += 1) {
    toolLogInsert.run(`window_tool_${i}`, 't-test-owner--coo-test', '{}', '{"ok":true}', 'ok', owner,
      `2026-01-01 00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`);
  }
  const enrichedToolTurns = attachToolCallsToChatTurns([
    { id: 1, role: 'assistant', content: 'done', created_at: '2026-01-01 00:02:00' },
  ], 'coo-test', owner);
  assert(enrichedToolTurns[0].tool_calls.some((call) => call.tool_name === 'window_tool_179'),
    'latest tool calls survive broad history enrichment windows');

  const { getAgentsUnderOrchestratorForCeo } = await import('../src/services/org-context.js');
  assert.deepEqual(getAgentsUnderOrchestratorForCeo(owner, 'content-orchestrator').map((a) => a.id), ['scene-agent']);

  const {
    createGoalRun,
    createGoalPlanningRun,
    updateGoalPlanningRun,
    completeGoalRun,
    completeGoalStep,
    getGoalRun,
    validateAndRepairGoalPlan,
    assertRuntimeStepInputs,
    finalizeGoalStepContracts,
    resumeGoalAfterValidatedRecovery,
  } = await import('../src/services/agent-goal-run.js');
  const provisional = createGoalPlanningRun({
    ownerUserId: owner,
    agentId: 'coo-test',
    title: 'Visible maker checker planning',
    prompt: 'Prepare a status report',
    source: 'test',
  });
  assert.equal(provisional.status, 'planning');
  assert.equal(provisional.steps[0].step_type, 'planning');
  updateGoalPlanningRun(provisional.id, owner, {
    phase: 'checker',
    label: 'Validating plan independently',
    detail: 'Checker round',
  });
  assert.equal(getGoalRun(provisional.id, owner).steps[0].spec.phase, 'checker');
  const finalizedProvisional = createGoalRun({
    ownerUserId: owner,
    agentId: 'coo-test',
    title: 'Visible maker checker planning',
    prompt: 'Prepare a status report',
    source: 'test',
    goalRunId: provisional.id,
    steps: [{ type: 'agent_tool', label: 'Check status', tool_name: 'status_checker', args: {} }],
  });
  assert.equal(finalizedProvisional.id, provisional.id, 'planning and execution keep one durable goal id');
  assert.equal(finalizedProvisional.status, 'pending');
  assert.equal(finalizedProvisional.steps.some((step) => step.step_type === 'planning'), false);
  assert.throws(
    () => createGoalRun({
      ownerUserId: owner,
      agentId: 'content-orchestrator',
      prompt: 'Delegate outside the reporting line',
      steps: [{ type: 'specialty_task', agent_id: 'finance-agent', message: 'Do finance work' }],
    }),
    /only to direct reportees/
  );

  const dependencyGoal = createGoalRun({
    ownerUserId: owner,
    agentId: 'coo-test',
    prompt: 'Run two dependent research steps.',
    steps: [
      { type: 'agent_tool', label: 'First', tool_name: 'status_checker' },
      { type: 'agent_tool', label: 'Second', tool_name: 'status_checker', depends_on: ['0'] },
    ],
  });
  assert.deepEqual(dependencyGoal.steps.slice(0, 2).map((step) => step.spec.step_key), ['0', '1']);
  db.prepare("UPDATE agent_goal_steps SET status='completed', result_json=? WHERE id=?")
    .run(JSON.stringify({ ok: true }), dependencyGoal.steps[0].id);
  const legacySecond = db.prepare('SELECT * FROM agent_goal_steps WHERE id=?').get(dependencyGoal.steps[1].id);
  assert.doesNotThrow(() => assertRuntimeStepInputs(dependencyGoal.id, legacySecond));

  // A stale nested dependency from an older saved plan must never overwrite
  // the runtime's repaired top-level contract and make step zero depend on itself.
  const repairedContracts = finalizeGoalStepContracts([
    { type: 'agent_tool', depends_on: [], spec: { step_key: '0', depends_on: ['0'], tool_name: 'market_history' } },
    { type: 'agent_tool', depends_on: [0], spec: { step_key: '1', depends_on: ['1'], tool_name: 'market_fundamentals' } },
  ]);
  assert.deepEqual(repairedContracts[0].spec.depends_on, []);
  assert.deepEqual(repairedContracts[1].spec.depends_on, ['0']);
  // Simulate an old persisted source step that had no explicit key; numeric
  // dependency resolution remains backward compatible via step_index.
  db.prepare('UPDATE agent_goal_steps SET spec_json=? WHERE id=?')
    .run(JSON.stringify({ tool_name: 'status_checker' }), dependencyGoal.steps[0].id);
  assert.doesNotThrow(() => assertRuntimeStepInputs(dependencyGoal.id, legacySecond));

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

  upsertExceptionPolicy(owner, { retry_limit: 0, create_kanban: false, agent_pickup: false });
  const partialGoal = createGoalRun({
    ownerUserId: owner,
    agentId: 'coo-test',
    prompt: 'Return every available symbol and identify missing evidence. Do not call notify_ceo.',
    steps: [{ type: 'agent_tool', label: 'Market evidence', tool_name: 'status_checker' }],
  });
  const partialCompletion = completeGoalStep({
    goalRunId: partialGoal.id,
    stepId: partialGoal.steps[0].id,
    ownerUserId: owner,
    failed: true,
    error: 'Browser recovery incomplete after executor attempts: XYXY not found',
    result: {
      status: 503,
      failure_code: 'EVIDENCE_INCOMPLETE',
      results: [{ symbol: 'AAPL', ok: true, result: { close: 250 } }],
      errors: [{ symbol: 'XYXY', ok: false, error: 'not found' }],
    },
  });
  assert.equal(partialCompletion.partial_success, true);
  assert.equal(getGoalRun(partialGoal.id, owner).status, 'partial_success');
  assert.equal(getGoalRun(partialGoal.id, owner).steps[0].status, 'completed');

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

  const continuityGoal = createGoalRun({
    ownerUserId: owner,
    agentId: 'coo-test',
    prompt: 'Recover this failed specialist output and continue to the next step.',
    steps: [
      { type: 'specialty_task', agent_id: 'finance-agent', message: 'Return a concrete evidence-backed report.' },
      { type: 'agent_tool', label: 'Continue after recovery', tool_name: 'status_checker', depends_on: ['0'] },
    ],
  });
  const continuityStep = db.prepare('SELECT * FROM agent_goal_steps WHERE goal_run_id=? ORDER BY step_index LIMIT 1').get(continuityGoal.id);
  db.prepare("UPDATE agent_goal_steps SET status='failed', error_message='incomplete evidence' WHERE id=?").run(continuityStep.id);
  db.prepare("UPDATE agent_goal_runs SET status='failed', error_message='incomplete evidence', completed_at=datetime('now') WHERE id=?").run(continuityGoal.id);
  db.prepare(`INSERT INTO kanban_tasks(title,status,assigned_agent_id,created_by,owner_user_id,goal_run_id,goal_step_id)
              VALUES(?,?,?,?,?,?,?)`).run('Goal recovery continuity', 'in_progress', 'finance-agent', 'exception-policy', owner, continuityGoal.id, continuityStep.id);
  const continuityCard = Number(db.prepare('SELECT id FROM kanban_tasks ORDER BY id DESC LIMIT 1').get().id);
  const resumedGoal = resumeGoalAfterValidatedRecovery({
    goal: db.prepare('SELECT * FROM agent_goal_runs WHERE id=?').get(continuityGoal.id),
    step: continuityStep,
    taskId: 99991,
    cardId: continuityCard,
    response: 'Concrete recovered report with evidence record-77.',
    validation: { satisfied: true, reason: 'required report supplied', missing_outcomes: [] },
    capturedEvidence: { tool_calls: [{ evidence_id: 'record-77', tool_name: 'status_checker', status: 'ok' }] },
  });
  assert.equal(resumedGoal.status, 'running');
  assert.equal(resumedGoal.steps[0].status, 'completed');
  assert.equal(resumedGoal.steps[1].status, 'pending');
  assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(continuityCard).status, 'completed');

  // Exception recovery must remain CEO-visible when its assigned agent cannot
  // run due to budget, and reopen automatically after the budget is cleared.
  const { setAgentBudget } = await import('../src/services/agent-budgets.js');
  const { recordTokenUsage } = await import('../src/services/token-usage.js');
  const { enqueueGoalPlanFailureKanban } = await import('../src/services/goal-plan-failure-kanban.js');
  const { reconcileBudgetBlockedGoalRecoveryCards } = await import('../src/services/kanban-orphan-watcher.js');
  upsertExceptionPolicy(owner, { retry_limit: 1, create_kanban: true, agent_pickup: true });
  setAgentBudget(owner, 'coo-test', { monthly_token_budget: 1 });
  recordTokenUsage(owner, { memberKey: 'coo-test', agentId: 'coo-test', source: 'test', inputTokens: 2 });
  const budgetGoal = createGoalRun({
    ownerUserId: owner,
    agentId: 'coo-test',
    prompt: 'Recover a failed scheduled goal visibly.',
    steps: [{ type: 'agent_tool', label: 'Failing check', tool_name: 'status_checker' }],
  });
  db.prepare("UPDATE agent_goal_runs SET status='failed', error_message='schema mismatch' WHERE id=?").run(budgetGoal.id);
  const budgetRecovery = await enqueueGoalPlanFailureKanban(budgetGoal.id);
  assert.equal(budgetRecovery.awaiting_confirmation, true);
  assert.equal(budgetRecovery.task_id, null);
  assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(budgetRecovery.kanban_id).status, 'awaiting_confirmation');
  db.prepare("UPDATE kanban_tasks SET status='failed' WHERE id=?").run(budgetRecovery.kanban_id);
  const repairedBudgetCard = reconcileBudgetBlockedGoalRecoveryCards({ ownerUserId: owner });
  assert.equal(repairedBudgetCard.awaiting, 1);
  setAgentBudget(owner, 'coo-test', { monthly_token_budget: null });
  const reopenedBudgetCard = reconcileBudgetBlockedGoalRecoveryCards({ ownerUserId: owner });
  assert.equal(reopenedBudgetCard.reopened, 1);
  assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(budgetRecovery.kanban_id).status, 'open');

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
    budget_recovery_card: 'awaiting_confirmation -> open',
    recovery_continuity: 'validated recovery resumed original goal',
  });
} finally {
  try { database?.close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
