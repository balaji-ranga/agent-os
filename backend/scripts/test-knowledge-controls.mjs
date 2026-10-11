import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {validateSelection,recordSelected,projectKnowledgeRecord,sourceReadable} from '../src/services/knowledge-selection.js';
import {knowledgeStore} from '../src/services/knowledge-store.js';
import {runIncrementalKnowledge} from '../src/services/knowledge-incremental.js';
import {versionedSource} from '../src/services/knowledge-versioned-source.js';
import {knowledgeAdviceStore,suggestKnowledgeMapping,checkedModelEdges} from '../src/services/knowledge-mapping-advice.js';
import {knowledgeFeedback} from '../src/services/knowledge-feedback.js';
import {connectedKnowledge} from '../src/services/knowledge-runtime.js';
import {entityId} from '../src/services/knowledge-contract.js';
import {previewKnowledgeSelection} from '../src/services/knowledge-selection-preview.js';

const db=new Database(':memory:'),store=knowledgeStore(db),owner='controls-test';
const selection=validateSelection({mode:'all',rules:[{field:'fields.status',operator:'equals',value:'Open'}],include:['title','fields.status']});
assert.throws(()=>validateSelection({rules:[{field:'fields.__proto__.polluted',operator:'equals',value:'yes'}]}));
assert.throws(()=>validateSelection({rules:[{field:'title',operator:'execute',value:'code'}]}));
const input={object_id:'Customer/1',title:'Acme',text:'Full body PRIVATE',fields:{status:'Open',secret:'PRIVATE'},modified_at:'2026-01-01',relations:[]};
assert.ok(recordSelected(input,selection));assert.ok(!recordSelected({...input,fields:{status:'Closed'}},selection));
assert.ok(!JSON.stringify(projectKnowledgeRecord(input,selection)).includes('PRIVATE'));
assert.ok(recordSelected(input,{mode:'any',rules:[{field:'title',operator:'equals',value:'Other'},{field:'fields.status',operator:'equals',value:'Open'}]}));
assert.ok(recordSelected(input,{rules:[{field:'modified_at',operator:'within_days',value:2}]},Date.parse('2026-01-02')));
assert.ok(!recordSelected(input,{rules:[{field:'modified_at',operator:'within_days',value:2}]},Date.parse('2026-01-04')));
const s=store.save(owner,{name:'Controls',kind:'erp',collections:['Customer'],graph_enabled:true,selection});
const objects=new Map();let loads=0,writes=0;let rows=[input,{...input,object_id:'Customer/2',fields:{status:'Closed'}}];
const search={processingProfile:'test',ensure:async()=>{},refresh:async()=>{},pruneIncremental:async()=>{},
  markIncrementalSeen:async(o,s,d,id,v,scan)=>{const r=objects.get(id);if(!r)return false;r.scan=scan;return true;},
  putIncrementalRecord:async(o,s,d,r,h,scan)=>{writes++;objects.set(r.object_id,{...r,record_hash:h,scan});},
  closeUnseenIncremental:async(o,s,d,scan)=>{let n=0;for(const [id,r] of objects)if(r.scan!==scan){objects.delete(id);n++;}return n;},
};
const records=async function*(o,s,{incremental}){for(const row of rows)yield* versionedSource(row.object_id,JSON.stringify(row),async function*(){loads++;yield row;},incremental);};
async function run(){store.enqueue(owner,s.id);return runIncrementalKnowledge(store.claim(),{store,search,records});}
assert.equal((await run()).changed,1);assert.equal(objects.size,1);assert.ok(!JSON.stringify([...objects.values()]).includes('PRIVATE'));
loads=0;assert.equal((await run()).reused,1);assert.equal(loads,0);assert.equal(writes,1);
rows[0]={...input,fields:{status:'Closed'}};assert.equal((await run()).deleted,1);assert.equal(objects.size,0);
rows[1]={...rows[1],fields:{status:'Open'}};assert.equal((await run()).changed,1);assert.ok(objects.has('Customer/2'));
store.setSyncPaused(owner,s.id,true);assert.ok(sourceReadable(store.get(owner,s.id)));assert.equal(store.get(owner,s.id).enabled,false);assert.throws(()=>store.enqueue(owner,s.id));
store.setVisibility(owner,s.id,false);assert.ok(!sourceReadable(store.get(owner,s.id)));assert.equal(store.get(owner,s.id).enabled,false);
store.setSyncPaused(owner,s.id,false);assert.equal(store.get(owner,s.id).enabled,true);assert.ok(!sourceReadable(store.get(owner,s.id)));
store.setVisibility(owner,s.id,true);assert.ok(sourceReadable(store.get(owner,s.id)));
assert.throws(()=>store.setVisibility('other',s.id,true),/not found/);
const preview=await previewKnowledgeSelection(owner,{...s,selection},{connectionRef:async()=>null,assertAccess:async()=>{},records:async function*(){yield input;yield {...input,object_id:'Customer/2',fields:{status:'Closed'}};}});
assert.equal(preview.checked,2);assert.equal(preview.matched,1);assert.ok(!JSON.stringify(preview.samples).includes('PRIVATE'));

const b=store.save(owner,{name:'CRM',kind:'crm',collections:['companies'],graph_enabled:true});
db.prepare("UPDATE knowledge_sources SET revision='v1',status='ready'").run();
let sourceRecord={source:s.id,object_id:'Customer/2',entity:entityId(owner,s.id,'Customer/2'),revision:'v1',record_hash:'hash-a',title:'Acme',text:'Account ID AC-42'},target={source:b.id,object_id:'companies/1',entity:entityId(owner,b.id,'companies/1'),revision:'v1',record_hash:'hash-b',title:'Acme',text:'Account ID AC-42'};
const edges=[],advice=knowledgeAdviceStore(db);let calls=0;
const modelSearch={documents:async()=>[{entity:target.entity}],entities:async(o,allowed,ids)=>[sourceRecord,target].filter(r=>ids.includes(r.entity)&&allowed.some(s=>s.id===r.source)),putAdviceEdge:async(o,s,item)=>edges.push({from:sourceRecord.entity,to:target.entity,relation:item.relation,evidence:{origin:'model_inferred',advice_id:item.id}})};
const deps={store,search:modelSearch,advice,assertAccess:async()=>{},automatic:true,complete:async()=>{calls++;return {content:JSON.stringify({match:true,candidate_entity:'C1',relation:'same_account',confidence:.9,from_quote:'AC-42',to_quote:'AC-42',reason:'Shared explicit account identifier'})};}};
const proposal=await suggestKnowledgeMapping(owner,{source_id:s.id,object_id:sourceRecord.object_id},deps);assert.equal(proposal.suggestion.status,'active');
assert.equal((await checkedModelEdges(owner,edges,store.list(owner),modelSearch,advice)).length,1);
db.prepare("UPDATE knowledge_sources SET revision='v2'").run();sourceRecord={...sourceRecord,revision:'v2'};target={...target,revision:'v2'};
assert.equal((await checkedModelEdges(owner,edges,store.list(owner),modelSearch,advice)).length,1,'Unchanged endpoints survive unrelated source revision');
await suggestKnowledgeMapping(owner,{source_id:s.id,object_id:sourceRecord.object_id},deps);assert.equal(calls,1,'Unchanged candidates must not repeat inference');
target={...target,record_hash:'changed'};assert.equal((await checkedModelEdges(owner,edges,store.list(owner),modelSearch,advice)).length,0);
advice.setStatus(owner,proposal.suggestion.id,'rejected');await suggestKnowledgeMapping(owner,{source_id:s.id,object_id:sourceRecord.object_id},deps);assert.equal(edges.length,1,'Rejection persists across endpoint revisions');
const empty=await connectedKnowledge('other',{query:'unknown'},{store,search:{documents:async(o,s)=>{assert.equal(s.length,0);return [];},entities:async()=>[]},assertAccess:async()=>{}});assert.equal(empty.evidence.length,0);assert.equal(empty.relationships.length,0);
const exactQuery=await connectedKnowledge(owner,{query:'Acme',depth:0},{store,assertAccess:async()=>{},search:{documents:async()=>[{...sourceRecord,title:'Acme'},{...target,title:'Other company'}],entities:async(o,ss,ids)=>[sourceRecord,target].filter(r=>ids.includes(r.entity))}});
assert.equal(exactQuery.evidence.length,1,'Exact entity search must exclude unrelated vector candidates');
const projectedLive=await connectedKnowledge(owner,{query:'Acme',depth:0,live_values:true},{store,assertAccess:async()=>{},search:{documents:async()=>[sourceRecord],entities:async()=>[sourceRecord]},refreshLive:async()=>({checks:[],records:[{...sourceRecord,value_origin:'live',text:'PRIVATE secret',fields:{status:'Open',secret:'PRIVATE'}}]})});
assert.ok(!JSON.stringify(projectedLive.evidence).includes('PRIVATE'),'Live verification cannot bypass selected fields');
const feedback=knowledgeFeedback(db);feedback.save(owner,{kind:'missing_evidence',query:'Acme account',note:'Expected agreement'});assert.equal(feedback.page(owner).items.length,1);assert.equal(feedback.page('other').items.length,0);
db.close();console.log('Knowledge controls passed: filters/projection, incremental membership, preview, independent pause/visibility, endpoint revisions, inference reuse, rejection persistence, no-evidence isolation and feedback.');
