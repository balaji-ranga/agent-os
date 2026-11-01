import {randomUUID} from 'node:crypto';
import {fault,fingerprint,id} from './contracts.js';
import {validateManagedDocument} from './managed-config.js';
const clone=v=>structuredClone(v);
export const managedControl={
 expireManaged(){for(const h of Object.values(this.state.hubs)){if(h.managedPending?.expiresAt<=this.now()){const r=h.managedPending;r.status='rejected';r.error='Edge did not accept configuration before deadline';h.managedHistory=[...(h.managedHistory||[]),r].slice(-20);h.managedPending=null;this.save();this.sendConfig(h.id);}}},
 managedState(owner,hubId){const h=this.owned('hubs',owner,hubId);return {active:h.managedActive||null,pending:h.managedPending||null,history:h.managedHistory||[],adapters:h.adapters||[],integrationEntities:h.integrationEntities||[]};},
 stageManaged(owner,hubId,{document,baseRevision=null}){
  const h=this.owned('hubs',owner,hubId);if(h.revoked)throw fault('Hub revoked',403);
  if(h.managedPending)throw fault('Configuration activation already pending',409);
  if((h.managedActive?.id||null)!==baseRevision)throw fault('Configuration changed; refresh before editing',409);
  validateManagedDocument(document);
  for(const m of document.mappings){const a=h.adapters?.find(a=>a.id===m.adapterId);if(!a||a.type!=='home-assistant'||a.managedVersion!==1)throw fault('Installed adapter does not support managed configuration',409);}
  const revision={id:randomUUID(),document:clone(document),hash:fingerprint(document),createdAt:this.now(),expiresAt:this.now()+60000,status:'pending'};
  h.managedPending=revision;this.audit(owner,'configuration_staged',{hubId,revisionId:revision.id,hash:revision.hash});this.sendConfig(hubId);return clone(revision);
 },
 managedAck(hubId,{revisionId,hash,ok,error}){
  const h=this.state.hubs[hubId],r=h?.managedPending;if(!r||r.id!==revisionId||r.hash!==hash)return;
  if(r.expiresAt<=this.now()){ok=false;error='Activation deadline expired';}
  r.status=ok===true?'active':'rejected';r.error=ok===true?null:String(error||'Edge validation rejected configuration').slice(0,160);
  h.managedHistory=[...(h.managedHistory||[]),clone(r)].slice(-20);h.managedPending=null;
  if(ok===true){
   const affected=new Set([...(h.managedActive?.document.mappings||[]),...r.document.mappings].map(m=>m.mapping.id));h.managedActive=r;
   for(const e of Object.values(this.state.entities).filter(e=>e.hubId===hubId)){
    if(!affected.has(e.deviceId))continue;e.bindingRevision=r.document.mappings.some(m=>m.mapping.id===e.deviceId)?r.id:null;
    // Changing device bindings never inherits action authority.
    if(affected.has(e.deviceId)){e.enabled=false;e.actions={};e.offline=null;e.policyVersion=randomUUID();}
    for(const o of Object.values(this.state.operations))if(o.entityId===e.id&&!['completed','failed','cancelled','timed_out','uncertain','denied'].includes(o.status)){o.status='uncertain';o.error='Configuration changed; reconcile without replay';}
   }
  }
  this.audit(h.owner,ok===true?'configuration_activated':'configuration_rejected',{hubId,revisionId,reason:r.error});this.sendConfig(hubId);
 },
 rollbackManaged(owner,hubId,{revisionId,baseRevision}){
  const h=this.owned('hubs',owner,hubId),r=h.managedHistory?.find(r=>r.id===revisionId&&r.status==='active');if(!r)throw fault('Accepted configuration revision not found',404);
  return this.stageManaged(owner,hubId,{document:r.document,baseRevision});
 },
 setEntitlements(owner,entityId,{grants}){
  const e=this.owned('entities',owner,entityId);
  if(!Array.isArray(grants)||grants.length>100)throw fault('Invalid resource grants');
  const seen=new Set();for(const g of grants){if(typeof g.principal!=='string'||! /^(agent|user|workflow):[a-zA-Z0-9_-]{1,96}$/.test(g.principal)||seen.has(g.principal)||!Array.isArray(g.actions)||g.actions.some(a=>!e.description.actions[a])||typeof g.discover!=='boolean')throw fault('Invalid resource grant');seen.add(g.principal);}
  e.entitlements=clone(grants);e.policyVersion=randomUUID();
  for(const o of Object.values(this.state.operations))if(o.entityId===e.id&&!['completed','failed','cancelled','timed_out','uncertain','denied'].includes(o.status)){o.status='uncertain';o.error='Resource grants changed; reconcile without replay';}
  this.audit(owner,'resource_grants_changed',{entityId});this.sendConfig(e.hubId);return clone(e.entitlements);
 },
 authorized(e,principal,action){
  if(Array.isArray(principal))return principal.every(p=>this.authorized(e,p,action));
  if(!principal||principal==='human'||principal==='owner'||principal==='human:'+e.owner)return true;
  // Legacy assets retain existing tool-gated company access until explicitly scoped.
  if(!Array.isArray(e.entitlements))return !String(principal).startsWith('user:');
  const g=e.entitlements.find(g=>g.principal===principal);return !!g?.discover&&(!action||g.actions.includes(action));
 },
 assertResource(owner,entityId,principal,action){const e=this.owned('entities',owner,entityId);if(!this.authorized(e,principal,action))throw fault('Physical resource access denied',403);return e;},
 resourceList(owner,principal){const result=this.list(owner);const entities=result.entities.filter(e=>this.authorized(e,principal)).map(e=>({...e,actions:Object.fromEntries(Object.entries(e.actions).map(([a,m])=>[a,this.authorized(e,principal,a)?m:'prohibited']))}));const ids=new Set(entities.map(e=>e.id));const hubIds=new Set(entities.map(e=>e.hubId));return {...result,hubs:result.hubs.filter(h=>hubIds.has(h.id)).map(h=>({id:h.id,name:h.name,siteId:h.siteId,online:h.online,revoked:h.revoked})),entities,operations:result.operations.filter(o=>ids.has(o.entityId)),audit:[]};},
 deviceReadiness(e){const h=this.state.hubs[e.hubId],r=h?.readiness?.[e.deviceId];return {status:!this.connections.has(e.hubId)?'hub_offline':!r||this.now()-r.at>45000?'unknown':r.available?'available':'unavailable',at:r?.at||null};},
 hubReport(hubId,{adapters,entities,integrationEntities}){
  const h=this.state.hubs[hubId];if(!h||h.revoked)throw fault('Invalid hub');
  if(!Array.isArray(adapters)||adapters.length>32||!Array.isArray(entities)||entities.length>100)throw fault('Invalid readiness report');
  h.adapters=adapters.map(a=>({id:id(a.id),type:String(a.type||'').slice(0,64),version:Number(a.version)||0,managedVersion:a.managedVersion===1?1:0,connected:a.connected===true}));
  h.readiness=Object.fromEntries(entities.map(e=>[id(e.id),{available:e.available===true,at:this.now()}]));
  h.integrationEntities=(Array.isArray(integrationEntities)?integrationEntities:[]).slice(0,500).filter(e=>typeof e.adapterId==='string'&&typeof e.entityId==='string').map(e=>({adapterId:e.adapterId,entityId:e.entityId.slice(0,150)}));h.lastSeen=this.now();this.save();
 }
};
