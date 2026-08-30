import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-human-execution-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
process.env.PUBLIC_BASE_URL = 'https://login.example.test';
process.env.GOAL_PLAN_COO_COMPLETION_NUDGE = '0';
let testDb;
try {
  const { initDb } = await import('../src/db/schema.js'); const db = initDb(); testDb = db;
  const owner = 'ceo-human-test', employee = 'user-collections-test', outsider = 'user-outsider-test';
  db.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)').run(owner,'owner@example.test','x','Owner','ceo');
  db.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled,owner_user_id,department,role_title,specialty,purpose) VALUES(?,?,?,?,?,1,?,?,?,?,?)`).run(employee,'collector@example.test','x','Alex Collector','org_user',owner,'Finance','Collections Manager','overdue invoice collections','Resolve overdue customer invoices');
  db.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)').run(outsider,'other@example.test','x','Other Owner','ceo');

  const comms = await import('../src/services/human-communications.js');
  const people = comms.listHumanDirectory(owner, owner); assert.equal(people.some((p) => p.id === employee), true); assert.equal(people.some((p) => p.id === outsider), false);
  const conversation = comms.getOrCreateDirectConversation(owner, owner, employee); const message = comms.sendHumanMessage(owner, owner, conversation.id, 'Please review invoice INV-104.'); assert.equal(message.body, 'Please review invoice INV-104.');
  assert.throws(() => comms.listHumanMessages(owner, outsider, conversation.id), /Conversation not found/);
  const invite = comms.createHumanVoiceInvite(owner, owner, employee, { ttlSeconds: 120 }); assert.match(invite.url, /\/call\/user\/[A-Za-z0-9_-]+$/); assert.equal(invite.target.id, employee);

  const assignment = await import('../src/services/work-assignment-policy.js');
  assignment.saveWorkAssignmentPolicy(owner, { mode: 'risk_to_human', high_risk_to_human: true });
  const decision = assignment.chooseOverlappingExecutor({ policy: assignment.getWorkAssignmentPolicy(owner), risk: 'high', agentCandidate: { id: 'erp-checker', match_score: 90 }, humanCandidate: { id: employee, match_score: 75 } }); assert.equal(decision.kind, 'human');
  assert.equal(assignment.chooseOverlappingExecutor({ policy: { mode: 'prefer_agent', high_risk_to_human: false }, agentCandidate: { id: 'agent', match_score: 60 }, humanCandidate: { id: employee, match_score: 90 } }).kind, 'agent');
  assert.equal(assignment.chooseOverlappingExecutor({ policy: { mode: 'prefer_human', high_risk_to_human: false }, agentCandidate: { id: 'agent', match_score: 90 }, humanCandidate: { id: employee, match_score: 60 } }).kind, 'human');
  assert.equal(assignment.chooseOverlappingExecutor({ policy: { mode: 'equal_weight', high_risk_to_human: false }, agentCandidate: { id: 'agent', match_score: 80 }, humanCandidate: { id: employee, match_score: 70 } }).kind, 'agent');

  db.prepare(`INSERT OR REPLACE INTO agents(id,name,role,department,parent_id,openclaw_agent_id,is_coo,planning_status) VALUES
    ('balserve','COO / BalServe','COO','Executive',NULL,'balserve',1,'production'),
    ('invoice-agent','Invoice Agent','Accounts receivable and overdue invoice collections','Finance','balserve','invoice-agent',0,'production'),
    ('test-chat-hist-leak','Test','tester','Operations','balserve','test-chat-hist-leak',0,'fixture'),
    ('business-discovery','Business Discovery','Local business discovery and market research','Research','balserve','business-discovery',0,'production')`).run();
  db.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)').run(owner,'balserve');
  db.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)').run(owner,'invoice-agent');
  db.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)').run(owner,'test-chat-hist-leak');
  db.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)').run(owner,'business-discovery');
  const registry = await import('../src/services/runtime-capability-registry.js');
  const employees = registry.buildRuntimeCapabilityRegistry(owner).filter((row) => row.kind === 'employee');
  assert.equal(employees.some((row) => row.id === 'test-chat-hist-leak'), false, 'fixture employee must never enter runtime planner registry');
  assert.equal(employees.some((row) => row.id === 'invoice-agent'), true, 'production employee remains plannable');

  const intent = await import('../src/services/intent-classifier.js');
  const permissions = await import('../src/services/org-permissions.js');
  assert.equal(permissions.matchApiPermission('POST', '/agents/erp-invoice/chat'), 'agent-chat');
  assert.equal(permissions.matchApiPermission('POST', '/agents/erp-invoice/sessions/new'), 'agent-chat');
  assert.equal(permissions.matchApiPermission('PATCH', '/agents/erp-invoice'), '__full__');
  const roster = intent.parseAgentsFromAgentsMd(`| Agent ID | Name | Department | Purpose |\n|---|---|---|---|\n| erp-invoice | Invoice Agent | Finance | Accounts receivable |\n| test-chat-hist-1 | Test | Operations | tester |`);
  assert.deepEqual(roster.map((row) => row.id), ['erp-invoice']);
  assert.deepEqual(intent.normalizeKeysToDocIds({ 'Invoice Agent': 'Review receivable', hallucinated_agent: 'Do unrelated work' }, roster), { 'erp-invoice': 'Review receivable' });
  const goalIntent = await import('../src/services/goal-plan-intent.js');
  assert.equal(goalIntent.isEligiblePlanningAgent({ id: 'test-chat-hist-1', name: 'Test', role: 'Operations — tester' }), false);
  assert.equal(goalIntent.isEligiblePlanningAgent({ id: 'test-chat-hist-1', name: 'Test', role: 'specialty agent' }), false);
  assert.equal(goalIntent.isEligiblePlanningAgent({ id: 'erp-invoice', name: 'Invoice Agent', role: 'Finance — Accounts receivable' }), true);
  const specialty = await import('../src/services/goal-plan-specialty.js');
  const planningRoster = specialty.rosterAgentsForGoalPlan(`| Agent ID | Name | Department | Purpose |\n|---|---|---|---|\n| erp-invoice | Invoice Agent | Finance | Accounts receivable |\n| test-chat-hist-1 | Test | Operations | tester |`);
  assert.deepEqual(planningRoster.map((row) => row.id), ['erp-invoice']);

  const goals = await import('../src/services/agent-goal-run.js');
  const repaired = goals.validateAndRepairGoalPlan([
    { type: 'specialty_task', label: 'Test', agent_id: 'test-chat-hist-leak', message: 'Test the final result.' },
    { type: 'specialty_task', label: 'Report consolidated final outcome', agent_id: 'business-discovery', message: '' },
    { type: 'notify_ceo', label: 'Notify CEO' },
  ], 'Assign invoice collection judgment to Alex Collector and report the consolidated final outcome to me in this chat.', { ownerUserId: owner, orchestratorAgentId: 'balserve' });
  assert.equal(repaired.some((step) => step.type === 'specialty_task' && step.spec?.agent_id === 'test-chat-hist-leak'), false);
  assert.equal(repaired.some((step) => step.type === 'specialty_task' && step.spec?.agent_id === 'business-discovery'), false);
  const assigned = await goalIntent.applyHumanAssignmentPolicy(owner, 'Assign invoice collection judgment to Alex Collector and report the consolidated final outcome to me in this chat.', repaired);
  assert.equal(assigned.some((step) => step.type === 'human_task' && step.spec?.user_id === employee), true);
  assert.equal(assigned.some((step) => step.type === 'agent_continue'), true, 'COO synthesis must follow human outcome');
  const directMapped = await goalIntent.applyHumanAssignmentPolicy(owner, 'Ask Alex Collector to resolve overdue invoice INV-221 and record the customer payment outcome.', [
    { type: 'specialty_task', label: 'Route customer judgment', spec: { agent_id: 'invoice-agent', message: 'Assign the task to Alex Collector for customer-contact judgment.' } },
    { type: 'notify_ceo', label: 'Notify CEO' },
  ]);
  const directHuman = directMapped.find((step) => step.type === 'human_task');
  assert(directHuman, 'explicit human must replace the matched agent step');
  assert.match(directHuman.spec.message, /resolve overdue invoice INV-221/i, 'human work order must preserve the real CEO outcome');
  assert.doesNotMatch(directHuman.spec.message, /^Assign the task to Alex Collector/i, 'human must not be asked to prove assignment to themself');
  const goal = goals.createGoalRun({ ownerUserId: owner, agentId: 'balserve', title: 'Overdue invoice collection', prompt: 'Resolve overdue invoice INV-104 and report the outcome.', steps: [{ type: 'human_task', label: 'Human: Alex Collector', user_id: employee, message: 'Contact the account owner, use judgment on the collection approach, and record the outcome.', risk: 'high', selection_rationale: 'High-risk customer/financial judgment routed to the matched human.' }, { type: 'notify_ceo', label: 'Report outcome' }] });
  const started = await goals.startGoalRunExecution(goal.id, { ownerUserId: owner }); assert.equal(started.waiting_for_human, true); assert(started.kanban_task_id);
  const task = db.prepare('SELECT * FROM kanban_tasks WHERE id=?').get(started.kanban_task_id); assert.equal(task.assigned_user_id, employee); assert.equal(task.goal_run_id, goal.id); assert.equal(task.status, 'in_progress');
  assert.equal(task.eta_hours, 4, 'explicit high-risk human judgment gets the urgent SLA tier'); assert(task.due_at);
  const sla = await import('../src/services/kanban-sla.js'); assert.equal(sla.slaState(task), 'green');
  assert.equal(sla.normalizeEtaHours(null, 'high-risk overdue invoice judgment'), 4);
  assert.equal(sla.normalizeEtaHours(null, 'complex customer research'), 12);
  const twelveHourStart = Date.parse('2026-08-30T00:00:00.000Z');
  const twelveHourTask = { status: 'in_progress', eta_hours: 12, created_at: new Date(twelveHourStart).toISOString(), due_at: new Date(twelveHourStart + 12 * 3600000).toISOString() };
  assert.equal(sla.slaState(twelveHourTask, twelveHourStart + 8 * 3600000), 'green');
  assert.equal(sla.slaState(twelveHourTask, twelveHourStart + 9 * 3600000), 'amber');
  assert.equal(sla.slaState(twelveHourTask, twelveHourStart + 12 * 3600000), 'red');
  const slaNow = Date.now();
  const amberTask = db.prepare(`INSERT INTO kanban_tasks(title,status,assigned_user_id,owner_user_id,eta_hours,due_at,created_at)
    VALUES('Amber SLA test','in_progress',?,?,4,?,?) RETURNING *`).get(employee,owner,new Date(slaNow + 30 * 60000).toISOString(),new Date(slaNow - 3 * 3600000).toISOString());
  const redTask = db.prepare(`INSERT INTO kanban_tasks(title,status,assigned_user_id,owner_user_id,eta_hours,due_at,created_at)
    VALUES('Red SLA test','in_progress',?,?,4,?,?) RETURNING *`).get(employee,owner,new Date(slaNow - 10 * 60000).toISOString(),new Date(slaNow - 5 * 3600000).toISOString());
  assert.equal(sla.slaState(amberTask), 'amber'); assert.equal(sla.slaState(redTask), 'red');
  const monitored = await sla.runKanbanSlaMonitor(); assert(monitored.nudged >= 1); assert(monitored.escalated >= 1);
  assert(db.prepare('SELECT sla_nudged_at FROM kanban_tasks WHERE id=?').get(amberTask.id).sla_nudged_at);
  assert(db.prepare('SELECT sla_escalated_at FROM kanban_tasks WHERE id=?').get(redTask.id).sla_escalated_at);
  assert(db.prepare("SELECT 1 FROM platform_user_notifications WHERE user_id=? AND source='kanban_sla_nudge' LIMIT 1").get(employee));
  assert(db.prepare("SELECT 1 FROM platform_user_notifications WHERE user_id=? AND source='kanban_sla_escalation' LIMIT 1").get(owner));
  const rejectedOutcome = await goals.respondToHumanGoalTask({ ownerUserId: owner, actorUserId: employee, taskId: task.id, action: 'complete', outcome: 'done' });
  assert.equal(rejectedOutcome.validation_failed, true); assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(task.id).status, 'in_progress');
  await goals.respondToHumanGoalTask({ ownerUserId: owner, actorUserId: employee, taskId: task.id, action: 'complete', outcome: 'Customer confirmed payment on 3 September; no fee waiver was promised.' });
  const humanStep = db.prepare("SELECT * FROM agent_goal_steps WHERE goal_run_id=? AND step_type='human_task'").get(goal.id); assert.equal(humanStep.status, 'completed'); assert.match(humanStep.result_json, /payment on 3 September/);
  const terminalContext = goals.priorStepContextForAgent(goal.id, 1);
  assert.match(terminalContext, /Customer confirmed payment on 3 September/, 'orchestrator synthesis receives the concrete human outcome');
  assert.match(terminalContext, /Kanban task: #/, 'orchestrator synthesis retains human-task evidence correlation');
  await assert.rejects(() => goals.respondToHumanGoalTask({ ownerUserId: owner, actorUserId: outsider, taskId: task.id, action: 'complete', outcome: 'spoof' }), /assigned employee/);
  const ownerGoal = goals.createGoalRun({ ownerUserId: owner, agentId: 'balserve', title: 'CEO disposition', prompt: 'Obtain invoice evidence from Alex.', steps: [{ type: 'human_task', label: 'Human: Alex Collector', user_id: employee, message: 'Obtain the invoice evidence.', risk: 'normal' }, { type: 'notify_ceo', label: 'Report outcome' }] });
  const ownerStarted = await goals.startGoalRunExecution(ownerGoal.id, { ownerUserId: owner });
  const ownerResult = await goals.respondToHumanGoalTask({ ownerUserId: owner, actorUserId: owner, taskId: ownerStarted.kanban_task_id, action: 'complete', outcome: 'CEO verified the invoice evidence directly and accepts the result.' });
  assert.equal(ownerResult.owner_override, true); assert.equal(ownerResult.validation.overridden_by_owner, true);
  assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(ownerStarted.kanban_task_id).status, 'completed');
  assert.match(db.prepare('SELECT result_json FROM agent_goal_steps WHERE id=?').get(db.prepare('SELECT goal_step_id FROM kanban_tasks WHERE id=?').get(ownerStarted.kanban_task_id).goal_step_id).result_json, /owner_override/);
  const failGoal = goals.createGoalRun({ ownerUserId: owner, agentId: 'balserve', title: 'CEO failure disposition', prompt: 'Obtain a signed payment commitment.', steps: [{ type: 'human_task', label: 'Human: Alex Collector', user_id: employee, message: 'Obtain a signed payment commitment.', risk: 'high' }] });
  const failStarted = await goals.startGoalRunExecution(failGoal.id, { ownerUserId: owner });
  const failResult = await goals.respondToHumanGoalTask({ ownerUserId: owner, actorUserId: owner, taskId: failStarted.kanban_task_id, action: 'unable', outcome: 'CEO confirmed the customer declined to provide a signed commitment.' });
  assert.equal(failResult.owner_override, true); assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(failStarted.kanban_task_id).status, 'failed');
  assert.equal(db.prepare('SELECT status FROM agent_goal_runs WHERE id=?').get(failGoal.id).status, 'failed');
  console.log('human-company-execution: OK');
} finally { try { testDb?.close(); } catch {} rmSync(dataDir, { recursive: true, force: true }); }
