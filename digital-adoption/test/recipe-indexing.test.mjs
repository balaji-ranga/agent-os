import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createKnowledgeService} from '../src/knowledge-service.mjs';
test('published workflow summaries use its embedding index and authoritative version revocation',async()=>{
 const repository=openRepository();let chunks=[];const indexed=[];
 try{
  const search={index:async(embedding,batch)=>{indexed.push(embedding);chunks.push(...batch);},search:async()=>({hits:{hits:chunks.map(_source=>({_source}))}})};
  const knowledge=createKnowledgeService(repository,search),learning=createLearningRuntime(repository,createLearningStore(repository),{knowledge});
  const owner={embeddingId:'A',audienceIds:['public'],audienceId:'public',role:'maintainer',origin:'https://example.com'},visitor={...owner,role:'visitor'};
  const recipe=learning.create(owner,{title:'Customer coaching',steps:[{action:'fill',path:'/customer',field:'company',parameter:'company_name'}]});
  learning.observe(owner,{revision:1,path:'/customer',fields:[{ref:'r1f0',key:'company',label:'Company',type:'text'}]});learning.validate(owner,{id:recipe.id,version:1});
  const result=await learning.publish(owner,{id:recipe.id,version:1,reviewed:true});assert.equal(result.indexed,true);assert.deepEqual(indexed,['A']);
  assert.equal((await knowledge.retrieve(visitor,{query:'Customer'})).evidence.length,1);assert.equal((await knowledge.retrieve({...visitor,embeddingId:'B'},{query:'Customer'})).evidence.length,0);
  learning.disable(owner,{id:recipe.id,version:2});assert.equal((await knowledge.retrieve(visitor,{query:'Customer'})).evidence.length,0);assert.equal(knowledge.available(visitor).length,0);
 }finally{repository.close();}
});
