import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { knowledgeStore } from '../src/services/knowledge-store.js';
import { runKnowledgeJob, connectedKnowledge } from '../src/services/knowledge-runtime.js';
import { entityId } from '../src/services/knowledge-contract.js';

const db=new Database(':memory:');const store=knowledgeStore(db);
const create=(owner,kind,collections)=>store.save(owner,{name:kind,kind,collections,graph_enabled:true});
const crm=create('alice','crm',['companies']),erp=create('alice','erp',['Customer','Sales Invoice']),content=create('alice','content',['uploaded']);
const other=create('bob','crm',['companies']);
assert.equal(store.get('bob',crm.id),undefined);
assert.throws(()=>store.enqueue('bob',crm.id));
assert.throws(()=>store.addMapping('alice',{from_source:crm.id,from_object:'companies/1',to_source:other.id,to_object:'companies/1',relation:'same_customer',note:'bad'}));
store.addMapping('alice',{from_source:crm.id,from_object:'companies/1',to_source:erp.id,to_object:'Customer/1',relation:'same_customer',note:'Verified customer reference'});
store.addMapping('alice',{from_source:content.id,from_object:'contract.md',to_source:crm.id,to_object:'companies/1',relation:'contract_for',note:'Contract customer ID'});
const documents=[];
const search={
  async ensure(){},async refresh(){},
  async putRecord(owner,s,revision,r){documents.push({...r,owner,source:s.id,revision,entity:entityId(owner,s.id,r.object_id)});},
  async documents(owner,sources){return documents.filter(d=>d.owner===owner&&sources.some(s=>s.id===d.source&&s.revision===d.revision)&&d.object_id==='contract.md');},
  async entities(owner,sources,ids){return documents.filter(d=>d.owner===owner&&sources.some(s=>s.id===d.source&&s.revision===d.revision)&&ids.includes(d.entity));},
  async edges(owner,sources,ids){return documents.filter(d=>d.owner===owner&&sources.some(s=>s.id===d.source&&s.revision===d.revision)).flatMap(d=>(d.relations||[]).map(r=>({from:d.entity,to:entityId(owner,d.source,r.target),relation:r.relation}))).filter(e=>ids.includes(e.from)||ids.includes(e.to));},
};
async function* records(owner,s){
  if(s.kind==='crm')yield {object_id:'companies/1',title:'Customer',text:'Customer',relations:[]};
  if(s.kind==='erp'){
    yield {object_id:'Customer/1',title:'ERP customer',text:'Customer',relations:[]};
    yield {object_id:'Sales Invoice/1',title:'Overdue',text:'100 USD outstanding',relations:[{target:'Customer/1',relation:'customer'}]};
  }
  if(s.kind==='content')yield {object_id:'contract.md',title:'Contract',text:'Renewal next month',relations:[]};
}
for(let i=0;i<4;i++) {
  const job=store.claim();assert.ok(job);assert.equal((await runKnowledgeJob(job,{store,search,records})).status,'completed');
}
const deps={store,search,assertAccess(){}};
const result=await connectedKnowledge('alice',{query:'renewal',depth:3},deps);
assert.equal(result.evidence.length,4);
assert.equal(result.relationships.length,3);
assert.ok(result.evidence.every(e=>e.owner==='alice'));
// Reprocessing publishes a new revision, without returning old duplicate records.
store.enqueue('alice',content.id);store.enqueue('alice',content.id);
assert.equal(store.history('alice',content.id).filter(j=>j.status==='queued').length,1);
await runKnowledgeJob(store.claim(),{store,search,records});
assert.equal((await connectedKnowledge('alice',{query:'renewal',depth:3},deps)).evidence.length,4);
// Disabling an intermediate source prevents traversal through it.
store.save('alice',{...crm,enabled:false},crm.id);
assert.equal((await connectedKnowledge('alice',{query:'renewal',depth:3},deps)).evidence.length,1);
// A failed snapshot cannot publish half of its records.
store.enqueue('alice',content.id);
await runKnowledgeJob(store.claim(),{store,search,records:async function*(){yield {object_id:'new',title:'partial',text:'partial'};throw new Error('provider failed');}});
assert.equal(store.get('alice',content.id).status,'error');
assert.equal((await connectedKnowledge('alice',{query:'renewal'},deps)).evidence.length,0);
db.close();console.log('Knowledge lifecycle: persistent jobs, idempotent enqueue, snapshot publication, tenant isolation, CRM/ERP/content traversal, pause and failed snapshot exclusion passed (mock adapters/search).');
