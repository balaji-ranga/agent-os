import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionClient} from '../web/session-client.mjs';
test('same-tab restore validates and rotates its credential before requesting history',async()=>{
 let saved={sessionId:'same',sessionToken:'old',expiresAt:100,sessionExpiresAt:200},calls=[];const store={read:()=>saved,write:v=>saved=v,clear:()=>saved=null},client=createSessionClient({service:'https://copilot.test/',sessionStore:store,clock:()=>1,fetchImpl:async(url,o)=>{calls.push({path:url.pathname,token:o.headers.Authorization,data:JSON.parse(o.body)});return new Response(JSON.stringify(url.pathname==='/v1/renew'?{sessionId:'same',sessionToken:'rotated',expiresAt:101,sessionExpiresAt:200}:{messages:[]}));}});
 await client.resume({identityToken:'current-host-proof'});await client.request('/v1/history');assert.equal(calls[0].path,'/v1/renew');assert.equal(calls[0].data.identityToken,'current-host-proof');assert.equal(calls[1].token,'Bearer rotated');assert.equal(saved.sessionToken,'rotated');
});
test('expired or denied tab restore does not revive its previous session',async()=>{
 for(const expiresAt of [0,100]){let saved={sessionId:'old',sessionToken:'old',expiresAt,sessionExpiresAt:200},calls=0;const client=createSessionClient({service:'https://copilot.test/',sessionStore:{read:()=>saved,clear:()=>saved=null},clock:()=>1,fetchImpl:async()=>{calls++;return new Response('{}',{status:403});}});assert.equal(await client.resume(),null);assert.equal(saved,null);assert.equal(calls,expiresAt?1:0);}
});
test('transport failure during tab restore preserves proof and never creates a replacement session',async()=>{
 let saved={sessionId:'same',sessionToken:'old',expiresAt:100,sessionExpiresAt:200},calls=0;const client=createSessionClient({service:'https://copilot.test/',sessionStore:{read:()=>saved,clear:()=>saved=null},clock:()=>1,fetchImpl:async()=>{calls++;throw new TypeError('offline');}});await assert.rejects(client.resume(),/interrupted/);assert.equal(saved.sessionId,'same');assert.equal(calls,1);
});
test('network-lost bootstrap retries once with the same high-entropy key; instances differ',async()=>{
 const seen=[];let count=0;
 const fetchImpl=async(url,options)=>{seen.push(JSON.parse(options.body).initializationKey);if(count++===0)throw new TypeError('response lost');return {ok:true,json:async()=>({sessionId:'one',sessionToken:'token',expiresAt:9999999999999,sessionExpiresAt:9999999999999})};};
 await createSessionClient({service:'https://copilot.example/',fetchImpl}).request('/v1/sessions',{});
 await createSessionClient({service:'https://copilot.example/',fetchImpl}).request('/v1/sessions',{});
 assert.match(seen[0],/^[a-f0-9]{64}$/);assert.equal(seen[0],seen[1]);assert.notEqual(seen[1],seen[2]);
});
test('renewal serializes subsequent requests and stop cancels queued work',async()=>{
 let release,received=[];
 const client=createSessionClient({service:'https://copilot.example/',clock:()=>1,fetchImpl:async(url,options)=>{
  received.push({path:url.pathname,authorization:options.headers.Authorization});
  if(url.pathname==='/v1/renew')await new Promise(resolve=>{release=resolve;});
  return {ok:true,json:async()=>({sessionId:'one',sessionToken:url.pathname==='/v1/renew'?'new':'old',expiresAt:1000,sessionExpiresAt:2000})};
 }});
 await client.request('/v1/sessions');
 const renewal=client.request('/v1/renew'),history=client.request('/v1/history');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(received.length,2);
 release();await renewal;await history;assert.equal(received[2].authorization,'Bearer new');
 client.stop();await assert.rejects(client.request('/v1/approve'),/stopped/);assert.equal(received.length,3);
});
test('expired token cannot send an action or silently initialize a replacement',async()=>{
 let now=1,calls=0;
 const client=createSessionClient({service:'https://copilot.example/',clock:()=>now,fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({sessionId:'one',sessionToken:'token',expiresAt:2,sessionExpiresAt:3})};}});
 await client.request('/v1/sessions');now=2;
 await assert.rejects(client.request('/v1/approve'),/expired/);assert.equal(calls,1);
});

test('interrupting an observer unblocks queued pause without retrying or interrupting approvals',async()=>{
 let began,calls=[];const observing=new Promise(resolve=>began=resolve);
 const client=createSessionClient({service:'https://copilot.example/',clock:()=>1,fetchImpl:async(url,options)=>{
  calls.push(url.pathname);
  if(url.pathname==='/v1/discovery/next'){began();await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));}
  if(url.pathname==='/v1/approve')assert.equal(client.interruptRead(),false);
  return {ok:true,json:async()=>({sessionId:'one',sessionToken:'credential',expiresAt:1000,sessionExpiresAt:2000})};
 }});
 await client.request('/v1/sessions');
 const pending=client.request('/v1/discovery/next');const rejected=assert.rejects(pending,{name:'AbortError',code:'TASK_CANCELLED'});await observing;
 const pause=client.request('/v1/discovery/pause');assert.equal(client.interruptRead(),true);await rejected;await pause;await client.request('/v1/approve');
 assert.deepEqual(calls,['/v1/sessions','/v1/discovery/next','/v1/discovery/pause','/v1/approve']);
});

test('temporary service failure is distinct from authorization failure and is never automatically retried',async()=>{
 let calls=0;const client=createSessionClient({service:'https://copilot.example/',fetchImpl:async()=>{calls++;return {ok:false,status:503};}});
 await assert.rejects(client.request('/v1/plan'),/temporarily unavailable/);assert.equal(calls,1);
});

test('a disconnected approval is not retried or described as a confirmed failure',async()=>{
 let calls=0;const client=createSessionClient({service:'https://copilot.example/',fetchImpl:async()=>{calls++;throw new TypeError('Failed to fetch');}});
 await assert.rejects(client.request('/v1/approve'),/connection was interrupted.*Check the current task/);assert.equal(calls,1);
});

test('an unrequested fetch abort is a visible connection interruption, not intentional task cancellation',async()=>{
 const client=createSessionClient({service:'https://copilot.example/',fetchImpl:async()=>{throw Object.assign(new Error('signal is aborted without reason'),{name:'AbortError'});}});
 await assert.rejects(client.request('/v1/approve'),error=>error.code!=='TASK_CANCELLED'&&/connection was interrupted.*Check the current task/.test(error.message));
});
