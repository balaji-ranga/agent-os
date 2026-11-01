import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import mqtt from 'mqtt';
import { startTestBroker } from '../src/test-broker.js';
import { topicRoot } from '../src/mqtt-adapter.js';
import { Simulator } from '../src/simulator.js';
import { HomeAssistantAdapter } from '../src/home-assistant-adapter.js';
import { fingerprint } from '../../backend/src/services/physical/contracts.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await wait(20);}throw Error('Fixture condition timed out');}

test('Home Assistant wire contract uses authenticated calls and independent MQTT observations', {timeout:15000}, async()=>{
  const scope={tenantId:randomUUID(),siteId:'test-site',hubId:randomUUID()},root=topicRoot(scope),password=randomUUID();
  const broker=await startTestBroker({simulator:{password,root,role:'simulator',discoveryPrefix:scope.hubId},ha:{password,root,role:'home-assistant',discoveryPrefix:scope.hubId}});
  let persisted={devices:{},operations:{}};const simulator=new Simulator({...scope,url:broker.url,username:'simulator',password},{load:()=>persisted,save:v=>{persisted=structuredClone(v);}});
  simulator.add('fixture-switch','switch');await simulator.start();
  const http=createServer();const ws=new WebSocketServer({server:http,path:'/api/websocket'});await new Promise(r=>http.listen(0,'127.0.0.1',r));
  const client=mqtt.connect(broker.url,{username:'ha',password,reconnectPeriod:0});client.on('error',()=>{});await new Promise(r=>client.once('connect',r));await client.subscribeAsync(root+'/fixture-switch/ha/state');
  let state={entity_id:'switch.fixture',state:'off',attributes:{assumed_state:false},last_updated:new Date().toISOString()},serviceCalls=0;
  client.on('message',(_,payload)=>{state={...state,state:payload.toString()==='ON'?'on':'off',last_updated:new Date().toISOString()};for(const s of ws.clients)if(s.authenticated&&s.subscribed)s.send(JSON.stringify({type:'event',event:{event_type:'state_changed',data:{new_state:state}}}));});
  ws.on('connection',socket=>{
    socket.send(JSON.stringify({type:'auth_required'}));socket.on('message',bytes=>{
      const m=JSON.parse(bytes);if(m.type==='auth'){socket.authenticated=m.access_token===password;socket.send(JSON.stringify({type:socket.authenticated?'auth_ok':'auth_invalid'}));return;}
      if(!socket.authenticated)return socket.close();
      if(m.type==='subscribe_events'){socket.subscribed=true;socket.send(JSON.stringify({id:m.id,type:'result',success:true,result:null}));}
      if(m.type==='get_states')socket.send(JSON.stringify({id:m.id,type:'result',success:true,result:[state]}));
      if(m.type==='call_service'){serviceCalls++;assert.equal(m.domain,'switch');assert.equal(m.target.entity_id,'switch.fixture');client.publish(root+'/fixture-switch/ha/set',m.service==='turn_on'?'ON':'OFF');socket.send(JSON.stringify({id:m.id,type:'result',success:true,result:{context:{id:randomUUID()}}}));}
    });
  });
  const config={url:'http://127.0.0.1:'+http.address().port,token:password,entities:[{id:'ha-switch',haEntityId:'switch.fixture',profile:'switch',simulated:true}]};
  let adapter,bad;
  try{
    bad=new HomeAssistantAdapter({...config,token:'wrong'});await assert.rejects(()=>bad.start());await bad.close();bad=null;
    adapter=new HomeAssistantAdapter(config);const events=[];adapter.on('event',e=>events.push(e));await adapter.start();
    const command={id:randomUUID(),entityId:'ha-switch',action:'set_state',input:{on:true},authorized:true,descriptionHash:fingerprint(adapter.describe('ha-switch')),expiresAt:Date.now()+2000};
    await adapter.invokeAction(command);await until(()=>events.some(e=>e.operationId===command.id&&e.value===true));assert.equal(serviceCalls,1);assert.equal(simulator.state.devices['fixture-switch'].values.on,true);
    assert.equal(adapter.pending.size,0,'Observed completion releases the adapter for the next operation');
    simulator.control('fixture-switch',{mode:'accepted_only'});const silent={...command,id:randomUUID(),input:{on:false},expiresAt:Date.now()+150};await adapter.invokeAction(silent);await wait(200);assert.ok(!events.some(e=>e.operationId===silent.id&&e.value===false));
    state={...state,state:'off',attributes:{assumed_state:true},last_updated:new Date().toISOString()};adapter.observe(state);assert.ok(!events.some(e=>e.operationId===silent.id&&e.value===false));
    console.log('HA_WIRE_CONTRACT_PASS: authenticated adapter, real MQTT simulator, observed-state completion, optimistic-state rejection. HA server is an explicit protocol fixture.');
  }finally{await bad?.close();await adapter?.close();for(const socket of ws.clients)socket.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>http.close(r));await client.endAsync();await simulator.close();await broker.close();}
});
