import {randomUUID,createHash} from 'node:crypto';
import {approvedUrl} from './public-url.mjs';
const mimeTypes={
 'application/pdf':['pdf',/\.pdf$/i],
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx',/\.docx$/i],
 'text/plain':['text',/\.(txt|md)$/i], 'text/markdown':['text',/\.md$/i], 'text/html':['html',/\.html?$/i],
 'image/png':['image',/\.png$/i], 'image/jpeg':['image',/\.jpe?g$/i],
 'video/mp4':['video',/\.mp4$/i], 'video/webm':['video',/\.webm$/i],
};
const maintain=scope=>{if(scope?.role!=='maintainer'||!/^[A-Za-z0-9_-]{1,80}$/.test(scope.embeddingId))throw new Error('Source management denied');};
const trustedScope=job=>({embeddingId:job.embeddingId,audienceIds:job.audienceIds,role:'maintainer'});
const audienceAllowed=(scope,job)=>Array.isArray(scope.audienceIds)&&job.audienceIds?.some(a=>scope.audienceIds.includes(a));
const operationScope=scope=>scope.embeddingId+(scope.audienceIds?.length===1&&scope.audienceIds[0]==='public'?'':':'+createHash('sha256').update(JSON.stringify([...(scope.audienceIds||[])].sort())).digest('hex'));
export function createSourceIngestion(repository,{knowledge,blobs,extract,fetchUrl,clock=Date.now,onEvent=()=>{},leaseMs=90_000,maxAttemptMs=300_000,maxAttempts=3,retryDelayMs=1000,maxWorkers=2,perDomainWorkers=1}={}){
 for(const [value,min,max] of [[leaseMs,1000,600_000],[maxAttemptMs,leaseMs,1_800_000],[maxAttempts,1,10],[retryDelayMs,0,60_000],[maxWorkers,1,32],[perDomainWorkers,1,maxWorkers]])if(!Number.isInteger(value)||value<min||value>max)throw new Error('Invalid worker configuration');
 const jobs=repository.map('source_jobs'),attempts=repository.map('source_uploads');
 const fairness=repository.map('worker_fairness'),coordination=repository.map('worker_coordination'),cleanup=repository.map('source_cleanup'),localWorker=`local-${randomUUID()}`;
 let running=false,stopped=false,timer;
 const notify=(job,state)=>{try{onEvent({embeddingId:job.embeddingId,jobId:job.id,state,attempts:job.attempts});}catch{}};
 const jobFor=(scope,id)=>{maintain(scope);const job=jobs.get(id);if(!job||job.embeddingId!==scope.embeddingId||!audienceAllowed(scope,job))throw new Error('Source not found');return job;};
 const owned=claim=>{const job=jobs.get(claim?.id);return job&&job.attemptId===claim.attemptId&&job.workerId===claim.workerId&&['extracting','indexing'].includes(job.status)&&job.leaseUntil>clock()?job:null;};
 const requireOwned=claim=>{const job=owned(claim);if(!job)throw new Error('Worker lease lost');return job;};
 const discardObject=(job,objectId)=>{if(objectId)cleanup.set(objectId,{id:objectId,embeddingId:job.embeddingId,status:'queued',leaseUntil:Math.max(clock(),job.maxUntil||0)+60_000});};
 const service={
  addUrl(scope,{title,url,sharedConsent,operationId}){
   maintain(scope);if(!fetchUrl||sharedConsent!==true||typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(operationId))throw new Error('Help URL not authorized');
   const normalized=approvedUrl(url).href,key=`${operationScope(scope)}:${operationId}`,fingerprint=createHash('sha256').update(JSON.stringify({title,url:normalized})).digest('hex');
   return repository.transaction(()=>{const previous=attempts.get(key);if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Upload operation conflict');return {id:previous.id,reused:true};}const id=randomUUID();knowledge.createPending(scope,{id,title,kind:'url'});jobs.set(id,{id,embeddingId:scope.embeddingId,audienceIds:scope.audienceIds,status:'queued',bytes:0,kind:'url',url:normalized,createdAt:clock(),attempts:0});attempts.set(key,{id,fingerprint});return {id,status:'queued'};});
  },
  refresh(scope,id){return repository.transaction(()=>{const job=jobFor(scope,id);if(job.kind!=='url'||!['ready','failed'].includes(job.status))throw new Error('Help source cannot refresh');job.status='queued';job.lastError=null;job.attempts=0;job.nextAttemptAt=0;jobs.set(id,job);return {id,status:'queued'};});},
  async upload(scope,{title,filename,mime,content,sharedConsent,operationId}){
   maintain(scope);
   if(sharedConsent!==true||typeof title!=='string'||!title.trim()||title.length>200||typeof filename!=='string'||filename.length>180||/[\\/\x00-\x1f]/.test(filename)||!Object.hasOwn(mimeTypes,mime)||!mimeTypes[mime][1].test(filename)||typeof content!=='string'||content.length>22_369_624||!content.length||typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(operationId))throw new Error('Invalid upload, sharing consent or file type');
   const bytes=Buffer.from(content,'base64'),kind=mimeTypes[mime][0];
   if(!bytes.length||bytes.length>16*1024*1024||bytes.toString('base64')!==content||bytes.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')))throw new Error('File rejected');
   if((kind==='pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))||(kind==='docx'&&!bytes.subarray(0,4).equals(Buffer.from('PK\x03\x04')))||(mime==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(mime==='image/jpeg'&&bytes.readUInt16BE(0)!==0xffd8))throw new Error('File signature does not match type');
   if((mime==='video/mp4'&&(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp'))||(mime==='video/webm'&&!bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))))throw new Error('Video signature does not match type');
   const fingerprint=createHash('sha256').update(JSON.stringify({title,filename,mime})).update(bytes).digest('hex'),key=`${operationScope(scope)}:${operationId}`;
   const previous=attempts.get(key);
   if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Upload operation conflict');return {id:previous.id,reused:true,status:knowledge.inspect(scope,previous.id).status};}
   const active=jobs.values({embeddingId:scope.embeddingId}).filter(j=>j.status!=='deleted');
   if(active.reduce((sum,j)=>sum+j.bytes,0)+bytes.length>64*1024*1024)throw new Error('Embedding raw storage quota reached');
   const id=randomUUID();await blobs.put(scope.embeddingId,id,bytes);
   try{
    // Recheck after asynchronous storage: simultaneous retries never create two jobs.
    const result=repository.transaction(()=>{
     const retry=attempts.get(key);if(retry){if(retry.fingerprint!==fingerprint)throw new Error('Upload operation conflict');return {id:retry.id,reused:true};}
     if(jobs.values({embeddingId:scope.embeddingId}).filter(j=>j.status!=='deleted').reduce((sum,j)=>sum+j.bytes,0)+bytes.length>64*1024*1024)throw new Error('Embedding raw storage quota reached');
     knowledge.createPending(scope,{id,title,kind,bytes:bytes.length,uploadedBySessionId:scope.sessionId||null});
     jobs.set(id,{id,embeddingId:scope.embeddingId,audienceIds:scope.audienceIds,status:'queued',bytes:bytes.length,kind,mime,createdAt:clock(),uploadedBySessionId:scope.sessionId||null,attempts:0});
     attempts.set(key,{id,fingerprint});return {id,status:'queued'};
    });
    if(result.reused)await blobs.remove(scope.embeddingId,id);
    return result;
   }catch(error){await blobs.remove(scope.embeddingId,id);throw error;}
  },
  status(scope,id){
   const job=jobs.get(id);
   if(!job||job.embeddingId!==scope.embeddingId||!audienceAllowed(scope,job)||(scope.role!=='maintainer'&&job.uploadedBySessionId!==scope.sessionId))throw new Error('Source access denied');
   return {id:job.id,status:job.status,attempts:job.attempts,lastError:job.lastError||null};
  },
  retry(scope,id){return repository.transaction(()=>{const job=jobFor(scope,id);if(job.status!=='failed')throw new Error('Source cannot retry');job.status='queued';job.lastError=null;job.attempts=0;job.nextAttemptAt=0;jobs.set(id,job);return {id,status:'queued'};});},
  async remove(scope,id){
   maintain(scope);const job=jobs.get(id);if(job)jobFor(scope,id);else knowledge.inspect(scope,id);
   if(job){discardObject(job,job.pendingObjectId);job.status='deleted';jobs.set(id,job);}
   try{await knowledge.remove(scope,id);}finally{await blobs.remove(scope.embeddingId,id);if(job?.rawObjectId)await blobs.remove(scope.embeddingId,job.rawObjectId);}return {id,status:'deleted'};
  },
  async raw(scope,id){
   maintain(scope);const job=jobFor(scope,id);if(job.status!=='ready'||knowledge.inspect(scope,id).status!=='ready')throw new Error('Source unavailable');
   return {mime:job.mime,content:(await blobs.read(scope.embeddingId,job.rawObjectId||id)).toString('base64')};
  },
  recover(){return repository.transaction(()=>{
   let recovered=0;
   for(const job of repository.workItems('source_jobs',['extracting','indexing'],clock())){
    discardObject(job,job.pendingObjectId);delete job.pendingObjectId;
    knowledge.extractionFailed(trustedScope(job),job.id);
    const retryable=Number.isFinite(job.leaseUntil)&&job.attempts<maxAttempts;
    job.status=retryable?'queued':'failed';job.nextAttemptAt=clock()+retryDelayMs*Math.max(1,job.attempts);job.lastError=retryable?'Worker interrupted; automatic retry scheduled.':'Processing interrupted; retry limit reached. Review and retry manually.';
    jobs.set(job.id,job);notify(job,job.status);recovered++;
   }
   return {recovered};
  });},
  claim(workerId){
   if(typeof workerId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(workerId))throw new Error('Invalid worker identity');
   return repository.transaction(()=>{
    service.recover();
    const active=repository.workItems('source_jobs',['extracting','indexing']);
    if(active.length>=maxWorkers||active.some(job=>job.workerId===workerId))return null;
    const job=repository.nextSourceJob(clock(),perDomainWorkers);if(!job)return null;
    knowledge.processing(trustedScope(job),job.id);
    Object.assign(job,{status:'extracting',attempts:job.attempts+1,startedAt:clock(),attemptId:randomUUID(),workerId,leaseUntil:clock()+leaseMs,maxUntil:clock()+maxAttemptMs});
    const sequence=(coordination.get('fairness')?.sequence||0)+1;coordination.set('fairness',{sequence});fairness.set(job.embeddingId,{sequence});jobs.set(job.id,job);notify(job,'processing');
    return {id:job.id,attemptId:job.attemptId,workerId,leaseMs};
   });
  },
  heartbeat(claim){return repository.transaction(()=>{const job=requireOwned(claim);job.leaseUntil=Math.min(clock()+leaseMs,job.maxUntil);if(job.leaseUntil<=clock())throw new Error('Worker lease lost');jobs.set(job.id,job);return {leaseUntil:job.leaseUntil};});},
  async input(claim,{includeContent=true}={}){
   let job=requireOwned(claim);
   if(job.status!=='extracting')throw new Error('Worker input unavailable');
   if(job.kind==='url'){
    const page=await fetchUrl(job.url);requireOwned(claim);
    const rawObjectId=job.attemptId;
    repository.transaction(()=>{const current=requireOwned(claim);current.pendingObjectId=rawObjectId;jobs.set(job.id,current);});
    await blobs.put(job.embeddingId,rawObjectId,page.bytes);
    try{repository.transaction(()=>{job=requireOwned(claim);if(jobs.values({embeddingId:job.embeddingId}).filter(j=>j.id!==job.id&&j.status!=='deleted').reduce((n,j)=>n+j.bytes,0)+page.bytes.length>64*1024*1024)throw new Error('Embedding raw storage quota reached');discardObject(job,job.rawObjectId);Object.assign(job,{rawObjectId,bytes:page.bytes.length,mime:page.mime,resolvedUrl:page.url});delete job.pendingObjectId;jobs.set(job.id,job);});}
    catch(error){await blobs.remove(job.embeddingId,rawObjectId);throw error;}
   }
   const objectId=job.rawObjectId||job.id;
   const content=includeContent?(await blobs.read(job.embeddingId,objectId)).toString('base64'):undefined;
   requireOwned(claim);
   return {kind:job.kind==='url'?(job.mime==='text/html'?'html':'text'):job.kind,...(includeContent?{content}:{path:blobs.path(job.embeddingId,objectId)})};
  },
  async complete(claim,result){
   const previous=jobs.get(claim?.id);
   if(previous?.status==='ready'&&previous.attemptId===claim.attemptId&&previous.workerId===claim.workerId)return {id:previous.id,status:'ready',reused:true};
   if(previous?.status==='indexing'&&owned(claim))return {id:previous.id,status:'indexing',pending:true};
   const job=repository.transaction(()=>{const current=requireOwned(claim);if(current.status!=='extracting')throw new Error('Worker result already processing');knowledge.extracted(trustedScope(current),current.id,{...result,url:current.resolvedUrl||null});current.status='indexing';jobs.set(current.id,current);return current;});
   try{
    await knowledge.ingest(trustedScope(job),job.id,{isCurrent:()=>!!owned(claim)});
    return repository.transaction(()=>{const current=requireOwned(claim);current.status='ready';current.completedAt=clock();current.lastError=null;jobs.set(current.id,current);notify(current,'ready');return {id:current.id,status:'ready'};});
   }finally{
    if(jobs.get(job.id)?.status==='deleted'){try{await knowledge.remove(trustedScope(job),job.id);}finally{await blobs.remove(job.embeddingId,job.rawObjectId||job.id);}}
   }
  },
  fail(claim){return repository.transaction(()=>{const job=owned(claim);if(!job)return {accepted:false};discardObject(job,job.pendingObjectId);delete job.pendingObjectId;job.status='failed';job.lastError='Processing failed. Check the supported format, file limits and readable content, then retry.';jobs.set(job.id,job);knowledge.extractionFailed(trustedScope(job),job.id);notify(job,'failed');return {accepted:true};});},
  metrics(){const oldest=repository.oldestQueuedAt();return {counts:repository.workCounts(),oldestQueuedAgeMs:oldest===null?0:Math.max(0,clock()-oldest),maxWorkers,perDomainWorkers,leaseMs,maxAttempts};},
  async cleanupObjects(){
   for(const item of repository.workItems('source_cleanup',['queued'],clock(),100)){await blobs.remove(item.embeddingId,item.id);cleanup.delete(item.id);}
  },
  async drain(){
   if(running||stopped)return;running=true;let heartbeat;
   try{const claim=service.claim(localWorker);if(!claim)return;
    heartbeat=setInterval(()=>{try{if(!stopped)service.heartbeat(claim);}catch{}},Math.max(250,Math.floor(leaseMs/3)));heartbeat.unref();
    try{const input=await service.input(claim,{includeContent:false});await service.complete(claim,await extract(input));}catch{service.fail(claim);}
   }finally{clearInterval(heartbeat);running=false;}
  },
  start({local=true}={}){
   if(timer)clearInterval(timer);stopped=false;service.recover();
   timer=setInterval(()=>{try{service.recover();service.cleanupObjects().catch(()=>{});if(local)service.drain().catch(()=>{});}catch{}},1000);timer.unref();if(local)service.drain().catch(()=>{});
  },
  stop(){stopped=true;if(timer)clearInterval(timer);},
 };
 return service;
}
