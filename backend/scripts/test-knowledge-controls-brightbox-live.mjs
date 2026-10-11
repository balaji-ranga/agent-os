import assert from 'node:assert/strict';
import {knowledgeStore} from '../src/services/knowledge-store.js';
import {knowledgeSearch} from '../src/services/knowledge-search.js';
import {connectedKnowledge} from '../src/services/knowledge-runtime.js';
import {previewKnowledgeSelection} from '../src/services/knowledge-selection-preview.js';
import {assertKnowledgeSourceAccess} from '../src/services/knowledge-source-adapters.js';

const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(owner!=='ceo-demo-brightbox-744921')throw new Error('Explicit BrightBox demo owner required');
const store=knowledgeStore(),search=knowledgeSearch(),results=[];
const originals=store.list(owner).filter(s=>s.name.startsWith('Knowledge-E2E-571e2944 '));
assert.equal(originals.length,4);
const before=JSON.stringify(originals.map(s=>[s.id,s.enabled,s.retrieval_enabled,s.selection]));
async function sync(source){const job=store.enqueue(owner,source.id),deadline=Date.now()+240000;while(Date.now()<deadline){const row=store.history(owner,source.id).find(j=>j.id===job.id);if(row?.status==='completed')return row;if(['failed','cancelled'].includes(row?.status))throw new Error(`${source.kind} ${row.status}: ${row.error}`);await new Promise(r=>setTimeout(r,1000));}throw new Error('Acceptance sync deadline exceeded');}
for(const original of originals){
  await assertKnowledgeSourceAccess(owner,original);
  const [record]=await search.entities(owner,[original]);assert.ok(record?.object_id,`${original.kind} retained fixture missing`);
  const name=`Knowledge controls acceptance ${original.kind}`;
  const existing=store.list(owner).find(s=>s.name===name);
  if(existing)assert.ok(!store.history(owner,existing.id).some(j=>j.status==='running'),'Wait for previous acceptance sync');
  const input={...original,name,enabled:true,retrieval_enabled:true,graph_enabled:false,intelligent_mapping:false,interval_seconds:86400,selection:{mode:'all',rules:[{field:'object_id',operator:'equals',value:record.object_id}],include:['title']}};
  let source;
  try{
    const preview=await previewKnowledgeSelection(owner,input);assert.ok(preview.samples.every(r=>r.object_id===record.object_id));
    source=store.save(owner,input,existing?.id||null);
    const first=await sync(source);assert.equal(first.records,1);
    const stable=await sync(source);assert.equal(stable.changed,0);assert.equal(stable.reused,1);assert.equal(stable.content_groups_loaded,0);
    const records=(await search.browse(owner,[store.get(owner,source.id)])).records;assert.equal(records.length,1);assert.deepEqual(records[0].fields,{});assert.equal(records[0].text,record.title||record.object_id);
    store.setSyncPaused(owner,source.id,true);
    const start=Date.now();const visible=await connectedKnowledge(owner,{query:record.title||record.object_id,source_ids:[source.id]});
    assert.equal(visible.evidence.length,1,'Paused sync must retain retrieval');
    store.setVisibility(owner,source.id,false);assert.equal((await connectedKnowledge(owner,{query:'account',source_ids:[source.id]})).evidence.length,0);
    assert.equal(store.get(owner,source.id).enabled,false,'Visibility must not resume sync');
    store.setVisibility(owner,source.id,true);store.setSyncPaused(owner,source.id,false);
    source=store.save(owner,{...input,selection:{...input.selection,rules:[{field:'object_id',operator:'equals',value:'acceptance-nonexistent-record'}]}},source.id);
    assert.equal((await sync(source)).records,0);assert.equal((await search.browse(owner,[store.get(owner,source.id)])).records.length,0);
    source=store.save(owner,input,source.id);assert.equal((await sync(source)).records,1);
    results.push({kind:source.kind,source_id:source.id,filter_and_projection:true,unchanged_reuse:true,pause_search:true,visibility:true,filter_exit_and_restore:true,retrieval_ms:Date.now()-start});
    console.log(JSON.stringify({status:'passed',...results.at(-1)}));
  }finally{if(source){store.setSyncPaused(owner,source.id,true);store.setVisibility(owner,source.id,true);}}
}
assert.equal(JSON.stringify(store.list(owner).filter(s=>s.name.startsWith('Knowledge-E2E-571e2944 ')).map(s=>[s.id,s.enabled,s.retrieval_enabled,s.selection])),before,'Original source configuration must remain unchanged');
console.log(JSON.stringify({status:'passed',owner,retained_demo_sources:results.map(r=>r.source_id),original_sources_unchanged:true,provider_records_unchanged:true}));
