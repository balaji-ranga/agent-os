import {physicalPage,physicalOnboardingPage} from '../services/physical/pagination.js';
import { Router } from 'express';
import { fileURLToPath } from 'node:url';
import { fault } from '../services/physical/contracts.js';

export function physicalApiRouter({plane,auth,owner,isAdmin=req=>req.authUser?.role==='ceo'||req.authUser?.role==='admin'||req.authUser?.is_ceo_delegate===true}){
  if(!plane||!Array.isArray(auth)||!auth.length||typeof owner!=='function')throw Error('Explicit physical authority required');
  const router=Router();
  router.get('/ui',(req,res)=>res.sendFile(fileURLToPath(new URL('../public/physical.html',import.meta.url))));
  router.use(...auth);
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');
    if(req.method!=='GET'&&req.headers.origin){try{if(new URL(req.headers.origin).host!==req.get('host'))throw Error();}catch{return res.status(403).json({error:'Same-origin request required'});}}
    if(req.body&&JSON.stringify(req.body).length>65536)return res.status(413).json({error:'Physical payload too large'});next();});
  const admin=isAdmin;
  const principal=req=>admin(req)?'owner':'user:'+req.authUser.id;
  router.use((req,res,next)=>{const operational=req.method==='GET'||(req.method==='POST'&&(/^\/operations$/.test(req.path)||/^\/operations\/[^/]+\/cancel$/.test(req.path)));if(!admin(req)&&!operational)return res.status(403).json({error:'Company owner or delegate required to administer physical resources'});next();});
  const route=(method,path,fn)=>router[method](path,(req,res)=>{try{res.json(fn(owner(req,req.body),req));}catch(e){res.status(e.status||500).json({error:e.status?e.message:'Physical service error'});}});
  route('get','/view',(o,r)=>physicalPage(plane,o,r.query,principal(r)));
  route('get','/',(o,r)=>physicalOnboardingPage(plane,o,r.query,principal(r)));
  router.use('/hubs',(req,res,next)=>admin(req)?next():res.status(403).json({error:'Hub administration requires owner or delegate'}));
  route('post','/hubs',(o,r)=>plane.enroll(o,r.body));
  route('post','/hubs/:id/revoke',(o,r)=>{plane.revoke(o,r.params.id);return {ok:true};});
  route('post','/hubs/:id/rotate',(o,r)=>plane.rotate(o,r.params.id));
  route('get','/hubs/:id/configuration',(o,r)=>plane.managedState(o,r.params.id));
  route('post','/hubs/:id/configuration',(o,r)=>plane.stageManaged(o,r.params.id,r.body));
  route('post','/hubs/:id/configuration/rollback',(o,r)=>plane.rollbackManaged(o,r.params.id,r.body));
  route('put','/entities/:id/entitlements',(o,r)=>plane.setEntitlements(o,r.params.id,r.body));
  route('post','/entities',(o,r)=>plane.register(o,r.body));
  route('patch','/entities/:id',(o,r)=>plane.configure(o,r.params.id,r.body));
  route('post','/entities/:id/revalidate',(o,r)=>plane.revalidate(o,r.params.id));
  route('post','/operations',(o,r)=>plane.operation(o,r.body,admin(r)?'human:'+o:principal(r)));
  router.get('/operations/:id/evidence/:index',(req,res)=>{try{
    const operation=plane.owned('operations',owner(req,{}),req.params.id);plane.assertResource(operation.owner,operation.entityId,principal(req));const index=Number(req.params.index);
    if(!Number.isInteger(index)||index<0||!operation.evidence?.attachments?.[index]||!plane.evidenceStore)throw fault('Evidence not found',404);
    const attachment=operation.evidence.attachments[index],bytes=plane.evidenceStore.get(operation.owner,attachment);
    res.set({'Content-Type':attachment.mimeType,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'",'Cache-Control':'private, no-store'}).send(bytes);
  }catch(e){res.status(e.status||500).json({error:e.status?e.message:'Evidence unavailable'});}});
  route('get','/operations/:id',(o,r)=>(()=>{const op=plane.owned('operations',o,r.params.id);plane.assertResource(o,op.entityId,principal(r));return structuredClone(op);})());
  route('get','/entities/:id/properties/:property',(o,r)=>{const e=plane.assertResource(o,r.params.id,principal(r));if(!e.description.properties[r.params.property])throw fault('Unknown property',404);return plane.resourceList(o,principal(r)).entities.find(x=>x.id===e.id)?.observations[r.params.property]||{status:'unknown'};});
  route('post','/operations/:id/approve',(o,r)=>plane.approve(o,r.params.id,admin(r)?'human:'+o:principal(r),r.body));
  route('post','/operations/:id/cancel',(o,r)=>{const op=plane.owned('operations',o,r.params.id);plane.assertResource(o,op.entityId,principal(r),op.action);return plane.cancel(o,r.params.id);});
  return router;
}
