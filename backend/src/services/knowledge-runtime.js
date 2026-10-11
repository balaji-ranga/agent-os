import { randomUUID } from 'node:crypto';
import { knowledgeStore } from './knowledge-store.js';
import { knowledgeSearch } from './knowledge-search.js';
import { sourceRecords, assertKnowledgeSourceAccess } from './knowledge-source-adapters.js';
import { entityId } from './knowledge-contract.js';

export async function runKnowledgeJob(job,{store=knowledgeStore(),search=knowledgeSearch(),records=sourceRecords}={}) {
  const source=store.get(job.owner,job.source_id); const revision=randomUUID(); let count=0;
  let lost=null;
  const heartbeat=setInterval(()=>{try{store.heartbeat(job,count);}catch(error){lost=error;}},30000);
  heartbeat.unref?.();
  try {
    await search.ensure(job.owner);
    for await(const record of records(job.owner,source)) {
      if(lost)throw lost;
      await search.putRecord(job.owner,source,revision,record); count++;
      store.heartbeat(job,count);
    }
    await search.refresh(job.owner);
    if(lost)throw lost;
    store.finish(job,revision);
    // Cleanup failure must not reverse a successfully published snapshot.
    try {await search.prune?.(job.owner,source.id,revision);} catch {console.warn('[knowledge] obsolete revision cleanup deferred',job.id);}
    return {status:'completed',records:count,revision};
  } catch(error) {
    const message=String(error.message||error).slice(0,500);
    store.finish(job,null,message);
    return {status:'failed',records:count,error:message};
  } finally {clearInterval(heartbeat);}
}

export async function connectedKnowledge(owner,{query,depth=2}={},deps={}) {
  if(!owner)throw new Error('Owner required');
  if(typeof query!=='string'||!query.trim()||query.length>4000)throw new Error('Enter a question up to 4000 characters');
  const store=deps.store||knowledgeStore();const search=deps.search||knowledgeSearch();
  const sources=store.list(owner).filter(s=>s.enabled&&s.revision&&['ready','syncing'].includes(s.status));
  const allowed=[];const unavailable=[];
  for(const source of sources) {
    try{(deps.assertAccess||assertKnowledgeSourceAccess)(owner,source);allowed.push(source);}
    catch{unavailable.push(source.id);}
  }
  const hits=await search.documents(owner,allowed,query);
  const entities=new Map((await search.entities(owner,allowed,[...new Set(hits.map(h=>h.entity))])).map(e=>[e.entity,e]));
  const edges=[]; let frontier=[...entities.keys()];
  const graphSources=allowed.filter(s=>s.graph_enabled);
  const graphIds=new Set(graphSources.map(s=>s.id));
  const mappings=store.mappings(owner).filter(m=>graphIds.has(m.from_source)&&graphIds.has(m.to_source));
  for(let hop=0;hop<Math.min(4,Math.max(0,Number(depth)||0))&&frontier.length&&entities.size<100;hop++) {
    const native=await search.edges(owner,graphSources,frontier);
    const explicit=mappings.map(m=>({from:entityId(owner,m.from_source,m.from_object),to:entityId(owner,m.to_source,m.to_object),relation:m.relation,evidence:{origin:'explicit_mapping',mapping_id:m.id,note:m.note}}))
      .filter(e=>frontier.includes(e.from)||frontier.includes(e.to));
    const candidate=[...native,...explicit];
    const ids=[...new Set(candidate.flatMap(e=>[e.from,e.to]))].filter(id=>!entities.has(id)).slice(0,100-entities.size);
    const next=ids.length?await search.entities(owner,graphSources,ids):[];
    next.forEach(e=>entities.set(e.entity,e));
    for(const edge of candidate) if(entities.has(edge.from)&&entities.has(edge.to)&&!edges.some(e=>e.from===edge.from&&e.to===edge.to&&e.relation===edge.relation))edges.push(edge);
    frontier=next.map(e=>e.entity);
  }
  // Recheck source eligibility after I/O to avoid returning a revision disabled during retrieval.
  const current=new Set(store.list(owner).filter(s=>s.enabled&&['ready','syncing'].includes(s.status)).map(s=>`${s.id}:${s.revision}`));
  const visible=[...entities.values()].filter(e=>current.has(`${e.source}:${e.revision}`));
  const visibleIds=new Set(visible.map(e=>e.entity));
  return {query,retrieval_mode:'connected_information',evidence:visible,
    chunks:hits.filter(h=>visibleIds.has(h.entity)),relationships:edges.filter(e=>visibleIds.has(e.from)&&visibleIds.has(e.to)),
    sources:allowed.filter(s=>current.has(`${s.id}:${s.revision}`)).map(s=>({id:s.id,name:s.name,last_success:s.last_success})),
    unavailable_sources:unavailable, note:'Indexed snapshots; freshness is shown per source. No live balance check was performed.'};
}
