import { getDb } from '../db/schema.js';
import { isCeoDelegate } from './org-permissions.js';
import { respondToGoalRecoveryKanban, respondToHumanGoalTask } from './agent-goal-run.js';
import { getGoalActionApprovalByKanban, respondToGoalActionApproval } from './goal-action-approval.js';
import { clearKanbanTaskNotification } from './platform-notifications.js';

function db() { return getDb(); }

export function ensureKanbanUserActionAudit() {
  db().exec(`CREATE TABLE IF NOT EXISTS kanban_user_action_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id TEXT NOT NULL, task_id INTEGER,
    actor_user_id TEXT NOT NULL, proxy_agent_id TEXT, channel TEXT NOT NULL,
    sender_fingerprint TEXT, session_key TEXT, action TEXT NOT NULL, evidence TEXT NOT NULL,
    result_json TEXT, status TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
  ); CREATE INDEX IF NOT EXISTS idx_kanban_user_action_audit_owner ON kanban_user_action_audit(owner_user_id, created_at);`);
}

function assertActor(task, ownerUserId, actor) {
  const full = actor?.role === 'ceo' || isCeoDelegate(actor);
  if (String(task.owner_user_id || '') !== String(ownerUserId) || (!full && String(task.assigned_user_id || '') !== String(actor?.id || ''))) {
    throw Object.assign(new Error('Only the company CEO, a CEO delegate, or the assigned task owner may act on this task'), { status: 403 });
  }
}

function audit(input, result, status = 'ok') {
  ensureKanbanUserActionAudit();
  db().prepare(`INSERT INTO kanban_user_action_audit
    (owner_user_id,task_id,actor_user_id,proxy_agent_id,channel,sender_fingerprint,session_key,action,evidence,result_json,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(input.ownerUserId, input.taskId || null, input.actor.id,
      input.proxyAgentId || null, input.channel || 'web', input.senderFingerprint || null,
      input.sessionKey || null, input.action, input.evidence, JSON.stringify(result || {}), status);
}

export async function executeKanbanUserAction(input) {
  const action = String(input.action || '').toLowerCase();
  const evidence = String(input.evidence || '').trim();
  if (!['list','update','complete','unable','question','approve','reject','reopen'].includes(action))
    throw Object.assign(new Error('Unsupported task action'), { status: 400 });
  if (input.proxyAgentId) {
    const coo = db().prepare('SELECT id,is_coo FROM agents WHERE id=? OR openclaw_agent_id=?').get(input.proxyAgentId, input.proxyAgentId);
    if (!coo?.is_coo) throw Object.assign(new Error('Only the COO may act on behalf of a user'), { status: 403 });
  }
  if (action === 'list') {
    const privileged = input.actor?.role === 'ceo' || isCeoDelegate(input.actor);
    const rows = privileged
      ? db().prepare('SELECT id,title,status,assigned_user_id,due_at FROM kanban_tasks WHERE owner_user_id=? ORDER BY updated_at DESC LIMIT 50').all(input.ownerUserId)
      : db().prepare('SELECT id,title,status,assigned_user_id,due_at FROM kanban_tasks WHERE owner_user_id=? AND assigned_user_id=? ORDER BY updated_at DESC LIMIT 50').all(input.ownerUserId, input.actor.id);
    return { ok: true, actor_user_id: input.actor.id, tasks: rows };
  }
  if (!input.taskId) throw Object.assign(new Error('task_id required'), { status: 400 });
  if (!evidence) throw Object.assign(new Error('Exact user request, confirmation, or update evidence is required'), { status: 400 });
  input.evidence = evidence.slice(0, 4000);
  const task = db().prepare('SELECT * FROM kanban_tasks WHERE id=?').get(input.taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
  assertActor(task, input.ownerUserId, input.actor);
  const evidenceMessage = `[${input.channel || 'web'}${input.proxyAgentId ? ` via COO ${input.proxyAgentId}` : ''}; user ${input.actor.id}] ${input.evidence}`;
  let result;
  const isGoalRecovery = task.created_by === 'exception-policy' && task.goal_run_id && task.goal_step_id;
  if (isGoalRecovery && ['approve','complete','reject','unable'].includes(action)) {
    result = await respondToGoalRecoveryKanban({
      ownerUserId: input.ownerUserId,
      actorUserId: input.actor.id,
      taskId: Number(task.id),
      decision: action,
      comment: evidenceMessage,
    });
  } else if (['complete','unable','question'].includes(action) && task.goal_run_id && task.goal_step_id) {
    result = await respondToHumanGoalTask({ ownerUserId: input.ownerUserId, actorUserId: input.actor.id, taskId: Number(task.id), action, outcome: evidenceMessage, authorizedActor: true });
  } else if (['approve','reject'].includes(action)) {
    const approval = getGoalActionApprovalByKanban(input.ownerUserId, task.id);
    if (approval) result = await respondToGoalActionApproval({ ownerUserId: input.ownerUserId, kanbanTaskId: task.id, decision: action, comment: evidenceMessage, actor: input.actor });
    else {
      const { completeCeoApprovalResponse } = await import('./agent-workflow-runner.js');
      result = await completeCeoApprovalResponse({ kanbanTaskId: task.id, decision: action, comment: evidenceMessage, actor: input.actor, ownerUserId: input.ownerUserId });
    }
  } else {
    const status = action === 'complete' ? 'completed' : action === 'unable' ? 'failed' : action === 'reopen' ? 'open' : (input.newStatus || 'in_progress');
    const allowed = ['open','awaiting_confirmation','in_progress','completed','failed'];
    if (!allowed.includes(status)) throw Object.assign(new Error('Invalid task status'), { status: 400 });
    db().transaction(() => {
      db().prepare('INSERT INTO task_messages(task_id,role,content) VALUES (?,?,?)').run(task.id, input.actor.id, evidenceMessage);
      db().prepare("UPDATE kanban_tasks SET status=?,updated_at=datetime('now') WHERE id=?").run(status, task.id);
    })();
    if (['completed','failed'].includes(status)) clearKanbanTaskNotification(task.id, input.actor.id);
    result = { ok: true, task_id: task.id, status };
  }
  audit(input, result);
  return { ...result, actor_user_id: input.actor.id, acted_by_coo: Boolean(input.proxyAgentId), evidence_captured: true };
}
