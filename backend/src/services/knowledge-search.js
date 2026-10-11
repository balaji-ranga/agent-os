import { opensearchRequest } from './opensearch/client.js';
import { chunkText } from './opensearch/documents.js';
import { embedTexts } from './opensearch/embeddings.js';
import { embeddingDims } from './opensearch/indices.js';
import { entityId, fingerprint } from './knowledge-contract.js';

export function knowledgeSearch(request=opensearchRequest) {
  const index = owner => `aos-knowledge-${fingerprint(owner).slice(0,24)}`;
  const current = (owner,sources) => [ {term:{owner}}, {bool:{should:sources.map(s=>({bool:{filter:[{term:{source:s.id}},{term:{revision:s.revision}}]}})),minimum_should_match:1}} ];
  const search = async (owner,query,size=100) => {
    try { const result=await request('POST',`/${index(owner)}/_search`,{size,query},{timeoutMs:10000}); return (result?.hits?.hits||[]).map(h=>({...h._source,score:h._score})); }
    catch(error) { if(error.status===404)return []; throw error; }
  };
  return {
    async ensure(owner) {
      try { await request('PUT',`/${index(owner)}`,{settings:{index:{knn:true,number_of_shards:1,number_of_replicas:0}},mappings:{dynamic:false,properties:{
        owner:{type:'keyword'},source:{type:'keyword'},revision:{type:'keyword'},entity:{type:'keyword'},kind:{type:'keyword'},title:{type:'text'},text:{type:'text'},
        from:{type:'keyword'},to:{type:'keyword'},embedding:{type:'knn_vector',dimension:embeddingDims()}
      }}}); } catch(error) { if(!JSON.stringify(error.body||error.message).includes('resource_already_exists_exception'))throw error; }
    },
    async putRecord(owner,source,revision,record) {
      const id=entityId(owner,source.id,record.object_id);
      const base={owner,source:source.id,revision,entity:id,title:record.title,object_id:record.object_id,url:record.url||null,modified_at:record.modified_at};
      await request('PUT',`/${index(owner)}/_doc/${fingerprint([revision,id])}`,{...base,kind:'entity',fields:record.fields||{},text:record.text,content_hash:fingerprint(record.text)});
      const chunks=chunkText(record.text,1800,180);
      for(let start=0;start<chunks.length;start+=8) {
        const texts=chunks.slice(start,start+8); const vectors=await embedTexts(texts);
        const body=texts.map((text,i)=>JSON.stringify({index:{_id:fingerprint([revision,id,start+i])}})+'\n'+JSON.stringify({
          ...base,kind:'chunk',text,chunk:start+i,...(vectors[i]?.length===embeddingDims()?{embedding:vectors[i]}:{})
        })).join('\n')+'\n';
        const result=await request('POST',`/${index(owner)}/_bulk`,body,{contentType:'application/x-ndjson'});
        if(result?.errors)throw new Error('Knowledge chunk indexing failed');
      }
      if(source.graph_enabled) for(const relation of record.relations||[]) {
        await request('PUT',`/${index(owner)}/_doc/${fingerprint([revision,id,relation])}`,{
          ...base,kind:'edge',from:id,to:entityId(owner,source.id,relation.target),relation:relation.relation,
          evidence:{object_id:record.object_id,source_id:source.id,revision,origin:'native_record'},
        });
      }
    },
    async refresh(owner) { await request('POST',`/${index(owner)}/_refresh`); },
    async discard(owner,revision) {
      await request('POST',`/${index(owner)}/_delete_by_query`,{query:{bool:{filter:[{term:{owner}},{term:{revision}}]}}});
    },
    async prune(owner,source,revision) {
      await request('POST',`/${index(owner)}/_delete_by_query?conflicts=proceed`,{query:{bool:{filter:[{term:{owner}},{term:{source}}],must_not:[{term:{revision}}]}}});
    },
    async documents(owner,sources,query) {
      if(!sources.length)return [];
      const [vector]=await embedTexts([query],{timeoutMs:Number(process.env.KNOWLEDGE_QUERY_EMBED_TIMEOUT_MS)||5000});
      const should=[{multi_match:{query,fields:['text','title^2']}}];
      if(vector?.length===embeddingDims())should.push({knn:{embedding:{vector,k:20}}});
      return search(owner,{bool:{filter:[...current(owner,sources),{term:{kind:'chunk'}}],should,minimum_should_match:1}},20);
    },
    async entities(owner,sources,ids=null) {
      if(!sources.length)return [];
      return search(owner,{bool:{filter:[...current(owner,sources),{term:{kind:'entity'}},...(ids?[{terms:{entity:ids}}]:[])]}},ids?.length||100);
    },
    async edges(owner,sources,ids) {
      if(!sources.length||!ids.length)return [];
      return search(owner,{bool:{filter:[...current(owner,sources),{term:{kind:'edge'}}],should:[{terms:{from:ids}},{terms:{to:ids}}],minimum_should_match:1}},200);
    },
  };
}
