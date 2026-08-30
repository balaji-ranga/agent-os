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

  const intent = await import('../src/services/intent-classifier.js');
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
  const goal = goals.createGoalRun({ ownerUserId: owner, agentId: 'balserve', title: 'Overdue invoice collection', prompt: 'Resolve overdue invoice INV-104 and report the outcome.', steps: [{ type: 'human_task', label: 'Human: Alex Collector', user_id: employee, message: 'Contact the account owner, use judgment on the collection approach, and record the outcome.', risk: 'high', selection_rationale: 'High-risk customer/financial judgment routed to the matched human.' }, { type: 'notify_ceo', label: 'Report outcome' }] });
  const started = await goals.startGoalRunExecution(goal.id, { ownerUserId: owner }); assert.equal(started.waiting_for_human, true); assert(started.kanban_task_id);
  const task = db.prepare('SELECT * FROM kanban_tasks WHERE id=?').get(started.kanban_task_id); assert.equal(task.assigned_user_id, employee); assert.equal(task.goal_run_id, goal.id); assert.equal(task.status, 'in_progress');
  await goals.respondToHumanGoalTask({ ownerUserId: owner, actorUserId: employee, taskId: task.id, action: 'complete', outcome: 'Customer confirmed payment on 3 September; no fee waiver was promised.' });
  const humanStep = db.prepare("SELECT * FROM agent_goal_steps WHERE goal_run_id=? AND step_type='human_task'").get(goal.id); assert.equal(humanStep.status, 'completed'); assert.match(humanStep.result_json, /payment on 3 September/);
  await assert.rejects(() => goals.respondToHumanGoalTask({ ownerUserId: owner, actorUserId: outsider, taskId: task.id, action: 'complete', outcome: 'spoof' }), /assigned employee/);
  console.log('human-company-execution: OK');
} finally { try { testDb?.close(); } catch {} rmSync(dataDir, { recursive: true, force: true }); }
