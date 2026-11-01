import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {randomUUID} from 'node:crypto';
import {PhysicalControlPlane} from '../../backend/src/services/physical/control-plane.js';
import {attachPhysicalHubServer} from '../../backend/src/services/physical/socket-server.js';
import {profile,fingerprint} from '../../backend/src/services/physical/contracts.js';
import {validateManagedDocument} from '../../backend/src/services/physical/managed-config.js';
import {EdgeGateway} from '../src/gateway.js';
import {HomeAssistantAdapter} from '../src/home-assistant-adapter.js';
import {siteSimulator} from '../src/site-simulator.js';
const store=initial=>{let state=structuredClone(initial);return {load:()=>structuredClone(state),save:s=>{state=structuredClone(s);}};};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await wait(20);}throw Error('Condition timed out');}
function mapping(id='mapped-device'){
 const d=profile(id,'switch');d.title='Mapped simulated device';d.flolah.simulated=true;
 d.actions={activate:{risk:'routine',task:false,input:{type:'object',properties:{},required:[]},expected:{property:'on',value:true}}};
 return {id,profile:'ha-capability',simulated:true,description:d,actionBindings:{activate:{transport:'home-assistant',domain:'script',service:'turn_on',entityId:'script.activate'}},observationBindings:[{entityId:'binary_sensor.device',property:'on',states:{on:true,off:false}}]};
}
function document(m=mapping()){return {version:1,mappings:[{adapterId:'ha',mapping:m}]};}

test('managed validation rejects code, secret fields, schema mismatch and unobservable commands',()=>{
 validateManagedDocument(document());
 for(const mutate of [d=>d.code='run',d=>d.mappings[0].token='secret',d=>d.mappings[0].mapping.actionBindings.activate={transport:'shell',command:'anything'},d=>d.mappings[0].mapping.observationBindings=[],d=>d.mappings.push(d.mappings[0])]){const d=document();mutate(d);assert.throws(()=>validateManagedDocument(d));}
});

test('versioned rollout scopes hub, rejects mismatches, preserves last good and supports rollback',()=>{
 let now=1000;const p=new PhysicalControlPlane(store(null),{now:()=>now});const a=p.enroll('owner',{siteId:'same-site',name:'A'}),b=p.enroll('owner',{siteId:'same-site',name:'B'});
 const report={adapters:[{id:'ha',type:'home-assistant',version:2,managedVersion:1,connected:true}],entities:[]};p.hubReport(a.hubId,report);p.hubReport(b.hubId,report);
 assert.throws(()=>p.stageManaged('other',a.hubId,{document:document()}),{status:404});
 const r=p.stageManaged('owner',a.hubId,{document:document()});p.managedAck(b.hubId,{revisionId:r.id,hash:r.hash,ok:true});assert.equal(p.managedState('owner',a.hubId).active,null);
 p.managedAck(a.hubId,{revisionId:r.id,hash:'wrong',ok:true});assert.equal(p.managedState('owner',a.hubId).active,null);
 p.managedAck(a.hubId,{revisionId:r.id,hash:r.hash,ok:true});assert.equal(p.managedState('owner',a.hubId).active.id,r.id);
 assert.throws(()=>p.stageManaged('owner',a.hubId,{document:document()}),{status:409});
 const rejected=p.stageManaged('owner',a.hubId,{document:document(mapping('another-device')),baseRevision:r.id});p.managedAck(a.hubId,{revisionId:rejected.id,hash:rejected.hash,ok:false});assert.equal(p.managedState('owner',a.hubId).active.id,r.id);
 const next=p.stageManaged('owner',a.hubId,{document:document(mapping('next-device')),baseRevision:r.id});p.managedAck(a.hubId,{revisionId:next.id,hash:next.hash,ok:true});
 const rolled=p.rollbackManaged('owner',a.hubId,{revisionId:r.id,baseRevision:next.id});p.managedAck(a.hubId,{revisionId:rolled.id,hash:rolled.hash,ok:true});assert.deepEqual(p.managedState('owner',a.hubId).active.document,r.document);
 const timeout=p.stageManaged('owner',a.hubId,{document:document(),baseRevision:rolled.id});now+=60001;p.expire();assert.equal(p.managedState('owner',a.hubId).pending,null);p.managedAck(a.hubId,{revisionId:timeout.id,hash:timeout.hash,ok:true});assert.equal(p.managedState('owner',a.hubId).active.id,rolled.id);
});

test('resource grants filter agents and users, revoke pending work, reject bad arguments and label stale values',()=>{
 let now=1000;const p=new PhysicalControlPlane(store(null),{now:()=>now});const h=p.enroll('owner',{siteId:'site',name:'hub'});p.discover(h.hubId,[profile('lamp')]);const e=p.register('owner',{hubId:h.hubId,candidateId:'lamp',actions:{set_state:'approval_required'}});
 p.setEntitlements('owner',e.id,{grants:[{principal:'agent:operator',discover:true,actions:['set_state']},{principal:'user:viewer',discover:true,actions:[]}]});
 assert.equal(p.resourceList('owner','agent:other').entities.length,0);assert.equal(p.resourceList('owner','user:viewer').entities[0].actions.set_state,'prohibited');
 const request={entityId:e.id,action:'set_state',input:{on:true},idempotencyKey:'one'};
 assert.throws(()=>p.operation('owner',request,'agent:other'),{status:403});assert.throws(()=>p.operation('owner',request,'user:viewer'),{status:403});assert.throws(()=>p.operation('owner',{...request,input:{on:'placeholder'}},'agent:operator'));
 const op=p.operation('owner',request,'agent:operator');assert.equal(op.status,'awaiting_approval');assert.equal(p.operation('owner',request,'agent:operator').id,op.id);assert.throws(()=>p.operation('owner',{...request,input:{on:false}},'agent:operator'),{status:409});
 p.setEntitlements('owner',e.id,{grants:[]});assert.equal(p.owned('operations','owner',op.id).status,'uncertain');assert.throws(()=>p.approve('owner',op.id,'human:owner'),{status:409});
 p.event(h.hubId,{type:'observation',entityId:'lamp',property:'on',value:true,at:now});now+=61000;assert.equal(p.list('owner').entities[0].observations.on.stale,true);
});

test('two real simulator hubs at same site isolate commands, approvals and offline expiry', {timeout:20000},async()=>{
 const p=new PhysicalControlPlane(store(null));const http=createServer();const sockets=attachPhysicalHubServer(http,p);await new Promise(r=>http.listen(0,'127.0.0.1',r));
 const labs=[],gateways=[];
 try{
  const enrolled=[];for(const name of ['first','second']){const hub=p.enroll('owner',{siteId:'same-site',name});enrolled.push(hub);const config={hub:{...hub,cloudUrl:'ws://127.0.0.1:'+http.address().port+'/api/physical/hub',allowInsecureLocal:true}};const lab=await siteSimulator(config,(_,initial)=>store(initial));labs.push(lab);const g=new EdgeGateway(config.hub,store(null),{simulator:lab.adapter});gateways.push(g);await g.start();}
  await until(()=>enrolled.every(h=>p.state.hubs[h.hubId].candidates.length===4));
  const assets=enrolled.map(h=>p.register('owner',{hubId:h.hubId,candidateId:'virtual-switch',actions:{set_state:'approval_required'}}));
  await until(()=>gateways.every(g=>g.state.configuration?.entities.length===1));
  const op=p.operation('owner',{entityId:assets[0].id,action:'set_state',input:{on:true},idempotencyKey:randomUUID(),timeoutMs:5000});assert.equal(op.status,'awaiting_approval');assert.equal(labs[0].simulator.state.devices['virtual-switch'].values.on,false);
  p.approve('owner',op.id,'human:owner');await until(()=>p.owned('operations','owner',op.id).status==='completed');assert.equal(labs[0].simulator.state.devices['virtual-switch'].values.on,true);assert.equal(labs[1].simulator.state.devices['virtual-switch'].values.on,false);
  const result=p.owned('operations','owner',op.id);assert.equal(result.evidence.source.hubId,enrolled[0].hubId);assert.equal(result.simulated,true);
  p.hubReport(enrolled[0].hubId,{adapters:[],entities:[{id:'virtual-switch',available:false}]});assert.throws(()=>p.operation('owner',{entityId:assets[0].id,action:'set_state',input:{on:false},idempotencyKey:randomUUID()}),{status:409});
 }finally{for(const g of gateways)await g.close();for(const l of labs){await l.simulator.close();await l.broker.close();}await sockets.close();await new Promise(r=>http.close(r));}
});

test('HA reconnects and server-delivered mapping executes without local mapping edits', {timeout:15000},async()=>{
 const http=createServer(),wss=new WebSocketServer({server:http,path:'/api/websocket'});await new Promise(r=>http.listen(0,'127.0.0.1',r));
 let state={entity_id:'binary_sensor.device',state:'off',last_updated:new Date().toISOString(),attributes:{}},calls=0;
 wss.on('connection',ws=>{ws.send(JSON.stringify({type:'auth_required'}));ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='auth'){ws.send(JSON.stringify({type:'auth_ok'}));return;}if(m.type==='call_service'){calls++;state={...state,state:'on',last_updated:new Date().toISOString()};}ws.send(JSON.stringify({type:'result',id:m.id,success:true,result:m.type==='get_states'?[state]:null}));if(m.type==='call_service')ws.send(JSON.stringify({type:'event',event:{event_type:'state_changed',data:{new_state:state}}}));});});
 const a=new HomeAssistantAdapter({url:'http://127.0.0.1:'+http.address().port,token:'test',entities:[]});
 const g=new EdgeGateway({hubId:'hub',siteId:'site',token:'test',cloudUrl:'ws://127.0.0.1:1',allowInsecureLocal:true},store(null),{ha:a});
 try{await a.start();const d=document();const r={id:randomUUID(),document:d,hash:fingerprint(d)};await g.applyManaged(r);g.descriptions();await a.refresh();assert.equal(a.available('mapped-device'),true);
  const events=[];a.on('event',e=>events.push(e));await a.invokeAction({id:randomUUID(),entityId:'mapped-device',action:'activate',input:{},expiresAt:Date.now()+5000});await until(()=>events.some(e=>e.value===true));assert.equal(calls,1);
  for(const ws of wss.clients)ws.terminate();await until(()=>!a.health().connected);assert.equal(a.available('mapped-device'),false);await until(()=>a.health().connected&&a.available('mapped-device'));assert.equal(calls,1,'Reconnect does not replay device action');
  const bad=document();bad.mappings[0].mapping.actionBindings.activate.transport='shell';await assert.rejects(()=>g.applyManaged({id:randomUUID(),document:bad,hash:fingerprint(bad)}));assert.equal(g.state.managed.id,r.id);assert.ok(a.describe('mapped-device'));
 }finally{await a.close();for(const ws of wss.clients)ws.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>http.close(r));}
});
