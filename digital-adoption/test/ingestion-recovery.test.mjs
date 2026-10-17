import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createKnowledgeService} from '../src/knowledge-service.mjs';
test('interrupted ingestion recovers with fenced retry and idempotent completed work',async()=>{
 const repository=openRepository();let now=1000,release,calls=0;
 const search={index:async()=>{if(++calls===1)await new Promise(resolve=>{release=resolve;});}};
 const scope={embeddingId:'synthetic',audienceIds:['public'],role:'maintainer'};
 try{
  const service=createKnowledgeService(repository,search,{clock:()=>now,leaseMs:1000}),source=service.createText(scope,{title:'Fixture',text:'Synthetic recovery evidence.'});
  const first=service.ingest(scope,source.id);const rejected=assert.rejects(first,/changed|expired/);
  await assert.rejects(()=>service.ingest(scope,source.id));
  now+=1001;const restarted=createKnowledgeService(repository,search,{clock:()=>now,leaseMs:1000});
  assert.equal(restarted.recoverExpired().recovered,1);assert.equal(restarted.list(scope)[0].status,'failed');
  assert.equal((await restarted.ingest(scope,source.id)).status,'ready');release();await rejected;
  assert.equal(restarted.list(scope)[0].status,'ready');assert.equal((await restarted.ingest(scope,source.id)).reused,true);assert.equal(calls,2);
 }finally{repository.close();}
});
