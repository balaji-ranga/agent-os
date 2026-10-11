import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { knowledgeStore } from '../src/services/knowledge-store.js';
import { knowledgeSearch } from '../src/services/knowledge-search.js';
import { connectedKnowledge, runKnowledgeJob, cleanupKnowledgeSources } from '../src/services/knowledge-runtime.js';
import { fingerprint } from '../src/services/knowledge-contract.js';
import { opensearchRequest } from '../src/services/opensearch/client.js';
import {manageKnowledgeRecords} from '../src/services/knowledge-record-management.js';
import {knowledgeResultPages} from '../src/services/knowledge-result-pages.js';
import {knowledgeAdviceStore,suggestKnowledgeMapping,decideKnowledgeAdvice} from '../src/services/knowledge-mapping-advice.js';

// Real OpenSearch, synthetic source fixtures. No production business records or
// user indexes are touched; cleanup targets only this invocation's random index.
const owner=`knowledge-integration-${randomUUID()}`;
const db=new Database(':memory:');
const store=knowledgeStore(db),search=knowledgeSearch();
const started=Date.now();
const create=(kind,collections)=>store.save(owner,{name:kind,kind,collections,graph_enabled:true});
const crm=create('crm',['companies']),erp=create('erp',['Customer','Sales Invoice']),content=create('content',['generated']);
store.saveFieldRule(owner,{from_source:crm.id,from_collection:'companies',from_field:'fields.external_id',to_source:erp.id,to_collection:'Customer',to_field:'fields.external_id',relation:'same_customer',note:'Verified customer external ID',identifier_confirmed:true});
store.addMapping(owner,{from_source:content.id,from_object:'contract.md',to_source:crm.id,to_object:'companies/customer-1',relation:'contract_for',note:'Contract explicitly references customer-1'});
let amount=100;
let invoicePresent=true;
let contractSuffix='';
async function* records(_owner,source){
  if(source.kind==='crm')yield {object_id:'companies/customer-1',title:'Acceptance customer',text:'Customer 1 account contact Taylor',fields:{external_id:'AC-42'}};
  if(source.kind==='erp'){
    yield {object_id:'Customer/customer-1',title:'Customer 1',text:'Customer 1',fields:{external_id:'AC-42'}};
    if(invoicePresent)yield {object_id:'Sales Invoice/invoice-1',title:'Overdue invoice',text:`Overdue invoice outstanding ${amount} USD`,fields:{outstanding_amount:amount},relations:[{target:'Customer/customer-1',relation:'customer'}]};
  }
  if(source.kind==='content')yield {object_id:'contract.md',title:'Contract renewal',text:'Customer 1 contract renewing next month with annual renewal terms'+contractSuffix};
}
try {
  for(let i=0;i<3;i++)assert.equal((await runKnowledgeJob(store.claim(),{store,search,records})).status,'completed');
  const currentErp=store.get(owner,erp.id);
  assert.ok((await search.fields(owner,currentErp,'Customer')).includes('fields.external_id'));
  assert.equal((await search.matchField(owner,currentErp,'Customer','fields.external_id','ac-42','casefold')).length,1);
  assert.equal((await search.matchField(owner,currentErp,'Customer','fields.external_id','ac-42','exact')).length,0);
  const page1=await search.browse(owner,[currentErp],null,{limit:1,compact:true});
  assert.equal(page1.records.length,1);assert.ok(page1.next);assert.equal(page1.records[0].text,undefined);
  const page2=await search.browse(owner,[currentErp],page1.next,{limit:1,compact:true});
  assert.equal(page2.records.length,1);assert.equal(page2.next,null);
  assert.notEqual(page1.records[0].entity,page2.records[0].entity);
  assert.equal((await search.browse(owner,[currentErp],null,{query:'Sales Invoice/invoice-1',limit:25,compact:true})).records[0].object_id,'Sales Invoice/invoice-1');
  assert.equal((await search.browse(owner,[currentErp],null,{query:'doesnotexistxyz',limit:25})).records.length,0);
  const contentOnly=await search.browse(owner,[store.get(owner,content.id)],null,{query:'annual renewal terms',limit:25,compact:true});
  assert.equal(contentOnly.records.length,1,'Content-only words absent from title and ID must match');
  assert.match(contentOnly.records[0].preview,/annual renewal terms/);
  await assert.rejects(()=>search.browse(`${owner}-other`,[currentErp],page1.next,{limit:1}),e=>e.status===409);
  const vectors=await opensearchRequest('POST',`/aos-knowledge-${fingerprint(owner).slice(0,24)}/_count`,{query:{exists:{field:'embedding'}}});
  assert.ok(vectors.count>=4,'Real vectors must be indexed; lexical-only fallback is not a passing test');
  const deps={store,search,assertAccess(){}};
  const first=await connectedKnowledge(owner,{query:'overdue invoices contracts renewing next month'},deps);
  assert.equal(first.evidence.length,4);assert.equal(first.relationships.length,3);
  assert.ok(first.evidence.every(e=>e.source_name));
  assert.ok(first.relationships.every(e=>e.from_record?.title&&e.to_record?.title));
  const advice=knowledgeAdviceStore(db);
  const from=first.evidence.find(e=>e.source===crm.id),to=first.evidence.find(e=>e.object_id==='contract.md');
  const automated={...deps,advice,complete:async()=>({modelUsed:'test-model',content:JSON.stringify({match:true,candidate_entity:to.entity,relation:'has_contract',confidence:.91,from_quote:'Customer 1',to_quote:'Customer 1',reason:'Synthetic integration fixture verified customer relationship'})})};
  const auto=await suggestKnowledgeMapping(owner,{source_id:crm.id,object_id:from.object_id,target_source_id:content.id},automated);
  assert.equal(auto.suggestion.status,'active');
  const withModel=await connectedKnowledge(owner,{query:'Customer 1 contract'},automated);
  assert.ok(withModel.relationships.some(e=>e.evidence.origin==='model_inferred'&&e.from_record.title&&e.to_record.title),'Indexed model edge must participate in graph retrieval without approval');
  store.enqueue(owner,crm.id);assert.equal((await runKnowledgeJob(store.claim(),{store,search,records})).changed,0);
  assert.ok((await connectedKnowledge(owner,{query:'Customer 1 contract'},automated)).relationships.some(e=>e.evidence.origin==='model_inferred'),'Unchanged endpoint survives next source generation');
  contractSuffix=' Updated commercial terms.';store.enqueue(owner,content.id);assert.equal((await runKnowledgeJob(store.claim(),{store,search,records})).changed,1);
  assert.ok(!(await connectedKnowledge(owner,{query:'Customer 1 contract'},automated)).relationships.some(e=>e.evidence.origin==='model_inferred'),'Changed endpoint invalidates old model evidence');
  await decideKnowledgeAdvice(owner,auto.suggestion.id,'reject',automated);
  assert.ok(!(await connectedKnowledge(owner,{query:'Customer 1 contract'},automated)).relationships.some(e=>e.evidence.origin==='model_inferred'),'Rejected indexed edge must be excluded immediately');
  assert.ok(first.relationships.some(e=>e.evidence?.origin==='field_rule'));
  assert.ok(first.chunks.length);assert.ok(first.evidence.every(e=>e.owner===owner));
  assert.equal((await connectedKnowledge(`${owner}-other`,{query:'renewal'},deps)).evidence.length,0);
  amount=200;store.enqueue(owner,erp.id);store.enqueue(owner,erp.id);
  assert.equal((await runKnowledgeJob(store.claim(),{store,search,records})).status,'completed');
  const second=await connectedKnowledge(owner,{query:'overdue invoices contracts renewing next month'},deps);
  assert.equal(second.evidence.length,4);
  assert.equal(second.evidence.find(e=>e.object_id==='Sales Invoice/invoice-1').fields.outstanding_amount,200);
  assert.ok(knowledgeResultPages().create(owner,second,store.list(owner)).page_token,'Reused object versions must support paged UI answers');
  invoicePresent=false;store.enqueue(owner,erp.id);
  assert.equal((await runKnowledgeJob(store.claim(),{store,search,records})).status,'completed');
  const afterDelete=await connectedKnowledge(owner,{query:'overdue invoices contracts renewing next month'},deps);
  assert.ok(!afterDelete.evidence.some(e=>e.object_id==='Sales Invoice/invoice-1'));
  assert.equal(afterDelete.relationships.length,2);
  let accessCalls=0;
  const revoked=await connectedKnowledge(owner,{query:'overdue invoices contracts renewing next month'}, {...deps,assertAccess(){if(++accessCalls>3)throw new Error('revoked during retrieval');}});
  assert.equal(revoked.evidence.length,0);assert.equal(revoked.relationships.length,0);
  const management={store,search,assertAccess(){}};
  await manageKnowledgeRecords(owner,{source_id:content.id,action:'exclude',object_ids:['contract.md'],confirm:'INDEX_ONLY'},management);
  assert.equal((await runKnowledgeJob(store.claim(),{store,search,records})).status,'completed');
  assert.equal((await search.browse(owner,[store.get(owner,content.id)])).records.length,0,'Excluded copy must not return on sync');
  await manageKnowledgeRecords(owner,{source_id:content.id,action:'restore',object_ids:['contract.md']},management);
  assert.equal((await runKnowledgeJob(store.claim(),{store,search,records})).status,'completed');
  assert.equal((await search.browse(owner,[store.get(owner,content.id)])).records.length,1,'Restore must recreate only the indexed copy');
  console.log('Real index lifecycle exclude, physical removal, sync suppression and restore passed; source fixture unchanged.');
  store.setEnabled(owner,erp.id,false);
  assert.ok(!(await connectedKnowledge(owner,{query:'overdue'},deps)).evidence.some(e=>e.source===erp.id));
  store.remove(owner,content.id);
  assert.ok(!(await connectedKnowledge(owner,{query:'renewal'},deps)).evidence.some(e=>e.source===content.id));
  await cleanupKnowledgeSources({store,search});assert.equal(store.cleanupPending().length,0);
  const remaining=await opensearchRequest('POST',`/aos-knowledge-${fingerprint(owner).slice(0,24)}/_count`,{query:{term:{source:content.id}}});
  assert.equal(remaining.count,0);
  console.log(JSON.stringify({test:'real-opensearch',status:'passed',fixtures:'synthetic source records',checks:['bulk indexing','lexical/vector retrieval','graph expansion','revision replacement','duplicate enqueue','tenant isolation','source pause','record deletion and edge invalidation','mid-query access revocation','source deletion and physical cleanup'],duration_ms:Date.now()-started}));
} finally {
  await opensearchRequest('DELETE',`/aos-knowledge-${fingerprint(owner).slice(0,24)}`);
  db.close();
}
