import {projectDeviceOutputs,physicalWorkflowContract} from './output-contracts.js';
import {managedControl} from './managed-control.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { VERSION, TERMINAL, id, fault, hash, fingerprint, validateDescription, validateInput, validateCommand } from './contracts.js';

const secret = () => randomBytes(32).toString('base64url');
const clone = v => structuredClone(v);
export const emptyState = () => ({ hubs:{}, entities:{}, operations:{}, audit:[] });

export class PhysicalControlPlane {
  constructor(store, { now = Date.now, companyPolicy = () => ({ok:true}), evidenceStore = null } = {}) {
    this.store=store; this.now=now; this.companyPolicy=companyPolicy; this.state=store.load() || emptyState(); this.connections=new Map(); this.evidenceStore=evidenceStore;
  }
  save() { this.store.save(this.state); }
  audit(owner, type, data={}) {
    this.state.audit.push({id:randomUUID(),owner,type,at:this.now(),...data});
    if(this.state.audit.length>10000)this.state.audit.splice(0,this.state.audit.length-10000);
    this.save();
  }
  owned(collection, owner, key) { const item=this.state[collection][key]; if(!owner||!item||item.owner!==owner)throw fault('Not found',404); return item; }
  list(owner) {
    this.expire();
    return {hubs:Object.values(this.state.hubs).filter(h=>h.owner===owner).map(({tokenHash,...h})=>({...h,online:this.connections.has(h.id)})),
      entities:Object.values(this.state.entities).filter(e=>e.owner===owner).map(e=>({...e,readiness:this.deviceReadiness(e),observations:Object.fromEntries(Object.entries(e.observations).map(([k,v])=>[k,{...v,stale:this.now()-v.at>60000,ageMs:Math.max(0,this.now()-v.at)}]))})),operations:Object.values(this.state.operations).filter(o=>o.owner===owner).slice(-200),
      audit:this.state.audit.filter(a=>a.owner===owner).slice(-200)};
  }
  enroll(owner, {siteId, name}) {
    if(!owner)throw fault('Owner required',403); id(siteId);
    if(typeof name!=='string'||!name.trim()||name.length>150)throw fault('Hub name required');
    const token=secret(), hub={id:randomUUID(),owner,siteId,name,tokenHash:hash(token),revoked:false,candidates:[],createdAt:this.now()};
    this.state.hubs[hub.id]=hub; this.audit(owner,'hub_enrolled',{hubId:hub.id,siteId});
    return {hubId:hub.id,siteId,token};
  }
  authenticate(hubId, token) {
    const h=this.state.hubs[hubId]; if(!h||h.revoked||!token||h.tokenHash!==hash(token))throw fault('Invalid hub credentials',401); return h;
  }
  revoke(owner, hubId) {
    const h=this.owned('hubs',owner,hubId);h.revoked=true;
    this.connections.get(hubId)?.close(4003,'Hub revoked');this.connections.delete(hubId);
    for(const op of Object.values(this.state.operations))if(op.hubId===hubId&&!TERMINAL.has(op.status)){op.status='uncertain';op.error='Hub revoked';}
    this.audit(owner,'hub_revoked',{hubId});
  }
  rotate(owner,hubId) { const h=this.owned('hubs',owner,hubId),token=secret();h.tokenHash=hash(token);h.revoked=false;this.connections.get(hubId)?.close(4003,'Credentials rotated');this.connections.delete(hubId);this.audit(owner,'hub_rotated',{hubId});return {hubId,token}; }
  discover(hubId, descriptions) {
    const h=this.state.hubs[hubId];if(!h||h.revoked)throw fault('Hub revoked',403);
    if(!Array.isArray(descriptions)||descriptions.length>100)throw fault('Invalid discovery');
    h.candidates=descriptions.map(d=>clone(validateDescription(d)));h.lastSeen=this.now();this.save();
  }
  register(owner,{hubId,candidateId,actions={},offline}) {
    const h=this.owned('hubs',owner,hubId);if(h.revoked)throw fault('Hub revoked',403);
    const td=h.candidates.find(d=>d.id===candidateId);if(!td)throw fault('Discover candidate first',409);
    const modes={};
    for(const [name,mode] of Object.entries(actions)) {
      if(!td.actions[name]||!['autonomous','approval_required','prohibited'].includes(mode))throw fault('Invalid action policy');modes[name]=mode;
    }
    const entity={id:randomUUID(),owner,hubId,siteId:h.siteId,deviceId:td.id,adapter:clone(td.flolah.adapter||null),description:clone(td),descriptionHash:fingerprint(td),actions:modes,bindingRevision:h.managedActive?.document.mappings.some(m=>m.mapping.id===td.id)?h.managedActive.id:null,enabled:true,entitlements:[],observations:{},policyVersion:randomUUID()};
    if(Object.values(this.state.entities).some(e=>e.hubId===hubId&&e.deviceId===td.id))throw fault('Asset already registered',409);
    this.state.entities[entity.id]=entity;
    if(offline)entity.offline=this.offlinePolicy(entity,offline);
    this.audit(owner,'entity_registered',{entityId:entity.id,hubId,simulated:td.flolah.simulated});this.sendConfig(hubId);return clone(entity);
  }
  offlinePolicy(entity,policy) {
    if(!this.companyPolicy(entity.owner,policy.action,policy.input).ok)throw fault('Company policy prohibits offline work',403);
    const action=entity.description.actions[policy.action];
    if(!action||action.risk!=='routine'||entity.actions[policy.action]!=='autonomous')throw fault('Offline requires an autonomous routine capability',403);
    validateInput(action.input,policy.input);
    if(!Number.isInteger(policy.maxUses)||policy.maxUses<1||policy.maxUses>20||!Number.isFinite(policy.expiresAt)||policy.expiresAt<=this.now()||policy.expiresAt>this.now()+3600_000)throw fault('Invalid offline bounds');
    return {id:randomUUID(),action:policy.action,input:clone(policy.input),expiresAt:policy.expiresAt,maxUses:policy.maxUses,used:0};
  }
  configure(owner,entityId,{actions,enabled,offline}) {
    const e=this.owned('entities',owner,entityId);
    if(actions){for(const [name,mode]of Object.entries(actions)){if(!e.description.actions[name]||!['autonomous','approval_required','prohibited'].includes(mode))throw fault('Invalid policy');}e.actions=clone(actions);}
    if(enabled!==undefined){if(typeof enabled!=='boolean')throw fault('Invalid enabled state');e.enabled=enabled;}
    e.offline=offline?this.offlinePolicy(e,offline):null;e.policyVersion=randomUUID();
    for(const o of Object.values(this.state.operations))if(o.entityId===e.id&&!TERMINAL.has(o.status)){o.status='uncertain';o.error='Policy changed; reconcile without replay';}
    this.audit(owner,'entity_policy_changed',{entityId});this.sendConfig(e.hubId);return clone(e);
  }
  revalidate(owner,entityId){
    const e=this.owned('entities',owner,entityId),hub=this.state.hubs[e.hubId];
    const td=hub.candidates.find(d=>d.id===e.deviceId);if(!td)throw fault('Discover current capabilities first',409);
    validateDescription(td);e.description=clone(td);e.descriptionHash=fingerprint(td);e.adapter=clone(td.flolah.adapter||null);
    // A reviewed capability version starts disabled, without inherited action authority.
    return this.configure(owner,entityId,{enabled:false,actions:{}});
  }
  configuration(hubId) { const h=this.state.hubs[hubId];return {type:'configuration',version:VERSION,hubId,siteId:h.siteId,leaseExpiresAt:this.now()+60_000,
    managed:h.managedPending||h.managedActive||null,
    entities:Object.values(this.state.entities).filter(e=>e.hubId===hubId&&e.enabled).map(e=>({id:e.deviceId,entityId:e.id,description:e.description,descriptionHash:e.descriptionHash,actions:e.actions,policyVersion:e.policyVersion,bindingRevision:e.bindingRevision||null,offline:e.offline})),
    pending:Object.values(this.state.operations).filter(o=>o.hubId===hubId&&['dispatched','accepted','running','cancelling'].includes(o.status)).map(o=>({id:o.id,deviceId:this.state.entities[o.entityId].deviceId}))}; }
  sendConfig(hubId) { const c=this.connections.get(hubId);if(c)c.send(JSON.stringify(this.configuration(hubId))); }
  // Policy context comes from the server runner/tool middleware, never operation JSON.
  operation(owner,{entityId,action,input={},idempotencyKey,timeoutMs=30000},requester='human',accessPrincipal=requester,policyContext={}) {
    const e=this.assertResource(owner,entityId,accessPrincipal,action);id(action);id(idempotencyKey);
    if(!e.enabled||this.state.hubs[e.hubId].revoked)throw fault('Asset unavailable',403);
    if(this.state.hubs[e.hubId].managedPending)throw fault('Configuration activation pending',409);
    const readiness=this.deviceReadiness(e);if(['unavailable','hub_offline'].includes(readiness.status)&&this.state.hubs[e.hubId].readiness)throw fault('Device unavailable; no command queued',409);
    const spec=e.description.actions[action];if(!spec)throw fault('Unsupported action');validateInput(spec.input,input);
    if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>300000)throw fault('Invalid timeout');
    const digest=fingerprint({entityId,action,input,timeoutMs});
    const previous=Object.values(this.state.operations).find(o=>o.owner===owner&&o.idempotencyKey===idempotencyKey);
    if(previous){if(previous.fingerprint!==digest)throw fault('Idempotency key reused with different inputs',409);return clone(previous);}
    const mode=e.actions[action]||'prohibited';
    if(mode==='prohibited'||spec.risk==='prohibited'){this.audit(owner,'operation_denied',{entityId,action,requester});throw fault('Physical action prohibited',403);}
    const decision=this.companyPolicy(owner,action,input,{...policyContext,entityId,phase:'create'});
    if(!decision.ok){this.audit(owner,'company_policy_denied',{entityId,action});throw fault('Company policy does not authorize this action',403);}
    const op={id:randomUUID(),owner,entityId,hubId:e.hubId,action,input:clone(input),idempotencyKey,fingerprint:digest,requester,accessPrincipal:clone(accessPrincipal),createdAt:this.now(),expiresAt:this.now()+timeoutMs,
      policyContext:{workflowId:policyContext.workflowId||null,agentId:policyContext.agentId||null},policyVersion:e.policyVersion,bindingRevision:e.bindingRevision||null,status:decision.requiresApproval||mode==='approval_required'||spec.risk==='approval_required'?'awaiting_approval':'queued',simulated:e.description.flolah.simulated};
    this.state.operations[op.id]=op;this.audit(owner,'operation_proposed',{operationId:op.id,entityId,requester});if(op.status==='queued')this.dispatch(op);return clone(op);
  }
  approve(owner,operationId,actor,{allow=true}={}) {
    if(typeof allow!=='boolean')throw fault('Approval decision must be boolean');
    const o=this.owned('operations',owner,operationId);if(o.status!=='awaiting_approval')throw fault('Operation is not awaiting approval',409);
    if(o.expiresAt<=this.now())throw fault('Approval expired',409);
    o.status=allow?'queued':'denied';o.approvedBy=actor;this.audit(owner,allow?'operation_approved':'operation_rejected',{operationId,actor});if(allow)this.dispatch(o);return clone(o);
  }
  dispatch(o) {
    const e=this.state.entities[o.entityId],h=this.state.hubs[o.hubId];
    const decision=this.companyPolicy(o.owner,o.action,o.input,{...o.policyContext,entityId:o.entityId,phase:'dispatch'});
    if(!e.enabled||h.revoked||o.policyVersion!==e.policyVersion||!decision.ok||!this.authorized(e,o.accessPrincipal||o.requester,o.action)||o.bindingRevision!==(e.bindingRevision||null)){o.status='denied';this.save();return;}
    if(decision.requiresApproval&&!o.approvedBy){o.status='awaiting_approval';this.save();return;}
    if(!this.connections.has(o.hubId)){o.status='queued';this.save();return;}
    if(o.expiresAt<=this.now()){o.status='timed_out';this.save();return;}
    const ready=this.deviceReadiness(e);if(h.readiness&&ready.status!=='available'){o.status='failed';o.error='Device readiness unavailable; request fresh work after recovery';this.save();return;}
    const c={bindingRevision:e.bindingRevision||null,id:o.id,entityId:e.deviceId,action:o.action,input:o.input,descriptionHash:e.descriptionHash,policyVersion:e.policyVersion,authorized:true,expiresAt:o.expiresAt};
    validateCommand(c,{id:e.deviceId,description:e.description},this.now());
    o.status='dispatched';o.dispatchedAt=this.now();this.save();this.connections.get(o.hubId).send(JSON.stringify({type:'command',command:c}));
  }
  cancel(owner,operationId) { const o=this.owned('operations',owner,operationId);if(TERMINAL.has(o.status))return clone(o);
    if(['queued','awaiting_approval'].includes(o.status)){o.status='cancelled';}else{const e=this.state.entities[o.entityId];if(!e.description.actions[o.action].task)throw fault('Cancellation unsupported',409);o.status='cancelling';this.connections.get(o.hubId)?.send(JSON.stringify({type:'cancel',id:o.id}));}
    this.audit(owner,'operation_cancel_requested',{operationId});return clone(o);
  }
  event(hubId, event) {
    if(!event||typeof event!=='object')throw fault('Invalid event');
    const h=this.state.hubs[hubId];if(!h||h.revoked)throw fault('Hub revoked',403);
    const e=Object.values(this.state.entities).find(e=>e.hubId===hubId&&e.deviceId===event.entityId);if(!e)throw fault('Unknown hub asset',403);
    const o=event.operationId?this.state.operations[event.operationId]:null;
    if(o&&(o.hubId!==hubId||o.entityId!==e.id))throw fault('Operation scope mismatch',403);
    if(event.type==='offline_start') {
      const grant=e.offline;
      if(o)return;
      if(!Number.isFinite(event.at)||!e.enabled||!grant||grant.id!==event.grantId||event.at>grant.expiresAt||event.at>this.now()+5000||event.at<this.now()-3600_000||grant.used>=grant.maxUses||e.actions[grant.action]!=='autonomous')throw fault('Offline authority invalid',403);
      id(event.operationId);grant.used++;
      this.state.operations[event.operationId]={id:event.operationId,owner:e.owner,hubId,entityId:e.id,action:grant.action,input:clone(grant.input),createdAt:event.at,dispatchedAt:event.at,expiresAt:event.at+30000,status:'dispatched',policyVersion:e.policyVersion,offline:true,simulated:e.description.flolah.simulated};
      this.audit(e.owner,'offline_operation_reconciled',{operationId:event.operationId});return;
    }
    if(event.type==='observation') {
      if(!e.description.properties[event.property])throw fault('Unknown property');validateInput(e.description.properties[event.property],event.value);
      if(!Number.isFinite(event.at)||event.at>this.now()+5000)throw fault('Invalid observation time');
      const old=e.observations[event.property];
      if(!old||event.at>old.at)e.observations[event.property]={value:event.value,at:event.at,simulated:e.description.flolah.simulated};
      if(o&&(!TERMINAL.has(o.status)||o.status==='uncertain')&&o.policyVersion===e.policyVersion&&event.at>=(o.dispatchedAt||Infinity)&&event.at<=o.expiresAt&&event.at>=this.now()-60000) {
        const expected=e.description.actions[o.action].expected;
        const value=expected.input?o.input[expected.input]:expected.value;
        if(event.property===expected.property&&event.value===value){
          let attachments=[],captureError=String(event.captureError||'').slice(0,160);
          if(event.attachments?.length){
            try{if(!e.description.flolah.evidence?.visual||!this.evidenceStore)throw Error('Visual capture/storage is not configured');if(event.attachments.some(a=>a.at<o.dispatchedAt||a.at>this.now()+5000||(!e.description.flolah.simulated&&a.kind==='simulator_snapshot')||(e.description.flolah.evidence.kind&&a.kind!==e.description.flolah.evidence.kind)))throw Error('Capture source/time mismatch');attachments=this.evidenceStore.put(e.owner,o.id,event.attachments);}
            catch{captureError='Visual evidence unavailable or rejected; observed-state evidence retained';}
          }
          const output=e.description.actions[o.action].output;
          if(output){try{const c=physicalWorkflowContract(e,{action:o.action});o.outputContract={version:c.version,hash:c.hash};o.outputs=projectDeviceOutputs(output,{value:event.value,at:event.at,attachments,result:event.result,operationId:o.id,simulated:e.description.flolah.simulated});}catch{o.status='failed';o.error='Declared device output missing or invalid';this.audit(e.owner,'device_output_rejected',{operationId:o.id});return;}}
          o.status='completed';o.evidence={kind:'observed_state',type:'observation',entityId:event.entityId,operationId:o.id,property:event.property,value:clone(event.value),at:event.at,expected:{property:expected.property,value:clone(value)},source:{siteId:e.siteId,hubId:e.hubId,deviceId:e.deviceId,adapter:e.adapter},attachments,captureError:captureError||null,simulated:e.description.flolah.simulated};o.completedAt=this.now();
        }
      }
    }else if(o&&!TERMINAL.has(o.status)) {
      if(event.type==='accepted'&&o.status==='dispatched')o.status='accepted';
      else if(event.type==='running'&&['accepted','running','dispatched'].includes(o.status)){o.status='running';o.progress=Math.max(0,Math.min(100,Number(event.progress)||0));}
      else if(['failed','cancelled','uncertain'].includes(event.type)){o.status=event.type;o.error=String(event.error||'').slice(0,200);}
      // Never complete a physical operation on receipt of a bare "completed" status.
    }
    this.audit(e.owner,'hub_'+event.type,{entityId:e.id,operationId:o?.id||null,status:o?.status||null});
  }
  connect(hubId,socket) { const old=this.connections.get(hubId);old?.close(4000,'Replaced connection');this.connections.set(hubId,socket);this.sendConfig(hubId); }
  disconnect(hubId,socket) { if(this.connections.get(hubId)===socket)this.connections.delete(hubId); }
  dispatchQueued(hubId) { for(const o of Object.values(this.state.operations))if(o.hubId===hubId&&o.status==='queued')this.dispatch(o); }
  expire() { this.expireManaged();let changed=false;for(const o of Object.values(this.state.operations))if(!TERMINAL.has(o.status)&&o.expiresAt<=this.now()){o.status=['queued','awaiting_approval'].includes(o.status)?'timed_out':'uncertain';o.error='Deadline expired; reconcile without replay';changed=true;}if(changed)this.save(); }
}

Object.assign(PhysicalControlPlane.prototype,managedControl);

export function sqliteStore(db) {
  db.exec('CREATE TABLE IF NOT EXISTS physical_control_state (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL)');
  return {load:()=>{const r=db.prepare('SELECT document FROM physical_control_state WHERE id=1').get();return r?JSON.parse(r.document):null;},
    save:s=>db.prepare('INSERT INTO physical_control_state(id,document) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(JSON.stringify(s))};
}
