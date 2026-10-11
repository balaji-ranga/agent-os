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
  const versionFilter=s=>String(s.revision||'').startsWith('g:')?[{range:{valid_from:{lte:Number(s.revision.slice(2))}}},{range:{valid_to:{gt:Number(s.revision.slice(2))}}}]:[{term:{revision:s.revision}}];
  const current = (owner,sources) => [ {term:{owner}}, {bool:{should:sources.map(s=>({bool:{filter:[{term:{source:s.id}},...versionFilter(s)]}})),minimum_should_match:1}} ];
  const scoped=(owner,source,extra=[])=>({bool:{filter:[{term:{owner}},{term:{source:source.id}},...extra]}});
  const entityOf=(owner,source,id)=>entityId(owner,source.id,id);
  // Public cursors/evidence refer to the published view; retain the immutable
  // object version separately so unchanged objects need no rewriting.
  const view=(rows,sources)=>rows.map(row=>{const source=sources.find(s=>s.id===row.source);return source&&String(source.revision).startsWith('g:')?{...row,object_revision:row.revision,revision:source.revision}:row;});
  const close=async(owner,source,entity,generation)=>request('POST',`/${index(owner)}/_update_by_query?refresh=true&conflicts=proceed`,{query:scoped(owner,source,[{term:{entity}},{range:{valid_from:{lt:generation}}},{range:{valid_to:{gt:generation}}}]),script:{lang:'painless',source:'ctx._source.valid_to=params.g',params:{g:generation}}});
  const search = async (owner,query,size=100) => {
    try { const result=await request('POST',`/${index(owner)}/_search`,{size,query,_source:{excludes:['field_tokens','field_names','embedding']}},{timeoutMs:10000}); return (result?.hits?.hits||[]).map(h=>({...h._source,score:h._score})); }
    catch(error) { if(error.status===404)return []; throw error; }
  };
  return {
    processingProfile:embeddingProfile,
    async putAdviceEdge(owner,source,item) {
      const generation=String(source.revision).startsWith('g:')?Number(source.revision.slice(2)):null;
      await request('PUT',`/${index(owner)}/_doc/${fingerprint(['model_relationship',owner,item.from_source,item.from_object,item.to_source,item.to_object,item.relation])}?refresh=true`,{
        owner,source:source.id,revision:source.revision,kind:'edge',
        ...(generation===null?{}:{valid_from:generation,valid_to:9007199254740991}),
        from:entityId(owner,item.from_source,item.from_object),to:entityId(owner,item.to_source,item.to_object),relation:item.relation,
        evidence:{origin:'model_inferred',advice_id:item.id,note:item.reason,confidence:item.confidence,
          from_quote:item.from_quote,to_quote:item.to_quote,model:item.model||null},
      });
    },
    async deleteIndexedRecords(owner,source,ids){
      const entities=ids.map(id=>entityOf(owner,source,id));
      await request('POST',`/${index(owner)}/_delete_by_query?refresh=true`,{query:scoped(owner,source,[{bool:{should:[{terms:{entity:entities}},{terms:{from:entities}},{terms:{to:entities}}],minimum_should_match:1}}])});
    },
    async markIncrementalSeen(owner,source,draft,objectId,version,scan){
      const id=entityOf(owner,source,objectId);
      const previous=await request('POST',`/${index(owner)}/_mget`,{ids:[fingerprint([`g:${version}`,id])]});
      const doc=previous.docs?.[0]?._source;
      if(!doc||doc.valid_to<=draft.generation)return false;
      await request('POST',`/${index(owner)}/_update/${fingerprint([`g:${version}`,id])}`,{doc:{seen_scan:scan}});
      return true;
    },
    async putIncrementalRecord(owner,source,draft,record,hash,scan){
      const id=entityOf(owner,source,record.object_id),revision=`g:${draft.generation}`;
      // A failed object may have written partial chunks; clear only its draft.
      await request('POST',`/${index(owner)}/_delete_by_query?refresh=true`,{query:scoped(owner,source,[{term:{entity:id}},{term:{revision}}])});
      await this.putRecord(owner,source,revision,record,{valid_from:draft.generation,valid_to:9007199254740991,seen_scan:scan,record_hash:hash});
      await close(owner,source,id,draft.generation);
    },
    async closeUnseenIncremental(owner,source,draft,scan){
      await this.refresh(owner);let deleted=0;
      for(;;){
        const rows=await search(owner,{bool:{filter:[...current(owner,[{...source,revision:`g:${draft.generation}`}]),{term:{kind:'entity'}}],must_not:[{term:{seen_scan:scan}}]}},100);
        if(!rows.length)break;
        for(const row of rows){
          await request('POST',`/${index(owner)}/_update_by_query?refresh=true&conflicts=proceed`,{query:scoped(owner,source,[{term:{entity:row.entity}},{range:{valid_to:{gt:draft.generation}}}]),script:{lang:'painless',source:'ctx._source.valid_to=params.g',params:{g:draft.generation}}});deleted++;
        }
      }
      return deleted;
    },
    async pruneIncremental(owner,source,generation){
      await request('POST',`/${index(owner)}/_delete_by_query?refresh=true`,{query:scoped(owner,source,[{bool:{should:[{range:{valid_to:{lte:generation}}},{bool:{must_not:[{exists:{field:'valid_from'}}]}}],minimum_should_match:1}}])});
    },
    async ensure(owner) {
      try { await request('PUT',`/${index(owner)}`,{settings:{index:{knn:true,number_of_shards:1,number_of_replicas:0}},mappings:{dynamic:false,properties:{
        owner:{type:'keyword'},source:{type:'keyword'},revision:{type:'keyword'},entity:{type:'keyword'},kind:{type:'keyword'},title:{type:'text'},text:{type:'text'},
        from:{type:'keyword'},to:{type:'keyword'},embedding:{type:'knn_vector',dimension:embeddingDims()}
      }}}); } catch(error) { if(!JSON.stringify(error.body||error.message).includes('resource_already_exists_exception'))throw error; }
      await request('PUT',`/${index(owner)}/_mapping`,{properties:{field_tokens:{type:'keyword'},field_names:{type:'keyword'},collection:{type:'keyword'},valid_from:{type:'long'},valid_to:{type:'long'},seen_scan:{type:'keyword'}}});
    },
    async putRecord(owner,source,revision,record,version={}) {
      const id=entityId(owner,source.id,record.object_id);
      const base={owner,source:source.id,revision,entity:id,title:record.title,object_id:record.object_id,url:record.url||null,modified_at:record.modified_at,...version};
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
      return view(await search(owner,{bool:{filter:[...current(owner,sources),{term:{kind:'chunk'}}],should,minimum_should_match:1}},20),sources);
    },
    async entities(owner,sources,ids=null) {
      if(!sources.length)return [];
      return view(await search(owner,{bool:{filter:[...current(owner,sources),{term:{kind:'entity'}},...(ids?[{terms:{entity:ids}}]:[])]}},ids?.length||100),sources);
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
      return {records:view(visible.map(h=>({...h._source,...(h.highlight?.text?.[0]?{preview:String(h.highlight.text[0]).replace(/\s+/g,' ').slice(0,240)}:{})})),sources),next:hits.length>page.limit?page.cursor(visible.at(-1).sort[0]):null};
    },
    async edges(owner,sources,ids) {
      if(!sources.length||!ids.length)return [];
      return view(await search(owner,{bool:{filter:[...current(owner,sources),{term:{kind:'edge'}}],should:[{terms:{from:ids}},{terms:{to:ids}}],minimum_should_match:1}},200),sources);
    },
    async matchField(owner,source,collection,field,value,normalization='exact'){
      return view(await search(owner,{bool:{filter:[...current(owner,[source]),{term:{kind:'entity'}},{term:{collection}},{term:{field_tokens:fieldToken(field,value,normalization)}}]}},2),[source]);
    },
    async fields(owner,source,collection){
      const result=await request('POST',`/${index(owner)}/_search`,{size:0,query:{bool:{filter:[...current(owner,[source]),{term:{kind:'entity'}},{term:{collection}}]}},aggs:{fields:{terms:{field:'field_names',size:200}}}});
      return (result.aggregations?.fields?.buckets||[]).map(b=>b.key);
    },
  };
}
