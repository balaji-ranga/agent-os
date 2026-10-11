// Explicit opt-in: actual local Ollama + OpenSearch, synthetic owner/data only.
// No business records, customer profiles or connector settings are modified.
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
if(process.env.KNOWLEDGE_AUTO_MODEL_LIVE!=='1')throw new Error('Set KNOWLEDGE_AUTO_MODEL_LIVE=1 for isolated live inference');
const directory=mkdtempSync(join(tmpdir(),'knowledge-auto-model-'));
process.env.AGENT_OS_DATA_DIR=directory;
process.env.OPENCLAW_DIR=directory;
const {getDb}=await import('../src/db/schema.js');
const {knowledgeStore}=await import('../src/services/knowledge-store.js');
const {knowledgeSearch}=await import('../src/services/knowledge-search.js');
const {knowledgeAdviceStore,suggestKnowledgeMapping,decideKnowledgeAdvice}=await import('../src/services/knowledge-mapping-advice.js');
const {connectedKnowledge}=await import('../src/services/knowledge-runtime.js');
const {saveEfficiencyPreferences,saveEfficiencyPolicy,efficiencyReport}=await import('../src/services/efficiency-control-plane.js');
const {entityId,fingerprint}=await import('../src/services/knowledge-contract.js');
const {opensearchRequest}=await import('../src/services/opensearch/client.js');
const owner=`auto-model-test-${randomUUID()}`,db=getDb(),store=knowledgeStore(db),search=knowledgeSearch(),advice=knowledgeAdviceStore(db);
const index=`aos-knowledge-${fingerprint(owner).slice(0,24)}`;
try{
  db.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,llm_efficiency_mode) VALUES (?,?,?,?,?,?)').run(owner,`${owner}@example.test`,'not-a-login','Synthetic Knowledge model test','ceo',1);
  saveEfficiencyPreferences(owner,{fallback_mode:'local_only'});
  // Disposable test DB only: allow CPU cold loading; never alter VPS policy.
  saveEfficiencyPolicy({local_timeout_ms:120000});
  const from=store.save(owner,{name:'Synthetic CRM',kind:'crm',collections:['companies'],enabled:true,graph_enabled:true,intelligent_mapping:true});
  const to=store.save(owner,{name:'Synthetic ERP',kind:'erp',collections:['Customer'],enabled:true,graph_enabled:true});
  db.prepare("UPDATE knowledge_sources SET revision='live-test-v1',status='ready' WHERE owner=?").run(owner);
  const source=store.get(owner,from.id),target=store.get(owner,to.id);
  const first={object_id:'companies/AC-4242',title:'Acme shared account AC-4242',text:'CRM customer Acme. Verified cross-system account identifier AC-4242. The ERP customer for this same account has the identical verified external identifier AC-4242.',fields:{external_id:'AC-4242'}};
  const second={object_id:'Customer/AC-4242',title:'Acme shared account AC-4242',text:'ERP customer Acme. Verified cross-system account identifier AC-4242. This is the same customer account as CRM AC-4242.',fields:{external_id:'AC-4242'}};
  await search.ensure(owner);
  await search.putRecord(owner,source,source.revision,first);
  await search.putRecord(owner,target,target.revision,second);
  await search.refresh(owner);
  const deps={store,search,advice,assertAccess:async()=>{}};
  const generated=await suggestKnowledgeMapping(owner,{source_id:source.id,object_id:first.object_id,target_source_id:target.id},deps);
  const suggestion=generated.suggestion;
  const confidence=suggestion?.confidence;
  if(suggestion){
    assert.ok(Number.isFinite(confidence)&&confidence>=0&&confidence<=1,'Model confidence must be valid');
    assert.equal(suggestion.status,confidence>=0.75?'active':'pending','Only supported high-confidence links may activate automatically');
  }else assert.equal(generated.note,'Model found no supported match','Only explicit model abstention may omit a suggestion');
  const events=efficiencyReport(owner).events;
  assert.ok(events.some(e=>e.tool_name==='knowledge_mapping_advice'&&e.status==='success'&&e.local===1),'Actual model call must use local efficiency path');
  const result=await connectedKnowledge(owner,{query:'Acme account AC-4242'},deps);
  const inferred=result.relationships.filter(e=>e.evidence?.origin==='model_inferred');
  assert.equal(inferred.length>0,suggestion?.status==='active','Pending or abstained matches must not enter retrieval');
  assert.ok(inferred.every(e=>e.from_record?.title&&e.to_record?.title),'Indexed endpoints must be readable');
  if(suggestion)await decideKnowledgeAdvice(owner,suggestion.id,'reject',deps);
  const rejected=await connectedKnowledge(owner,{query:'Acme account AC-4242'},deps);
  assert.ok(!rejected.relationships.some(e=>e.evidence?.origin==='model_inferred'));
  console.log(JSON.stringify({passed:true,actual_model:events.find(e=>e.local===1)?.actual_model,outcome:!suggestion?'abstained':suggestion.status==='active'?'auto_indexed':'low_confidence_withheld',confidence,automatic_indexing:inferred.length>0,readable_endpoints:inferred.length?true:null,rejection_effective:suggestion?true:null,owner_isolation:entityId(owner,source.id,first.object_id)!==entityId('other',source.id,first.object_id)}));
}finally{
  await opensearchRequest('DELETE',`/${index}`).catch(()=>{});
  db.close();
  rmSync(directory,{recursive:true,force:true});
}
