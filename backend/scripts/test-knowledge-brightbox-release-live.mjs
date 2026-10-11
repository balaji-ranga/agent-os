import assert from 'node:assert/strict';
import {knowledgeStore} from '../src/services/knowledge-store.js';
import {knowledgeSearch} from '../src/services/knowledge-search.js';
import {connectedKnowledge} from '../src/services/knowledge-runtime.js';
import {erpGet} from '../src/services/erpnext-erp.js';
import {manageKnowledgeRecords} from '../src/services/knowledge-record-management.js';
import {answerConnectedKnowledge} from '../src/services/knowledge-answer.js';

// Explicit retained demo only. No provider records, credentials or original files
// are changed; temporary indexing enablement is restored even on failure.
const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(owner!=='ceo-demo-brightbox-744921')throw new Error('Explicit BrightBox demo owner required');
const store=knowledgeStore(),search=knowledgeSearch();
const sources=store.list(owner).filter(s=>s.name.startsWith('Knowledge-E2E-571e2944 '));
assert.equal(sources.length,4);
const original=new Map(sources.map(s=>[s.id,s.enabled]));
async function wait(source,job){
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){
    const row=store.history(owner,source.id).find(j=>j.id===job.id);
    if(row?.status==='completed')return row;
    if(['failed','cancelled'].includes(row?.status))throw new Error(`${source.kind} acceptance synchronization ${row.status}`);
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error(`${source.kind} synchronization timed out`);
}
const report=(test,data={})=>console.log(JSON.stringify({test,status:'passed',...data}));
let restoreRecord=null;
try{
  for(const source of sources){
    if(!source.enabled)store.setEnabled(owner,source.id,true);
    await wait(source,store.enqueue(owner,source.id));
    const second=await wait(source,store.enqueue(owner,source.id));
    assert.equal(second.changed,0,`${source.kind}: unchanged records unexpectedly reindexed`);
    assert.ok(second.reused>0);
    report('incremental_reuse',{kind:source.kind,checked:second.records,reused:second.reused,job_id:second.id});
  }
  const query='Knowledge-E2E-571e2944 Acme Technologies ACC-SINV-2026-00001 contract renewal';
  const result=await connectedKnowledge(owner,{query,depth:4,live_values:true});
  const expected=['companies/b204124e-5661-44ed-8dc8-90aa70712589','people/ffd0907a-bc5f-44fa-bb24-6e920155b91a','Project/PROJ-0001','documents/mdd-mv35qx2u-ea4fe1','tables/mdt-mv35qx2s-a9f5a8'];
  for(const id of expected)assert.ok(result.evidence.some(r=>r.object_id===id),`Missing linked evidence ${id}`);
  assert.ok(result.evidence.some(r=>r.object_id.endsWith('Knowledge-E2E-571e2944.md')));
  assert.ok(result.relationships.length>0);
  const invoices=result.evidence.filter(r=>r.object_id.startsWith('Sales Invoice/'));
  assert.ok(invoices.length>0,'Live invoice evidence missing');
  for(const invoice of invoices){
    assert.equal(invoice.value_origin,'live');
    const authoritative=await erpGet(owner,'Sales Invoice',invoice.object_id.slice('Sales Invoice/'.length));
    assert.equal(invoice.fields.outstanding_amount,authoritative.data.outstanding_amount);
    assert.equal(invoice.fields.status,authoritative.data.status);
    assert.ok(invoice.live_checked_at);
  }
  report('live_graph_cross_source',{evidence:result.evidence.length,relationships:result.relationships.length,verified_invoices:invoices.length});
  if(process.env.KNOWLEDGE_TEST_LIVE_LLM==='1'){
    const answer=await answerConnectedKnowledge(owner,{query:'Report the linked account contact, project and contract renewal terms. Report invoice statuses and recorded outstanding values as evidence, including cancelled history; do not represent cancelled invoices as current payable obligations.'},{retrieve:async()=>result});
    assert.equal(answer.answer_status,'generated_from_evidence');
    assert.ok(answer.citations.some(c=>c.value_origin==='live'&&c.live_checked_at),'Live citation provenance missing');
    assert.ok(answer.answer.trim().length>100);
    const valid=new Set(answer.citations.map(c=>c.id));
    const refs=[...answer.answer.matchAll(/\[((?:G\d+-)?K\d+)\]/g)].map(m=>m[1]);
    assert.ok(refs.length>0);assert.ok(refs.every(id=>valid.has(id)));
    report('live_model_cited_answer',{citations:answer.citations.length,live_citations:answer.citations.filter(c=>c.value_origin==='live').length});
  }
  const other=await connectedKnowledge('ceo-bala',{query,source_ids:sources.map(s=>s.id),live_values:true});
  assert.equal(other.evidence.length,0);
  report('cross_owner_denied');
  const content=sources.find(s=>s.kind==='content');
  const page=await search.browse(owner,[store.get(owner,content.id)],null,{limit:100});
  const record=page.records.find(r=>r.object_id.endsWith('Knowledge-E2E-571e2944.md'));
  assert.ok(record);restoreRecord={source:content,id:record.object_id};
  const excluded=await manageKnowledgeRecords(owner,{source_id:content.id,action:'exclude',object_ids:[record.object_id],confirm:'INDEX_ONLY'});
  await wait(content,{id:excluded.job_id});
  const absent=await search.browse(owner,[store.get(owner,content.id)],null,{limit:100});
  assert.ok(!absent.records.some(r=>r.object_id===record.object_id));
  const restored=await manageKnowledgeRecords(owner,{source_id:content.id,action:'restore',object_ids:[record.object_id]});
  await wait(content,{id:restored.job_id});
  const present=await search.browse(owner,[store.get(owner,content.id)],null,{limit:100});
  assert.ok(present.records.some(r=>r.object_id===record.object_id));restoreRecord=null;
  report('indexed_copy_exclude_restore',{originals_unchanged:true});
  for(const source of sources){
    const row=await wait(source,store.fullResync(owner,source.id));
    assert.equal(row.trigger,'full_resync');assert.ok(row.changed>0);assert.equal(row.reused,0);
    report('full_resync',{kind:source.kind,checked:row.records,changed:row.changed,job_id:row.id});
  }
}finally{
  if(restoreRecord){
    const {source,id}=restoreRecord;
    store.setExcluded(owner,source.id,id,false);
    if(!store.get(owner,source.id).enabled)store.setEnabled(owner,source.id,true);
    await wait(source,store.enqueue(owner,source.id,'lifecycle'));
  }
  for(const source of sources)if(store.get(owner,source.id).enabled!==original.get(source.id))store.setEnabled(owner,source.id,original.get(source.id));
  console.log(JSON.stringify({test:'restore_demo_schedules',status:'passed',retained_data:true}));
}
