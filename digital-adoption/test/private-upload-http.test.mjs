import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {createPrivateTasks} from '../src/private-tasks.mjs';
import {createUploadAdmission} from '../src/upload-admission.mjs';
const origin='http://127.0.0.1:4194';
async function fixture(t,limits={},fileBytes=1024){
 const root=await mkdtemp(join(tmpdir(),'private-upload-http-'));let now=Date.now();const guard=createUploadAdmission({clock:()=>now,limits}),authority=new SessionAuthority({development:true}),site={id:'upload-site',organizationId:'owner',origin,verified:true,status:'approved',taskPolicy:{attachments:true,limits:{fileBytes}}};
 const tasks=await createPrivateTasks({root,website:()=>site,activeScope:s=>authority.activeScope(s),uploadAdmission:guard}),server=createAdoptionServer({authority,privateTasks:tasks,uploadAdmission:guard,taskWebsite:()=>site});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const make=()=>{const installation=authority.registerApproved({embeddingId:site.id,origins:[origin],expiresAt:Date.now()+60000}),session=authority.initialize({...installation,origin}),scope=authority.context({sessionToken:session.sessionToken,origin}),ticket=tasks.ticket(scope,{});tasks.connect(ticket.ticket,origin,()=>{});const task=tasks.start(scope,{instanceId:ticket.instanceId});return {session,scope,input:{instanceId:ticket.instanceId,taskId:task.taskId,filename:'transaction.txt',mime:'text/plain',content:Buffer.from('Synthetic task document').toString('base64'),operationId:crypto.randomUUID()}};};
 const post=(client,input=client.input,extra={})=>fetch(base+'/v1/tasks/upload',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+client.session.sessionToken,...extra},body:JSON.stringify(input)});
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await tasks.close();await rm(root,{recursive:true,force:true});});return {tasks,guard,base,make,post,advance:ms=>now+=ms,site};
}
test('visitor private upload succeeds with shared-upload capability false; cooldown and retained quota resist remove/task/session churn',async t=>{
 const f=await fixture(t,{websiteFiles:1}),a=f.make();assert.equal(a.scope.capabilities.upload,false);let response=await f.post(a);assert.equal(response.status,200);const file=await response.json();
 response=await f.post(a,{...a.input,operationId:crypto.randomUUID()});assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'5');assert.equal((await response.json()).code,'UPLOAD_COOLDOWN');
 f.tasks.remove(a.scope,{...a.input,attachmentId:file.id});f.tasks.end(a.scope,a.input);f.advance(5000);const b=f.make();response=await f.post(b);assert.equal(response.status,429);assert.equal((await response.json()).code,'UPLOAD_BUDGET_EXCEEDED');assert.equal(f.tasks.metrics().privateJobs,0);
});
test('lower website size limit is enforced before a declared or chunked large body can reach storage',async t=>{
 const f=await fixture(t,{cooldownMs:0}),a=f.make();let response=await f.post(a,{...a.input,content:'A'.repeat(20000)});assert.equal(response.status,413);
 const outcome=await new Promise(resolve=>{const req=request(f.base+'/v1/tasks/upload',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+a.session.sessionToken,'Transfer-Encoding':'chunked'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',()=>resolve('closed'));req.write('{"content":"');req.end('A'.repeat(20000)+'"}');});assert.ok([413,'closed'].includes(outcome));assert.equal(f.tasks.metrics().privateJobs,0);response=await f.post(a);assert.equal(response.status,200);
});
test('slow upload body is terminated at an absolute deadline and releases its global slot',async t=>{
 const f=await fixture(t,{cooldownMs:0,concurrentUploads:1,readTimeoutMs:100}),a=f.make(),started=Date.now();
 await new Promise((resolve,reject)=>{const req=request(f.base+'/v1/tasks/upload',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+a.session.sessionToken,'Content-Length':'1000'}},res=>{res.resume();reject(new Error('Incomplete request unexpectedly completed '+res.statusCode));});req.on('error',()=>resolve());req.flushHeaders();req.write('{');});assert.ok(Date.now()-started<2000);const response=await f.post(a);assert.equal(response.status,200);assert.equal(f.tasks.metrics().privateJobs,1);
});
test('forged forwarded addresses cannot bypass the network upload budget and a bounded parser queue refuses more work',async t=>{
 const f=await fixture(t,{cooldownMs:0,networkRequests:1}),a=f.make(),b=f.make();let response=await f.post(a,a.input,{'X-Forwarded-For':'192.0.2.1'});assert.equal(response.status,200);response=await f.post(b,b.input,{'X-Forwarded-For':'192.0.2.2'});assert.equal(response.status,429);assert.equal((await response.json()).code,'UPLOAD_RATE_LIMIT');
 const queued=await fixture(t,{cooldownMs:0,maxQueuedFiles:1}),first=queued.make(),second=queued.make();assert.equal((await queued.post(first)).status,200);response=await queued.post(second);assert.equal(response.status,429);assert.equal((await response.json()).code,'UPLOAD_QUEUE_FULL');
});
test('nested upload aliases are refused before reading the body and cannot bypass network admission',async t=>{
 const f=await fixture(t,{cooldownMs:0,networkRequests:1}),a=f.make();
 for(const path of ['/v1/tasks/anything/upload','/v1/tasks//upload','/v1/pair/upload','/v1/tasks/constructor']){
  const response=await fetch(f.base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+a.session.sessionToken},body:JSON.stringify(a.input)});assert.equal(response.status,403);
 }
 assert.equal(f.tasks.metrics().privateJobs,0);assert.equal((await f.post(a)).status,200);
 const b=f.make(),response=await f.post(b);assert.equal(response.status,429);assert.equal((await response.json()).code,'UPLOAD_RATE_LIMIT');
});
test('removed-file operation IDs cannot be reused to bypass retained quotas; live retries remain idempotent',async t=>{
 const f=await fixture(t,{cooldownMs:0,sessionFiles:1}),a=f.make(),first=await f.post(a);assert.equal(first.status,200);const file=await first.json();
 const retry=await f.post(a);assert.equal(retry.status,200);assert.equal((await retry.json()).id,file.id);
 f.tasks.remove(a.scope,{...a.input,attachmentId:file.id});
 for(const input of [a.input,{...a.input,content:Buffer.from('Different transaction file').toString('base64')}]){const response=await f.post(a,input);assert.equal(response.status,403);assert.equal((await response.json()).code,'OPERATION_CONFLICT');}
 const response=await f.post(a,{...a.input,operationId:crypto.randomUUID()});assert.equal(response.status,429);assert.equal((await response.json()).code,'UPLOAD_BUDGET_EXCEEDED');assert.equal(f.tasks.metrics().privateJobs,0);
});
