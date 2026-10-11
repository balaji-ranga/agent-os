import { opensearchRequest } from './opensearch/client.js';
import { chunkText } from './opensearch/documents.js';
import { embedTexts } from './opensearch/embeddings.js';
import { embeddingDims } from './opensearch/indices.js';
import { entityId, fingerprint } from './knowledge-contract.js';
import { recordPageOptions, recordPreview } from './knowledge-record-page.js';
import { indexedFields, fieldToken } from './knowledge-field-rules.js';

export function knowledgeSearch(transport=opensearchRequest,{deadline=null,embed=embedTexts}={}) {
  const embeddingProfile=fingerprint([
    process.env.OPENSEARCH_EMBEDDING_MODEL||process.env.EMBEDDING_MODEL_ID||'Qwen/Qwen3-Embedding-0.6B',
    process.env.OPENSEARCH_EMBEDDING_BASE_URL||process.env.EMBEDDINGS_BASE_URL||'http://embeddings:8080/v1',
    embeddingDims(),
  ]);
  const budget=()=>{
    const remaining=deadline==null?10000:deadline-Date.now();
    if(remaining<1000)throw new Error('Knowledge retrieval deadline exceeded; narrow the question or source scope');
    return Math.min(10000,remaining);
  };
  const request=(method,path,body,options={})=>transport(method,path,body,{
    ...options,...(deadline==null?{}:{timeoutMs:Math.min(options.timeoutMs||10000,budget())}),
  });
  const index = owner => `aos-knowledge-${fingerprint(owner).slice(0,24)}`;
  const current = (owner,sources) => [ {term:{owner}}, {bool:{should:sources.map(s=>({bool:{filter:[{term:{source:s.id}},{term:{revision:s.revision}}]}})),minimum_should_match:1}} ];
  const search = async (owner,query,size=100) => {
    try { const result=await request('POST',`/${index(owner)}/_search`,{size,query,_source:{excludes:['field_tokens','field_names','embedding']}},{timeoutMs:10000}); return (result?.hits?.hits||[]).map(h=>({...h._source,score:h._score})); }
    catch(error) { if(error.status===404)return []; throw error; }
  };
  return {
    async ensure(owner) {
      try { await request('PUT',`/${index(owner)}`,{settings:{index:{knn:true,number_of_shards:1,number_of_replicas:0}},mappings:{dynamic:false,properties:{
        owner:{type:'keyword'},source:{type:'keyword'},revision:{type:'keyword'},entity:{type:'keyword'},kind:{type:'keyword'},title:{type:'text'},text:{type:'text'},
        from:{type:'keyword'},to:{type:'keyword'},embedding:{type:'knn_vector',dimension:embeddingDims()}
      }}}); } catch(error) { if(!JSON.stringify(error.body||error.message).includes('resource_already_exists_exception'))throw error; }
      await request('PUT',`/${index(owner)}/_mapping`,{properties:{field_tokens:{type:'keyword'},field_names:{type:'keyword'},collection:{type:'keyword'}}});
    },
    async putRecord(owner,source,revision,record) {
      const id=entityId(owner,source.id,record.object_id);
      const base={owner,source:source.id,revision,entity:id,title:record.title,object_id:record.object_id,url:record.url||null,modified_at:record.modified_at};
      await request('PUT',`/${index(owner)}/_doc/${fingerprint([revision,id])}`,{...base,kind:'entity',preview:recordPreview(record),collection:record.object_id.split('/')[0],...indexedFields(record),fields:record.fields||{},text:record.text,content_hash:fingerprint(record.text)});
      const chunks=chunkText(record.text,1800,180);
      for(let start=0;start<chunks.length;start+=8) {
        const texts=chunks.slice(start,start+8);
        const vectors=texts.map(()=>null),missing=[];
        if(source.revision) {
          const previous=await request('POST',`/${index(owner)}/_mget`,{ids:texts.map((_,i)=>fingerprint([source.revision,id,start+i]))});
          for(let i=0;i<texts.length;i++) {
            const cached=previous.docs?.[i]?._source;
            if(cached?.owner===owner&&cached.entity===id&&cached.text===texts[i]&&cached.embedding_profile===embeddingProfile&&cached.embedding?.length===embeddingDims())vectors[i]=cached.embedding;
          }
        }
        texts.forEach((text,i)=>{if(!vectors[i])missing.push({text,i});});
        if(missing.length){const fresh=await embed(missing.map(item=>item.text));missing.forEach((item,i)=>{vectors[item.i]=fresh[i];});}
        const body=texts.map((text,i)=>JSON.stringify({index:{_id:fingerprint([revision,id,start+i])}})+'\n'+JSON.stringify({
          ...base,kind:'chunk',text,chunk:start+i,embedding_profile:embeddingProfile,...(vectors[i]?.length===embeddingDims()?{embedding:vectors[i]}:{})
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
    async discardSource(owner,source) {
      await request('POST',`/${index(owner)}/_delete_by_query?refresh=true`,{query:{bool:{filter:[{term:{owner}},{term:{source}}]}}});
    },
    async discard(owner,revision) {
      await request('POST',`/${index(owner)}/_delete_by_query`,{query:{bool:{filter:[{term:{owner}},{term:{revision}}]}}});
    },
    async documents(owner,sources,query) {
      if(!sources.length)return [];
      const [vector]=await embed([query],{timeoutMs:Math.min(Number(process.env.KNOWLEDGE_QUERY_EMBED_TIMEOUT_MS)||5000,budget())});
      const should=[{multi_match:{query,fields:['text','title^2']}}];
      if(vector?.length===embeddingDims())should.push({knn:{embedding:{vector,k:20}}});
      return search(owner,{bool:{filter:[...current(owner,sources),{term:{kind:'chunk'}}],should,minimum_should_match:1}},20);
    },
    async entities(owner,sources,ids=null) {
      if(!sources.length)return [];
      return search(owner,{bool:{filter:[...current(owner,sources),{term:{kind:'entity'}},...(ids?[{terms:{entity:ids}}]:[])]}},ids?.length||100);
    },
    async browse(owner,sources,after=null,options={}) {
      if(!sources.length)return {records:[],next:null};
      const page=recordPageOptions(owner,sources[0],after,options);
      const filters=[...current(owner,sources),{term:{kind:'entity'}}];
      if(page.query)filters.push({bool:{should:[
        {multi_match:{query:page.query,fields:['title^3','text'],operator:'and'}},
        {terms:{entity:sources.map(source=>entityId(owner,source.id,page.query))}},
      ],minimum_should_match:1}});
      const result=await request('POST',`/${index(owner)}/_search`,{
        size:page.limit+1,track_total_hits:false,sort:[{entity:'asc'}],...(page.entity?{search_after:[page.entity]}:{}),
        ...(page.compact?{_source:['entity','title','preview','object_id','source','revision','modified_at']}:{_source:{excludes:['field_tokens','field_names','embedding']}}),
        ...(page.query?{highlight:{pre_tags:[''],post_tags:[''],fields:{text:{fragment_size:240,number_of_fragments:1}}}}:{}),
        query:{bool:{filter:filters}},
      },{timeoutMs:10000});
      const hits=result?.hits?.hits||[];
      const visible=hits.slice(0,page.limit);
      return {records:visible.map(h=>({...h._source,...(h.highlight?.text?.[0]?{preview:String(h.highlight.text[0]).replace(/\s+/g,' ').slice(0,240)}:{})})),next:hits.length>page.limit?page.cursor(visible.at(-1).sort[0]):null};
    },
    async edges(owner,sources,ids) {
      if(!sources.length||!ids.length)return [];
      return search(owner,{bool:{filter:[...current(owner,sources),{term:{kind:'edge'}}],should:[{terms:{from:ids}},{terms:{to:ids}}],minimum_should_match:1}},200);
    },
    async matchField(owner,source,collection,field,value,normalization='exact'){
      return search(owner,{bool:{filter:[...current(owner,[source]),{term:{kind:'entity'}},{term:{collection}},{term:{field_tokens:fieldToken(field,value,normalization)}}]}},2);
    },
    async fields(owner,source,collection){
      const result=await request('POST',`/${index(owner)}/_search`,{size:0,query:{bool:{filter:[...current(owner,[source]),{term:{kind:'entity'}},{term:{collection}}]}},aggs:{fields:{terms:{field:'field_names',size:200}}}});
      return (result.aggregations?.fields?.buckets||[]).map(b=>b.key);
    },
  };
}
