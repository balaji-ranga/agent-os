/** Display-only activity: a card's status is not proof of an active execution. */
export function withKanbanTaskActivity(db, task, now=Date.now()) {
  if (!task?.owner_user_id || !task.assigned_agent_id || task.status!=='in_progress') return task;
  const delegation=task.agent_delegation_task_id?db.prepare('SELECT status FROM agent_delegation_tasks WHERE id=? AND owner_user_id=? AND to_agent_id=?')
    .get(task.agent_delegation_task_id,task.owner_user_id,task.assigned_agent_id):null;
  const hasObserver=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kanban_task_observer_state'").get();
  const state=hasObserver?db.prepare('SELECT * FROM kanban_task_observer_state WHERE task_id=? AND owner_user_id=?').get(task.id,task.owner_user_id):null;
  const active=delegation && ['pending','processing'].includes(delegation.status) || Date.parse(state?.reply_inflight_until||'')>now;
  const label=active?(delegation?.status==='pending'?'Agent execution queued':'Agent execution active'):state?.outcome==='unknown'?'Verification pending — agent not running':'Agent not running — recovery or verification pending';
  let diagnostics=null;try{diagnostics=JSON.parse(state?.review_diagnostics_json||'null')}catch{}
  return {...task,execution_activity:{active:!!active,label,observer_outcome:state?.outcome||null,observer_reason:state?.reason||null,
    checked_at:state?.checked_at||null,review_attempt_count:state?.review_attempt_count||0,agent_retry_count:state?.retry_count||0,review:diagnostics}};
}
