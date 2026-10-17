import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createAdoptionServer} from '../src/server.mjs';

test('large upload is authorized before buffering and derives scope/capability from runtime credentials',async()=>{
 const authority=new SessionAuthority({development:true});
 const installation=authority.registerApproved({embeddingId:'upload-http',origins:['http://127.0.0.1'],expiresAt:Date.now()+60_000});
 const session=authority.initialize({...installation,origin:'http://127.0.0.1'});let received;
 const ingestion={upload:async(scope,input)=>{received={scope,input};return {id:'accepted',status:'queued'};}};
 const server=createAdoptionServer({authority,ingestion});server.listen(0,'127.0.0.1');await once(server,'listening');
 const post=(path,input,token=session.sessionToken)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{Origin:'http://127.0.0.1','Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(input)});
 try{
  assert.equal((await post('/v1/knowledge/upload',{content:'A'.repeat(50_000),capabilities:{upload:true}})).status,403);assert.equal(received,undefined);
  authority.setUploadPolicy('upload-http',true);
  assert.equal((await post('/v1/knowledge/upload',{content:'A'.repeat(50_000),embeddingId:'foreign',index:'foreign'})).status,200);
  assert.equal(received.scope.embeddingId,'upload-http');assert.equal(received.scope.sessionId,session.sessionId);
  authority.setUploadPolicy('upload-http',false);assert.equal((await post('/v1/knowledge/upload',{})).status,403);
  assert.equal((await post('/v1/knowledge/upload',{},'forged')).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
