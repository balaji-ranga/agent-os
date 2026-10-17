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
export function createSourceIngestion(repository,{knowledge,blobs,extract,fetchUrl,clock=Date.now}){
 const jobs=repository.map('source_jobs'),attempts=repository.map('source_uploads');
 let running=false,stopped=false,timer;
 const jobFor=(scope,id)=>{maintain(scope);const job=jobs.get(id);if(!job||job.embeddingId!==scope.embeddingId)throw new Error('Source not found');return job;};
 const service={
  addUrl(scope,{title,url,sharedConsent,operationId}){
   maintain(scope);if(!fetchUrl||sharedConsent!==true||typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(operationId))throw new Error('Help URL not authorized');
   const normalized=approvedUrl(url).href,key=`${scope.embeddingId}:${operationId}`,fingerprint=createHash('sha256').update(JSON.stringify({title,url:normalized})).digest('hex');
   return repository.transaction(()=>{const previous=attempts.get(key);if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Upload operation conflict');return {id:previous.id,reused:true};}const id=randomUUID();knowledge.createPending(scope,{id,title,kind:'url'});jobs.set(id,{id,embeddingId:scope.embeddingId,audienceIds:scope.audienceIds,status:'queued',bytes:0,kind:'url',url:normalized,createdAt:clock(),attempts:0});attempts.set(key,{id,fingerprint});return {id,status:'queued'};});
  },
  refresh(scope,id){const job=jobFor(scope,id);if(job.kind!=='url'||!['ready','failed'].includes(job.status))throw new Error('Help source cannot refresh');job.status='queued';job.lastError=null;jobs.set(id,job);return {id,status:'queued'};},
  async upload(scope,{title,filename,mime,content,sharedConsent,operationId}){
   maintain(scope);
   if(sharedConsent!==true||typeof title!=='string'||!title.trim()||title.length>200||typeof filename!=='string'||filename.length>180||/[\\/\x00-\x1f]/.test(filename)||!Object.hasOwn(mimeTypes,mime)||!mimeTypes[mime][1].test(filename)||typeof content!=='string'||content.length>22_369_624||!content.length||typeof operationId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(operationId))throw new Error('Invalid upload, sharing consent or file type');
   const bytes=Buffer.from(content,'base64'),kind=mimeTypes[mime][0];
   if(!bytes.length||bytes.length>16*1024*1024||bytes.toString('base64')!==content||bytes.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')))throw new Error('File rejected');
   if((kind==='pdf'&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-')))||(kind==='docx'&&!bytes.subarray(0,4).equals(Buffer.from('PK\x03\x04')))||(mime==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(mime==='image/jpeg'&&bytes.readUInt16BE(0)!==0xffd8))throw new Error('File signature does not match type');
   const fingerprint=createHash('sha256').update(JSON.stringify({title,filename,mime})).update(bytes).digest('hex'),key=`${scope.embeddingId}:${operationId}`;
   const previous=attempts.get(key);
   if(previous){if(previous.fingerprint!==fingerprint)throw new Error('Upload operation conflict');return {id:previous.id,reused:true,status:knowledge.inspect(scope,previous.id).status};}
   const active=jobs.values().filter(j=>j.embeddingId===scope.embeddingId&&j.status!=='deleted');
   if(active.reduce((sum,j)=>sum+j.bytes,0)+bytes.length>64*1024*1024)throw new Error('Embedding raw storage quota reached');
   const id=randomUUID();await blobs.put(scope.embeddingId,id,bytes);
   try{
    // Recheck after asynchronous storage: simultaneous retries never create two jobs.
    const result=repository.transaction(()=>{
     const retry=attempts.get(key);if(retry){if(retry.fingerprint!==fingerprint)throw new Error('Upload operation conflict');return {id:retry.id,reused:true};}
     if(jobs.values().filter(j=>j.embeddingId===scope.embeddingId&&j.status!=='deleted').reduce((sum,j)=>sum+j.bytes,0)+bytes.length>64*1024*1024)throw new Error('Embedding raw storage quota reached');
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
   if(!job||job.embeddingId!==scope.embeddingId||(scope.role!=='maintainer'&&job.uploadedBySessionId!==scope.sessionId))throw new Error('Source access denied');
   return {id:job.id,status:job.status,attempts:job.attempts,lastError:job.lastError||null};
  },
  retry(scope,id){const job=jobFor(scope,id);if(job.status!=='failed')throw new Error('Source cannot retry');job.status='queued';job.lastError=null;jobs.set(id,job);return {id,status:'queued'};},
  async remove(scope,id){
   maintain(scope);const job=jobs.get(id);if(job&&job.embeddingId!==scope.embeddingId)throw new Error('Source not found');
   if(job){job.status='deleted';jobs.set(id,job);}
   await knowledge.remove(scope,id);await blobs.remove(scope.embeddingId,id);return {id,status:'deleted'};
  },
  async raw(scope,id){
   maintain(scope);const job=jobFor(scope,id);if(job.status!=='ready'||knowledge.inspect(scope,id).status!=='ready')throw new Error('Source unavailable');
   return {mime:job.mime,content:(await blobs.read(scope.embeddingId,id)).toString('base64')};
  },
  async drain(){
   if(running||stopped)return;running=true;
   try{
    for(const candidate of jobs.values().filter(j=>j.status==='queued')){
     if(stopped)break;
     const scope=trustedScope(candidate),job=jobs.get(candidate.id);if(job.status!=='queued')continue;
     job.status='extracting';job.attempts++;job.startedAt=clock();jobs.set(job.id,job);
     try{
      knowledge.processing(scope,job.id);
      let result;
      if(job.kind==='url'){
       const page=await fetchUrl(job.url);if(jobs.get(job.id)?.status==='deleted')continue;
       if(jobs.values().filter(j=>j.embeddingId===scope.embeddingId&&j.id!==job.id&&j.status!=='deleted').reduce((sum,j)=>sum+j.bytes,0)+page.bytes.length>64*1024*1024)throw new Error('Embedding raw storage quota reached');
       job.bytes=page.bytes.length;job.mime=page.mime;jobs.set(job.id,job);
       await blobs.remove(job.embeddingId,job.id);await blobs.put(job.embeddingId,job.id,page.bytes);
       result=await extract({path:blobs.path(job.embeddingId,job.id),kind:page.mime==='text/html'?'html':'text'});result.url=page.url;
      }else result=await extract({path:blobs.path(job.embeddingId,job.id),kind:job.kind});
      if(jobs.get(job.id)?.status==='deleted')continue;
      knowledge.extracted(scope,job.id,result);
      job.status='indexing';jobs.set(job.id,job);
      await knowledge.ingest(scope,job.id);
      if(jobs.get(job.id)?.status!=='deleted'){job.status='ready';job.completedAt=clock();job.lastError=null;jobs.set(job.id,job);}
     }catch{
      if(jobs.get(job.id)?.status!=='deleted'){job.status='failed';job.lastError='Processing failed. Check the supported format, file limits and readable content, then retry.';jobs.set(job.id,job);knowledge.extractionFailed(scope,job.id);}
     }finally{
      // An in-flight index write may finish after deletion; perform cleanup again.
      if(jobs.get(job.id)?.status==='deleted'){await knowledge.remove(scope,job.id);await blobs.remove(scope.embeddingId,job.id);}
     }
    }
   }finally{running=false;}
  },
  start(){
   // A previous process cannot own an extraction after restart. Do not silently
   // call it Ready, or retry indefinitely without a visible user decision.
   for(const job of jobs.values())if(['extracting','indexing'].includes(job.status)){job.status='failed';job.lastError='Processing interrupted; retry is available.';jobs.set(job.id,job);knowledge.extractionFailed(trustedScope(job),job.id);}
   stopped=false;timer=setInterval(()=>service.drain().catch(()=>{}),1000);timer.unref();service.drain().catch(()=>{});
  },
  stop(){stopped=true;if(timer)clearInterval(timer);},
 };
 return service;
}
