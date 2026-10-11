import { sourceRecords } from '../src/services/knowledge-source-adapters.js';
const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(!owner||!/demo|test|e2e/.test(owner))throw new Error('An explicit test/demo owner is required');
const counts={invoices:0,submitted:0,overdue:0,projects:0,contacts:0};
for await(const record of sourceRecords(owner,{kind:'erp',collections:['Contact','Project','Sales Invoice']})) {
  if(record.object_id.startsWith('Sales Invoice/')){
    counts.invoices++;
    if(record.fields.status!=='Draft')counts.submitted++;
    if(record.fields.outstanding_amount>0&&record.fields.due_date<new Date().toISOString().slice(0,10))counts.overdue++;
  }
  if(record.object_id.startsWith('Project/'))counts.projects++;
  if(record.object_id.startsWith('Contact/'))counts.contacts++;
}
console.log(JSON.stringify({test:'acceptance-fixture-readiness',counts,scope:'read-only existing test records; no business values emitted'}));
