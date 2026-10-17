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
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({content:JSON.stringify({evidenceStatus:'supported',message:'Invented promise is 99 hours.',citations:[]})})})});
 const result=await answer({text:'What is the delivery promise?',evidence:[{chunkId:'a',title:'Handbook',text:'The handbook does not specify delivery.'}]});
 assert.equal(result.kind,'no_evidence');assert.doesNotMatch(result.message,/99/);
});
test('an explicit abstention cannot acquire supported status from an unrelated citation',async()=>{
 let evidenceStatus='insufficient';
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({content:JSON.stringify({evidenceStatus,message:'Insufficient evidence for the price.',citations:['a']})})})});
 const input={text:'What is the enterprise price?',evidence:[{chunkId:'a',title:'Public guide',text:'Welcome to the public guide.'}]};
 const result=await answer(input);assert.equal(result.kind,'no_evidence');assert.deepEqual(result.citations,[]);
 evidenceStatus=false;await assert.rejects(()=>answer(input),/Invalid evidence/);
});

test('an evidenced negative answer is distinct from insufficient evidence',async()=>{
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async(url,options)=>{
  const prompt=JSON.parse(options.body).messages[0].content;assert.match(prompt,/positive OR negative/);
  return {ok:true,json:async()=>({content:JSON.stringify({evidenceStatus:'supported',message:'No. A separate approval is required.',citations:['a']})})};
 }});
 const result=await answer({text:'Does a draft authorize submission?',evidence:[{chunkId:'a',title:'Policy',text:'The participant must approve submission separately.'}]});
 assert.equal(result.kind,'answer');assert.match(result.message,/^No/);assert.equal(result.citations[0].chunkId,'a');
});

test('null model JSON is a malformed answer instead of an authorization failure',async()=>{
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({content:'null'})})});
 await assert.rejects(answer({text:'Which handbook?',evidence:[{chunkId:'a',text:'Handbook'}]}),/Invalid evidence citations/);
});
