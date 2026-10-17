// Explicit opt-in VPS probe. Disposable DB/object store and 25 owned indices;
// never imports production authority state, tokens, objects or website content.
import {readFileSync,writeFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createKnowledgeService} from '../src/knowledge-service.mjs';
import {createOpenSearch} from '../src/opensearch.mjs';
import {knowledgeScope} from '../src/knowledge-scope.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {createWorkerServer} from '../src/worker-server.mjs';
import {createSourceIngestion} from '../src/source-ingestion.mjs';
import {createBlobStore} from '../src/blob-store.mjs';
import {createKnowledgeAnswer} from '../src/knowledge-answer.mjs';

const build=process.argv[2];if(!/^[a-zA-Z0-9_-]{1,32}$/.test(build||''))throw new Error('Unique probe label required');
const config=JSON.parse(readFileSync('/config/service.json','utf8')),root=await mkdtemp(join(tmpdir(),'adoption-scale-')),repository=openRepository(join(root,'probe.sqlite'));
const search=createOpenSearch({...config.search,privateNetwork:true}),knowledge=createKnowledgeService(repository,search),authority=new SessionAuthority({repository,development:true});
const ingestion=createSourceIngestion(repository,{knowledge,blobs:createBlobStore(join(root,'objects')),maxWorkers:2,perDomainWorkers:1});
const token=randomBytes(48).toString('base64url'),workerServer=createWorkerServer({ingestion,token}),server=createAdoptionServer({authority,knowledge,ingestion,answer:createKnowledgeAnswer(config),capacity:config.capacity});
await new Promise(r=>workerServer.listen(0,'127.0.0.1',r));await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port,coordinator='http://127.0.0.1:'+workerServer.address().port+'/',origin='http://127.0.0.1:4194';
const report={build,startedAt:new Date().toISOString(),target:{websites:25,concurrentUsers:25,workers:2},scope:'Synthetic backend corpus on the existing loopback acceptance origin; isolated authority and search indices. Real OpenSearch, Python extraction and configured model gateway.',criteria:{bootstrapP95Ms:1000,searchP95Ms:1000,answerP95Ms:30000,eventLoopP99Ms:100,unexpectedErrors:0,crossDomainLeaks:0,workerBatchDeadlineMs:120000},checks:[],timings:{bootstrap:[],search:[],answer:[]},cleanup:{indices:0,sessions:0,completed:false}},embeddings=[],sessions=[],workers=[];
const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();let loopPeak=0,rssPeak=0;const sample=setInterval(()=>{rssPeak=Math.max(rssPeak,process.memoryUsage().rss);loopPeak=Math.max(loopPeak,histogram.percentile(99)/1e6);histogram.reset();},1000);
const output='/evidence/scaling-'+build+'.json',save=()=>writeFileSync(output,JSON.stringify(report,null,2));
const parallel=async(items,n,fn)=>{let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const at=i++;await fn(items[at],at);}}));};
const request=async(path,input,session)=>{const start=performance.now(),response=await fetch(base+'/v1/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.sessionToken}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)}),body=await response.json();assert.equal(response.status,200,path+' '+response.status);return {body,ms:performance.now()-start};};
const check=async(name,fn)=>{try{report.checks.push({name,status:'passed',detail:await fn()});}catch(e){report.checks.push({name,status:'failed',reason:String(e.message).slice(0,300)});}save();console.log(name+': '+report.checks.at(-1).status);};
try{
 await check('25 isolated website indices seeded with 500 documents / approximately 10 MB',async()=>{
  const start=performance.now();
  await parallel(Array.from({length:25},(_,i)=>i),2,async i=>{
   const id=`scale_${build}_${i}_${randomBytes(4).toString('hex')}`,scope={embeddingId:id,audienceIds:['public'],role:'maintainer'};embeddings[i]=id;await search.provision(id);
   const chunks=[];
   for(let doc=0;doc<20;doc++){
    const canary=`CANARY_SITE_${i}_ONLY`,promise=`Site ${i} delivery requires ${i+3} working days.`,text=`${promise} Verification marker ${canary}.\n`+(`Synthetic reference paragraph for website ${i}, document ${doc}. Review before saving.\n`.repeat(300)).slice(0,19900),revision=randomBytes(32).toString('hex'),sourceId=randomUUID();
    repository.map('sources').set(sourceId,{id:sourceId,embeddingId:id,audienceIds:['public'],title:`Site ${i} delivery policy ${doc}`,text,revision,status:'ready'});
    for(let offset=0;offset<text.length;offset+=2400)chunks.push({embedding_id:id,source_id:sourceId,chunk_id:`${sourceId}_${revision}_${String(chunks.length).padStart(5,'0')}`,revision,status:'ready',deleted:false,audience_ids:['public'],title:`Site ${i} delivery policy ${doc}`,text:text.slice(offset,offset+2400),locator:'Document'});
   }
   assert.ok(chunks.length<=300);await search.index(id,chunks);
  });return {indices:embeddings.length,documents:500,seedMs:performance.now()-start};
 });
 if(embeddings.filter(Boolean).length!==25)throw new Error('Corpus incomplete');
 await check('25 simultaneous users bootstrap independently',async()=>{await parallel(embeddings,25,async(id,i)=>{const installation=authority.registerApproved({embeddingId:id,origins:[origin],expiresAt:Date.now()+3600000,visitorUploads:true});const {body,ms}=await request('sessions',installation);sessions[i]=body;report.timings.bootstrap.push(ms);});assert.equal(new Set(sessions.map(s=>s.sessionId)).size,25);return {sessions:25,concurrency:25};});
 await check('500 searches at concurrency 25 retain domain isolation',async()=>{await parallel(Array.from({length:500},(_,i)=>i),25,async i=>{const site=i%25,{body,ms}=await request('knowledge/search',{text:`delivery CANARY_SITE_${site}_ONLY CANARY_SITE_${(site+1)%25}_ONLY`,size:6},sessions[site]);assert.ok(body.evidence.length);assert.ok(body.evidence.some(e=>e.text.includes(`CANARY_SITE_${site}_ONLY`)));assert.ok(body.evidence.every(e=>!e.text.includes(`CANARY_SITE_${(site+1)%25}_ONLY`)));report.timings.search.push(ms);});return {requests:500,concurrency:25,leaks:0};});
 await check('two real parser processes drain 50 jobs across 25 website queues during retrieval',async()=>{
  for(const id of embeddings)for(let n=0;n<2;n++)await ingestion.upload({embeddingId:id,audienceIds:['public'],role:'maintainer'},{title:'Worker load fixture',filename:'load.txt',mime:'text/plain',content:Buffer.from('Synthetic parallel parser queue evidence.').toString('base64'),sharedConsent:true,operationId:randomUUID()});
  ingestion.start({local:false});const start=performance.now();
  for(let i=0;i<2;i++)workers.push(fork(new URL('./fixtures/scaling-worker.mjs',import.meta.url),[],{stdio:['ignore','ignore','inherit','ipc'],env:{...process.env,ADOPTION_TEST_COORDINATOR:coordinator,ADOPTION_TEST_WORKER_TOKEN:token}}));
  let maxActive=0,maxDomain=0,searchRounds=0;
  while((ingestion.metrics().counts.ready||0)<50&&performance.now()-start<120000){
   const active=repository.workItems('source_jobs',['extracting','indexing']);maxActive=Math.max(maxActive,active.length);const counts={};for(const j of active)counts[j.embeddingId]=(counts[j.embeddingId]||0)+1;maxDomain=Math.max(maxDomain,...Object.values(counts));
   if(searchRounds++<10)await parallel(sessions,25,async(s,i)=>{const {body,ms}=await request('knowledge/search',{text:`CANARY_SITE_${i}_ONLY`,size:6},s);assert.ok(body.evidence.some(e=>e.text.includes(`CANARY_SITE_${i}_ONLY`)));report.timings.search.push(ms);});await delay(500);
  }
  assert.equal(ingestion.metrics().counts.ready,50);assert.equal(maxActive,2);assert.equal(maxDomain,1);const elapsedMs=performance.now()-start;assert.ok(elapsedMs<120000);return {jobs:50,workers:2,maxActive,maxPerDomain:maxDomain,elapsedMs,jobsPerSecond:50/(elapsedMs/1000)};
 });
 await check('25 simultaneous real model answers retain scoped citations',async()=>{await parallel(sessions,25,async(s,i)=>{const {body,ms}=await request('ask',{text:`For Site ${i}, how many working days does delivery require?`},s);assert.equal(body.kind,'answer');assert.ok(body.citations.length);assert.ok(body.citations.every(c=>c.title.startsWith(`Site ${i} `)));report.timings.answer.push(ms);});return {requests:25,concurrency:25,metric:'Full JSON response, not streamed first token'};});
}catch(e){report.checks.push({name:'Probe execution',status:'failed',reason:String(e.message).slice(0,300)});}
finally{
 ingestion.stop();for(const child of workers){if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}}
 for(const session of sessions)if(session)try{await request('terminate',{},session);report.cleanup.sessions++;}catch{}
 for(const id of embeddings.filter(Boolean)){try{const response=await fetch(new URL('/'+knowledgeScope({embeddingId:id,audienceIds:['public']}).index,config.search.url),{method:'DELETE',headers:config.search.authorization?{Authorization:config.search.authorization}:{},signal:AbortSignal.timeout(15000)});if(response.ok||response.status===404)report.cleanup.indices++;}catch{}}
 server.closeAllConnections();workerServer.closeAllConnections();await new Promise(r=>server.close(r));await new Promise(r=>workerServer.close(r));repository.close();await rm(root,{recursive:true,force:true});clearInterval(sample);histogram.disable();
 const p95=a=>a.length?[...a].sort((x,y)=>x-y)[Math.ceil(a.length*.95)-1]:null;
 report.measurements=Object.fromEntries(Object.entries(report.timings).map(([name,values])=>[name,{n:values.length,p95Ms:p95(values),maxMs:values.length?Math.max(...values):null}]));delete report.timings;
 report.resources={coordinatorPeakRssMiB:rssPeak/1024/1024,eventLoopP99PeakMs:loopPeak,containerLimit:'1 CPU / 1 GiB for coordinator and both test child parser processes combined; stricter than production separate workers'};
 report.cleanup.completed=report.cleanup.indices===25&&report.cleanup.sessions===25;
 report.checks.push({name:'Declared latency and event-loop criteria',status:report.measurements.bootstrap.p95Ms<1000&&report.measurements.search.p95Ms<1000&&report.measurements.answer.p95Ms!==null&&report.measurements.answer.p95Ms<30000&&loopPeak<100?'passed':'failed',detail:{measurements:report.measurements,eventLoopP99PeakMs:loopPeak}});
 report.finishedAt=new Date().toISOString();report.limits=['25-user synthetic pilot only; no 1,000-domain or sustained saturation claim.','Real model latency depends on configured provider and can exceed target independently of parser scaling.','Single coordinator/local SQLite disk; remote stateless workers supported; API multi-replica HA requires shared transactional storage.','Safari/mobile/screen reader and real BFCache acceptance remain pending.'];save();console.log(JSON.stringify({checks:report.checks.map(({name,status})=>({name,status})),measurements:report.measurements,resources:report.resources,cleanup:report.cleanup}));process.exitCode=report.checks.some(c=>c.status==='failed')||!report.cleanup.completed?1:0;
}
