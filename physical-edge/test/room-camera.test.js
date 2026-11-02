import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {siteSimulator} from '../src/site-simulator.js';import {fingerprint} from '../../backend/src/services/physical/contracts.js';
const store=initial=>{let s=structuredClone(initial);return {load:()=>structuredClone(s),save:v=>{s=structuredClone(v);}};};
const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out');};
test('camera capture traverses authenticated MQTT, follows virtual TV pixels and replays one durable frame',async()=>{
 const hubId=randomUUID(),lab=await siteSimulator({hub:{hubId,siteId:'fixture'}},(_,initial)=>store(initial)),events=[];
 try{
  await lab.adapter.start();lab.adapter.on('event',e=>events.push(e));await until(()=>lab.adapter.discover().length===5);
  const description=lab.adapter.describe('virtual-camera');
  const command=()=>({id:randomUUID(),entityId:'virtual-camera',action:'capture',input:{},authorized:true,descriptionHash:fingerprint(description),expiresAt:Date.now()+5000});
  const capture=async c=>{await lab.adapter.invokeAction(c);await until(()=>events.some(e=>e.operationId===c.id&&e.attachments?.length));return events.find(e=>e.operationId===c.id&&e.attachments?.length);};
  lab.simulator.control('virtual-tv',{on:true});const c=command(),first=await capture(c);assert.equal(first.attachments[0].kind,'simulator_snapshot');assert.equal(first.value,true);
  const bytes=Buffer.from(first.attachments[0].data,'base64');assert.equal(bytes.readUInt32BE(16),640);assert.ok(!bytes.includes(Buffer.from('tEXt')));
  lab.simulator.control('virtual-tv',{on:false});const second=await capture(command());assert.notEqual(second.attachments[0].data,first.attachments[0].data);
  events.length=0;const replay=await capture(c);assert.equal(replay.attachments[0].data,first.attachments[0].data);assert.equal(lab.simulator.state.operations[c.id].sideEffects,1);
  lab.simulator.control('virtual-camera',{scene:'unknown'});const hidden=await capture(command());assert.notEqual(hidden.attachments[0].data,second.attachments[0].data);
  assert.throws(()=>lab.simulator.control('virtual-camera',{on:true}));assert.throws(()=>lab.simulator.control('virtual-tv',{scene:'on'}));
 }finally{await lab.adapter.close();await lab.simulator.close();await lab.broker.close();}
});

