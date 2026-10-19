import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openRepository} from '../src/repository.mjs';
import {createKnowledgeService} from '../src/knowledge-service.mjs';
import {createSourceIngestion} from '../src/source-ingestion.mjs';
import {createConcurrencyBudget} from '../src/request-budget.mjs';
import {createIngestionWorker} from '../src/ingestion-worker.mjs';

const owner={embeddingId:'distributed-alpha',audienceIds:['public'],role:'maintainer'};
const file={title:'Worker fixture',filename:'fixture.txt',mime:'text/plain',content:Buffer.from('DOMAIN_A_CANARY').toString('base64'),sharedConsent:true};
function childProcess(file,args){
 const child=fork(new URL(file,import.meta.url),args,{stdio:['ignore','ignore','inherit','ipc']}),queue=[],waiters=[],pending=new Map();let seq=0;
 child.on('message',m=>{if(m.rpc){const p=pending.get(m.rpc);pending.delete(m.rpc);m.error?p.reject(new Error(m.error)):p.resolve(m.result);}else{const waiter=waiters.shift();waiter?waiter(m):queue.push(m);}});
 return {child,next:()=>queue.length?Promise.resolve(queue.shift()):new Promise(r=>waiters.push(r)),rpc:(method,...args)=>new Promise((resolve,reject)=>{const rpc=++seq;pending.set(rpc,{resolve,reject});child.send({rpc,method,args});}),stop:async()=>{if(child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}};
}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'adoption-distributed-')),api=childProcess('./fixtures/lifecycle-api.mjs',[join(root,'state.sqlite'),join(root,'objects')]),ready=await api.next(),workers=[];
 const request=async(path,input={},expected=200,extra={})=>{const response=await fetch(ready.workerBase+path,{method:'POST',headers:{Authorization:`Bearer ${ready.workerToken}`,'Content-Type':'application/json',...extra},body:JSON.stringify(input)});assert.equal(response.status,expected,path);return response.json();};
 const upload=async(domain='distributed-alpha',text='DOMAIN_A_CANARY')=>{const install=await api.rpc('install',domain);let response=await fetch(ready.base+'/v1/sessions',{method:'POST',headers:{Origin:'http://127.0.0.1:4194','Content-Type':'application/json'},body:JSON.stringify(install)});const session=await response.json();response=await fetch(ready.base+'/v1/manage/source-file',{method:'POST',headers:{Origin:'http://127.0.0.1:4194','Content-Type':'application/json',Authorization:'Bearer fixture-owner'},body:JSON.stringify({id:domain,...file,content:Buffer.from(text).toString('base64'),operationId:randomUUID()})});assert.equal(response.status,200);return response.json();};
 return {root,api,ready,request,upload,worker:async(id,mode='normal')=>{const w=childProcess('./fixtures/distributed-worker.mjs',[ready.workerBase,ready.workerToken,id,mode]);workers.push(w);await w.next();return w;},close:async()=>{for(const w of workers)await w.stop();await api.stop();await rm(root,{recursive:true,force:true});}};
}
const result=text=>({sections:[{text,locator:'Document'}]});

test('remote worker protocol rejects browser/missing credentials and bounds worker identities',async()=>{
 const f=await fixture();try{
  await f.request('/claim',{workerId:'x'},403,{Authorization:'Bearer invalid'});
  await f.request('/claim',{workerId:'x'},403,{Origin:'http://127.0.0.1:4194'});
  await f.request('/claim',{workerId:'../escape'},409);
  assert.deepEqual(await f.request('/claim',{workerId:'valid-worker'}),{claim:null});
 }finally{await f.close();}
});

test('simultaneous remote claims enforce global/per-domain capacity and durable fairness',async()=>{
 const f=await fixture();try{
  for(let i=0;i<3;i++)await f.upload();await f.upload('distributed-beta','DOMAIN_B_CANARY');await f.upload('distributed-gamma','DOMAIN_C_CANARY');
  const claims=await Promise.all(Array.from({length:8},(_,i)=>f.request('/claim',{workerId:`worker-${i}`})));
  const active=claims.filter(c=>c.claim);assert.equal(active.length,2);assert.equal(new Set(active.map(c=>c.input.content)).size,2);
  await f.api.rpc('start-idle');assert.equal((await f.api.rpc('worker-metrics')).counts.extracting,2);
  for(const task of active)await f.request('/complete',{claim:task.claim,result:result(Buffer.from(task.input.content,'base64').toString())});
  const next=await f.request('/claim',{workerId:'third-worker'});assert.equal(new Set([...active,next].map(c=>c.input.content)).size,3);
 }finally{await f.close();}
});

test('two OS worker processes parse independently; killed worker lease recovers and stale completion is rejected',async()=>{
 const f=await fixture();try{
  const first=await f.upload(),second=await f.upload('distributed-beta','DOMAIN_B_CANARY'),a=await f.worker('process-a','hold'),b=await f.worker('process-b');
  a.child.send({run:true});await a.next();b.child.send({run:true});await b.next();assert.equal((await b.next()).result,true);
  const before=(await f.api.rpc('rows','source_jobs')).find(j=>j.workerId==='process-a');assert.equal(before.status,'extracting');
  await a.stop();assert.equal((await f.api.rpc('recover')).recovered,0);await f.api.rpc('clock',before.leaseUntil+1);assert.equal((await f.api.rpc('recover')).recovered,1);
  b.child.send({run:true});await b.next();assert.equal((await b.next()).result,true);
  await f.request('/complete',{claim:{id:before.id,attemptId:before.attemptId,workerId:before.workerId},result:result('STALE_CANARY')},409);
  const jobs=await f.api.rpc('rows','source_jobs');assert.equal(jobs.find(j=>j.id===before.id).attempts,2);assert.equal(jobs.find(j=>j.id!==before.id).attempts,1);assert.ok(jobs.every(j=>j.status==='ready'));
  const chunks=await f.api.rpc('rows','test_search');assert.equal(chunks.length,2);assert.ok(chunks.every(c=>!c.text.includes('STALE_CANARY')));
 }finally{await f.close();}
});

test('coordinator restart preserves healthy ownership; heartbeats extend only to bounded lifetime and retries dead-letter',async()=>{
 const f=await fixture();let restarted;
 try{
  const source=await f.upload(),task=await f.request('/claim',{workerId:'heartbeat-worker'});await f.api.stop();
  restarted=childProcess('./fixtures/lifecycle-api.mjs',[join(f.root,'state.sqlite'),join(f.root,'objects')]);const ready=await restarted.next();
  const req=async(path,input)=>{const response=await fetch(ready.workerBase+path,{method:'POST',headers:{Authorization:`Bearer ${ready.workerToken}`,'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:response.status,data:await response.json()};};
  assert.equal((await restarted.rpc('recover')).recovered,0);await restarted.rpc('clock',1_000_500);assert.equal((await req('/heartbeat',{claim:task.claim})).status,200);await restarted.rpc('clock',1_001_100);assert.equal((await restarted.rpc('recover')).recovered,0);
  await restarted.rpc('clock',1_005_001);assert.equal((await req('/heartbeat',{claim:task.claim})).status,409);
  for(let i=0;i<2;i++){await restarted.rpc('recover');const next=(await req('/claim',{workerId:'retry-worker'})).data.claim;assert.ok(next);const job=(await restarted.rpc('rows','source_jobs')).find(j=>j.id===source.id);await restarted.rpc('clock',job.leaseUntil+1);}
  await restarted.rpc('recover');const job=(await restarted.rpc('rows','source_jobs')).find(j=>j.id===source.id);assert.equal(job.status,'failed');assert.equal(job.attempts,3);assert.match(job.lastError,/retry limit/);
 }finally{await restarted?.stop();await f.close();}
});

test('late old search write cannot overwrite a new revision; lost completion acknowledgement is idempotent',async()=>{
 const f=await fixture();try{
  const source=await f.upload(),old=await f.request('/claim',{workerId:'old-worker'});await f.api.rpc('arm','index');
  const pending=f.request('/complete',{claim:old.claim,result:result('OLD_REVISION')},409);assert.equal((await f.api.next()).held,'index');
  assert.equal((await f.request('/complete',{claim:old.claim,result:result('OLD_REVISION')})).pending,true);
  const job=(await f.api.rpc('rows','source_jobs')).find(j=>j.id===source.id);await f.api.rpc('clock',job.leaseUntil+1);await f.api.rpc('recover');
  const next=await f.request('/claim',{workerId:'new-worker'});
  // Release the held old write, but publish the new extraction before it finishes.
  const publication=f.request('/complete',{claim:next.claim,result:result('NEW_REVISION')});assert.equal((await f.api.next()).held,'index');await f.api.rpc('release','index');await pending;await publication;
  assert.equal((await f.request('/complete',{claim:next.claim,result:result('NEW_REVISION')})).reused,true);
  const chunks=await f.api.rpc('rows','test_search'),current=(await f.api.rpc('rows','sources')).find(s=>s.id===source.id);assert.equal(current.status,'ready');assert.match(current.text,/NEW_REVISION/);assert.equal(chunks.filter(c=>c.revision===current.revision).length,1);assert.equal(new Set(chunks.map(c=>c.chunk_id)).size,2);
 }finally{await f.close();}
});

test('concurrency admission reserves other domains and releases exactly once after failure',()=>{
 const budget=createConcurrencyBudget({global:3,perDomain:2}),a=budget.acquire('a'),b=budget.acquire('a');assert.throws(()=>budget.acquire('a'),/capacity/);const c=budget.acquire('b');assert.throws(()=>budget.acquire('c'),/capacity/);b();b();const d=budget.acquire('c');a();c();d();assert.deepEqual(budget.current(),{active:0,domains:0,global:3,perDomain:2});
});

test('lost in-flight completion response joins publication without demoting the job or extracting twice',async()=>{
 const f=await fixture();let worker;
 try{
  const source=await f.upload();await f.api.rpc('arm','index');let completions=0,extractions=0;
  worker=createIngestionWorker({coordinatorUrl:f.ready.workerBase+'/',token:f.ready.workerToken,workerId:'lost-ack-worker',development:true,extract:async()=>{extractions++;return result('ACK_RECOVERY_CANARY');},fetchImpl:async(url,options)=>{
   if(url.pathname==='/complete'){
    completions++;
    if(completions===1){const original=fetch(url,options);assert.equal((await f.api.next()).held,'index');original.then(r=>r.arrayBuffer()).catch(()=>{});return new Response('Synthetic lost acknowledgement',{status:503});}
    if(completions===2){const response=await fetch(url,options);await f.api.rpc('release','index');return response;}
   }
   return fetch(url,options);
  }});
  assert.equal(await worker.once(),true);assert.equal(extractions,1);assert.ok(completions>=3);const job=(await f.api.rpc('rows','source_jobs')).find(j=>j.id===source.id);assert.equal(job.status,'ready');assert.equal(job.attempts,1);assert.equal((await f.api.rpc('rows','test_search')).length,1);
 }finally{worker?.stop();await f.close();}
});

test('expired URL staging cannot replace the current raw object and cleanup survives service restart',async()=>{
 const repository=openRepository(),objects=new Map();let now=1000,release,startedResolve;
 const started=new Promise(r=>startedResolve=r),held=new Promise(r=>release=r),search={index:async()=>{},remove:async()=>{}};
 const knowledge=createKnowledgeService(repository,search,{clock:()=>now}),blobs={put:async(_,id,bytes)=>{objects.set(id,bytes);if(objects.size===1){startedResolve();await held;}},read:async(_,id)=>{if(!objects.has(id))throw new Error('Missing');return objects.get(id);},remove:async(_,id)=>objects.delete(id)};
 const options={knowledge,blobs,clock:()=>now,leaseMs:1000,maxAttemptMs:5000,retryDelayMs:0,fetchUrl:async()=>({url:'https://flolah.cloud/',mime:'text/html',bytes:Buffer.from('<p>Approved public fixture</p>')})};
 try{
  const service=createSourceIngestion(repository,options),source=service.addUrl(owner,{title:'Public fixture',url:'https://flolah.cloud/',sharedConsent:true,operationId:randomUUID()}),old=service.claim('old-url-worker');
  const pending=service.input(old);const rejected=assert.rejects(pending,/lease lost/);await started;now+=1001;service.recover();const next=service.claim('new-url-worker');await service.input(next);release();await rejected;
  const restarted=createSourceIngestion(repository,options);now=70_000;await restarted.cleanupObjects();const current=repository.map('source_jobs').get(source.id);assert.ok(objects.has(current.rawObjectId));assert.ok(!objects.has(old.attemptId));assert.equal(objects.size,1);
 }finally{release?.();repository.close();}
});
