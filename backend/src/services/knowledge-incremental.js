import {randomUUID} from 'node:crypto';
import {fingerprint} from './knowledge-contract.js';

// Canonical content identity, independent of provider property ordering.
export function recordFingerprint(value){
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
  return fingerprint(canonical(value));
}

// A failed scan never advances the published generation. The staged generation
// is retained for the next job, so completed object writes can be reused.
export async function runIncrementalKnowledge(job,{store,search,records}){
  const source=store.get(job.owner,job.source_id);
  const draft=store.incrementalDraft(job);
  const scan=randomUUID();let count=0,changed=0,reused=0,lost=null;
  const controller=new AbortController();
  const timer=setInterval(()=>{try{store.heartbeat(job,count);}catch(e){lost=e;controller.abort(e);}},30000);
  timer.unref?.();
  try{
    await search.ensure(job.owner);store.heartbeat(job,0);
    for await(const record of records(job.owner,source,{signal:controller.signal})){
      if(lost)throw lost;
      if(store.excluded(job.owner,source.id,record.object_id))continue;
      store.heartbeat(job,count);
      const hash=recordFingerprint({record,graph_enabled:source.graph_enabled,profile:search.processingProfile});
      store.recordProgress(job,record.object_id,'indexing');
      try{
        const prior=store.incrementalRecord(job,record.object_id);
        if(prior?.hash===hash&&await search.markIncrementalSeen(job.owner,source,draft,record.object_id,prior.version,scan)){
          reused++;
        }else{
          await search.putIncrementalRecord(job.owner,source,draft,record,hash,scan);
          store.saveIncrementalRecord(job,record.object_id,hash,draft.generation);
          changed++;
        }
        store.recordProgress(job,record.object_id,'indexed');
      }catch(e){store.recordProgress(job,record.object_id,'failed','Object processing failed; completed objects are retained for retry.');throw e;}
      count++;
    }
    store.heartbeat(job,count);
    const deleted=await search.closeUnseenIncremental(job.owner,source,draft,scan);
    await search.refresh(job.owner);
    if(lost)throw lost;
    store.finish(job,`g:${draft.generation}`,null,{metrics:{checked:count,changed,reused,deleted}});
    // Obsolete versions are no longer queryable. Physical cleanup is retryable.
    try{await search.pruneIncremental(job.owner,source,draft.generation);}catch{console.warn('[knowledge] historical object cleanup deferred',job.id);}
    return {status:'completed',records:count,changed,reused,deleted,revision:`g:${draft.generation}`};
  }catch(error){
    const message=String(error.message||error).slice(0,500);
    try{store.finish(job,null,message,{retryAfterMs:error.retry_after_ms,metrics:{checked:count,changed,reused,deleted:null}});}catch{}
    return {status:'failed',records:count,changed,reused,error:message};
  }finally{clearInterval(timer);}
}
