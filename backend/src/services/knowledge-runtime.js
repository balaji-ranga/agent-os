import { randomUUID } from 'node:crypto';
import { knowledgeStore } from './knowledge-store.js';
import { knowledgeSearch } from './knowledge-search.js';
import { sourceRecords, assertKnowledgeSourceAccess } from './knowledge-source-adapters.js';
import { entityId } from './knowledge-contract.js';
import { fieldRuleEdges } from './knowledge-field-rules.js';

export async function cleanupKnowledgeSources({store=knowledgeStore(),search=knowledgeSearch()}={}) {
  for(const item of store.cleanupPending()) {
    try {
      await search.ensure(item.owner);
      await search.discardSource(item.owner,item.source_id);
      store.cleanupFinished(item.owner,item.source_id);
    } catch {console.warn('[knowledge] source cleanup deferred',item.source_id);}
  }
}

export async function browseKnowledge(owner,sourceId,after=null,options={}) {
  const store=knowledgeStore();
  const source=store.get(owner,sourceId);
  if(!source)throw Object.assign(new Error('Source not found'),{status:404});
  if(!source.enabled||!source.revision||!['ready','syncing'].includes(source.status))return {records:[],next:null};
  await assertKnowledgeSourceAccess(owner,source);
  const result=await knowledgeSearch().browse(owner,[source],after,options);
  const latest=store.get(owner,sourceId);
  await assertKnowledgeSourceAccess(owner,latest);
  if(!latest.enabled||latest.revision!==source.revision||!['ready','syncing'].includes(latest.status))return {records:[],next:null};
  return result;
}

export async function runKnowledgeJob(job,{store=knowledgeStore(),search=knowledgeSearch(),records=sourceRecords}={}) {
  const source=store.get(job.owner,job.source_id); const revision=randomUUID(); let count=0;
  let lost=null;
  const controller=new AbortController();
  const heartbeat=setInterval(()=>{try{store.heartbeat(job,count);}catch(error){lost=error;controller.abort(error);}},30000);
  heartbeat.unref?.();
  try {
    await search.ensure(job.owner);
    store.heartbeat(job,count);
    for await(const record of records(job.owner,source,{signal:controller.signal})) {
      if(lost)throw lost;
      store.recordProgress?.(job,record.object_id,'indexing');
      try{
        await search.putRecord(job.owner,source,revision,record);
        store.recordProgress?.(job,record.object_id,'indexed');
      }catch(error){
        store.recordProgress?.(job,record.object_id,'failed','Indexing failed; synchronization retry is scheduled.');
        throw error;
      }
      count++;
      store.heartbeat(job,count);
    }
    await search.refresh(job.owner);
    if(lost)throw lost;
    store.finish(job,revision);
    // Cleanup failure must not reverse a successfully published snapshot.
    // Delete only the revision replaced by this job, never a newer worker's draft.
    try {if(source.revision)await search.discard?.(job.owner,source.revision);} catch {console.warn('[knowledge] obsolete revision cleanup deferred',job.id);}
    return {status:'completed',records:count,revision};
  } catch(error) {
    const message=String(error.message||error).slice(0,500);
    // An expired worker must not overwrite the replacement worker's state.
    try {store.finish(job,null,message,{retryAfterMs:error.retry_after_ms});} catch { /* lease ownership was lost */ }
    try {await search.discard?.(job.owner,revision);} catch {console.warn('[knowledge] failed revision cleanup deferred',job.id);}
    return {status:'failed',records:count,error:message};
  } finally {clearInterval(heartbeat);}
}

export async function connectedKnowledge(owner,{query,depth=3,source_ids=null}={},deps={}) {
  if(!owner)throw new Error('Owner required');
  if(typeof query!=='string'||!query.trim()||query.length>4000)throw new Error('Enter a question up to 4000 characters');
  const store=deps.store||knowledgeStore();const search=deps.search||knowledgeSearch(undefined,{deadline:Date.now()+Math.min(60000,Math.max(5000,Number(process.env.KNOWLEDGE_QUERY_TIMEOUT_MS)||30000))});
  if(source_ids!==null&&(!Array.isArray(source_ids)||source_ids.some(id=>typeof id!=='string')))throw new Error('source_ids must be an array of source IDs');
  const sources=store.list(owner).filter(s=>s.enabled&&s.revision&&['ready','syncing'].includes(s.status)&&(!source_ids||source_ids.includes(s.id)));
  const allowed=[];const unavailable=[];
  for(const source of sources) {
    try{await (deps.assertAccess||assertKnowledgeSourceAccess)(owner,source);allowed.push(source);}
    catch{unavailable.push(source.id);}
  }
  const hits=await search.documents(owner,allowed,query);
  const entities=new Map((await search.entities(owner,allowed,[...new Set(hits.map(h=>h.entity))])).map(e=>[e.entity,e]));
  const edges=[]; let frontier=[...entities.keys()];
  const graphSources=allowed.filter(s=>s.graph_enabled);
  const graphIds=new Set(graphSources.map(s=>s.id));
  const rules=store.fieldRules?.(owner)||[];
  for(let hop=0;hop<Math.min(4,Math.max(0,Number(depth)||0))&&frontier.length&&entities.size<100;hop++) {
    const native=await search.edges(owner,graphSources,frontier);
    const mappings=(store.mappingsFor?store.mappingsFor(owner,frontier.map(id=>entities.get(id))):store.mappings(owner)).filter(m=>graphIds.has(m.from_source)&&graphIds.has(m.to_source));
    const explicit=mappings.map(m=>({from:entityId(owner,m.from_source,m.from_object),to:entityId(owner,m.to_source,m.to_object),relation:m.relation,evidence:{origin:'explicit_mapping',mapping_id:m.id,note:m.note}}))
      .filter(e=>frontier.includes(e.from)||frontier.includes(e.to));
    const ruled=search.matchField?await fieldRuleEdges(owner,frontier,entities,graphSources,rules,search):[];
    const candidate=[...native,...explicit,...ruled];
    const ids=[...new Set(candidate.flatMap(e=>[e.from,e.to]))].filter(id=>!entities.has(id)).slice(0,100-entities.size);
    const next=ids.length?await search.entities(owner,graphSources,ids):[];
    next.forEach(e=>entities.set(e.entity,e));
    for(const edge of candidate) if(entities.has(edge.from)&&entities.has(edge.to)&&!edges.some(e=>e.from===edge.from&&e.to===edge.to&&e.relation===edge.relation))edges.push(edge);
    frontier=next.map(e=>e.entity);
  }
  // Recheck source eligibility after I/O to avoid returning a revision disabled during retrieval.
  const current=new Set();
  for(const source of store.list(owner).filter(s=>s.enabled&&['ready','syncing'].includes(s.status)&&allowed.some(a=>a.id===s.id))) {
    try {await (deps.assertAccess||assertKnowledgeSourceAccess)(owner,source);current.add(`${source.id}:${source.revision}`);} catch {unavailable.push(source.id);}
  }
  const visible=[...entities.values()].filter(e=>current.has(`${e.source}:${e.revision}`));
  const visibleIds=new Set(visible.map(e=>e.entity));
  let remaining=40000;
  const evidence=visible.map(record=>{
    const passages=hits.filter(h=>h.entity===record.entity).slice(0,2).map(h=>h.text).filter(Boolean);
    const text=String(passages.length?passages.join('\n\n'):record.text||'').slice(0,Math.max(0,Math.min(4000,remaining)));
    remaining-=text.length;
    const fields=JSON.stringify(record.fields||{}).length<=4000?record.fields:{};
    return {...record,text,fields,text_truncated:text.length<String(record.text||'').length};
  });
  return {query,retrieval_mode:'connected_information',evidence,
    chunks:hits.filter(h=>visibleIds.has(h.entity)).map(({embedding,...hit})=>hit),relationships:edges.filter(e=>visibleIds.has(e.from)&&visibleIds.has(e.to)).slice(0,100).map(e=>({...e,evidence:e.evidence?{...e.evidence,...(e.evidence.note?{note:e.evidence.note.slice(0,300)}:{})}:undefined})),
    sources:allowed.filter(s=>current.has(`${s.id}:${s.revision}`)).map(s=>({id:s.id,name:s.name,last_success:s.last_success})),
    unavailable_sources:unavailable, note:'Indexed snapshots; freshness is shown per source. No live balance check was performed.'};
}
