import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSnapshot} from '../src/proposals.mjs';
import {assistantResponseSchema} from '../src/assistant-contract.mjs';
import {createPlatformGateway} from '../integrations/platform-gateway.mjs';
import {encodePlannerRequest} from '../src/planner-budget.mjs';
const observed={revision:1,path:'/directory',fields:[],links:[],targets:[{ref:'r1t0',label:'Example listing',role:'article',kind:'content',text:'A relevant result'}],pageContext:{text:'1533 approved listings · page 1',headings:Array.from({length:24},(_,i)=>({level:2,label:'Listing '+i})),headingCount:24,truncated:false}};
test('loaded-page evidence survives server validation independently of ranked targets',()=>{const s=validateSnapshot(observed);assert.equal(s.targets.length,1);assert.equal(s.pageContext.headings.length,24);assert.match(s.pageContext.text,/1533/);assert.match(s.pageContext.scope,/not a full-page census/);for(const p of [{...observed.pageContext,text:'x'.repeat(5001)},{...observed.pageContext,headings:[{level:9,label:'bad'}]},{...observed.pageContext,headingCount:1}])assert.throws(()=>validateSnapshot({...observed,pageContext:p}));});
test('page evidence is byte-bounded with explicit truncation, without losing action refs or task',()=>{const body={messages:[{role:'system',content:'rules'},{role:'user',content:JSON.stringify({task:'Read the loaded page',observed:{...observed,pageContext:{...observed.pageContext,text:'x'.repeat(5000)}}})}]};const encoded=encodePlannerRequest(body,{maxBytes:2500}),c=JSON.parse(JSON.parse(encoded).messages.at(-1).content);assert.ok(Buffer.byteLength(encoded)<=2500);assert.equal(c.task,'Read the loaded page');assert.equal(c.observed.targets[0].ref,'r1t0');assert.equal(c.observed.pageContext.truncated,true);});
test('read-only inspection uses the exact response schema and maker applies checker feedback before recheck',async()=>{
 const token='synthetic-page-inspection-service-token-0000',calls=[];let makers=0,checkers=0;
 const gateway=createPlatformGateway({serviceToken:token,resolveActive:async()=>({active:'primary',quality:{enabled:true},checker:{slot:'secondary',baseUrl:'https://synthetic.invalid',model:'checker',apiKey:'synthetic'}}),complete:async request=>{
  calls.push(request);
  if(request.config.slot){checkers++;const c=JSON.parse(request.messages.at(-1).content);assert.equal(c.observed.pageContext.headings.length,24);assert.equal(c.conversationContext[0].content,'Reply to the previous count of four.');return {content:JSON.stringify({decision:checkers===1?'revise':'accept',feedback:checkers===1?'Use all 24 loaded result headings, not four ranked targets; distinguish the displayed 1533 total.':'Grounded loaded count and displayed total.',checks:{taskMatch:checkers===1?'fail':'pass',grounding:checkers===1?'fail':'pass',safety:'pass'}})};}
  makers++;assert.deepEqual(request.outputSchema,assistantResponseSchema(validateSnapshot(observed)));
  if(makers===2)assert.match(request.messages.at(-1).content,/24 loaded result headings/);
  return {content:JSON.stringify({intent:'explain',message:makers===1?'Four listings.':'24 loaded listings on this page; the displayed dataset total is 1533.',actions:[]})};
 }});
 const result=await gateway({authorization:'Bearer '+token,body:{purpose:'digital_adoption_plan',selection:'platform_active',messages:[{role:'user',content:JSON.stringify({task:'Inspect the full DOM; are there more?',observed,conversationContext:[{role:'user',content:'Reply to the previous count of four.'}]})}]}});
 assert.equal(makers,2);assert.equal(checkers,2);assert.equal(result.quality.revisions,1);assert.equal(result.quality.decision,'accept');assert.match(JSON.parse(result.content).message,/24.*1533/);assert.deepEqual(JSON.parse(result.content).actions,[]);
});
test('malformed inspection root gets a precise bounded repair rather than being treated as a checker rejection',async()=>{
 const token='synthetic-page-inspection-service-token-0000';let makers=0,checkers=0;
 const gateway=createPlatformGateway({serviceToken:token,resolveActive:async()=>({active:'primary',quality:{enabled:true},checker:{slot:'secondary',baseUrl:'https://synthetic.invalid',model:'checker',apiKey:'synthetic'}}),complete:async request=>{
  if(request.config.slot){checkers++;return {content:JSON.stringify({decision:'accept',feedback:'Grounded.',checks:{taskMatch:'pass',grounding:'pass',safety:'pass'}})};}
  makers++;if(makers===1)return {content:JSON.stringify({intent:'explain',message:'Inspection',actions:[],observations:['extra root key']})};
  assert.match(request.messages.at(-1).content,/Root keys other than those are forbidden/);return {content:JSON.stringify({intent:'explain',message:'24 loaded results; 1533 total displayed.',actions:[]})};
 }});
 const result=await gateway({authorization:'Bearer '+token,body:{purpose:'digital_adoption_plan',selection:'platform_active',messages:[{role:'user',content:JSON.stringify({task:'Inspect full DOM',observed})}]}});assert.equal(makers,2);assert.equal(checkers,1);assert.equal(result.quality.revisions,1);
});
test('a contract repair does not consume the separate checker-feedback correction',async()=>{
 const token='synthetic-page-inspection-service-token-0000';let makers=0,checkers=0;
 const gateway=createPlatformGateway({serviceToken:token,resolveActive:async()=>({active:'primary',quality:{enabled:true},checker:{slot:'secondary',baseUrl:'https://synthetic.invalid',model:'checker',apiKey:'synthetic'}}),complete:async request=>{
  if(request.config.slot){checkers++;return {content:JSON.stringify({decision:checkers===1?'revise':'accept',feedback:checkers===1?'Distinguish loaded 24 and total 1533.':'Grounded.',checks:{taskMatch:checkers===1?'fail':'pass',grounding:'pass',safety:'pass'}})};}
  makers++;if(makers===1)return {content:JSON.stringify({intent:'explain',message:'Read this page.',actions:[{type:'highlight',ref:'r1t0'}]})};
  const repair=JSON.parse(request.messages.at(-1).content);assert.equal(repair.originalTask,'Inspect full DOM; are there more?');if(makers===2)assert.match(repair.boundedCheckerFeedback,/remove ALL actions/);else assert.match(repair.boundedCheckerFeedback,/24.*1533/);return {content:JSON.stringify({intent:'explain',message:makers===2?'24 loaded.':'24 loaded, 1533 total displayed.',actions:[]})};
 }});
 const result=await gateway({authorization:'Bearer '+token,body:{purpose:'digital_adoption_plan',selection:'platform_active',messages:[{role:'user',content:JSON.stringify({task:'Inspect full DOM; are there more?',observed})}]}});assert.equal(makers,3);assert.equal(checkers,2);assert.equal(result.quality.contractRepairs,1);assert.equal(result.quality.checkerRevisions,1);assert.equal(result.quality.decision,'accept');
});
