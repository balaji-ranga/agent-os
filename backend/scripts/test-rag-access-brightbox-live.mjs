// Read-only live acceptance. User source visibility/grants must be configured first.
import assert from 'node:assert/strict';
import {ragDocumentsForAgent,listTablesForAgent} from '../src/services/master-data-tools.js';
import {knowledgeStore} from '../src/services/knowledge-store.js';
import {PLATFORM_OWNER_ID} from '../src/services/opensearch/index.js';
const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(owner!=='ceo-demo-brightbox-744921')throw new Error('Explicit BrightBox owner required');
const store=knowledgeStore(),agent='balserve',blocked='crm-s1-ceodemobrigh';
assert.equal(store.agentSources(owner,blocked).length,0,'Negative-control agent must have no source grants');
const source=store.list(owner).find(s=>s.name==='Knowledge-E2E-571e2944 knowledge');
assert.ok(source&&store.agentSources(owner,agent).includes(source.id));
const before=JSON.stringify(store.list(owner));
const tablesBefore=await listTablesForAgent(owner);
const call=(a,p)=>ragDocumentsForAgent(owner,{agentId:`t-${owner}--${a}`,query:'Acme Hotels contract',summarize:false,...p});
const denied=await call(blocked,{});
assert.equal(denied.ceo_hit_count,0);assert.equal(denied.company_knowledge_access,'no_knowledge_sources_granted');
await assert.rejects(()=>call(blocked,{retrieval_mode:'connected_information'}),e=>e.status===403&&e.code==='knowledge_access_required');
const allowed=await call(agent,{});
assert.ok(allowed.ceo_hit_count>0,'Visible granted document source must yield evidence');
const chunks=allowed.chunks.filter(c=>c.corpus==='ceo');
assert.ok(chunks.every(c=>c.source===source.id&&c.object_id.startsWith('documents/')));
const documentId=chunks[0].document_id;
for(const key of ['document_id','documentId']){
 await assert.rejects(()=>call(blocked,{[key]:documentId}),e=>e.status===403);
 const single=await call(agent,{[key]:documentId});assert.ok(single.ceo_hit_count>0);assert.ok(single.chunks.every(c=>c.document_id===documentId));
}
const ph=await call('platformhelp',{query:'Twenty CRM companies leads opportunities'});
assert.equal(ph.owner_user_id,PLATFORM_OWNER_ID);assert.ok(ph.hit_count>0);assert.ok(ph.chunks.every(c=>c.corpus==='platform-help'));
assert.deepEqual(await listTablesForAgent(owner),tablesBefore,'Table tools unchanged');
assert.equal(JSON.stringify(store.list(owner)),before,'No test changes to sources');
console.log(JSON.stringify({passed:true,owner,no_grants_company_hits:denied.ceo_hit_count,granted_company_hits:allowed.ceo_hit_count,explicit_document_aliases:true,connected_denial:true,platform_help_hits:ph.hit_count,table_tools_unchanged:true,source_settings_unchanged:true}));
