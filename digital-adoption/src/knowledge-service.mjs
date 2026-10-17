import { createHash,randomUUID } from 'node:crypto';
import {knowledgeScope,searchCursor} from './knowledge-scope.mjs';

export function createKnowledgeService(repository,search,{clock=Date.now,leaseMs=120_000}={}) {
  if(!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>600_000)throw new Error('Invalid ingestion lease');
  const sources=repository.map('sources');
  const validScope=scope=>{
    if (!scope || !/^[a-zA-Z0-9_-]{1,80}$/.test(scope.embeddingId) || !Array.isArray(scope.audienceIds) || !scope.audienceIds.length) throw new Error('Access denied');
  };
  const maintain=scope=>{validScope(scope);if(scope.role!=='maintainer')throw new Error('Access denied');};
  const get=(scope,id)=>{validScope(scope);const source=sources.get(id);if(!source||source.embeddingId!==scope.embeddingId)throw new Error('Source not found');return source;};
  const reserve=(scope,title)=>{maintain(scope);if(typeof title!=='string'||!title.trim()||title.length>200)throw new Error('Invalid source title');if(sources.values({embeddingId:scope.embeddingId}).filter(s=>s.status!=='deleted').length>=100)throw new Error('Embedding source quota reached');};
  const recipeVisible=(source,scope)=>{
    if(!source.recipeBinding)return true;
    const recipe=repository.map('recipes').get(source.recipeBinding.id),current=recipe?.versions?.at(-1);
    return scope.audienceIds.some(a=>recipe?.scope===`${scope.embeddingId}:${a}`)&&current?.status==='published'&&current.version===source.recipeBinding.version;
  };
  const service={
    createPending(scope,{id=randomUUID(),title,kind,bytes=0,uploadedBySessionId=null}){
      reserve(scope,title);
      if(!/^[a-f0-9-]{36}$/.test(id)||sources.get(id)||!['pdf','docx','text','html','image','video','url'].includes(kind))throw new Error('Invalid source');
      sources.set(id,{id,embeddingId:scope.embeddingId,title,kind,bytes,uploadedBySessionId,status:'queued',text:'',revision:'pending',audienceIds:[...scope.audienceIds],createdAt:clock()});
      return {id,status:'queued'};
    },
    extracted(scope,id,{sections,url=null}){
      maintain(scope);
      if(!Array.isArray(sections)||!sections.length||sections.length>300||sections.some(s=>typeof s.text!=='string'||typeof s.locator!=='string'||s.locator.length>120))throw new Error('Invalid extraction');
      const text=sections.map(s=>s.text).join('\n\n');
      if(!text.trim()||Buffer.byteLength(text)>200_000)throw new Error('Extracted content limit exceeded');
      const current=get(scope,id);
      if(current.status==='deleted')throw new Error('Source removed');
      const otherBytes=sources.values({embeddingId:scope.embeddingId}).filter(s=>s.id!==id&&s.status!=='deleted').reduce((n,s)=>n+Buffer.byteLength(s.text||''),0);
      if(otherBytes+Buffer.byteLength(text)>2_000_000)throw new Error('Embedding source quota reached');
      const revision=createHash('sha256').update(JSON.stringify({sections,url})).digest('hex');
      const previous={revision:current.revision,completedAt:current.completedAt};
      current.versions=[...(current.versions||[]),...(current.revision!=='pending'?[previous]:[])].slice(-20);
      Object.assign(current,{sections,text,revision,url,status:'pending',lastError:null});sources.set(id,current);
      return {id,status:'pending',revision};
    },
    processing(scope,id){maintain(scope);const current=get(scope,id);if(!['queued','failed','ready'].includes(current.status))throw new Error('Source is busy');current.status='extracting';current.lastError=null;sources.set(id,current);},
    extractionFailed(scope,id){maintain(scope);const current=get(scope,id);if(current.status!=='deleted'){current.status='failed';current.lastError='Extraction or indexing failed. Check file type, readability and size before retrying.';sources.set(id,current);}},
    inspect(scope,id){maintain(scope);return get(scope,id);},
    createText(scope,{title,text,recipeBinding=null}) {
      maintain(scope);
      if(typeof title!=='string'||!title.trim()||title.length>200||typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>200_000)throw new Error('Invalid text source');
      const active=sources.values({embeddingId:scope.embeddingId}).filter(s=>s.status!=='deleted');
      if(active.length>=100||active.reduce((sum,s)=>sum+Buffer.byteLength(s.text||''),0)+Buffer.byteLength(text)>2_000_000)throw new Error('Embedding source quota reached');
      if(recipeBinding&&(!/^[a-f0-9-]{36}$/.test(recipeBinding.id)||!Number.isInteger(recipeBinding.version)))throw new Error('Invalid recipe reference');
      const source={id:randomUUID(),embeddingId:scope.embeddingId,title,text,status:'pending',revision:createHash('sha256').update(text).digest('hex'),audienceIds:[...scope.audienceIds],...(recipeBinding?{recipeBinding}:{})};
      sources.set(source.id,source);return {id:source.id,status:source.status};
    },
    async ingest(scope,id) {
      maintain(scope);
      const existing=get(scope,id);if(existing.status==='ready')return {id,status:'ready',reused:true};
      const source=repository.transaction(()=>{const current=get(scope,id);if(!['pending','failed'].includes(current.status)&&!(current.status==='indexing'&&(current.leaseUntil||0)<=clock()))throw new Error('Source cannot be indexed');current.status='indexing';current.attemptId=randomUUID();current.leaseUntil=clock()+leaseMs;current.attempts=(current.attempts||0)+1;current.lastError=null;sources.set(id,current);return current;});
      try {
        const chunks=[];
        for(const section of source.sections||[{text:source.text,locator:'Document'}])for(let offset=0;offset<section.text.length;offset+=2400){chunks.push({embedding_id:scope.embeddingId,source_id:id,chunk_id:`${id}_${String(chunks.length).padStart(5,'0')}`,revision:source.revision,
          status:'ready',deleted:false,audience_ids:source.audienceIds,title:source.title,text:section.text.slice(offset,offset+2400),locator:section.locator,...(source.url?{url:source.url}:{})});}
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
      repository.transaction(()=>{const current=get(scope,id);current.status='deleted';current.text='';delete current.sections;sources.set(id,current);});
      await search.remove(scope.embeddingId,id);
      return {id,status:'deleted'};
    },
    async retrieve(scope,{query,size=10,after=null}) {
      validScope(scope);
      knowledgeScope(scope).search({query,size,after}); // Validate even when this embedding has no eligible sources.
      const eligible=sources.values({embeddingId:scope.embeddingId}).filter(source=>source.status==='ready'&&source.audienceIds.some(a=>scope.audienceIds.includes(a))&&recipeVisible(source,scope));
      if(!eligible.length)return {evidence:[],next:null};
      const response=await search.search({...scope,sourceRevisions:eligible.map(({id,revision})=>({id,revision}))},{query,size,after});
      const hits=response.hits?.hits;
      if(!Array.isArray(hits))throw new Error('Invalid search response');
      const evidence=[];
      for(const hit of hits){
        const chunk=hit._source, source=chunk&&sources.get(chunk.source_id);
        // Search snapshots never override authoritative deletion/revision/entitlement state.
        if(!source||source.embeddingId!==scope.embeddingId||source.status!=='ready'||source.revision!==chunk.revision||
           chunk.embedding_id!==scope.embeddingId||!source.audienceIds.some(a=>scope.audienceIds.includes(a)))continue;
        if(!recipeVisible(source,scope))continue;
        evidence.push({sourceId:source.id,chunkId:chunk.chunk_id,title:source.title,text:chunk.text,revision:source.revision,...(chunk.locator?{locator:chunk.locator}:{}),...(source.url?{url:source.url}:{})});
      }
      return {evidence,next: hits.length===size?(searchCursor(hits.at(-1)?.sort)||hits.at(-1)?.sort?.[0]||null):null};
    },
    available(scope){validScope(scope);return sources.values({embeddingId:scope.embeddingId}).filter(s=>s.status==='ready'&&s.audienceIds.some(a=>scope.audienceIds.includes(a))&&recipeVisible(s,scope)).slice(0,100).map(s=>({id:s.id,title:s.title,status:s.status,revision:s.revision}));},
    list(scope) {maintain(scope);return sources.values({embeddingId:scope.embeddingId}).slice(0,100).map(({text,sections,uploadedBySessionId,...source})=>source);},
  };
  return service;
}
