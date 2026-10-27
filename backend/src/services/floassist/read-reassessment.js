import {currentFloAssistScope} from './execution-scope.js';
import {resolveSourceReference,sourceReference} from './source-references.js';
import {readFloAssistSource} from './source-reader.js';
const recoveries=new Map();
// Read-only prerequisite recovery. Never applies the rejected task mutation.
export async function recoverSourceReassessment(db,owner,input,error,{caller,context=currentFloAssistScope(),read=readFloAssistSource}={}){
 if(context?.owner!==owner||!context.run||!['FLOASSIST_THREAD_READ_REQUIRED','FLOASSIST_SOURCE_NOT_VERIFIED','FLOASSIST_DEADLINE_EVIDENCE_REQUIRED'].includes(error.code))return null;
 const app=input.app_id;if(!['gmail','outlook','google_drive','onedrive'].includes(app))return null;
 const id=resolveSourceReference(db,owner,app,input.source_id,context);
 const key=JSON.stringify([owner,context.run,app,id]),now=Date.now();
 for(const [k,until]of recoveries)if(until<=now)recoveries.delete(k);
 if(recoveries.has(key))return null;
 let task;
 if(error.code==='FLOASSIST_SOURCE_NOT_VERIFIED'){
  task=db.prepare('SELECT task_id FROM floassist_task_tracking WHERE owner_id=? AND app_id=? AND account_id=? AND source_id=?').get(owner,app,input.account_id,id);
  if(!task)return null; // Never fetch guessed IDs or correlate by title.
 }
 if(error.code==='FLOASSIST_DEADLINE_EVIDENCE_REQUIRED'&&!db.prepare('SELECT 1 FROM floassist_source_receipts WHERE owner_id=? AND run_id=? AND app_id=? AND source_id=?').get(owner,context.run,app,id))return null;
 const source=await read(owner,task?{task_id:task.task_id}:{app_id:app,source_id:id},{db,caller,context});
 if(recoveries.size>=5000)recoveries.delete(recoveries.keys().next().value);
 recoveries.set(key,now+30*60000);
 return {needs_reassessment:true,recovery_code:error.code,task_update_applied:false,source,
  next_action:{tool:source.next_offset===null?'floassist_tracking_observe':'floassist_source_read',
   input:source.next_offset===null?{app_id:app,source_id:sourceReference(db,owner,app,source.source_id,context)}:{...source.next_request,app_id:app,source_id:sourceReference(db,owner,app,source.source_id,context),offset:source.next_offset},
   instruction:'The rejected task update remains unapplied. Read all pages, reassess the latest thread and deadline against this source, then submit a new observation only if still supported. Do not repeat old arguments without reassessment.'}};
}
