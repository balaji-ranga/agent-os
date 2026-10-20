import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createTaskClient} from '../web/task-client.mjs';

function fixture(t,{failRelay=false}={}){
 const original=globalThis.WebSocket,events=[],requests=[],sockets=[];let proof='saved-proof',tickets=0;
 class Socket {
  readyState=0;
  constructor(){sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.();});}
  send(text){const data=JSON.parse(text);if(data.type==='authenticate')queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({type:'connected'})}));}
  close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.();}
  message(data){this.onmessage({data:JSON.stringify(data)});}
 }
 globalThis.WebSocket=Socket;
 const client=createTaskClient({service:'https://service.test/',inspect:()=>({}),execute:async()=>[],onEvent:e=>events.push(e),resumeStore:{read:()=>proof,write:p=>proof=p,clear:()=>proof=null,persist:()=>{}},request:async(path,input)=>{
  requests.push({path,input});
  if(path==='/v1/live/ticket')return {ticket:'one-use',instanceId:'instance-'+(++tickets),resumeProof:'saved-proof',heartbeatMs:60000,paired:true};
  if(path==='/v1/pair/status')return {groupId:'saved-group',members:[]};
  if(path==='/v1/tasks/start')return {taskId:'old-task'};
  if(path==='/v1/tasks/relay'){
   if(failRelay)throw Object.assign(new Error('Ended'),{code:'TASK_ENDED'});
   return {shared:true,taskId:'new-task',context:[]};
  }
  return {};
 }});
 t.after(()=>{client.close();globalThis.WebSocket=original;});
 return {client,events,requests,sockets};
}
test('fresh relay records returned task scope without a file-start permission request',async t=>{
 const f=fixture(t);await f.client.call('task-relay',{targetId:'recipient',shareConsent:true,instruction:'Inspect'});
 assert.deepEqual(f.client.taskScope,{taskId:'new-task',instanceId:'instance-1'});
 assert.equal(f.requests.some(r=>r.path==='/v1/tasks/start'),false);
 assert.equal(f.events.filter(e=>e.type==='task-active').length,1);
});
test('ended task clears stale scope but preserves pairing and never retries the handoff',async t=>{
 const f=fixture(t,{failRelay:true});await f.client.call('task-start');
 await assert.rejects(f.client.call('task-relay',{targetId:'recipient',shareConsent:true}),{code:'TASK_ENDED'});
 assert.equal(f.client.taskScope,null);assert.equal(f.sockets[0].readyState,1);
 assert.equal(f.requests.filter(r=>r.path==='/v1/tasks/relay').length,1);
 assert.equal(f.events.at(-1).type,'task-ended');
 await f.client.call('pair-status');assert.equal(f.requests.filter(r=>r.path==='/v1/live/ticket').length,1);
});
test('dropped socket restores saved pairing automatically without resending any task command',async t=>{
 const f=fixture(t);await f.client.call('task-relay',{targetId:'recipient',shareConsent:true});
 f.sockets[0].close();assert.equal(f.client.taskScope,null);
 await delay(1200);
 assert.equal(f.sockets.length,2);assert.equal(f.requests.filter(r=>r.path==='/v1/tasks/relay').length,1);
 assert.equal(f.events.at(-1).type,'pairing-restored');assert.equal(f.events.at(-1).status.groupId,'saved-group');
 assert.equal(f.requests.filter(r=>r.path==='/v1/live/ticket').at(-1).input.resumeProof,'saved-proof');
});
test('destroy cancels pending reconnect and ended messages for other tasks do not clear current task',async t=>{
 const f=fixture(t);await f.client.call('task-start');f.sockets[0].message({type:'task-ended',taskId:'other'});
 assert.equal(f.client.taskId,'old-task');f.sockets[0].close();f.client.close();await delay(1200);
 assert.equal(f.sockets.length,1);
});
