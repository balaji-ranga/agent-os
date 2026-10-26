import {getDb} from '../../db/schema.js';
import {currentFloAssistScope,withFloAssistScope,assertFloAssistConnector} from './execution-scope.js';
import {sourceData,authorizeSourceAction} from './source-reader.js';

/** Re-read the exact stored mail identity before honoring an orphan-close request.
 * A model's prose is never evidence of deletion or completed work. */
export async function verifyOrphanClosure(owner,input,{db=getDb(),execute,authorize=authorizeSourceAction,caller,context=currentFloAssistScope()}={}){
 const row=db.prepare(`SELECT f.*,k.created_by,k.status AS task_status FROM floassist_task_tracking f JOIN kanban_tasks k ON k.id=f.task_id AND k.owner_user_id=f.owner_id WHERE f.owner_id=? AND f.task_id=?`).get(owner,input.task_id);
 const fail=message=>{throw Object.assign(new Error(message),{status:409,code:'FLOASSIST_ORPHAN_UNVERIFIED'});};
 if(!row||row.origin!=='floassist_created'||row.created_by!=='floassist-tracking'||!['gmail','outlook'].includes(row.app_id))fail('Only the exact owner FloAssist-created mail task can be reconciled.');
 for(const key of ['app_id','account_id','source_id','obligation_key'])if(input[key]!==row[key])fail('Stored source identity does not match; no task was changed.');
 const p=db.prepare('SELECT agent_id FROM floassist_profiles WHERE owner_id=?').get(owner);
 execute=execute||(await import('../openconnector.js')).executeConnectorAction;
 const scope=context||{owner,origin:'source_reconciliation'};
 return withFloAssistScope(scope,async()=>{
  const action=row.app_id==='gmail'?'gmail.fetch_message_by_thread_id':'outlook.get_message';
  const args=row.app_id==='gmail'?{threadId:row.source_id}:{messageId:row.source_id,bodyContentType:'text'};
  assertFloAssistConnector(owner,action,db,scope);await authorize(owner,action,caller||p.agent_id,args);
  let deleted=false;
  try{
   const data=sourceData(await execute(owner,action,args,{source:caller||p.agent_id,authorizationRetryDelaysMs:[]}));
   if(row.app_id==='gmail'){
    if(data.threadId!==row.source_id||!Array.isArray(data.messages)||!data.messages.length)fail('Current thread identity or coverage is incomplete.');
    deleted=data.messages.every(m=>Array.isArray(m.labelIds)&&m.labelIds.includes('TRASH'));
   }else if(data.id!==row.source_id)fail('Current message identity is incomplete.');
  }catch(e){if([404,410].includes(e.provider_status))deleted=true;else throw e;}
  if(deleted)return {...input,source_checked:true,source_outcome:'deleted',source_evidence:'Backend independently re-read the exact stored mail source and confirmed provider deletion/trash.',evidence:'Direct provider deletion confirmed by the backend.'};
  // Reading, archiving, replying, or a generated summary does not prove the
  // requested business obligation was fulfilled. Ask through the existing task.
  return {...input,action:'clarify',source_checked:true,evidence:'Backend re-read the exact source. It remains present; external fulfillment needs owner confirmation. The task was not automatically closed.'};
 });
}
