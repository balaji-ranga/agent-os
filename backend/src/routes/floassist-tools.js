import {verifiedTrackingInput,recordRunError,isTrackingExclusion,resolveTrackingErrors} from '../services/floassist/source-receipts.js';
import { Router } from 'express';
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
  res.json({ok:true,...await fn(owner,req.body||{},service)});
}catch(e){recordRunError(e,{trackingInput:req.path==='/floassist-tracking-observe'?req.body:undefined});res.status(e.status||500).json({ok:false,error:e.status?e.message:'FloAssist operation failed.',code:e.code});}};
router.post('/floassist-status',run((owner,_b,s)=>s.view(owner)));
router.post('/floassist-reminder-create',run((owner,b)=>({reminder:createReminder(getDb(),owner,b)})));
router.post('/floassist-reminder-list',run(owner=>({reminders:listReminders(getDb(),owner)})));
router.post('/floassist-reminder-cancel',run((owner,b)=>cancelReminder(getDb(),owner,b.id)));
router.post('/floassist-control',run((owner,b,s)=>s.setStatus(owner,b.status)));
router.post('/floassist-tracking-list',run((owner,b)=>listTracking(getDb(),owner,b)));
router.post('/floassist-tracking-observe',run((owner,b)=>{
 const db=getDb();
 try{
  const verified=verifiedTrackingInput(db,owner,b);
  const result=observeTracking(db,owner,verified);
  resolveTrackingErrors(db,owner,b);
  return result;
 }catch(e){
  if(!isTrackingExclusion(e))throw e;
  resolveTrackingErrors(db,owner,b);
  return {suppressed:true,reason:e.code,message:e.message};
 }
}));
router.post('/floassist-tracking-update',run((owner,b)=>updateTracking(getDb(),owner,b)));
export default router;
