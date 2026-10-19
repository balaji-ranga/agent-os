import { knowledgeScope } from './knowledge-scope.mjs';
import { createPrivateTaskSearch } from './private-task-search.mjs';

// URL and authorization are trusted deployment configuration, never client input.
export function createOpenSearch({ url, authorization, fetchImpl = fetch, development = false, privateNetwork = false }) {
  const base=new URL(url);
  const allowedHttp=base.protocol==='http:'&&((development&&['127.0.0.1','localhost'].includes(base.hostname))||(privateNetwork&&base.hostname==='opensearch'));
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
      (base.protocol !== 'https:' && !allowedHttp)) throw new Error('Invalid search endpoint');
  async function request(path, method, body, ndjson=false,timeoutMs=15_000) {
    let response,result;try{response=await fetchImpl(new URL(path,base),{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),
      headers:{'Content-Type':ndjson?'application/x-ndjson':'application/json',...(authorization?{Authorization:authorization}:{})},
      ...(body===undefined?{}:{body:ndjson?body:JSON.stringify(body)})});
    result=await response.json();}catch{throw new Error('Search operation failed');}
    if (!response.ok || result.errors || result._shards?.failed>0 || result.timed_out || result.failures?.length) throw Object.assign(new Error('Search operation failed'), { statusCode: response.status });
    return result;
  }
  const indexFor=embeddingId=>knowledgeScope({embeddingId,audienceIds:['public']}).index;
  const lexicalText=()=>({type:'text',fields:{english:{type:'text',analyzer:'english'}}});
  return {
    privateTasks: createPrivateTaskSearch({ request }),
    async provision(embeddingId) {
      const index=indexFor(embeddingId);
      const exists=await fetchImpl(new URL(`/${index}`,base),{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(15_000),headers:authorization?{Authorization:authorization}:{}});
      if(exists.ok){
        const mappings=(await request(`/${index}/_mapping`,'GET'))[index]?.mappings||{};
        const complete=mappings._meta?.adoptionLexicalVersion===1&&['text','title'].every(name=>mappings.properties?.[name]?.fields?.english?.analyzer==='english');
        if(!complete){
          await request(`/${index}/_mapping`,'PUT',{properties:{title:lexicalText(),text:lexicalText(),locator:{type:'keyword'},url:{type:'keyword',ignore_above:2048}}});
          // Reindex the same source documents to populate additive subfields.
          // Mark complete only after every scoped document was updated; a
          // failure remains retryable and never changes source authorization.
          await request(`/${index}/_update_by_query?refresh=true`,'POST',{query:{term:{embedding_id:embeddingId}}},false,60_000);
          await request(`/${index}/_mapping`,'PUT',{_meta:{...mappings._meta,adoptionLexicalVersion:1}});
        }
        return {acknowledged:true,existing:true,lexicalVersion:1};
      }
      if(exists.status!==404)throw new Error('Search provisioning check failed');
      return request(`/${index}`,'PUT',{settings:{number_of_shards:1,number_of_replicas:0},mappings:{dynamic:'strict',_meta:{adoptionLexicalVersion:1},properties:{
        embedding_id:{type:'keyword'},source_id:{type:'keyword'},chunk_id:{type:'keyword'},revision:{type:'keyword'},
        status:{type:'keyword'},deleted:{type:'boolean'},audience_ids:{type:'keyword'},title:lexicalText(),text:lexicalText(),locator:{type:'keyword'},url:{type:'keyword',ignore_above:2048},
      }}});
    },
    async index(embeddingId,chunks) {
      const index=indexFor(embeddingId);
      if (!Array.isArray(chunks) || chunks.length>300 || chunks.some(c=>c.embedding_id!==embeddingId)) throw new Error('Invalid indexing batch');
      const lines=chunks.flatMap(chunk=>[JSON.stringify({index:{_index:index,_id:chunk.chunk_id}}),JSON.stringify(chunk)]).join('\n')+'\n';
      return request('/_bulk?refresh=wait_for','POST',lines,true);
    },
    async remove(embeddingId,sourceId) {
      if (typeof sourceId!=='string' || !/^[a-f0-9-]{36}$/.test(sourceId)) throw new Error('Invalid source ID');
      return request(`/${indexFor(embeddingId)}/_delete_by_query?refresh=true`,'POST',{query:{bool:{filter:[{term:{embedding_id:embeddingId}},{term:{source_id:sourceId}}]}}});
    },
    async search(scope,input) {
      const query=knowledgeScope(scope).search(input);
      return request(`/${query.index}/_search`,'POST',query.body);
    },
  };
}
