import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request} from 'node:http';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {openRepository} from '../src/repository.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {createManagement} from '../src/management.mjs';

test('visitor, legacy upload flag, coach and forged role cannot upload shared knowledge before body bytes arrive',async()=>{
 const origin='http://127.0.0.1',authority=new SessionAuthority({development:true}),installation=authority.registerApproved({embeddingId:'upload-http',origins:[origin],expiresAt:Date.now()+60000,visitorUploads:true}),session=authority.initialize({...installation,origin});let received=0;
 const server=createAdoptionServer({authority,ingestion:{upload:async()=>{received++;return {id:'must-not-be-created'};}}});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{
  authority.setUploadPolicy('upload-http',true);assert.equal(authority.context({sessionToken:session.sessionToken,origin}).capabilities.upload,false);
  for(const token of [session.sessionToken,'forged']){const r=await fetch(base+'/v1/knowledge/upload',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({content:'A'.repeat(50000),role:'maintainer',capabilities:{upload:true}})});assert.equal(r.status,403);assert.equal((await r.json()).code,'OWNER_KNOWLEDGE_UPLOAD_REQUIRED');}
  authority.grantCoaching({sessionToken:session.sessionToken,origin},{embeddingId:'upload-http',origin,expiresAt:Date.now()+30000});assert.equal(authority.context({sessionToken:session.sessionToken,origin}).capabilities.coach,true);assert.equal(authority.context({sessionToken:session.sessionToken,origin}).capabilities.upload,false);
  const status=await new Promise((resolve,reject)=>{const req=request(base+'/v1/knowledge/upload',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Content-Length':'22000000',Authorization:'Bearer '+session.sessionToken}},res=>{res.resume();resolve(res.statusCode);req.destroy();});req.on('error',e=>{if(e.code!=='ECONNRESET')reject(e);});req.setTimeout(2000,()=>{req.destroy();reject(new Error('Unauthorized upload waited for its body'));});req.flushHeaders();});assert.equal(status,403);assert.equal(received,0);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('authenticated Flolah and owner management preserve website ownership for shared file uploads',async()=>{
 const origin='http://127.0.0.1',repo=openRepository(),authority=new SessionAuthority({repository:repo,development:true}),owner={id:'owner-a',organizationId:'owner-a',role:'owner'},control=createControlPlane(repo,authority),seen=[];
 for(const [id,organizationId]of [['owned','owner-a'],['foreign','owner-b']])repo.map('websites').set(id,{id,organizationId,origin:'https://example.test',verified:true,status:'approved',installations:[]});
 const ingestion={upload:async(scope,input)=>{seen.push({scope,input});return {id:'queued-source',status:'queued'};}},handler=authenticate=>createManagement({authenticate,control,ingestion,platformOrigin:origin});
 const management=handler(async header=>{if(header!=='Bearer flolah-owner-session')throw Error('Denied');return owner;}),ownerManagement=handler(async cookie=>{if(cookie!=='signed-owner-cookie')throw Error('Denied');return owner;});
 const server=createAdoptionServer({authority,ingestion,management,ownerManagement,ownerIdentity:{},platformOrigin:origin});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`,body={id:'owned',filename:'handbook.txt',mime:'text/plain',title:'Handbook',content:Buffer.from('Owner-reviewed public help').toString('base64'),sharedConsent:true,operationId:crypto.randomUUID()};
 try{for(const path of ['/v1/manage/source-file','/v1/owner/manage/source-file']){
  const headers={Origin:origin,'Content-Type':'application/json',...(path.includes('/owner/')?{Cookie:'signed-owner-cookie'}:{Authorization:'Bearer flolah-owner-session'})};
  let r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,200);
  r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({...body,id:'foreign',organizationId:'owner-a',role:'maintainer'})});assert.equal(r.status,403);
 }
 assert.equal(seen.length,2);for(const {scope}of seen){assert.equal(scope.embeddingId,'owned');assert.equal(scope.role,'maintainer');assert.deepEqual(scope.audienceIds,['public']);}
 const r=await fetch(base+'/v1/manage/source-file',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer visitor-token'},body:JSON.stringify(body)});assert.equal(r.status,403);assert.equal(seen.length,2);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repo.close();}
});
