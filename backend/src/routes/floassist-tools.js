import {currentFloAssistScope} from '../services/floassist/execution-scope.js';
import {recoverSourceReassessment} from '../services/floassist/read-reassessment.js';
import {verifiedTrackingInput,recordRunError,isTrackingExclusion,resolveTrackingErrors,assertScheduledTrackingUpdate,scheduledTrackingExclusion} from '../services/floassist/source-receipts.js';
import { Router } from 'express';
import {readFloAssistSource} from '../services/floassist/source-reader.js';
import {verifyOrphanClosure} from '../services/floassist/reconcile-source.js';
import {trackingReferenceResult,resolveSourceReference} from '../services/floassist/source-references.js';
import { getDb } from '../db/schema.js';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { resolveToolOwnerUserId } from '../services/tool-owner-scope.js';
import { getFloAssist } from '../services/floassist/platform.js';
import { createReminder,listReminders,cancelReminder } from '../services/floassist/runtime.js';
import {listTracking,observeTracking,updateTracking} from '../services/floassist/tracking.js';
const router=Router();
const run=fn=>async(req,res)=>{try{
  const owner=resolveToolOwnerUserId(req,req.body||{},resolveAuthenticatedCeoUserId);
  const service=getFloAssist();service.profile(owner);
  res.json({ok:true,...trackingReferenceResult(getDb(),owner,await fn(owner,req.body||{},service,req))});
}catch(e){recordRunError(e,{trackingInput:req.path==='/floassist-tracking-observe'?req.body:undefined});res.status(e.status||500).json({ok:false,error:e.status?e.message:'FloAssist operation failed.',code:e.code,...(e.next_action?{next_action:e.next_action}:{})});}};
router.post('/floassist-status',run((owner,_b,s)=>s.view(owner)));
router.post('/floassist-source-read',run((owner,b,_s,req)=>readFloAssistSource(owner,b,{caller:req.headers['x-openclaw-agent-id']||req.headers['x-agent-id']})));
router.post('/floassist-reminder-create',run((owner,b)=>({reminder:createReminder(getDb(),owner,b)})));
router.post('/floassist-reminder-list',run(owner=>({reminders:listReminders(getDb(),owner)})));
router.post('/floassist-reminder-cancel',run((owner,b)=>cancelReminder(getDb(),owner,b.id)));
router.post('/floassist-control',run((owner,b,s)=>s.setStatus(owner,b.status)));
router.post('/floassist-tracking-list',run((owner,b)=>{
 const scheduled=!!currentFloAssistScope()?.run,result=listTracking(getDb(),owner,scheduled?{...b,limit:100}:b);
 if(!scheduled)return result;
 return {...result,tasks:result.tasks.map(({task_id,app_id,account_id,source_id,obligation_key,categories,state,closed,origin,automatic_alerts_quieted})=>({task_id,app_id,account_id,source_id,obligation_key,categories,state,closed,origin,automatic_alerts_quieted})),scope:'Identity and lifecycle only. Read exact task_id with floassist_source_read before describing or changing an obligation; prior task text and dates are not source evidence.'};
}));
router.post('/floassist-tracking-observe',run(async(owner,b,_s,req)=>{
 const db=getDb();
 try{
  const verified=verifiedTrackingInput(db,owner,b);
  const result=observeTracking(db,owner,verified);
  resolveTrackingErrors(db,owner,b);
  return result;
 }catch(e){
  if(e.code==='FLOASSIST_SOURCE_REVIEW_INCOMPLETE')return {needs_reassessment:true,recovery_code:e.code,task_update_applied:false,next_action:e.next_action};
  const recovery=await recoverSourceReassessment(db,owner,b,e,{caller:req.headers['x-openclaw-agent-id']||req.headers['x-agent-id']});
  if(recovery)return recovery;
  if(!isTrackingExclusion(e))throw e;
  resolveTrackingErrors(db,owner,b);
  return {suppressed:true,reason:e.code,message:e.message};
 }
}));
router.post('/floassist-tracking-update',run(async(owner,b,_s,req)=>{assertScheduledTrackingUpdate(b);b={...b,source_id:resolveSourceReference(getDb(),owner,b.app_id,b.source_id)};const excluded=scheduledTrackingExclusion(getDb(),owner,b);if(excluded)return excluded;if(b.action==='close_orphan')b=await verifyOrphanClosure(owner,b,{caller:req.headers['x-openclaw-agent-id']||req.headers['x-agent-id']});return updateTracking(getDb(),owner,b);}));
export default router;
