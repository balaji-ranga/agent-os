import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { sourceRecords, knowledgeConnectionRef } from '../src/services/knowledge-source-adapters.js';
import { listContentExplorer } from '../src/services/content-explorer.js';
import { knowledgeStore } from '../src/services/knowledge-store.js';
import { knowledgeSearch } from '../src/services/knowledge-search.js';
import { runKnowledgeJob, connectedKnowledge } from '../src/services/knowledge-runtime.js';
import { answerConnectedKnowledge } from '../src/services/knowledge-answer.js';

const file=process.env.KNOWLEDGE_TEST_MANIFEST;
if(!file)throw new Error('KNOWLEDGE_TEST_MANIFEST required; reuses existing fixtures without creating more');
const manifest=JSON.parse(await readFile(file,'utf8'));
const {owner,marker,fixture_ids:ids}=manifest;
if(!/demo|test|e2e/.test(owner))throw new Error('Test owner required');
const retain=process.env.KNOWLEDGE_RETAIN_DEMO==='1';
if(retain&&!/^ceo-(demo|test|e2e)-/.test(owner))throw new Error('Retained setup requires an isolated demo owner');
const cache=join(dirname(file),'retrieval-evidence.json');
let evidence;
if(process.env.KNOWLEDGE_REUSE_EVIDENCE==='1')evidence=JSON.parse(await readFile(cache,'utf8'));
else {
  const db=retain?null:new Database(':memory:'),store=retain?knowledgeStore():knowledgeStore(db),search=knowledgeSearch(),revisions=[];
  const create=(kind,collections)=>{
    const reusedId=retain&&manifest.retained_sources?.find(s=>s.kind===kind)?.id;
    const existing=reusedId?store.get(owner,reusedId):retain&&store.list(owner).find(s=>s.name===`${marker} ${kind}`&&s.kind===kind);
    if(reusedId)assert.equal(existing?.kind,kind,'Retained source must belong to owner and match kind');
    if(existing)return existing;
    return store.save(owner,{name:`${marker} ${kind}`,kind,collections,graph_enabled:true,interval_seconds:86400,connection_ref:knowledgeConnectionRef(owner,kind)});
  };
  const crm=create('crm',['companies','people']),erp=create('erp',['Customer','Project','Sales Invoice']),files=create('content',['generated']),knowledge=create('knowledge',['tables','documents']);
  let invoice;
  for await(const r of sourceRecords(owner,{kind:'erp',collections:['Sales Invoice']}))if(r.object_id===ids.invoice)invoice=r;
  assert.ok(invoice);manifest.expected_customer=invoice.fields.customer;
  const content=listContentExplorer(owner,{source:'generated',limit:100,offset:0}).items.find(i=>i.filename===`${marker}.md`);assert.ok(content);
  const map=(from,fromObject,to,toObject,relation)=>{
    const input={from_source:from.id,from_object:fromObject,to_source:to.id,to_object:toObject,relation,note:'Explicit IDs in acceptance contract and register'};
    if(!store.mappings(owner).some(m=>Object.keys(input).filter(k=>k!=='note').every(k=>m[k]===input[k])))store.addMapping(owner,input);
  };
  map(crm,`companies/${ids.crm_company}`,erp,`Customer/${invoice.fields.customer}`,'same_customer');
  map(files,content.relative_path,crm,`companies/${ids.crm_company}`,'contract_for');
  map(knowledge,`documents/${ids.document}`,crm,`companies/${ids.crm_company}`,'contract_for');
  map(knowledge,`tables/${ids.table}`,crm,`companies/${ids.crm_company}`,'account_register');
  try {
    if(retain){
      manifest.retained_sources=[crm,erp,files,knowledge].map(s=>({id:s.id,kind:s.kind}));
      await writeFile(file,JSON.stringify(manifest,null,2),{mode:0o600});
      for(const source of [crm,erp,files,knowledge]){
        const refresh=process.env.KNOWLEDGE_REFRESH_DEMO==='1';
        if(refresh)store.enqueue(owner,source.id);
        const deadline=Date.now()+600000;
        let current;
        do {
          current=store.get(owner,source.id);
          assert.ok(current,'Retained source missing');
          if(current.status==='error')throw new Error(current.error);
          if(current.status==='ready'&&(!refresh||current.revision!==source.revision))break;
          await new Promise(resolve=>setTimeout(resolve,2000));
        }while(Date.now()<deadline);
        assert.equal(current.status,'ready','Deployed worker must publish retained demo source');
        if(refresh)assert.notEqual(current.revision,source.revision,'Refresh must publish a new revision');
        console.log(JSON.stringify({stage:'retained-index-ready',kind:current.kind,source_id:current.id}));
      }
    }else for(let i=0;i<4;i++){
      const job=store.claim(),result=await runKnowledgeJob(job,{store,search});
      assert.equal(result.status,'completed',result.error);revisions.push(result.revision);
      console.log(JSON.stringify({stage:'indexed',kind:store.get(owner,job.source_id).kind,records:result.records}));
    }
    evidence=await connectedKnowledge(owner,{query:manifest.acceptance_query||`${marker}: Show the linked customer, account contact, project, historical invoice record with its status and recorded outstanding amount, and contract renewal terms and date. Include cancelled invoice history but do not present it as an active obligation. Cite supporting sources.`,depth:4},{store,search});
    await writeFile(cache,JSON.stringify(evidence),{mode:0o600});
    await writeFile(file,JSON.stringify(manifest,null,2),{mode:0o600});
  }finally{if(!retain){for(const revision of revisions)await search.discard(owner,revision);db.close();}}
}
const answer=await answerConnectedKnowledge(owner,{query:evidence.query},{retrieve:()=>evidence});
for(const objectId of [`companies/${ids.crm_company}`,`people/${ids.crm_contact}`,ids.invoice,`Project/${ids.erp_project}`,`documents/${ids.document}`,`tables/${ids.table}`]) {
  assert.ok(evidence.evidence.some(record=>record.object_id===objectId),`Missing source evidence: ${objectId}`);
}
assert.ok(evidence.evidence.some(record=>record.object_id.endsWith(`${marker}.md`)),'Content folder evidence missing');
await writeFile(join(dirname(file),'answer-retest.json'),JSON.stringify(answer,null,2),{mode:0o600});
assert.equal(answer.answer_status,'generated_from_evidence');
assert.ok(answer.answer.includes(manifest.expected_customer),'Expected customer missing from answer');
assert.ok(answer.answer.includes(ids.erp_project)||answer.answer.includes(marker),'Expected project missing');
const unrelatedCustomers=new Set(evidence.evidence.filter(e=>e.object_id.startsWith('Sales Invoice/')&&e.fields.customer!==manifest.expected_customer).map(e=>e.fields.customer));
for(const name of unrelatedCustomers)assert.ok(!answer.answer.includes(name),`Unrelated invoice customer incorrectly included: ${name}`);
assert.match(answer.answer,/30 days|30-day/i);assert.match(answer.answer,/Knowledge Acceptance Contact/i);
const invoiceEvidence=evidence.evidence.find(record=>record.object_id===ids.invoice);
if(String(invoiceEvidence.fields.status).toLowerCase()==='cancelled'){
  assert.match(answer.answer,/cancelled/i,'Historical invoice must retain its cancelled state');
  const rejected=await answerConnectedKnowledge(owner,{query:'Does this record prove an active overdue payable obligation? Only answer if it does; otherwise respond INSUFFICIENT_EVIDENCE.'},{retrieve:async()=>({...evidence,evidence:[invoiceEvidence],relationships:[]})});
  assert.equal(rejected.answer_status,'insufficient_evidence','Cancelled invoice cannot prove an active overdue obligation');
}
const amount=String(invoiceEvidence.fields.outstanding_amount);
assert.ok(answer.answer.replace(/,/g,'').includes(amount),'Invoice outstanding amount missing');
console.log(JSON.stringify({test:'five-source-answer-retest',status:'passed',customer:manifest.expected_customer,groups_considered:answer.groups_considered,answer:answer.answer}));
