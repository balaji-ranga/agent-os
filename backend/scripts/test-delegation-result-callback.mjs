import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getDb, initDb } from '../src/db/schema.js';
import { bindWorkUnitExecution, routeAgentTurn } from '../src/services/agent-turn-router.js';
import { postCallbackForRequestId } from '../src/services/delegation-queue.js';

initDb();
const db = getDb();
const suffix = randomUUID().slice(0, 8);
const owner = `callback-owner-${suffix}`;
const cooId = `callback-coo-${suffix}`;
const specialistId = `callback-specialist-${suffix}`;
const requestId = `callback-request-${suffix}`;
let standupId = null;
let workUnitId = null;

try {
  db.prepare(`INSERT INTO agents (id,name,role,is_coo,openclaw_agent_id) VALUES (?,?,?,?,?)`)
    .run(cooId, 'Callback COO', 'COO', 1, cooId);
  db.prepare(`INSERT INTO agents (id,name,role,parent_id,openclaw_agent_id) VALUES (?,?,?,?,?)`)
    .run(specialistId, 'Callback Specialist', 'Researcher', cooId, specialistId);

  const workUnit = await routeAgentTurn({
    ownerUserId: owner,
    agent: { id: cooId, name: 'Callback COO', role: 'COO', is_coo: 1 },
    sessionId: `callback-session-${suffix}`,
    message: 'Delegate a bounded research deliverable.',
    history: [],
    semanticDecision: {
      relation: 'new_work',
      execution_mode: 'delegate',
      relevant_turn_ids: [],
      resolved_request: 'Delegate a bounded research deliverable.',
      restart_requested: false,
      confidence: 1,
    },
  });
  workUnitId = workUnit.id;
  bindWorkUnitExecution(workUnitId, requestId, 'running');

  const standup = db.prepare(`INSERT INTO standups (scheduled_at,status,source) VALUES (datetime('now'),'in_progress','test')`).run();
  standupId = Number(standup.lastInsertRowid);
  db.prepare(`
    INSERT INTO agent_delegation_tasks
      (standup_id,request_id,to_agent_id,prompt,status,response_content,owner_user_id,parent_work_unit_id,parent_agent_id,completed_at)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
  `).run(
    standupId,
    requestId,
    specialistId,
    'Return the actual bounded result.',
    'completed',
    'Verified specialist result.',
    owner,
    workUnitId,
    cooId
  );

  const summarize = async ({ callbackMessage }) => `COO verified callback: ${callbackMessage}`;
  await postCallbackForRequestId(requestId, { summarize });
  await postCallbackForRequestId(requestId, { summarize });

  const callbackCount = db.prepare(`SELECT COUNT(*) AS n FROM delegation_callbacks WHERE request_id=?`).get(requestId).n;
  const delivered = db.prepare(`SELECT callback_delivered_at FROM agent_delegation_tasks WHERE request_id=?`).get(requestId);
  const parentTurns = db.prepare(`SELECT content FROM chat_turns WHERE owner_user_id=? AND agent_id=? AND work_unit_id=?`).all(owner, cooId, workUnitId);
  const finalWorkUnit = db.prepare(`SELECT status,execution_ref FROM chat_work_units WHERE id=?`).get(workUnitId);
  assert.equal(callbackCount, 1, 'standup callback is idempotent');
  assert.ok(delivered.callback_delivered_at, 'specialist result is marked delivered');
  assert.equal(parentTurns.length, 1, 'COO parent chat receives exactly one terminal result');
  assert.match(parentTurns[0].content, /Verified specialist result/);
  assert.deepEqual(finalWorkUnit, { status: 'completed', execution_ref: requestId });
  console.log('DELEGATION_RESULT_CALLBACK_OK');
} finally {
  if (workUnitId) db.prepare(`DELETE FROM chat_turns WHERE work_unit_id=?`).run(workUnitId);
  db.prepare(`DELETE FROM chat_sessions WHERE owner_user_id=?`).run(owner);
  db.prepare(`DELETE FROM delegation_callbacks WHERE request_id=?`).run(requestId);
  db.prepare(`DELETE FROM agent_delegation_tasks WHERE request_id=?`).run(requestId);
  if (standupId) {
    db.prepare(`DELETE FROM standup_responses WHERE standup_id=?`).run(standupId);
    db.prepare(`DELETE FROM standup_messages WHERE standup_id=?`).run(standupId);
    db.prepare(`DELETE FROM standups WHERE id=?`).run(standupId);
  }
  if (workUnitId) db.prepare(`DELETE FROM chat_work_units WHERE id=?`).run(workUnitId);
  db.prepare(`DELETE FROM agents WHERE id IN (?,?)`).run(cooId, specialistId);
}
