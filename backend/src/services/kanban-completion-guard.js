import {getDb} from '../db/schema.js';
import {ensureKanbanObserverTables,loadObserverTask,classifyKanbanTask,reviewTaskWithModel} from './kanban-task-observer.js';

/** A forward transition gate, not an audit/reopen job. Caller must already pass task RBAC. */
export function completionCodeVerdict(taskId,owner,{db=getDb(),replyText=null}={}) {
  ensureKanbanObserverTables(db);
  const input=loadObserverTask(db,taskId,owner);
  if(!input||input.scopeMismatch)return {ok:false,reason:'task_or_delegation_scope_invalid'};
  if(input.task.status==='completed')return {ok:true,alreadyCompleted:true,input};
  if(input.task.assigned_user_id||input.task.assigned_member_key)return {ok:false,reason:'human_completion_handler_required'};
  if(!input.delegation)return {ok:false,reason:'completion_evidence_missing',input};
  if(['pending','processing'].includes(input.delegation.status))return {ok:false,reason:'completion_pending_final_response',input};
  if(replyText!=null)input.delegation={...input.delegation,response_content:replyText};
  // Protect approvals/typed goals from this observer's recovery, but do not let an agent tool bypass verification.
  const task={...input.task,status:'in_progress',goal_run_id:null,goal_step_id:null,created_by:'completion_guard',description:String(input.task.description||'').replace(/CHAT_ACTION_APPROVAL|goal_action_approval|node_type:\s*ceo_approval|goal_plan_review|goal_plan_recovery|workflow_exception_recovery/gi,'')};
  const verdict=classifyKanbanTask({...input,task,userEvent:null});
  return {ok:verdict.outcome==='completed',reason:verdict.reason,input,verdict};
}

export async function validateKanbanCompletion(taskId,owner,{db=getDb(),review=reviewTaskWithModel,replyText=null}={}) {
  const code=completionCodeVerdict(taskId,owner,{db,replyText});
  if(code.ok||code.verdict?.outcome!=='ambiguous')return code;
  const snapshot=JSON.stringify(code.input);
  let verdict;
  try{verdict=await review(code.input)}catch{return {...code,reason:'completion_review_failed'}};
  const fresh=completionCodeVerdict(taskId,owner,{db,replyText});
  if(JSON.stringify(fresh.input)!==snapshot)return {...fresh,ok:false,reason:'completion_evidence_changed'};
  return {...code,ok:verdict?.outcome==='completed',reason:verdict?.reason||'completion_unverified'};
}
