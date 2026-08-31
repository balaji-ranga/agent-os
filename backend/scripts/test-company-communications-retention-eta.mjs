import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-comms-retention-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
process.env.OPENSEARCH_ENABLED = '0';
let database;
try {
  const { initDb } = await import('../src/db/schema.js');
  database = initDb();
  const owner = 'ceo-retention-test';
  const employee = 'employee-retention-test';
  const outsider = 'ceo-outsider-test';
  database.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled,data_retention_days) VALUES(?,?,?,?,?,1,30)')
    .run(owner, 'owner-retention@example.test', 'x', 'Owner', 'ceo');
  database.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled,owner_user_id,data_retention_days) VALUES(?,?,?,?,?,1,?,365)')
    .run(employee, 'employee-retention@example.test', 'x', 'Employee', 'org_user', owner);
  database.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)')
    .run(outsider, 'outsider-retention@example.test', 'x', 'Outsider', 'ceo');
  database.prepare(`INSERT INTO agents(id,name,role,openclaw_agent_id,is_coo) VALUES('coo-retention','COO','COO','coo-retention',1)`).run();
  database.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)`).run(owner, 'coo-retention');

  const policy = await import('../src/services/work-assignment-policy.js');
  policy.saveWorkAssignmentPolicy(owner, {
    mode: 'prefer_agent', urgent_eta_hours: 2, standard_eta_hours: 24, complex_eta_hours: 72,
    sla_notify_in_app: true, sla_notify_email: false, sla_notify_whatsapp: true,
    sla_include_status_checker: true,
  });
  const savedPolicy = policy.getWorkAssignmentPolicy(owner);
  assert.equal(savedPolicy.sla_notify_email, false);
  assert.equal(savedPolicy.sla_notify_whatsapp, true);
  assert.equal(policy.resolvePolicyEtaHours(owner, null, 'urgent legal approval'), 2);
  assert.equal(policy.resolvePolicyEtaHours(owner, null, 'prepare normal update'), 24);
  assert.equal(policy.resolvePolicyEtaHours(owner, null, 'complex research'), 72);
  assert.equal(policy.resolvePolicyEtaHours(owner, 8, 'urgent'), 8, 'task-specific ETA must override policy');
  const sla = await import('../src/services/kanban-sla.js');
  const taskInfo = database.prepare(`INSERT INTO kanban_tasks(title,description,status,created_by,owner_user_id) VALUES('Policy ETA task','normal work','open','test',?)`).run(owner);
  assert.equal(database.prepare('SELECT eta_hours FROM kanban_tasks WHERE id=?').get(Number(taskInfo.lastInsertRowid)).eta_hours, 24, 'all task creation paths receive the company standard ETA');
  const applied = sla.applyPolicyEtaToTask(Number(taskInfo.lastInsertRowid), owner, { context: 'normal work' });
  assert.equal(applied.eta_hours, 24);
  assert.equal(Math.round((Date.parse(applied.due_at) - Date.now()) / 3600000), 24);
  database.prepare(`INSERT INTO kanban_sla_events
    (owner_user_id,task_id,event_type,task_title,task_status,occurred_at)
    VALUES(?,999,'breach','Old SLA breach','deleted',datetime('now','-45 days'))`).run(owner);
  const taskActions = await import('../src/services/kanban-user-actions.js');
  taskActions.ensureKanbanUserActionAudit();
  database.prepare(`INSERT INTO kanban_user_action_audit
    (owner_user_id,task_id,actor_user_id,proxy_agent_id,channel,action,evidence,result_json,status,created_at)
    VALUES(?,999,?,'coo-retention','whatsapp','complete','old evidence','{}','ok',datetime('now','-45 days'))`).run(owner, employee);

  const users = await import('../src/services/users.js');
  assert.equal(users.getUserById(employee).data_retention_days, undefined, 'employee profile must not expose retention');
  assert.throws(() => users.updateUserProfile(employee, { data_retention_days: 30 }), /company CEO profile/);

  const comms = await import('../src/services/human-communications.js');
  const conversation = comms.getOrCreateDirectConversation(owner, owner, employee);
  const oldMessage = comms.sendHumanMessage(owner, owner, conversation.id, 'old retained message');
  database.prepare("UPDATE human_messages SET created_at=datetime('now','-45 days') WHERE id=?").run(oldMessage.id);
  comms.sendHumanMessage(owner, employee, conversation.id, 'current company message');
  const call = comms.createHumanCall(owner, owner, { calleeUserId: employee, conversationId: conversation.id, offer: { sdp: 'secret-offer' } });
  comms.updateHumanCall(owner, employee, call.id, { answer: { sdp: 'secret-answer' } });
  comms.updateHumanCall(owner, owner, call.id, { status: 'ended' });
  const rawCall = database.prepare('SELECT * FROM human_calls WHERE id=?').get(call.id);
  assert.equal(rawCall.offer_json, null); assert.equal(rawCall.answer_json, null);
  assert.equal(rawCall.caller_candidates_json, '[]'); assert.equal(rawCall.callee_candidates_json, '[]');
  const history = comms.listCompanyCommunicationHistory(owner, { conversationId: conversation.id });
  assert.equal(history.messages.some((m) => m.body === 'current company message'), true);
  assert.equal(history.calls.some((c) => c.id === call.id), true);
  assert.equal(Object.hasOwn(history.calls[0], 'offer_json'), false, 'company audit must never return WebRTC signalling');
  assert.equal(comms.listCompanyCommunicationHistory(outsider).conversations.length, 0, 'other CEO cannot see this company');

  const voice = await import('../src/services/agent-voice-sessions.js');
  voice.ensureVoiceSessionsSchema();
  database.prepare(`INSERT INTO ceo_voice_sessions
    (id,owner_user_id,agent_id,token_hash,status,transcript_json,created_at,ended_at,expires_at,is_guest)
    VALUES('voice-current',?,?,?,'ended',?,datetime('now','-1 day'),datetime('now','-1 day'),datetime('now','+1 day'),0)`).run(
      owner, 'coo-retention', 'voice-current-hash', JSON.stringify([{ role: 'user', text: 'current transcript' }])
    );
  database.prepare(`INSERT INTO ceo_voice_sessions
    (id,owner_user_id,agent_id,token_hash,status,transcript_json,created_at,ended_at,expires_at,is_guest)
    VALUES('voice-old',?,?,?,'ended',?,datetime('now','-45 days'),datetime('now','-45 days'),datetime('now','-44 days'),0)`).run(
      owner, 'coo-retention', 'voice-old-hash', JSON.stringify([{ role: 'user', text: 'old transcript' }])
    );
  assert.equal(voice.listVoiceSessions(owner, 'coo-retention').some((s) => s.transcript[0]?.text === 'current transcript'), true);

  const retention = await import('../src/services/data-retention.js');
  const purged = await retention.purgeOwnerRetention(owner);
  assert.equal(purged.retention_days, 30, 'CEO profile is the company retention source');
  assert.equal(purged.deleted.human_messages, 1);
  assert.equal(purged.deleted.agent_voice_sessions, 1);
  assert.equal(purged.deleted.kanban_sla_events, 1);
  assert.equal(purged.deleted.kanban_user_action_audit, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM ceo_voice_sessions WHERE id='voice-current'").get().n, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM human_messages WHERE conversation_id=?').get(conversation.id).n >= 1, true);
  await assert.rejects(() => retention.purgeOwnerRetention(employee), /CEO owner profile required/);

  database.close(); database = null;
  console.log('company-communications-retention-eta: OK');
} finally {
  try { if (database?.open) database.close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
