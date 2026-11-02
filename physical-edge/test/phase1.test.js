import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import { PhysicalControlPlane,emptyState } from '../../backend/src/services/physical/control-plane.js';
import { profile,fingerprint,validateDescription,validateCommand } from '../../backend/src/services/physical/contracts.js';
import { FileStore } from '../src/store.js';
import { Simulator } from '../src/simulator.js';
import { EdgeGateway } from '../src/gateway.js';
import { MqttAdapter } from '../src/mqtt-adapter.js';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=7000){const start=Date.now();while(Date.now()-start<ms){if(await fn())return;await pause(30);}throw Error('Timed out: '+label);}
const memory=()=>{let state=null;return {load:()=>state?structuredClone(state):null,save:s=>{state=structuredClone(s);}};};

test('typed capability contract rejects malformed and undeclared inputs',()=>{
  const td=profile('switch-1');assert.equal(validateDescription(td),td);
  const c={id:randomUUID(),entityId:td.id,action:'set_state',input:{on:true},descriptionHash:fingerprint(td),authorized:true,expiresAt:Date.now()+1000};
  assert.equal(validateCommand(c,{id:td.id,description:td}).risk,'routine');
  for(const bad of [{...c,input:{on:'yes'}},{...c,input:{on:true,motor:42}},{...c,action:'raw_motor'},{...c,expiresAt:0},{...c,authorized:false},{...c,descriptionHash:'wrong'}])assert.throws(()=>validateCommand(bad,{id:td.id,description:td}));
});

test('control plane owner isolation, human approval, stale state and persistence',()=>{
  let now=1000000;const store=memory(),plane=new PhysicalControlPlane(store,{now:()=>now});
  const h=plane.enroll('tenant-a',{siteId:'site-a',name:'Test hub'});plane.discover(h.hubId,[profile('robot','robot')]);
  const e=plane.register('tenant-a',{hubId:h.hubId,candidateId:'robot',actions:{clean_area:'autonomous'}});
  assert.throws(()=>plane.owned('entities','tenant-b',e.id),{status:404});assert.throws(()=>plane.authenticate(h.hubId,'wrong'),{status:401});
  const o=plane.operation('tenant-a',{entityId:e.id,action:'clean_area',input:{areaId:'room'},idempotencyKey:randomUUID()});
  assert.equal(o.status,'awaiting_approval');assert.throws(()=>plane.approve('tenant-b',o.id,'human'),{status:404});
  plane.approve('tenant-a',o.id,'human');assert.equal(plane.state.operations[o.id].status,'queued');
  plane.connect(h.hubId,{send(){},close(){}});plane.dispatchQueued(h.hubId);
  plane.event(h.hubId,{type:'completed',entityId:'robot',operationId:o.id,at:now});assert.notEqual(plane.state.operations[o.id].status,'completed');
  plane.event(h.hubId,{type:'observation',entityId:'robot',operationId:o.id,property:'task_state',value:'completed',at:now-1});assert.notEqual(plane.state.operations[o.id].status,'completed');
  now+=5;plane.event(h.hubId,{type:'observation',entityId:'robot',operationId:o.id,property:'task_state',value:'completed',at:now});assert.equal(plane.state.operations[o.id].status,'completed');
  const reopened=new PhysicalControlPlane(store,{now:()=>now});assert.equal(reopened.owned('operations','tenant-a',o.id).status,'completed');assert.ok(reopened.list('tenant-a').audit.some(a=>a.type==='operation_approved'));
});

test('file journals enforce single ownership and retain committed state across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'physical-store-'));try{const path=join(dir,'state.json'),a=new FileStore(path,{});a.save({committed:true});assert.throws(()=>new FileStore(path,{}));a.close();const b=new FileStore(path,{});assert.equal(b.load().committed,true);b.close();}finally{rmSync(dir,{recursive:true,force:true});}
});

test('transport credentials stay out of URLs and configured MQTT allowlists are validated',()=>{
  const config={hubId:randomUUID(),siteId:'test-site',token:randomUUID()};
  for(const cloudUrl of ['ws://remote.invalid/api/physical/hub','wss://user:secret@cloud.invalid/api/physical/hub','wss://cloud.invalid/api/physical/hub?token=secret'])assert.throws(()=>new EdgeGateway({...config,cloudUrl},memory(),{}));
  assert.throws(()=>new MqttAdapter({tenantId:'test',siteId:'test',hubId:'test',entityIds:'all'}));
});

test('company prohibition and human gates remain stricter than asset policy',()=>{
  let mode='approval_required';const plane=new PhysicalControlPlane(memory(),{companyPolicy:()=>({ok:mode!=='prohibited',requiresApproval:mode==='approval_required'})});
  const h=plane.enroll('owner',{siteId:'site',name:'Test'});plane.discover(h.hubId,[profile('lamp')]);
  const e=plane.register('owner',{hubId:h.hubId,candidateId:'lamp',actions:{set_state:'autonomous'}});
  const o=plane.operation('owner',{entityId:e.id,action:'set_state',input:{on:true},idempotencyKey:randomUUID()});assert.equal(o.status,'awaiting_approval');
  mode='prohibited';plane.approve('owner',o.id,'human');assert.equal(plane.state.operations[o.id].status,'denied');
  assert.throws(()=>plane.operation('owner',{entityId:e.id,action:'set_state',input:{on:true},idempotencyKey:randomUUID()}),{status:403});
});

test('real HTTP + WebSocket + MQTT simulator acceptance', {timeout:90000}, async t=>{
  const dir=mkdtempSync(join(tmpdir(),'physical-phase1-'));
  process.env.AGENT_OS_DATA_DIR=join(dir,'existing-backend-isolated');process.env.OPENCLAW_DIR=join(dir,'openclaw');
  const {startLab}=await import('../src/lab-runtime.js');
  const lab=await startLab({dataDir:dir});let checks=0;
  const call=async(path,body,token=lab.sessionToken,method=body?'POST':'GET')=>{const r=await fetch(lab.cloudUrl+'/api/physical'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const current=o=>{lab.plane.expire();return lab.plane.state.operations[o.id];};
  const invoke=async(e,action,input,timeoutMs=1500,key=randomUUID())=>{const r=await call('/operations',{entityId:e.id,action,input,timeoutMs,idempotencyKey:key});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
  try{
    await until(()=>lab.plane.state.hubs[lab.hub.hubId].candidates.length===5,'discovery');
    let light,sensor,robot;
    await t.test('onboarding and two device types share the capability interface',async()=>{
      for(const [device,actions]of [['lab-switch',{set_state:'autonomous'}],['lab-sensor',{}],['lab-robot',{clean_area:'approval_required'}]]){
        const r=await call('/entities',{hubId:lab.hub.hubId,candidateId:device,actions});assert.equal(r.status,200);if(device==='lab-switch')light=r.data;else if(device==='lab-sensor')sensor=r.data;else robot=r.data;
      }
      assert.equal(light.description.flolah.simulated,true);assert.equal(sensor.description.flolah.simulated,true);
      await until(()=>lab.gateway.state.configuration.entities.length===3,'edge grants');checks++;
    });
    await t.test('virtual TV power, approved app, channel and navigation complete through cloud-edge-MQTT round trip',async()=>{
      const registered=await call('/entities',{hubId:lab.hub.hubId,candidateId:'lab-tv',actions:{set_power:'autonomous',launch_app:'autonomous',select_channel:'autonomous',navigate:'autonomous'}});assert.equal(registered.status,200);
      const tv=registered.data;await until(()=>lab.gateway.state.configuration.entities.some(e=>e.entityId===tv.id),'TV grant');
      for(const [action,input]of [['set_power',{on:true}],['launch_app',{app:'youtube'}],['select_channel',{channel:5}],['navigate',{command:'DPAD_DOWN'}],['set_power',{on:false}]]){
        const op=await invoke(tv,action,input);await until(()=>current(op).status==='completed','TV '+action);assert.ok(current(op).evidence);assert.equal(lab.simulator.state.operations[op.id].sideEffects,1);
      }
      assert.equal((await call('/operations',{entityId:tv.id,action:'navigate',input:{command:'SHELL'},idempotencyKey:randomUUID()})).status,400);
      lab.simulator.control('lab-tv',{mode:'accepted_only'});const silent=await invoke(tv,'set_power',{on:true},200);await until(()=>current(silent).status==='uncertain','TV no evidence');assert.ok(!current(silent).evidence);lab.simulator.control('lab-tv',{mode:'normal'});checks++;
    });
    await t.test('unauthenticated requests and tenant escape are rejected',async()=>{
      assert.equal((await call('','', 'wrong')).status,401);
      assert.throws(()=>lab.plane.register('other-tenant',{hubId:lab.hub.hubId,candidateId:'lab-switch'}),{status:404});
      assert.throws(()=>lab.plane.operation('other-tenant',{entityId:light.id,action:'set_state',input:{on:true},idempotencyKey:randomUUID()}),{status:404});checks++;
    });
    await t.test('allowed action completes on independent observed state',async()=>{
      const o=await invoke(light,'set_state',{on:true});await until(()=>current(o).status==='completed','verified light');assert.equal(current(o).evidence.value,true);assert.equal(lab.simulator.state.devices['lab-switch'].values.on,true);checks++;
    });
    await t.test('duplicate request returns original outcome without another side effect',async()=>{
      const key=randomUUID(),o=await invoke(light,'set_state',{on:false},1500,key);await until(()=>current(o).status==='completed','first idempotent command');
      const repeated=await invoke(light,'set_state',{on:false},1500,key);assert.equal(repeated.id,o.id);assert.equal(lab.simulator.state.operations[o.id].sideEffects,1);
      const conflict=await call('/operations',{entityId:light.id,action:'set_state',input:{on:true},timeoutMs:1500,idempotencyKey:key});assert.equal(conflict.status,409);checks++;
    });
    await t.test('accepted without observation remains unverified and expires uncertain',async()=>{
      lab.simulator.control('lab-switch',{mode:'accepted_only'});const o=await invoke(light,'set_state',{on:true},200);await until(()=>current(o).status==='uncertain','accepted-only timeout');assert.ok(!current(o).evidence);lab.simulator.control('lab-switch',{mode:'normal'});checks++;
    });
    await t.test('stale observations cannot satisfy a new operation',async()=>{
      lab.simulator.control('lab-switch',{mode:'stale'});const o=await invoke(light,'set_state',{on:true},250);await until(()=>current(o).status==='uncertain','stale outcome');assert.ok(!current(o).evidence);lab.simulator.control('lab-switch',{mode:'normal'});checks++;
    });
    await t.test('human approval gates a simulated robot task and supports cancellation',async()=>{
      lab.simulator.control('lab-robot',{delayMs:700});const o=await invoke(robot,'clean_area',{areaId:'room-a'},2500);assert.equal(o.status,'awaiting_approval');assert.ok(!lab.simulator.state.operations[o.id]);
      await call('/operations/'+o.id+'/approve',{allow:true});await until(()=>current(o).status==='running','robot progress');await call('/operations/'+o.id+'/cancel',{});await until(()=>current(o).status==='cancelled','robot cancel');checks++;
    });
    await t.test('explicit rejection and prohibited policy never dispatch',async()=>{
      const o=await invoke(robot,'clean_area',{areaId:'room-b'});await call('/operations/'+o.id+'/approve',{allow:false});assert.equal(current(o).status,'denied');assert.ok(!lab.simulator.state.operations[o.id]);
      await call('/entities/'+light.id,{actions:{set_state:'prohibited'}},lab.sessionToken,'PATCH');
      assert.equal((await call('/operations',{entityId:light.id,action:'set_state',input:{on:false},idempotencyKey:randomUUID()})).status,403);
      await call('/entities/'+light.id,{actions:{set_state:'autonomous'}},lab.sessionToken,'PATCH');await until(()=>lab.gateway.state.configuration.entities.find(e=>e.entityId===light.id).actions.set_state==='autonomous','restore grant');checks++;
    });
    await t.test('simulator outage and adapter failure do not report completion',async()=>{
      lab.simulator.control('lab-switch',{mode:'offline'});const o=await invoke(light,'set_state',{on:true},200);await until(()=>current(o).status==='uncertain','offline timeout');lab.simulator.control('lab-switch',{mode:'fail'});
      const f=await invoke(light,'set_state',{on:false});await until(()=>current(f).status==='failed','simulator failure');lab.simulator.control('lab-switch',{mode:'normal'});checks++;
    });
    await t.test('invalid capability and malformed inputs are rejected',async()=>{
      for(const body of [{action:'raw_motor',input:{}},{action:'set_state',input:{on:'yes'}},{action:'set_state',input:{on:true,unknown:1}}])assert.equal((await call('/operations',{entityId:light.id,...body,idempotencyKey:randomUUID()})).status,400);checks++;
    });
    await t.test('cloud outage permits one bounded pre-approved routine and reconciles evidence',async()=>{
      await call('/entities/'+light.id,{actions:{set_state:'autonomous'},offline:{action:'set_state',input:{on:false},maxUses:1,expiresAt:Date.now()+60000}},lab.sessionToken,'PATCH');
      await until(()=>lab.gateway.state.configuration.entities.find(e=>e.entityId===light.id).offline,'cached offline grant');
      lab.gateway.closed=true;lab.gateway.socket.terminate();await until(()=>!lab.gateway.connected,'cloud disconnected');
      const offline=await lab.gateway.offline('lab-switch');await until(()=>lab.simulator.state.operations[offline.operationId]?.status==='completed','offline device outcome');await assert.rejects(()=>lab.gateway.offline('lab-switch'),{status:403});
      lab.gateway.closed=false;lab.gateway.connect();await until(()=>lab.plane.state.operations[offline.operationId]?.status==='completed','offline reconciliation');checks++;
    });
    await t.test('MQTT scope rejects cross-site publishing and subscription',async()=>{
      const c=mqtt.connect(lab.broker.url,{username:'gateway',password:lab.mqttConfig.password,reconnectPeriod:0});c.on('error',()=>{});await new Promise(r=>c.once('connect',r));
      try{await assert.rejects(()=>c.subscribeAsync('flolah/physical/another-tenant/site/hub/+/event'));}finally{await c.endAsync();}checks++;
    });
    await t.test('gateway restart reconciles pending work without replaying the command',async()=>{
      lab.simulator.control('lab-switch',{mode:'normal',delayMs:500});
      const o=await invoke(light,'set_state',{on:true},3000);await until(()=>current(o).status==='accepted','accepted before restart');
      await lab.restartGateway();await until(()=>lab.gateway.connected,'gateway recovered');
      await until(()=>current(o).status==='completed','post-restart observed outcome');
      assert.equal(lab.simulator.state.operations[o.id].sideEffects,1);
      assert.ok(lab.gateway.state.journal[o.id]);lab.simulator.control('lab-switch',{delayMs:50});checks++;
    });
    await t.test('expired authority is rejected locally even with an enrolled hub',async()=>{
      const e=lab.gateway.state.configuration.entities.find(e=>e.entityId===light.id);
      await assert.rejects(()=>lab.gateway.execute({id:randomUUID(),entityId:e.id,action:'set_state',input:{on:false},descriptionHash:e.descriptionHash,policyVersion:e.policyVersion,authorized:true,expiresAt:Date.now()-1}),{status:403});checks++;
    });
    await t.test('local simulator control requires token and rejects cross-origin writes',async()=>{
      assert.equal((await fetch(lab.uiUrl+'/status')).status,401);
      assert.equal((await fetch(lab.uiUrl+'/simulator/control',{method:'POST',headers:{Authorization:'Bearer '+lab.localToken,Origin:'https://other.invalid','Content-Type':'application/json'},body:JSON.stringify({deviceId:'lab-switch',mode:'normal'})})).status,403);checks++;
    });
    await t.test('revoked hub cannot reconnect or receive additional work',async()=>{
      await call('/hubs/'+lab.hub.hubId+'/revoke',{});await until(()=>!lab.gateway.connected,'hub revoked');assert.throws(()=>lab.plane.authenticate(lab.hub.hubId,lab.hub.token),{status:401});
      const r=await call('/operations',{entityId:light.id,action:'set_state',input:{on:true},idempotencyKey:randomUUID()});assert.equal(r.status,403);checks++;
    });
    console.log(JSON.stringify({stage:'PHYSICAL_PHASE1_ACCEPTANCE',checks,transports:['HTTP','WebSocket','MQTT'],hardware:'simulated',productionStateTouched:false}));
  }finally{await lab.close();rmSync(dir,{recursive:true,force:true});}
});
