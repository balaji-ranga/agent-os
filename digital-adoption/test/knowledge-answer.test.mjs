import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeAnswer} from '../src/knowledge-answer.mjs';
test('knowledge greetings guide users without fabricating evidence or calling a model',async()=>{
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:()=>{throw new Error('Unexpected model call');}});
 for(const text of ['Hi','hello!','Good evening']){
  const result=await answer({text,evidence:[]});
  assert.equal(result.kind,'greeting');assert.deepEqual(result.citations,[]);assert.match(result.message,/Digital Experience Guide/);
 }
 const missing=await answer({text:'What is the refund policy?',evidence:[]});
 assert.equal(missing.kind,'no_evidence');assert.deepEqual(missing.citations,[]);
});
test('an uncited model response cannot become a supported factual answer',async()=>{
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({content:JSON.stringify({message:'Invented promise is 99 hours.',citations:[]})})})});
 const result=await answer({text:'What is the delivery promise?',evidence:[{chunkId:'a',title:'Handbook',text:'The handbook does not specify delivery.'}]});
 assert.equal(result.kind,'no_evidence');assert.doesNotMatch(result.message,/99/);
});
