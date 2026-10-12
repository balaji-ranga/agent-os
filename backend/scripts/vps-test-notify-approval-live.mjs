// Explicitly scoped maintenance + deployed HTTP verification; never executes a tool.
import assert from 'node:assert/strict';
import { getDb } from '../src/db/schema.js';
import { createSession, revokeSession } from '../src/services/auth/session.js';
import { getKanbanScopeIds } from '../src/services/kanban-user-scope.js';
import { previewActionPolicy } from '../src/services/action-policy.js';

assert(process.argv.includes('--cleanup'), 'Explicit --cleanup required');
const name = process.argv[process.argv.indexOf('--owner-name') + 1];
assert(name && process.argv.includes('--owner-name'), 'Exact --owner-name required');
const db = getDb();
const matches = db.prepare("SELECT id,name,role FROM platform_users WHERE name=? AND role='ceo' AND enabled=1").all(name);
assert.equal(matches.length, 1, 'An unambiguous enabled CEO is required');
const user = matches[0], scopes = getKanbanScopeIds(user);
const marks = scopes.map(() => '?').join(',');
const approvals = db.prepare(`SELECT id,status,expires_at,tool_name,kanban_task_id FROM chat_action_approvals WHERE owner_user_id IN (${marks})`).all(...scopes);
const beforeTasks = db.prepare(`SELECT id FROM kanban_tasks WHERE owner_user_id IN (${marks})`).all(...scopes).map(t => t.id);
const notifyCount = () => db.prepare(`SELECT count(*) AS n FROM platform_user_notifications WHERE user_id IN (${marks}) AND source='agent_notify'`).get(...scopes).n;
const beforeNotify = notifyCount();
const token = createSession(user.id).token;
const base = 'http://127.0.0.1:3001';
async function request(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
try {
  const list = await request('/api/kanban/tasks?view=all&limit=500');
  assert.equal(list.status, 200);
  const bell = await request('/api/platform-notifications'); assert.equal(bell.status, 200);
  const afterTasks = new Set(db.prepare(`SELECT id FROM kanban_tasks WHERE owner_user_id IN (${marks})`).all(...scopes).map(t => t.id));
  const removed = beforeTasks.filter(id => !afterTasks.has(id));
  for (const id of removed) {
    const row = db.prepare(`SELECT a.status,a.owner_user_id,r.task_id FROM chat_action_approvals a
      JOIN chat_action_approval_task_archive r ON r.approval_id=a.id AND r.owner_user_id=a.owner_user_id
      WHERE a.owner_user_id IN (${marks}) AND a.kanban_task_id=?`).get(...scopes,id);
    assert(row && ['expired','superseded'].includes(row.status), 'Every removed task has retained terminal audit');
    assert.equal(row.task_id,id);
    assert(!list.body.tasks.some(t => t.id===id), 'Removed task not listed');
    assert(!bell.body.notifications.some(n => n.source==='kanban_task' && n.source_key===String(id)), 'Stale task bell absent');
  }
  for (const row of approvals) {
    if (['consumed','rejected'].includes(row.status)) {
      assert.equal(db.prepare('SELECT status FROM chat_action_approvals WHERE id=?').get(row.id).status,row.status,'Already executed/rejected grants unchanged');
      if(beforeTasks.includes(row.kanban_task_id)) assert(afterTasks.has(row.kanban_task_id),'Executed/rejected card retained');
    }
  }
  assert.equal(notifyCount(),beforeNotify,'No notification replay during cleanup');
  const stale = db.prepare(`SELECT kanban_task_id FROM chat_action_approvals WHERE owner_user_id IN (${marks}) AND status='expired' LIMIT 1`).get(...scopes);
  if(stale && !afterTasks.has(stale.kanban_task_id)) {
    const denied=await request(`/api/kanban/tasks/${stale.kanban_task_id}/action-approval`,{decision:'approve'});
    assert.equal(denied.status,409); assert.match(denied.body.error,/expired.*fresh/);
  }
  const risk=previewActionPolicy({ownerUserId:user.id,toolName:'notify_ceo'});
  const archived = db.prepare(`SELECT a.status,count(*) AS n FROM chat_action_approval_task_archive r
    JOIN chat_action_approvals a ON a.id=r.approval_id AND a.owner_user_id=r.owner_user_id
    WHERE r.owner_user_id IN (${marks}) GROUP BY a.status`).all(...scopes);
  const remaining = db.prepare(`SELECT count(*) AS n FROM chat_action_approvals a JOIN kanban_tasks k ON k.id=a.kanban_task_id AND k.owner_user_id=a.owner_user_id
    WHERE a.owner_user_id IN (${marks}) AND a.status IN ('expired','superseded') AND k.created_by='action_policy'
    AND k.description LIKE '%[CHAT_ACTION_APPROVAL]%' AND k.description LIKE '%approval_id: ' || a.id || '%'
    AND k.status IN ('awaiting_confirmation','in_progress','failed') AND k.goal_run_id IS NULL AND k.goal_step_id IS NULL
    AND k.standup_id IS NULL AND k.agent_delegation_task_id IS NULL`).get(...scopes).n;
  assert.equal(remaining,0,'No expired/obsolete standalone approval cards remain');
  console.log(JSON.stringify({passed:true,owner_name:user.name,removed_tasks_this_check:removed.length,archived_removals:archived,remaining_stale_cards:remaining,
    retained_approval_audit:true,no_notification_replay:true,kanban_http:list.status,notifications_http:bell.status,
    stale_approval_rejected:Boolean(stale),notify_ceo:{risk_tier:risk.risk_tier,action_family:risk.action_family,mode:risk.mode}},null,2));
} finally { revokeSession(token); db.close(); }
