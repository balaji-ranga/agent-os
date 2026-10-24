import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSnapshot} from '../src/proposals.mjs';
import {pageObservationEvidence} from '../src/page-understanding.mjs';
import {createKnowledgeAnswer} from '../src/knowledge-answer.mjs';
import {deterministicReview} from '../integrations/checker-contract.mjs';
import {createPlatformPlanner} from '../src/platform-model.mjs';
import {reviewContext} from '../integrations/checker-contract.mjs';
const snapshot={revision:4,path:'/assets',screen:'Equipment register',fields:[{ref:'r4f0',label:'Serial reference',type:'text',value:'PRIVATE_VALUE'}],links:[],pageContext:{text:'107 registered assets · page 1',title:'Equipment register',headings:[],headingCount:0,truncated:false,structure:[{role:'output',label:'107 registered assets · page 1',region:'Equipment register'},{role:'input',label:'Serial reference',region:'Warranty claim',description:'Use the reference printed on the purchase certificate.',required:true,disabled:false}],structureTruncated:false,collections:[{role:'tbody',itemCount:10,labels:['Asset A','Asset B'],labelsTruncated:true,truncated:false}]}};
test('semantic structure survives validation while raw properties and current field values do not',()=>{
 const validated=validateSnapshot(snapshot),source=pageObservationEvidence(validated)[0];
 assert.equal(validated.pageContext.structure[1].region,'Warranty claim');assert.match(source.text,/purchase certificate/);assert.ok(!source.text.includes('PRIVATE_VALUE'));assert.equal(source.kind,'page_observation');
 for(const bad of [{...snapshot.pageContext,title:'x'.repeat(201)},{...snapshot.pageContext,structure:[{role:'input',label:'A',region:'B',disabled:'false'}]},{...snapshot.pageContext,structureTruncated:'false'}])assert.throws(()=>validateSnapshot({...snapshot,pageContext:bad}));
});
test('page questions work without uploaded knowledge, retain exact citations and give maker/checker the same fresh source',async()=>{
 let body;
 const answer=createKnowledgeAnswer({gatewayUrl:'https://model.invalid/complete',serviceToken:'x'.repeat(32),fetchImpl:async(_,options)=>{
  body=JSON.parse(options.body);const input=JSON.parse(body.messages.at(-1).content),source=input.evidence[0];
  assert.equal(input.observed.pageEvidenceRef,source.chunkId);assert.match(body.messages[0].content,/semantic interface/);assert.match(source.text,/Warranty claim/);
  return new Response(JSON.stringify({content:JSON.stringify({evidenceStatus:'supported',message:'107 assets; 10 loaded here. Assuming consistent page capacity, ceil(107/10) gives 11 pages.',citations:[{chunkId:source.chunkId,quote:'107 registered assets · page 1'},{chunkId:source.chunkId,quote:'Loaded item count: 10.'}]})}));
 }});
 const out=await answer({text:'How large is this register and how many pages?',snapshot,evidence:[]});
 assert.equal(out.pageObserved,true);assert.match(out.message,/11 pages/);assert.equal(out.citations[0].kind,'page_observation');assert.ok(Buffer.byteLength(JSON.stringify(body))<=30000);
 assert.equal(deterministicReview({purpose:'digital_adoption_knowledge',task:'How many ASSETs?',proposal:{evidenceStatus:'supported',citations:[{chunkId:out.citations[0].chunkId,quote:'Loaded item count: 10.'}]},evidence:JSON.parse(body.messages.at(-1).content).evidence}),null);
});
test('large current-page context is trimmed explicitly without exceeding the shared request budget or inventing sources',async()=>{
 const large=validateSnapshot({...snapshot,pageContext:{...snapshot.pageContext,text:'界'.repeat(5000),headings:Array.from({length:100},()=>({level:2,label:'界'.repeat(160)})),headingCount:100}}),original=JSON.stringify(large),source=pageObservationEvidence(large)[0];
 assert.ok(Buffer.byteLength(source.text)<=12000);assert.equal(JSON.stringify(large),original);assert.match(source.text,/truncated=true|truncated by request budget/);
 let requests=0;
 const answer=createKnowledgeAnswer({gatewayUrl:'https://model.invalid/complete',serviceToken:'x'.repeat(32),fetchImpl:async(_,options)=>{requests++;assert.ok(Buffer.byteLength(options.body)<=30000);return new Response(JSON.stringify({content:JSON.stringify({evidenceStatus:'supported',message:'Wrong source.',citations:[{chunkId:'current-page-999',quote:'107 registered assets'}]})}));}});
 await assert.rejects(answer({text:'What is visible?',snapshot:large,evidence:[]}),/Invalid evidence citations/);assert.equal(requests,2);
});

test('regular planner and checker receive the same readable semantics, not only the explicit-edit shortcut',async()=>{
 let context;
 const planner=createPlatformPlanner({gatewayUrl:'https://model.invalid/complete',serviceToken:'x'.repeat(32),fetchImpl:async(_,options)=>{
  const body=JSON.parse(options.body);context=JSON.parse(body.messages.at(-1).content);assert.match(context.pageEvidence[0].text,/Warranty claim/);assert.match(context.pageEvidence[0].text,/Loaded item count: 10/);assert.ok(!context.pageEvidence[0].text.includes('PRIVATE_VALUE'));
  const checked=reviewContext(body.messages,'digital_adoption_plan',{intent:'explain',message:'Ten rows are loaded.',actions:[]});assert.deepEqual(checked.pageEvidence,context.pageEvidence);
  return new Response(JSON.stringify({content:JSON.stringify({intent:'explain',message:'Ten rows are loaded.',actions:[]})}));
 }});
 const out=await planner({text:'Explain the loaded equipment table.',snapshot});assert.match(out.message,/Ten rows/);assert.ok(context.observed.pageContext.structure.length);
});
