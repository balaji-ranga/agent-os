import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {createOperationalTelemetry} from '../src/operational-telemetry.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {openRepository} from '../src/repository.mjs';
import {createProposalStore} from '../src/proposals.mjs';

test('HTTP operational events correlate failures and success without bodies, tokens, URLs or raw scope identifiers',async()=>{
 const events=[],telemetry=createOperationalTelemetry({emit:event=>events.push(event)}),authority=new SessionAuthority(),origin='https://fixture.test',installation=authority.registerApproved({embeddingId:'private-fixture',origins:[origin],expiresAt:Date.now()+600000});
 for(const path of ['/v1/analytics/consent','/v1/analytics/events','/v1/owner/manage/pairing-policy','/v1/manage/analytics-report'])assert.notEqual(telemetry.operation(path),'unknown');
 const server=createAdoptionServer({authority,telemetry});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const post=(path,body,token)=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 try{
  const initialized=await post('/v1/sessions',installation),session=await initialized.json();assert.match(initialized.headers.get('x-adoption-request-id'),/^[a-f0-9-]{36}$/);
  const success=await post('/v1/messages',{text:'PRIVATE_CHAT_CANARY'},session.sessionToken);assert.equal(success.status,200);
  assert.equal((await post('/v1/history',{},'dac_session_FAKE_PRIVATE_CREDENTIAL')).status,403);
  assert.equal((await post('/v1/PRIVATE_URL_CANARY',{password:'PRIVATE_BODY_CANARY'},session.sessionToken)).status,404);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(events.length,4);assert.equal(events[1].operation,'messages');assert.equal(events[2].code,'REQUEST_DENIED');assert.equal(events[3].operation,'unknown');assert.match(events[1].session,/^sha256:/);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_|private-fixture|dac_session_|Bearer|password|fixture\.test/);
  telemetry.job({embeddingId:'private-fixture',jobId:'job-one',state:'failed',attempts:2});assert.equal(events.at(-1).event,'alert');assert.equal(events.at(-1).code,'INGESTION_FAILED');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('malformed absolute request URLs cannot escape the server error boundary',async()=>{
 const server=createAdoptionServer({authority:new SessionAuthority()});server.listen(0,'127.0.0.1');await once(server,'listening');
 try{const status=await new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:'http://[invalid',method:'GET'},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(status,400);const healthy=await fetch('http://127.0.0.1:'+server.address().port+'/health');assert.equal(healthy.status,200);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('a model outage returns a recoverable service failure without preparing actions or retrying',async()=>{
 const repository=openRepository(),authority=new SessionAuthority({repository}),origin='https://fixture.test',installation=authority.registerApproved({embeddingId:'outage-fixture',origins:[origin],expiresAt:Date.now()+600000});let failed=true,calls=0;
 const server=createAdoptionServer({authority,proposals:createProposalStore(repository),planner:async()=>{calls++;if(failed)throw new Error('Platform model unavailable');return {message:'Review',actions:[{type:'fill',ref:'r1f0',value:'Requested'}]};}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const post=(path,body,session)=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.sessionToken}:{})},body:JSON.stringify(body)});
 try{const session=await(await post('/v1/sessions',installation)).json(),task={text:'Prepare the requested value',snapshot:{revision:1,path:'/form',fields:[{ref:'r1f0',key:'name',label:'Name',type:'text'}],links:[]}};
  const outage=await post('/v1/plan',task,session);assert.equal(outage.status,503);assert.equal(outage.headers.get('access-control-allow-origin'),origin);assert.equal(repository.map('proposals').values().length,0);assert.equal(calls,1);
  failed=false;const recovered=await post('/v1/plan',task,session);assert.equal(recovered.status,200);assert.equal((await recovered.json()).actions.length,1);assert.equal(calls,2);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repository.close();}
});
