import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { knowledgeStore } from '../src/services/knowledge-store.js';
import { knowledgeConnectionRef, assertKnowledgeSourceAccess } from '../src/services/knowledge-source-adapters.js';
import { browseKnowledge } from '../src/services/knowledge-runtime.js';

const owner=process.env.KNOWLEDGE_TEST_OWNER;
if(!owner||!/^ceo-(demo|test|e2e)-/.test(owner))throw new Error('Explicit isolated test owner required');
const store=knowledgeStore();
const input={name:`Worker acceptance ${randomUUID()}`,kind:'content',collections:['generated'],graph_enabled:true,interval_seconds:86400,connection_ref:await knowledgeConnectionRef(owner,'content')};
await assertKnowledgeSourceAccess(owner,input);
const source=store.save(owner,input);
try {
  const deadline=Date.now()+300000;
  let current;
  do {
    current=store.get(owner,source.id);
    if(current.status==='error')throw new Error(current.error);
    if(current.status==='ready')break;
    await new Promise(resolve=>setTimeout(resolve,3000));
  }while(Date.now()<deadline);
  assert.equal(current.status,'ready','Deployed worker must pick up the persisted job');
  const records=await browseKnowledge(owner,source.id);
  assert.ok(records.records.length>0,'Worker must publish browsable records');
  assert.equal(store.get(`${owner}-other`,source.id),undefined);
  store.setEnabled(owner,source.id,false);
  assert.equal((await browseKnowledge(owner,source.id)).records.length,0);
  console.log(JSON.stringify({test:'deployed-worker',status:'passed',source:source.id,records:records.records.length,checks:['durable queue pickup','published records','owner isolation','pause hides records']}));
}finally{
  store.remove(owner,source.id);
  assert.equal(store.get(owner,source.id),undefined);
  console.log('Disposable test source removed; durable cleanup scheduled.');
}
