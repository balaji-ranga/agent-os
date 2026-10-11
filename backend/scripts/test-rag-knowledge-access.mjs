import assert from 'node:assert/strict';
import {grantedDocumentRag} from '../src/services/knowledge-document-access.js';
import {ragDocumentsForAgent} from '../src/services/master-data-tools.js';
import {PLATFORM_OWNER_ID} from '../src/services/opensearch/index.js';
process.env.KNOWLEDGE_SYNC_ENABLED='1';
let grants=[],visible=true,calls=0;
const sources=[{id:'docs',kind:'knowledge',collections:['documents','tables'],enabled:true,revision:'v1',status:'ready'},{id:'crm',kind:'crm',collections:['companies'],enabled:true,revision:'v1',status:'ready'}];
const permit=(owner,agent,ids)=>{assert.equal(owner,'alice');assert.equal(agent,'employee');if(ids?.some(id=>!grants.includes(id)))throw Object.assign(new Error('not granted'),{status:403});return ids||grants;};
const deps={permit,store:{list:()=>sources.map(s=>({...s,retrieval_enabled:visible}))},assertAccess:async()=>{},retrieve:async(owner,input,options)=>{
  calls++;assert.deepEqual(input.source_ids,['docs']);assert.equal(input.depth,0);assert.ok(input.document_scope);await options.assertAccess(owner,sources[0]);
  return {chunks:[{object_id:`documents/${input.document_scope.id||'doc1'}/chunks/0`,text:'Projected permitted evidence',title:'Allowed document'}],sources:[{id:'docs'}]};
}};
const companyRag=(owner,agent,input)=>grantedDocumentRag(owner,agent,input,deps);
const help={chunks:[{content:'Public help content',title:'Help'}],hit_count:1};
const toolDeps={companyRag,helpRag:async()=>help,data:{getDocument:async(owner,id)=>{assert.equal(owner,PLATFORM_OWNER_ID);return id==='help-doc'?{id}:null;},ragDocuments:async owner=>{assert.equal(owner,PLATFORM_OWNER_ID);return {...help,owner_user_id:owner};}},summarize:async(owner,query,chunks)=>({text:chunks.map(c=>c.content).join(' '),summary:chunks.map(c=>c.content).join(' ')})};
for(const mode of [undefined,'documents','rag','auto','']){
 const r=await ragDocumentsForAgent('alice',{agentId:'employee',query:'private',retrieval_mode:mode},toolDeps);
 assert.equal(r.ceo_hit_count,0);assert.equal(r.company_knowledge_access,'no_knowledge_sources_granted');assert.equal(r.platform_help_hit_count,1);
}
assert.equal(calls,0);
for(const alias of ['document_id','documentId'])await assert.rejects(()=>ragDocumentsForAgent('alice',{source:'employee',q:'private',[alias]:'doc1'},toolDeps),e=>e.status===403);
grants=['crm'];assert.equal((await companyRag('alice','employee',{query:'x'})).hit_count,0);
grants=['docs'];
for(const alias of ['document_id','documentId']){
 const r=await ragDocumentsForAgent('alice',{agent_id:'employee',question:'x',[alias]:'doc1',summarize:true},toolDeps);
 assert.equal(r.ceo_hit_count,1);assert.match(r.summary,/Projected permitted evidence/);
}
await assert.rejects(()=>companyRag('alice','employee',{query:'x',source_ids:['crm']}),/not granted/);
await assert.rejects(()=>companyRag('alice','employee',{query:'x',documentId:'doc1/other'}),/Invalid document ID/);
visible=false;assert.equal((await companyRag('alice','employee',{query:'x'})).hit_count,0);visible=true;
const revoked={...deps,retrieve:async(owner,input,options)=>{grants=[];await options.assertAccess(owner,sources[0]);}};
await assert.rejects(()=>grantedDocumentRag('alice','employee',{query:'x'},revoked),/not granted/);
const ph=await ragDocumentsForAgent('alice',{agentId:'t-alice--platformhelp',query:'help'},toolDeps);
assert.equal(ph.owner_user_id,PLATFORM_OWNER_ID);assert.equal(ph.corpus,'platform-help');
assert.equal((await ragDocumentsForAgent('alice',{agentId:'employee',query:'help',document_id:'help-doc'},toolDeps)).corpus,'platform-help');
await assert.rejects(()=>ragDocumentsForAgent('alice',{agentId:'employee',query:'x',retrieval_mode:'CONNECTED_INFORMATION'},toolDeps),/Unsupported/);
console.log('RAG source access passed: default/mode aliases, document aliases, source subsets, projected copies, hidden/revoked sources and Platform Help preserved.');
