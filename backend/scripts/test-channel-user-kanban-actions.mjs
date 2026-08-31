import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-channel-task-actions-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
let testDb;
try {
  const { initDb } = await import('../src/db/schema.js');
  const db = initDb(); testDb = db;
  const addUser = db.prepare(`INSERT INTO platform_users(id,email,password_hash,name,mobile,role,enabled,owner_user_id,department)
    VALUES(?,?,?,?,?,?,1,?,?)`);
  addUser.run('ceo-a','ceo-a@test','x','CEO A','+65 9000 0001','ceo',null,'Executive');
  addUser.run('user-a','user-a@test','x','User A','+65 9000 0002','org_user','ceo-a','Finance');
  addUser.run('user-b','user-b@test','x','User B','+65 9000 0003','org_user','ceo-a','Finance');
  addUser.run('ceo-b','ceo-b@test','x','CEO B','+65 9000 0004','ceo',null,'Executive');
  db.prepare(`INSERT INTO agents(id,name,role,department,openclaw_agent_id,is_coo) VALUES
    ('balserve','COO','COO','Executive','balserve',1),('other-agent','Other','Worker','Finance','other-agent',0)`).run();

  const identity = await import('../src/services/channel-user-identity.js');
  assert.equal(identity.normalizeChannelMobile('whatsapp:+65 9000-0002@s.whatsapp.net'), '6590000002');
  const mapped = identity.resolveChannelActor({ ownerUserId: 'ceo-a', senderId: '6590000002@s.whatsapp.net' });
  assert.equal(mapped.id, 'user-a');
  assert.throws(() => identity.resolveChannelActor({ ownerUserId: 'ceo-b', senderId: '6590000002@s.whatsapp.net' }), /not mapped/);
  const sessions = await import('../src/services/tool-owner-scope.js');
  sessions.registerOpenClawSessionOwner('agent:balserve:web-test', 'ceo-a', 'user-a', 'web');
  assert.deepEqual(sessions.lookupOpenClawSessionActor('agent:balserve:web-test'), { ownerUserId:'ceo-a', actorUserId:'user-a', channel:'web' });

  const task = db.prepare(`INSERT INTO kanban_tasks(title,status,assigned_user_id,owner_user_id) VALUES('Collect invoice','in_progress','user-a','ceo-a') RETURNING *`).get();
  const scope = await import('../src/services/kanban-user-scope.js');
  assert.equal(scope.canMutateKanbanTask(task, mapped), true);
  assert.equal(scope.canMutateKanbanTask(task, { id:'user-b', role:'org_user', owner_user_id:'ceo-a', department:'Finance' }), false);
  assert.equal(scope.canMutateKanbanTask(task, { id:'delegate', role:'org_user', owner_user_id:'ceo-a', is_ceo_delegate:true }), true);

  const actions = await import('../src/services/kanban-user-actions.js');
  await assert.rejects(() => actions.executeKanbanUserAction({ ownerUserId:'ceo-a', actor:mapped, proxyAgentId:'other-agent', channel:'whatsapp', taskId:task.id, action:'complete', evidence:'I completed it.' }), /Only the COO/);
  const exact = 'I contacted the customer and completed invoice collection; receipt INV-44 is attached.';
  const result = await actions.executeKanbanUserAction({ ownerUserId:'ceo-a', actor:mapped, proxyAgentId:'balserve', channel:'whatsapp', senderFingerprint:mapped.sender_fingerprint, sessionKey:'agent:balserve:test', taskId:task.id, action:'complete', evidence:exact });
  assert.equal(result.status, 'completed'); assert.equal(result.acted_by_coo, true); assert.equal(result.evidence_captured, true);
  const message = db.prepare('SELECT content FROM task_messages WHERE task_id=? ORDER BY id DESC').get(task.id);
  assert.match(message.content, new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const audit = db.prepare('SELECT * FROM kanban_user_action_audit WHERE task_id=?').get(task.id);
  assert.equal(audit.actor_user_id, 'user-a'); assert.equal(audit.proxy_agent_id, 'balserve'); assert.equal(audit.channel, 'whatsapp');
  assert.equal(audit.evidence, exact); assert(audit.sender_fingerprint); assert.equal(audit.sender_fingerprint.includes('90000002'), false);

  const webTask = db.prepare(`INSERT INTO kanban_tasks(title,status,assigned_user_id,owner_user_id) VALUES('Web update','open','user-a','ceo-a') RETURNING *`).get();
  const web = await actions.executeKanbanUserAction({ ownerUserId:'ceo-a', actor:mapped, proxyAgentId:'balserve', channel:'web', taskId:webTask.id, action:'update', evidence:'I have started this task.', newStatus:'in_progress' });
  assert.equal(web.status, 'in_progress');
  await assert.rejects(() => actions.executeKanbanUserAction({ ownerUserId:'ceo-a', actor:{ id:'user-b', role:'org_user', owner_user_id:'ceo-a' }, proxyAgentId:'balserve', channel:'web', taskId:webTask.id, action:'complete', evidence:'Complete it' }), /assigned task owner/);

  const goals = await import('../src/services/agent-goal-run.js');
  const approvalSvc = await import('../src/services/goal-action-approval.js');
  const approvalGoal = goals.createGoalRun({ ownerUserId:'ceo-a', agentId:'balserve', title:'Approval test', prompt:'Send an external update.', steps:[{ type:'agent_tool', label:'Send update', tool_name:'email_send', args:{ to:'a@test' } }] });
  const approvalStep = db.prepare('SELECT * FROM agent_goal_steps WHERE goal_run_id=?').get(approvalGoal.id);
  const approval = approvalSvc.createGoalActionApproval({ ownerUserId:'ceo-a', goal:approvalGoal, step:approvalStep, toolName:'email_send', actionFamily:'R2', args:{ to:'a@test' } });
  const ceo = identity.loadCompanyActor('ceo-a', 'ceo-a');
  const rejected = await actions.executeKanbanUserAction({ ownerUserId:'ceo-a', actor:ceo, proxyAgentId:'balserve', channel:'whatsapp', taskId:approval.kanban_task_id, action:'reject', evidence:'I reject this external email.' });
  assert.equal(rejected.decision, 'rejected');
  assert.equal(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(approval.kanban_task_id).status, 'failed');
  assert.equal(db.prepare('SELECT evidence FROM kanban_user_action_audit WHERE task_id=?').get(approval.kanban_task_id).evidence, 'I reject this external email.');
  console.log('channel-user-kanban-actions: OK');
} finally {
  try { testDb?.close(); } catch {}
  rmSync(dataDir, { recursive:true, force:true });
}
