import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {attachLiveTransport} from '../src/live-transport.mjs';

async function fixture(t,options={}){
 let beats=0,authorized=true,disconnected=0;
 const tasks={limits:{instances:4,heartbeatMs:25,staleMs:150},connect:()=> 'synthetic-instance',heartbeat(){if(!authorized)throw new Error('SESSION_ENDED');beats++;return {type:'heartbeat'};},disconnect(){disconnected++;},maintain(){},cleanup:async()=>{}};
 const server=createServer();attachLiveTransport(server,{tasks});server.listen(0,'127.0.0.1');await once(server,'listening');
 const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/v1/live`,{origin:'https://synthetic.test',...options});
 t.after(async()=>{ws.terminate();await new Promise(resolve=>server.close(resolve));});
 await once(ws,'open');ws.send(JSON.stringify({type:'authenticate',ticket:'synthetic-one-use-ticket'}));await once(ws,'message');
 return {ws,get beats(){return beats;},get disconnected(){return disconnected;},revoke(){authorized=false;}};
}

test('background client stays transport-online without any JavaScript heartbeat; revocation still closes it',async t=>{
 const f=await fixture(t);await delay(220);assert.ok(f.beats>=3);assert.equal(f.ws.readyState,WebSocket.OPEN);
 const closed=once(f.ws,'close');f.revoke();await closed;assert.equal(f.ws.readyState,WebSocket.CLOSED);await delay(10);assert.equal(f.disconnected,1);
});

test('missing protocol pong is bounded and unsolicited pong cannot refresh presence',async t=>{
 const f=await fixture(t,{autoPong:false});f.ws.on('ping',()=>f.ws.pong('unmatched-probe'));
 await once(f.ws,'close');assert.equal(f.beats,0);await delay(10);assert.equal(f.disconnected,1);
});
