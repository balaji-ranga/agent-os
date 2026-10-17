import test from 'node:test';
import assert from 'node:assert/strict';
import { openRepository } from '../src/repository.mjs';
import { createKnowledgeService } from '../src/knowledge-service.mjs';
import { createOpenSearch } from '../src/opensearch.mjs';

test('ingestion and retrieval recheck authoritative source lifecycle and embedding scope (search double)',async()=>{
 const repository=openRepository();let chunks=[];
 const search={index:async(_,batch)=>{chunks=batch;},remove:async()=>{},search:async()=>({hits:{hits:chunks.map(c=>({_source:c}))}})};
 try{
  const service=createKnowledgeService(repository,search),owner={embeddingId:'A',audienceIds:['public'],role:'maintainer'};
  const visitor={...owner,role:'visitor'},other={...owner,embeddingId:'B'};
  const source=service.createText(owner,{title:'Synthetic handbook',text:'The demo delivery time is 3 days.'});
  assert.equal((await service.retrieve(visitor,{query:'delivery'})).evidence.length,0);
  await service.ingest(owner,source.id);
  assert.equal((await service.retrieve(visitor,{query:'delivery'})).evidence.length,1);
  assert.equal((await service.retrieve(other,{query:'delivery'})).evidence.length,0);
  assert.throws(()=>service.createText(visitor,{title:'bad',text:'bad'}));
  await service.remove(owner,source.id);
  // Deliberately keep stale search hits: deleted evidence must still be rejected.
  assert.equal((await service.retrieve(visitor,{query:'delivery'})).evidence.length,0);
 }finally{repository.close();}
});

test('OpenSearch transport derives index and rejects partial bulk failures (transport double)',async()=>{
 const requests=[];
 const search=createOpenSearch({url:'https://search.test',fetchImpl:async(url,init)=>{requests.push({url:String(url),init});return {ok:true,json:async()=>({errors:true})};}});
 await assert.rejects(()=>search.index('A',[{embedding_id:'A',chunk_id:'one'}]),/failed/);
 assert.match(requests[0].init.body,/adoption-[a-f0-9]{64}-v1/);
 assert.throws(()=>createOpenSearch({url:'http://search.test'}));
});
