import {validateManagedDocument} from '../../backend/src/services/physical/managed-config.js';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { VERSION, id, fingerprint, fault, validateDescription, validateCommand, TERMINAL } from '../../backend/src/services/physical/contracts.js';

export class EdgeGateway {
  constructor(config,store,adapters){
    this.config=config;this.store=store;this.state=store.load()||{configuration:null,journal:{},events:[],offlineUses:{}};this.adapters=adapters;this.bindings=new Map();this.connected=false;this.closed=false;
    const u=new URL(config.cloudUrl);if(u.username||u.password||u.search||u.hash)throw fault('Cloud URL must not contain credentials, query or fragment');if(u.protocol!=='wss:'&&!(config.allowInsecureLocal===true&&u.protocol==='ws:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)))throw fault('Cloud connection requires WSS');
    if(!config.hubId||!config.token)throw fault('Hub credentials required');
    for(const [adapterId,a]of Object.entries(adapters)){id(adapterId);a.on('event',e=>this.onEvent(adapterId,e));}
  }
  save(){this.store.save(this.state);}
  record(event){if(this.state.events.length>=10000)throw fault('Event journal full; refusing new work',503);const envelope={...event,eventId:randomUUID()};this.state.events.push(envelope);this.save();this.send({type:'event',event:envelope});}
  send(message){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));}
  adapterDescription(adapterId,d){return {...d,flolah:{...d.flolah,adapter:{id:adapterId,version:this.adapters[adapterId].constructor.manifest.version}}};}
  descriptions(){const all=[];this.bindings.clear();for(const [adapterId,a]of Object.entries(this.adapters))for(const raw of a.discover()){
    const d=this.adapterDescription(adapterId,raw);validateDescription(d);if(this.bindings.has(d.id))throw fault('Ambiguous device identity across adapters');this.bindings.set(d.id,adapterId);all.push(d);
  }return all;}
  async applyManaged(revision){
    if(!revision)return;
    if(revision.status==='pending'&&revision.expiresAt<=Date.now())throw fault('Managed activation expired');
    if(revision.hash!==fingerprint(revision.document))throw fault('Managed configuration hash mismatch');
    if(this.state.managed?.id===revision.id){this.state.managed=structuredClone(revision);this.save();return;}
    validateManagedDocument(revision.document);
    for(const item of revision.document.mappings){const a=this.adapters[item.adapterId];if(!a?.validateManaged)throw fault('Unsupported managed adapter');a.validateManaged(item.mapping);}
    const snapshots=new Map();
    try{for(const [adapterId,a]of Object.entries(this.adapters)){if(!a.replaceManaged)continue;snapshots.set(a,a.entities);a.replaceManaged(revision.document.mappings.filter(m=>m.adapterId===adapterId).map(m=>m.mapping));}
      this.descriptions();this.state.managed=structuredClone(revision);this.save();
    }catch(error){for(const [a,entities]of snapshots)a.entities=entities;throw error;}
  }
  report(){this.send({type:'hub_report',adapters:Object.entries(this.adapters).map(([id,a])=>({id,type:a.constructor.manifest.id,version:a.constructor.manifest.version,managedVersion:a.replaceManaged?1:0,...a.health()})),entities:[...this.bindings].map(([id,adapterId])=>({id,available:this.adapters[adapterId].available?this.adapters[adapterId].available(id):this.adapters[adapterId].health().connected})),integrationEntities:Object.entries(this.adapters).flatMap(([adapterId,a])=>(a.integrationEntities?.()||[]).map(entityId=>({adapterId,entityId})))});}
  async start(){if(this.state.managed){const cached=this.state.managed;this.state.managed=null;await this.applyManaged({...cached,status:'active'});}for(const adapter of Object.values(this.adapters)){try{await adapter.start();}catch(error){if(!adapter.available)throw error;}}this.connect();return this;}
  connect(){
    if(this.closed)return;
    this.socket=new WebSocket(this.config.cloudUrl,{headers:{Authorization:'Bearer '+this.config.token,'X-Flolah-Hub':this.config.hubId},maxPayload:1024*1024});
    this.socket.on('error',()=>{});
    this.socket.on('message',raw=>{try{this.handle(JSON.parse(raw)).catch(()=>this.socket.close(4002,'Invalid hub message'));}catch{this.socket.close(4002,'Malformed hub message');}});
    this.socket.on('close',()=>{this.connected=false;if(!this.closed){this.reconnect=setTimeout(()=>this.connect(),500);}});
  }
  async handle(message){
    if(message.type==='configuration'){
      if(message.version!==VERSION||message.hubId!==this.config.hubId||message.siteId!==this.config.siteId||message.leaseExpiresAt<=Date.now()||message.leaseExpiresAt>Date.now()+120000)throw fault('Invalid hub configuration');
      if(message.managed){try{await this.applyManaged(message.managed);this.send({type:'configuration_ack',revisionId:message.managed.id,hash:message.managed.hash,ok:true});}catch{this.send({type:'configuration_ack',revisionId:message.managed.id,hash:message.managed.hash,ok:false,error:'Installed adapter rejected configuration; last valid cache retained'});}}
      if(!message.managed&&this.state.managed){for(const a of Object.values(this.adapters))a.replaceManaged?.([]);this.state.managed=null;this.save();}
      const descriptions=this.descriptions();
      for(const entity of message.entities){validateDescription(entity.description);if(entity.descriptionHash!==fingerprint(entity.description))throw fault('Description hash mismatch');}
      this.state.configuration=message;this.save();this.connected=true;
      this.send({type:'discover',descriptions});
      for(const e of message.entities){const adapterId=this.bindings.get(e.id),adapter=this.adapters[adapterId];if(!adapter)continue;
        if(adapter.refresh)await adapter.refresh(e.id);
        else for(const property of Object.keys(e.description.properties)){const observed=adapter.readProperty(e.id,property);if(observed)this.onEvent(adapterId,{type:'observation',entityId:e.id,property,...observed});}
      }
      // Replay evidence, not commands. A dispatched command without a result is never automatically re-executed.
      for(const event of this.state.events)this.send({type:'event',event});
      for(const pending of message.pending){const record=this.state.journal[pending.id];
        if(record?.lastEvent)this.send({type:'event',event:{...record.lastEvent,eventId:randomUUID()}});
        const adapter=record?this.adapters[record.adapterId]:null;
        if(record&&adapter?.reconcile)await adapter.reconcile(record.command,record.dispatchedAt);
        else if(!record?.lastEvent)this.send({type:'event',event:{type:'uncertain',entityId:pending.deviceId,operationId:pending.id,error:'Gateway has no verified outcome',at:Date.now(),eventId:randomUUID()}});
      }
      this.report();this.send({type:'ready'});
    }else if(message.type==='event_ack'){
      if(message.rejected){const event=this.state.events.find(e=>e.eventId===message.eventId),record=this.state.journal[event?.operationId];if(record){record.status='uncertain';record.error='Cloud rejected event authority or evidence';}}
      this.state.events=this.state.events.filter(e=>e.eventId!==message.eventId);this.save();
    }else if(message.type==='command'){try{await this.execute(message.command);}catch{this.record({type:'failed',entityId:message.command.entityId,operationId:message.command.id,error:'Device unavailable or command/configuration validation failed; no action dispatched',at:Date.now()});}}
    else if(message.type==='cancel'){
      const record=this.state.journal[message.id];if(!record)return;const adapter=this.adapters[record.adapterId];if(!adapter.cancelTask){this.record({type:'failed',entityId:record.command.entityId,operationId:message.id,error:'Cancellation unsupported',at:Date.now()});return;}await adapter.cancelTask(record.command);
    }
  }
  async execute(command,{offline=false}={}){
    if(this.state.events.length>=9800)throw fault('Evidence buffer capacity reached; refusing new actions',503);
    const c=this.state.configuration;if(!c||(!offline&&!this.connected)||c.leaseExpiresAt<=Date.now())throw fault('No current cached policy',403);
    const e=c.entities.find(e=>e.id===command.entityId);if(!e||command.policyVersion!==e.policyVersion||(command.bindingRevision||null)!==(e.bindingRevision||null)||(e.bindingRevision&&e.bindingRevision!==this.state.managed?.id))throw fault('Asset scope or policy changed',403);
    const spec=validateCommand(command,e);
    const mode=e.actions[command.action]||'prohibited';
    if(mode==='prohibited'||(offline&&(mode!=='autonomous'||spec.risk!=='routine')))throw fault('Local policy prohibits action',403);
    const digest=fingerprint(command),old=this.state.journal[command.id];
    if(old){if(old.digest!==digest)throw fault('Operation identity conflict',409);if(old.lastEvent)this.record(old.lastEvent);return;}
    const adapterId=this.bindings.get(e.id),adapter=this.adapters[adapterId];if(!adapter)throw fault('No configured adapter',409);
    if(fingerprint(this.adapterDescription(adapterId,adapter.describe(e.id)))!==e.descriptionHash)throw fault('Adapter capabilities changed; re-onboarding required',409);
    if(!adapter.health().connected||(adapter.available&&!adapter.available(e.id)))throw fault('Adapter offline',503);
    if(Object.values(this.state.journal).some(r=>r.command.entityId===e.id&&!TERMINAL.has(r.status)&&r.command.expiresAt>Date.now()))throw fault('Device has pending work',409);
    this.state.journal[command.id]={command,digest,adapterId,status:'dispatched',entityId:e.entityId,dispatchedAt:Date.now()};this.save();
    try{await (spec.task?adapter.startTask(command):adapter.invokeAction(command));}
    catch{this.onEvent(adapterId,{type:'uncertain',entityId:e.id,operationId:command.id,error:'Adapter could not verify dispatch',at:Date.now()});}
  }
  onEvent(adapterId,event){
    const record=event.operationId?this.state.journal[event.operationId]:null,entity=this.state.configuration?.entities.find(e=>e.id===event.entityId),adapter=this.adapters[adapterId];
    const expected=record&&entity?.description.actions[record.command.action]?.expected;
    if(record?.capturePending&&event.type==='observation'&&event.property===expected?.property)return;
    if(record&&expected&&this.bindings.get(event.entityId)===adapterId&&record.command.entityId===event.entityId&&entity.description.flolah.evidence?.visual&&adapter.captureEvidence&&!record.captureAttempted&&event.type==='observation'&&event.property===expected.property&&event.value===(expected.input?record.command.input[expected.input]:expected.value)&&event.at>=record.dispatchedAt&&event.at<=record.command.expiresAt){
      record.captureAttempted=true;record.capturePending=true;this.save();
      void (async()=>{try{event={...event,attachments:await adapter.captureEvidence(record.command)};}catch{event={...event,captureError:'Configured capture source unavailable'};}record.capturePending=false;this.processEvent(adapterId,event);})().catch(()=>{});return;
    }
    this.processEvent(adapterId,event);
  }
  processEvent(adapterId,event){
    if(event.type==='description'){if(this.connected)this.send({type:'discover',descriptions:this.descriptions()});return;}
    const c=this.state.configuration,e=c?.entities.find(e=>e.id===event.entityId);if(!e)return;
    if(this.bindings.get(event.entityId)!==adapterId)return;
    const record=event.operationId?this.state.journal[event.operationId]:null;
    if(record&&record.command.entityId!==event.entityId)return;
    if(record&&!TERMINAL.has(record.status)){
      record.lastEvent=event;
      if(event.type==='observation'){
        const expected=e.description.actions[record.command.action].expected;
        const value=expected.input?record.command.input[expected.input]:expected.value;
        if(event.property===expected.property&&event.value===value&&event.at<=record.command.expiresAt&&event.at>=record.dispatchedAt)record.status='completed';
      }else record.status=event.type;
      this.save();
    }
    this.record(event);
  }
  async offline(entityId){
    if(this.connected)throw fault('Offline routine endpoint only operates during cloud outage',409);
    const c=this.state.configuration,e=c?.entities.find(e=>e.id===entityId),grant=e?.offline;
    if(!grant||grant.expiresAt<=Date.now()||c.leaseExpiresAt<=Date.now()||(this.state.offlineUses[grant.id]||0)>=grant.maxUses)throw fault('No valid offline grant',403);
    const command={id:randomUUID(),entityId,action:grant.action,input:grant.input,descriptionHash:e.descriptionHash,policyVersion:e.policyVersion,authorized:true,expiresAt:Math.min(grant.expiresAt,c.leaseExpiresAt,Date.now()+30000)};
    this.state.offlineUses[grant.id]=(this.state.offlineUses[grant.id]||0)+1;this.save();
    this.record({type:'offline_start',entityId,operationId:command.id,grantId:grant.id,at:Date.now()});await this.execute(command,{offline:true});return {operationId:command.id};
  }
  status(){return {connected:this.connected,hubId:this.config.hubId,siteId:this.config.siteId,entities:this.state.configuration?.entities||[],journal:this.state.journal,pendingEvents:this.state.events.length,adapters:Object.entries(this.adapters).map(([id,a])=>({id,...a.health()}))};}
  async close(){this.closed=true;clearTimeout(this.reconnect);this.socket?.close();for(const a of Object.values(this.adapters))await a.close();}
}
