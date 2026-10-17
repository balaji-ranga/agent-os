import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {createManagementIdentity} from '../src/management-identity.mjs';
test('bootstrap rate limits remain readable and do not create duplicate sessions',async()=>{
 const authority=new SessionAuthority(),origin='https://fixture.test',installation=authority.registerApproved({embeddingId:'rate-fixture',origins:[origin],expiresAt:Date.now()+600000}),server=createAdoptionServer({authority});server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port+'/v1/sessions';let id;
 try{for(let i=0;i<=60;i++){const response=await fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({...installation,initializationKey:'a'.repeat(64)})});assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.status,i===60?429:200);const data=await response.json();if(i===0)id=data.sessionId;else if(i<60)assert.equal(data.sessionId,id);else assert.deepEqual(data,{error:'Access denied or invalid request'});}}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('identity outage or unreadable identity data cannot become an authentication denial or anonymous role',async()=>{
 for(const fetchImpl of [async()=>{throw new TypeError('PRIVATE_ENDPOINT');},async()=>({status:503,ok:false}),async()=>({status:200,ok:true,json:async()=>{throw new Error('PRIVATE_RESPONSE');}})]){
  const identify=createManagementIdentity({platformOrigin:'https://fixture.test',fetchImpl});await assert.rejects(identify('Bearer '+'a'.repeat(32)),{message:'Management identity unavailable'});
 }
 const denied=createManagementIdentity({platformOrigin:'https://fixture.test',fetchImpl:async()=>({status:401,ok:false})});await assert.rejects(denied('Bearer '+'a'.repeat(32)),{message:'Management authentication required'});
});
