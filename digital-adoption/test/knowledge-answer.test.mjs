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
