import {parseTenantOpenClawAgentId} from '../services/openclaw-tenant.js';
import { Router } from 'express';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {lookupOpenClawSessionActor} from '../services/tool-owner-scope.js';
import { resolveToolOwnerUserId } from '../services/tool-owner-scope.js';
import { getPhysicalControlPlane } from '../services/physical/runtime.js';
const router=Router();
const principal=r=>{const raw=String(r.headers['x-openclaw-agent-id']||r.headers['x-agent-id']||'session');return 'agent:'+(parseTenantOpenClawAgentId(raw)?.baseOpenClawId||raw);};
const access=(r,o)=>{const actor=lookupOpenClawSessionActor(String(r.headers['x-openclaw-session-key']||r.headers['x-session-key']||''));return [principal(r),...(actor?.ownerUserId===o&&actor.actorUserId!==o?['user:'+actor.actorUserId]:[])];};
const scopedOperation=(p,o,b,r)=>{const op=p.owned('operations',o,b.operationId);p.assertResource(o,op.entityId,access(r,o));return op;};
for(const [path,run] of [
  ['/physical-entities-list',(p,o,b,r)=>({entities:p.resourceList(o,access(r,o)).entities})],
  ['/physical-operation-get',(p,o,b,r)=>scopedOperation(p,o,b,r)],
  ['/physical-evidence-get',(p,o,b,r)=>{const operation=scopedOperation(p,o,b,r),index=b.index??0;if(!Number.isInteger(index)||index<0||!operation.evidence?.attachments?.[index]||!p.evidenceStore)throw Object.assign(Error('Evidence not found'),{status:404});const a=operation.evidence.attachments[index];return {operationId:operation.id,simulated:operation.simulated,kind:a.kind,mimeType:a.mimeType,sha256:a.sha256,at:a.at,dataBase64:p.evidenceStore.get(o,a).toString('base64')};}],
  ['/physical-invoke',(p,o,b,r)=>p.operation(o,b,principal(r),access(r,o),{agentId:principal(r).slice(6),evaluatedDecision:r.actionPolicy})],
  ['/physical-cancel',(p,o,b,r)=>{const op=scopedOperation(p,o,b,r);p.assertResource(o,op.entityId,access(r,o),op.action);return p.cancel(o,b.operationId);}],
])router.post(path,(req,res,next)=>{
  if(process.env.FLOLAH_PHYSICAL_ENABLED!=='1')return next();
  try{const owner=resolveToolOwnerUserId(req,req.body||{},resolveAuthenticatedCeoUserId);if(!owner)throw Object.assign(Error('Owner required'),{status:403});res.json(run(getPhysicalControlPlane(),owner,req.body||{},req));}
  catch(e){res.status(e.status||500).json({error:e.status?e.message:'Physical operation failed'});}
});
export default router;
