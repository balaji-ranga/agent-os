import { randomUUID } from 'node:crypto';
import { getDb } from '../db/schema.js';
import { lookupActiveDashboardChat } from './tool-owner-scope.js';

const ACTIVE = new Set(['pending', 'planning', 'active', 'running', 'in_progress', 'waiting', 'waiting_approval']);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function createSteeringStore(db, { chatActive = () => true } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS work_steering (
    id TEXT NOT NULL, owner_user_id TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
    agent_id TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL,
    delivered_at TEXT, checkpoint TEXT, actor_user_id TEXT NOT NULL,
    PRIMARY KEY(owner_user_id,id));
    CREATE INDEX IF NOT EXISTS idx_work_steering_target ON work_steering(owner_user_id,target_kind,target_id,status);`);
  const columns = db.prepare('PRAGMA table_info(work_steering)').all().map(r => r.name);
  for (const name of ['resolution_json', 'source_note_id']) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE work_steering ADD COLUMN ${name} TEXT`);
  }
  function target(owner, kind, id) {
    let row;
    if (kind === 'chat') {
      row = db.prepare('SELECT id,agent_id,status,resolved_request AS title FROM chat_work_units WHERE owner_user_id=? AND id=? AND execution_mode!=?').get(owner, id, 'goal_plan');
      if (row && !chatActive(row.agent_id, owner, row.id)) fail('This chat is no longer working. Send a normal follow-up instead.', 409);
    } else if (kind === 'goal') {
      row = db.prepare('SELECT id,agent_id,status,title FROM agent_goal_runs WHERE owner_user_id=? AND id=?').get(owner, id);
    } else if (kind === 'task') {
      row = db.prepare('SELECT id,to_agent_id AS agent_id,status,prompt AS title FROM agent_delegation_tasks WHERE owner_user_id=? AND id=?').get(owner, id);
    } else if (kind === 'schedule') {
      row = db.prepare('SELECT id,agent_id,status,title FROM scheduled_goals WHERE owner_user_id=? AND id=?').get(owner, id);
      if (row && row.status !== 'active') fail('Only an active schedule can receive guidance for its next run.', 409);
    } else if (kind === 'schedule_run') {
      row = db.prepare('SELECT r.id,r.agent_id,r.status,s.title FROM scheduled_goal_runs r JOIN scheduled_goals s ON s.id=r.goal_id AND s.owner_user_id=r.owner_user_id WHERE r.owner_user_id=? AND r.id=?').get(owner, id);
    } else fail('Unsupported work target');
    if (!row) fail('Work target not found', 404);
    if (!ACTIVE.has(row.status)) fail('This work has ended; steering will not restart it.', 409);
    return { ...row, kind, id: String(row.id) };
  }
  function listTargets(owner, agentId) {
    const candidates = [
      ...db.prepare("SELECT id,agent_id,status,resolved_request AS title,'chat' AS kind FROM chat_work_units WHERE owner_user_id=? AND status IN ('active','running') AND execution_mode!='goal_plan' ORDER BY created_at DESC LIMIT 50").all(owner).filter(r => chatActive(r.agent_id, owner, r.id)),
      ...db.prepare("SELECT id,agent_id,status,title,'goal' AS kind FROM agent_goal_runs WHERE owner_user_id=? AND status IN ('pending','planning','running','waiting','waiting_approval') ORDER BY created_at DESC LIMIT 100").all(owner),
      ...db.prepare("SELECT id,to_agent_id AS agent_id,status,prompt AS title,'task' AS kind FROM agent_delegation_tasks WHERE owner_user_id=? AND status IN ('pending','running','in_progress') ORDER BY created_at DESC LIMIT 100").all(owner),
      ...db.prepare("SELECT r.id,r.agent_id,r.status,s.title,'schedule_run' AS kind FROM scheduled_goal_runs r JOIN scheduled_goals s ON s.id=r.goal_id AND s.owner_user_id=r.owner_user_id WHERE r.owner_user_id=? AND r.status='running' ORDER BY r.created_at DESC LIMIT 50").all(owner),
      ...db.prepare("SELECT id,agent_id,status,title,'schedule' AS kind FROM scheduled_goals WHERE owner_user_id=? AND status='active' ORDER BY created_at DESC LIMIT 100").all(owner),
    ];
    return candidates.filter(r => !agentId || r.agent_id === agentId).map(r => ({ ...r, id: String(r.id), title: String(r.title || '').slice(0, 160), delivery: r.kind === 'schedule' ? 'Next scheduled run only' : 'Next agent/tool/step checkpoint; no restart' }));
  }
  function history(owner, kind, id) {
    db.prepare("UPDATE work_steering SET status='expired' WHERE owner_user_id=? AND target_kind=? AND target_id=? AND status='queued' AND expires_at<=datetime('now')").run(owner, kind, String(id));
    try { target(owner, kind, id); }
    catch (e) { if ([404,409].includes(e.status)) close(owner, kind, id); else throw e; }
    return db.prepare('SELECT id,target_kind,target_id,agent_id,message,status,created_at,delivered_at,checkpoint,resolution_json,source_note_id FROM work_steering WHERE owner_user_id=? AND target_kind=? AND target_id=? ORDER BY created_at DESC LIMIT 20').all(owner, kind, String(id));
  }
  function enqueue(owner, actor, { target_kind: kind, target_id: id, message, idempotency_key: key }) {
    if (!owner || !actor) fail('Authenticated owner and actor required', 403);
    const text = String(message || '').trim();
    if (!text || text.length > 4000) fail('Guidance must contain 1–4000 characters');
    if (key && !/^[a-zA-Z0-9_-]{8,80}$/.test(key)) fail('Invalid idempotency key');
    return db.transaction(() => {
      const rowId = key || randomUUID();
      const old = db.prepare('SELECT * FROM work_steering WHERE owner_user_id=? AND id=?').get(owner, rowId);
      if (old) {
        if (old.target_kind !== kind || old.target_id !== String(id) || old.message !== text) fail('Idempotency key already used for different guidance', 409);
        return old;
      }
      const work = target(owner, kind, id);
      const count = db.prepare("SELECT count(*) AS n FROM work_steering WHERE owner_user_id=? AND target_kind=? AND target_id=?").get(owner, kind, String(id)).n;
      if (count >= 20) fail('This work already has 20 guidance notes', 409);
      db.prepare(`INSERT INTO work_steering(id,owner_user_id,target_kind,target_id,agent_id,message,expires_at,actor_user_id) VALUES(?,?,?,?,?,?,datetime('now',?),?)`).run(rowId, owner, kind, String(id), work.agent_id, text, kind === 'schedule' ? '+7 days' : '+1 day', actor);
      return db.prepare('SELECT * FROM work_steering WHERE owner_user_id=? AND id=?').get(owner, rowId);
    })();
  }
  function consume(owner, kind, id, checkpoint) {
    return db.transaction(() => {
      db.prepare("UPDATE work_steering SET status='expired' WHERE owner_user_id=? AND target_kind=? AND target_id=? AND status='queued' AND expires_at<=datetime('now')").run(owner, kind, String(id));
      const rows = db.prepare("SELECT id,message FROM work_steering WHERE owner_user_id=? AND target_kind=? AND target_id=? AND status='queued' AND expires_at>datetime('now') ORDER BY created_at,id").all(owner, kind, String(id));
      for (const row of rows) db.prepare("UPDATE work_steering SET status='delivered',delivered_at=datetime('now'),checkpoint=? WHERE owner_user_id=? AND id=? AND status='queued'").run(checkpoint, owner, row.id);
      return rows;
    })();
  }
  const close = (owner, kind, id) => db.prepare("UPDATE work_steering SET status='not_applied',checkpoint='work_ended_before_checkpoint' WHERE owner_user_id=? AND target_kind=? AND target_id=? AND status='queued'").run(owner, kind, String(id));
  function active(owner, kind, id, checkpoint) {
    consume(owner, kind, id, checkpoint);
    return db.prepare("SELECT id,message,target_kind,target_id,status FROM work_steering WHERE owner_user_id=? AND target_kind=? AND target_id=? AND status IN ('delivered','acknowledged','applied') ORDER BY created_at,id").all(owner, kind, String(id));
  }
  function settle(owner, note, result) {
    const status = ['applied','acknowledged','not_applied','unverified'].includes(result.status) ? result.status : 'unverified';
    const row = db.prepare('SELECT source_note_id FROM work_steering WHERE owner_user_id=? AND id=? AND target_kind=? AND target_id=?').get(owner, note.id, note.target_kind, String(note.target_id));
    if (!row) return;
    const payload = JSON.stringify({ reason: String(result.reason || '').slice(0, 1200), checked_at: new Date().toISOString(), verification: 'completion_coverage_check' });
    // Applied evidence is sticky across later goal steps; acknowledgement isn't proof of execution.
    const update = db.prepare("UPDATE work_steering SET status=?,resolution_json=? WHERE owner_user_id=? AND id=? AND status!='applied'");
    update.run(status, payload, owner, note.id);
    let sourceId = row.source_note_id;
    const seen = new Set([note.id]);
    while (sourceId && !seen.has(sourceId) && seen.size < 10) {
      seen.add(sourceId);
      update.run(status, payload, owner, sourceId);
      sourceId = db.prepare('SELECT source_note_id FROM work_steering WHERE owner_user_id=? AND id=?').get(owner, sourceId)?.source_note_id;
    }
  }
  function handoff(owner, fromKind, fromId, toKind, toId, noteIds = null) {
    return db.transaction(() => {
      const rows = active(owner, fromKind, fromId, `handoff:${toKind}:${toId}`).filter(n => !noteIds || noteIds.includes(n.id));
      for (const row of rows) {
        const source = db.prepare('SELECT * FROM work_steering WHERE owner_user_id=? AND id=?').get(owner, row.id);
        if (db.prepare('SELECT id FROM work_steering WHERE owner_user_id=? AND source_note_id=? AND target_kind=? AND target_id=?').get(owner, row.id, toKind, String(toId))) continue;
        db.prepare(`INSERT INTO work_steering(id,owner_user_id,target_kind,target_id,agent_id,message,status,expires_at,delivered_at,checkpoint,actor_user_id,source_note_id) VALUES(?,?,?,?,?,?,'delivered',?,datetime('now'),?,?,?)`)
          .run(randomUUID(), owner, toKind, String(toId), source.agent_id, source.message, source.expires_at, `handoff:${fromKind}:${fromId}`, source.actor_user_id, row.id);
      }
      return rows;
    })();
  }
  return { target, listTargets, history, enqueue, consume, close, active, settle, handoff };
}

const store = () => createSteeringStore(getDb(), { chatActive: (agent, owner, workId) => lookupActiveDashboardChat(agent, owner)?.work_unit_id === workId });
export const listSteeringTargets = (owner, agent) => store().listTargets(owner, agent);
export const queueWorkSteering = (owner, actor, body) => store().enqueue(owner, actor, body);
export const listWorkSteering = (owner, kind, id) => store().history(owner, kind, id);
export const closeWorkSteering = (owner, kind, id) => store().close(owner, kind, id);
export const consumeWorkSteering = (owner, kind, id, checkpoint) => store().consume(owner, kind, id, checkpoint);
export const settleWorkSteering = (owner, note, result) => store().settle(owner, note, result);
export const handoffWorkSteering = (owner, fromKind, fromId, toKind, toId, noteIds) => store().handoff(owner, fromKind, fromId, toKind, toId, noteIds);
export function steeringPrompt(notes) {
  if (!notes?.length) return '';
  return '\n\n[Authenticated user steer guidance — same work, not a new task]\n' +
    'Incorporate each guidance item into the remaining work and final answer, or explicitly explain its conflict, missing permission/data, or deferred step. Do not silently ignore it. Do not repeat completed actions, restart/cancel work, expand permissions, bypass approvals or risk limits, or change trading mode. Delivery is not proof of application.\n' +
    notes.map(n => `Guidance ${n.id}: ${n.message}`).join('\n');
}
export function goalSteeringPrompt(owner, id, checkpoint) {
  return steeringPrompt(store().active(owner, 'goal', id, checkpoint));
}
export function checkpointSteering(owner, context, checkpoint) {
  if (!owner || !context) return [];
  const notes = [];
  for (const [key, kind] of [['work_unit_id','chat'], ['delegation_task_id','task'], ['goal_run_id','goal'], ['scheduled_goal_run_id','schedule_run']]) {
    if (context[key]) notes.push(...store().active(owner, kind, context[key], checkpoint));
  }
  return notes;
}
