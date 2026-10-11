import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { getDbForCeo } from '../src/db/request-db.js';
import * as md from '../src/services/master-data.js';
import { crmCreateCompany, crmCreatePerson } from '../src/services/twenty-crm.js';
import { erpCreateProject } from '../src/services/erpnext-erp.js';
import { getCeoGeneratedMediaDir, listContentExplorer } from '../src/services/content-explorer.js';
import { sourceRecords, knowledgeConnectionRef } from '../src/services/knowledge-source-adapters.js';
import { knowledgeStore } from '../src/services/knowledge-store.js';
import { knowledgeSearch } from '../src/services/knowledge-search.js';
import { runKnowledgeJob, connectedKnowledge } from '../src/services/knowledge-runtime.js';
import { answerConnectedKnowledge } from '../src/services/knowledge-answer.js';

// Explicit opt-in: creates labelled fixtures in an existing test/demo tenant.
// Does not create, submit, update or pay invoices; uses one existing test invoice.
const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(process.env.KNOWLEDGE_CREATE_FIXTURES!=='1'||!owner||!/demo|test|e2e/.test(owner))throw new Error('Test owner and KNOWLEDGE_CREATE_FIXTURES=1 required');
const resumed=process.env.KNOWLEDGE_RESUME_MANIFEST?JSON.parse(await readFile(process.env.KNOWLEDGE_RESUME_MANIFEST,'utf8')):null;
if(resumed)assert.equal(resumed.owner,owner);
const run=resumed?.run||randomUUID(),marker=resumed?.marker||`Knowledge-E2E-${run.slice(0,8)}`;
assert.match(marker,/^Knowledge-E2E-[a-f0-9]{8}$/);
const folder=join('/tmp',marker);await mkdir(folder,{mode:0o700,recursive:true});
if(!resumed)await getDbForCeo(owner).backup(join(folder,'tenant-before.sqlite'));
const manifest=resumed||{run,owner,marker,fixture_ids:{},checks:[]};
if(process.env.KNOWLEDGE_REUSE_MANIFEST){
  const previous=JSON.parse(await readFile(process.env.KNOWLEDGE_REUSE_MANIFEST,'utf8'));
  assert.equal(previous.owner,owner,'Only reuse this demo owner sources');
  manifest.retained_sources=previous.retained_sources;
}
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(manifest,null,2),{mode:0o600});
let invoice;
for await(const r of sourceRecords(owner,{kind:'erp',collections:['Sales Invoice']})) {
  if(['Overdue','Unpaid','Partly Paid'].includes(r.fields.status)&&r.fields.outstanding_amount>0&&r.fields.due_date<new Date().toISOString().slice(0,10)){invoice=r;break;}
}
if(!invoice)throw new Error('Test tenant requires an existing overdue invoice');
manifest.fixture_ids.invoice=invoice.object_id;
const company=manifest.fixture_ids.crm_company?{id:manifest.fixture_ids.crm_company}:(await crmCreateCompany(owner,{name:marker,idempotency_key:run})).company;
assert.ok(company?.id);manifest.fixture_ids.crm_company=company.id;await save();
const person=manifest.fixture_ids.crm_contact?{id:manifest.fixture_ids.crm_contact}:(await crmCreatePerson(owner,{name:'Knowledge Acceptance Contact',email:`knowledge-${run}@example.invalid`,companyId:company.id,idempotency_key:`${run}-contact`})).person;
assert.ok(person?.id);manifest.fixture_ids.crm_contact=person.id;await save();
const project=manifest.fixture_ids.erp_project?{name:manifest.fixture_ids.erp_project}:(await erpCreateProject(owner,{project_name:marker,customer:invoice.fields.customer})).data;
assert.ok(project?.name);manifest.fixture_ids.erp_project=project.name;await save();
const renewal=new Date();renewal.setUTCMonth(renewal.getUTCMonth()+1,15);
const text=`${marker} contract. ERP customer ID: ${invoice.fields.customer}. CRM account ID: ${company.id}. Project: ${project.name}. Renews ${renewal.toISOString().slice(0,10)} for twelve months. Renewal requires 30 days written notice. This is an isolated acceptance-test contract.`;
const table=manifest.fixture_ids.table?{id:manifest.fixture_ids.table}:md.createTable(owner,{name:marker,columns:['crm_account_id','erp_customer_id','project','renewal_terms']});
manifest.fixture_ids.table=table.id;await save();
if(!manifest.fixture_ids.row){const row=md.insertRow(owner,table.id,{crm_account_id:company.id,erp_customer_id:invoice.fields.customer,project:project.name,renewal_terms:'Twelve months; 30 days written notice'});manifest.fixture_ids.row=row.id;await save();}
const doc=manifest.fixture_ids.document?{id:manifest.fixture_ids.document}:await md.uploadDocument(owner,{title:marker,filename:`${marker}.md`,contentText:text});
manifest.fixture_ids.document=doc.id;await save();
const contentDir=getCeoGeneratedMediaDir(owner);await mkdir(contentDir,{recursive:true});
if(!manifest.fixture_ids.content)await writeFile(join(contentDir,`${marker}.md`),text,{flag:'wx'});
manifest.fixture_ids.content=join(contentDir,`${marker}.md`);await save();
manifest.acceptance_query=`${marker}: Which customers have overdue invoices and contracts renewing next month? Show the account contact, project, outstanding amount and renewal terms, with supporting sources.`;
await save();
if(process.env.KNOWLEDGE_SEED_ONLY==='1'){
  console.log(JSON.stringify({status:'seeded',marker,result_file:join(folder,'result.json')}));
  process.exit(0);
}
const content=listContentExplorer(owner,{source:'generated',limit:100,offset:0}).items.find(i=>i.filename===`${marker}.md`);
assert.ok(content);
const db=new Database(':memory:'),store=knowledgeStore(db),search=knowledgeSearch();
const create=(kind,collections)=>store.save(owner,{name:`${marker} ${kind}`,kind,collections,graph_enabled:true,connection_ref:knowledgeConnectionRef(owner,kind)});
const crm=create('crm',['companies','people']),erp=create('erp',['Customer','Project','Sales Invoice']),files=create('content',['generated']),knowledge=create('knowledge',['tables','documents']);
const map=(from,fromObject,to,toObject,relation,note)=>store.addMapping(owner,{from_source:from.id,from_object:fromObject,to_source:to.id,to_object:toObject,relation,note});
map(crm,`companies/${company.id}`,erp,`Customer/${invoice.fields.customer}`,'same_customer','Controlled test contract explicitly records both system IDs');
map(files,content.relative_path,crm,`companies/${company.id}`,'contract_for','Contract contains exact CRM account ID');
map(knowledge,`documents/${doc.id}`,crm,`companies/${company.id}`,'contract_for','Knowledge document contains exact CRM account ID');
map(knowledge,`tables/${table.id}`,crm,`companies/${company.id}`,'account_register','Controlled table row contains exact CRM account ID');
const revisions=[];
try {
  for(let i=0;i<4;i++) {
    const job=store.claim(),result=await runKnowledgeJob(job,{store,search});
    assert.equal(result.status,'completed',result.error);revisions.push(result.revision);
    console.log(JSON.stringify({stage:'source-indexed',kind:store.get(owner,job.source_id).kind,records:result.records}));
  }
  const query=`${marker}: Which customers have overdue invoices and contracts renewing next month? Show the account contact, project, outstanding amount and renewal terms, with supporting sources.`;
  const deps={store,search};
  const evidence=await connectedKnowledge(owner,{query,depth:4},deps);
  for(const id of [`companies/${company.id}`,`people/${person.id}`,invoice.object_id,`Project/${project.name}`,content.relative_path,`documents/${doc.id}`,`tables/${table.id}`])assert.ok(evidence.evidence.some(e=>e.object_id===id),`Missing ${id}`);
  manifest.checks.push('five real source types retrieved with explicit/native relationships');
  const answer=await answerConnectedKnowledge(owner,{query},{retrieve:()=>evidence});
  assert.equal(answer.answer_status,'generated_from_evidence');
  manifest.answer=answer.answer;manifest.citations=answer.citations;manifest.checks.push('live LLM generated answer with valid citation IDs');
  assert.equal((await connectedKnowledge(`${owner}-other`,{query},deps)).evidence.length,0);
  manifest.checks.push('second owner denied');manifest.status='passed-backend-only';await save();
  console.log(JSON.stringify({test:'five-source-live-backend',status:manifest.status,run,records:evidence.evidence.length,relationships:evidence.relationships.length,checks:manifest.checks,result_file:join(folder,'result.json'),note:'UI, updates, deletion and remaining release gates are not covered by this test.'}));
} catch(error){manifest.status='failed';manifest.error=error.message;await save();throw error;}
finally {for(const revision of revisions)await search.discard(owner,revision);db.close();}
