import { createHash,randomUUID } from 'node:crypto';

export function createKnowledgeService(repository,search,{clock=Date.now,leaseMs=120_000}={}) {
  if(!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>600_000)throw new Error('Invalid ingestion lease');
  const sources=repository.map('sources');
  const validScope=scope=>{
    if (!scope || !/^[a-zA-Z0-9_-]{1,80}$/.test(scope.embeddingId) || !Array.isArray(scope.audienceIds) || !scope.audienceIds.length) throw new Error('Access denied');
  };
  const maintain=scope=>{validScope(scope);if(scope.role!=='maintainer')throw new Error('Access denied');};
  const get=(scope,id)=>{validScope(scope);const source=sources.get(id);if(!source||source.embeddingId!==scope.embeddingId)throw new Error('Source not found');return source;};
  const service={
    createText(scope,{title,text}) {
      maintain(scope);
      if(typeof title!=='string'||!title.trim()||title.length>200||typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>200_000)throw new Error('Invalid text source');
      const active=[...sources.values()].filter(s=>s.embeddingId===scope.embeddingId&&s.status!=='deleted');
      if(active.length>=100||active.reduce((sum,s)=>sum+Buffer.byteLength(s.text||''),0)+Buffer.byteLength(text)>2_000_000)throw new Error('Embedding source quota reached');
      const source={id:randomUUID(),embeddingId:scope.embeddingId,title,text,status:'pending',revision:createHash('sha256').update(text).digest('hex'),audienceIds:[...scope.audienceIds]};
      sources.set(source.id,source);return {id:source.id,status:source.status};
    },
    async ingest(scope,id) {
      maintain(scope);
      const existing=get(scope,id);if(existing.status==='ready')return {id,status:'ready',reused:true};
      const source=repository.transaction(()=>{const current=get(scope,id);if(!['pending','failed'].includes(current.status)&&!(current.status==='indexing'&&(current.leaseUntil||0)<=clock()))throw new Error('Source cannot be indexed');current.status='indexing';current.attemptId=randomUUID();current.leaseUntil=clock()+leaseMs;current.attempts=(current.attempts||0)+1;current.lastError=null;sources.set(id,current);return current;});
      try {
        const chunks=[];
        for(let offset=0;offset<source.text.length;offset+=2400){chunks.push({embedding_id:scope.embeddingId,source_id:id,chunk_id:`${id}_${String(chunks.length).padStart(5,'0')}`,revision:source.revision,
          status:'ready',deleted:false,audience_ids:source.audienceIds,title:source.title,text:source.text.slice(offset,offset+2400)});}
        await search.index(scope.embeddingId,chunks);
        return repository.transaction(()=>{const current=get(scope,id);if(current.status!=='indexing'||current.attemptId!==source.attemptId||current.leaseUntil<=clock())throw new Error('Source changed or ingestion lease expired');current.status='ready';current.chunks=chunks.length;current.completedAt=clock();sources.set(id,current);return {id,status:'ready',chunks:chunks.length};});
      }catch(error){repository.transaction(()=>{const current=get(scope,id);if(current.status==='indexing'&&current.attemptId===source.attemptId){current.status='failed';current.lastError='Indexing failed or expired; retry is safe.';sources.set(id,current);}});throw error;}
    },
    recoverExpired(){
      return repository.transaction(()=>{let recovered=0;for(const source of sources.values())if(source.status==='indexing'&&(source.leaseUntil||0)<=clock()){source.status='failed';source.lastError='Interrupted indexing; retry required.';sources.set(source.id,source);recovered++;}return {recovered};});
    },
    async remove(scope,id) {
      maintain(scope);
      // Deny retrieval before remote cleanup. A failed cleanup remains denied and retryable.
      repository.transaction(()=>{const current=get(scope,id);if(current.status==='indexing')throw new Error('Indexing in progress; retry deletion');current.status='deleted';current.text='';sources.set(id,current);});
      await search.remove(scope.embeddingId,id);
      return {id,status:'deleted'};
    },
    async retrieve(scope,{query,size=10,after=null}) {
      validScope(scope);
      const response=await search.search(scope,{query,size,after});
      const hits=response.hits?.hits;
      if(!Array.isArray(hits))throw new Error('Invalid search response');
      const evidence=[];
      for(const hit of hits){
        const chunk=hit._source, source=chunk&&sources.get(chunk.source_id);
        // Search snapshots never override authoritative deletion/revision/entitlement state.
        if(!source||source.embeddingId!==scope.embeddingId||source.status!=='ready'||source.revision!==chunk.revision||
           chunk.embedding_id!==scope.embeddingId||!source.audienceIds.some(a=>scope.audienceIds.includes(a)))continue;
        evidence.push({sourceId:source.id,chunkId:chunk.chunk_id,title:source.title,text:chunk.text,revision:source.revision});
      }
      return {evidence,next: hits.length===size?hits.at(-1)?.sort?.[0]||null:null};
    },
    available(scope){validScope(scope);return [...sources.values()].filter(s=>s.embeddingId===scope.embeddingId&&s.status==='ready'&&s.audienceIds.some(a=>scope.audienceIds.includes(a))).slice(0,100).map(s=>({id:s.id,title:s.title,status:s.status,revision:s.revision}));},
    list(scope) {maintain(scope);return [...sources.values()].filter(s=>s.embeddingId===scope.embeddingId).slice(0,100).map(({text,...source})=>source);},
  };
  return service;
}
