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
  return {ok:true,json:async()=>({content:JSON.stringify({evidenceStatus:'supported',message:'No. A separate approval is required.',citations:[{chunkId:'a',quote:'The participant must approve submission separately.'}]})})};
 }});
 const result=await answer({text:'Does a draft authorize submission?',evidence:[{chunkId:'a',title:'Policy',text:'The participant must approve submission separately.'}]});
 assert.equal(result.kind,'answer');assert.match(result.message,/^No/);assert.equal(result.citations[0].chunkId,'a');
});

test('null model JSON is a malformed answer instead of an authorization failure',async()=>{
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({content:'null'})})});
 await assert.rejects(answer({text:'Which handbook?',evidence:[{chunkId:'a',text:'Handbook'}]}),/Invalid evidence citations/);
});

test('duplicate passages cannot crowd out a distinct fact or conflicting evidence',async()=>{
 let sent;
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async(url,options)=>{sent=JSON.parse(JSON.parse(options.body).messages[1].content).evidence;return {ok:true,json:async()=>({content:JSON.stringify({evidenceStatus:'insufficient',message:'Conflicting evidence',citations:[]})})};}});
 const input=[...Array.from({length:12},(_,i)=>({chunkId:'copy'+i,text:'Same repeated passage.'})),{chunkId:'fact',text:'A distinct documented fact.'},{chunkId:'conflict',text:'A different conflicting fact.'}];
 const result=await answer({text:'Which fact?',evidence:input});assert.deepEqual(sent.map(e=>e.chunkId),['copy0','fact','conflict']);assert.equal(result.kind,'no_evidence');
});

test('multibyte evidence stays within the real gateway byte budget and omits internal metadata',async()=>{
 let body;
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async(url,options)=>{body=options.body;return {ok:true,json:async()=>({content:JSON.stringify({evidenceStatus:'insufficient',message:'No complete answer',citations:[]})})};}});
 await answer({text:'Which policy?',history:Array.from({length:8},()=>({role:'user',text:'文'.repeat(800)})),replyContext:'文'.repeat(2000),evidence:Array.from({length:24},(_,i)=>({chunkId:'chunk'+i,title:'Policy '+i,text:i+' 文'.repeat(2000),url:'https://example.test/'+('x'.repeat(2000)),revision:'INTERNAL_REVISION'}))});
 assert.ok(Buffer.byteLength(body)<=30000);const sent=JSON.parse(JSON.parse(body).messages[1].content).evidence;assert.ok(sent.length>0&&sent.length<=12);assert.doesNotMatch(body,/INTERNAL_REVISION|https:\/\/example.test/);
});

test('abstention discards invented citations and prose while supported answers still reject them',async()=>{
 let evidenceStatus='insufficient';const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async()=>({ok:true,json:async()=>({content:JSON.stringify({evidenceStatus,message:'UNTRUSTED_ABSTENTION_PROSE',citations:['invented_chunk']})})})});
 const input={text:'Which conflicting day?',evidence:[{chunkId:'current',text:'Conflicting weekdays have no precedence.'}]};
 const result=await answer(input);assert.equal(result.kind,'no_evidence');assert.deepEqual(result.citations,[]);assert.doesNotMatch(result.message,/UNTRUSTED/);
 evidenceStatus='supported';await assert.rejects(answer(input),/Invalid evidence citations/);
});

test('a wrong-page quotation receives one bounded same-evidence repair and cannot become an answer uncorrected',async()=>{
 let calls=0,repair=true;const bodies=[];
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async(url,options)=>{
  calls++;bodies.push(JSON.parse(JSON.parse(options.body).messages[1].content));
  return {ok:true,json:async()=>({content:JSON.stringify({evidenceStatus:'supported',message:'Returns are accepted for nine days.',citations:[{chunkId:repair&&calls===2?'page2':'page1',quote:'Returns are accepted for nine days.'}]})})};
 }});
 const input={text:'What is the return period?',evidence:[{chunkId:'page1',text:'The primary contact is the Copper Desk.'},{chunkId:'page2',text:'Returns are accepted for nine days.'}]};
 const result=await answer(input);assert.equal(calls,2);assert.equal(bodies[1].validation.category,'citation-contract');assert.ok(bodies[1].validation.quotationHelp.examples.includes('The primary contact is the Copper Desk.'));assert.deepEqual(bodies[0].evidence,bodies[1].evidence);assert.equal(result.citations[0].chunkId,'page2');assert.deepEqual(result.citations[0].supportingQuotes,['Returns are accepted for nine days.']);
 calls=0;repair=false;await assert.rejects(answer(input),/Invalid evidence citations/);assert.equal(calls,2);
});

test('layout quotation lookup returns the original span without an unnecessary model correction',async()=>{
 let calls=0;
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async(url,options)=>{
  calls++;
  const quote='Separate participant Save confirmation is required.';
  return {ok:true,json:async()=>({content:JSON.stringify({evidenceStatus:'supported',message:'A draft alone does not permit submission.',citations:[{chunkId:'page',quote}]})})};
 }});
 const result=await answer({text:'Does the draft permit submission?',evidence:[{chunkId:'page',text:'Draft preparation does not permit submission. Separate participant Sa\nve confirmation is required.'}]});
 assert.equal(calls,1);assert.equal(result.citations[0].supportingQuotes[0],'Separate participant Sa\nve confirmation is required.');
});

test('citation correction retains the same evidence inside the UTF-8 request budget',async()=>{
 const bodies=[];
 const answer=createKnowledgeAnswer({gatewayUrl:'https://example.test/model',serviceToken:'x'.repeat(32),fetchImpl:async(url,options)=>{
  bodies.push(options.body);return {ok:true,json:async()=>({content:JSON.stringify({evidenceStatus:'supported',message:'Unsupported.',citations:[{chunkId:'chunk0',quote:'An invented quotation that is absent.'}]})})};
 }});
 await assert.rejects(answer({text:'Which policy?',evidence:Array.from({length:24},(_,i)=>({chunkId:'chunk'+i,text:('A '+i+' '+'word '.repeat(113)+'. ').repeat(4)}))}),/Invalid evidence citations/);
 assert.equal(bodies.length,2);assert.ok(bodies.every(body=>Buffer.byteLength(body)<=30_000));
 assert.deepEqual(...bodies.map(body=>JSON.parse(JSON.parse(body).messages[1].content).evidence));
});
