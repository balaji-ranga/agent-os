import test from 'node:test';import assert from 'node:assert/strict';
import {parseAssistantResponse,assistantResponseSchema}from'../src/assistant-contract.mjs';
import {createProposalStore,validateSnapshot}from'../src/proposals.mjs';
import {openRepository}from'../src/repository.mjs';
import {createTaskController}from'../web/task-controller.mjs';
import {mayApplyAutomatically,automaticOutcomeMessage}from'../web/field-approval.mjs';
import {createPlatformPlanner}from'../src/platform-model.mjs';import{deterministicReview}from'../integrations/checker-contract.mjs';
import{createPlatformGateway}from'../integrations/platform-gateway.mjs';
import{encodePlannerRequest}from'../src/planner-budget.mjs';
import{handleGoal}from'../src/goal-service.mjs';
const snapshot={revision:1,path:'/catalog',fields:[{ref:'r1f0',label:'Find equipment',type:'text'}],links:[],targets:[{ref:'r1t0',kind:'content',label:'Find',role:'button',text:'Find'}],controls:[{ref:'r1a0',label:'Find'}]};
test('a recorded button activation cannot be replayed by a continuation assessment',async()=>{
 for(const outcome of ['local_state_verified','unknown']){
  let blocked=false;const row={id:'goal-a',version:2,current:0,steps:[{kind:'activate',effects:[{actions:[{type:'activate',outcome}]}]}]},goals={get:()=>row,block:()=>{blocked=true;},reserve:()=>assert.fail('Must not reserve or dispatch another activation')};
  await assert.rejects(()=>handleGoal({operation:'next',scope:{},input:{id:row.id,version:2,snapshot},goals,goalModel:()=>assert.fail('No new model request'),planner:()=>assert.fail('No new action plan'),proposals:{},stillCurrent:()=>{}}),error=>error.publicCode==='GOAL_OUTCOME_REQUIRED');assert.equal(blocked,true);
 }
});
test('action intents cannot be empty narratives; clarification and reviewed-plan routing stay explicit',()=>{
 for(const intent of ['edit','navigate','activate','guide'])assert.throws(()=>parseAssistantResponse(JSON.stringify({intent,message:'Here are the next steps.',actions:[]}),snapshot),/intent_action_mismatch/);
 for(const intent of ['clarify','plan','explain'])assert.equal(parseAssistantResponse(JSON.stringify({intent,message:'Focused next decision.',actions:[]}),snapshot).intent,intent);
});
test('activation requires its own fresh namespace and sole action, never a read-only or submit ref',()=>{
 const good={intent:'activate',message:'Confirm the button.',actions:[{type:'activate',ref:'r1a0'}]};assert.equal(parseAssistantResponse(JSON.stringify(good),snapshot).actions[0].ref,'r1a0');
 for(const ref of ['r1t0','r1f0','r1s0','r2a0'])assert.throws(()=>parseAssistantResponse(JSON.stringify({...good,actions:[{type:'activate',ref}]}),snapshot));
 assert.throws(()=>parseAssistantResponse(JSON.stringify({message:'Bundled',actions:[{type:'fill',ref:'r1f0',value:'events'},{type:'activate',ref:'r1a0'}]}),snapshot));
 for(const controls of [[{ref:'r2a0',label:'Find'}],[...snapshot.controls,...snapshot.controls],[{ref:'r1a0',label:''}]])assert.throws(()=>validateSnapshot({...snapshot,controls}));
});
test('activation reviews remain session scoped, one use and fenced like other host effects',()=>{
 const repository=openRepository();try{const store=createProposalStore(repository),scope={embeddingId:'site-a',sessionId:'visitor-a'},p=store.prepare(scope,snapshot,{intent:'activate',message:'Confirm Find',actions:[{type:'activate',ref:'r1a0'}]});assert.match(p.message,/not been clicked/);assert.throws(()=>store.consume({...scope,sessionId:'visitor-b'},{id:p.id,revision:1,approved:true}));const approved=store.consume(scope,{id:p.id,revision:1,approved:true});assert.equal(approved.actions[0].type,'activate');assert.throws(()=>store.consume(scope,{id:p.id,revision:1,approved:true}));}finally{repository.close();}
});
test('explicit autonomous opt-in covers requested effects but never guide mode or unsupported mixed actions',()=>{
 const fill={type:'fill',ref:'r1f0',value:'events'};assert.equal(mayApplyAutomatically({actions:[fill]}),false);assert.equal(mayApplyAutomatically({approvalRequired:false,actions:[fill]}),true);
 for(const type of ['activate','navigate','submit','highlight'])assert.equal(mayApplyAutomatically({approvalRequired:false,actions:[{type}]}),true);
 assert.equal(mayApplyAutomatically({approvalRequired:false,mode:'guide',actions:[fill]}),false);assert.equal(mayApplyAutomatically({approvalRequired:false,actions:[]}),false);assert.equal(mayApplyAutomatically({approvalRequired:false,actions:[fill,{type:'activate'}]}),false);
});
test('button click alone is not success and a failed observation is never retried',async()=>{
 let clicks=0;const inspector={activate:async()=>{clicks++;return {activated:true,uiChanged:false,reason:'No UI change observed'};}},controller=createTaskController({inspector,request:async()=>{}});
 await assert.rejects(()=>controller.execute({revision:1,actions:[{type:'activate',ref:'r1a0'}]}),e=>e.code==='OUTCOME_UNKNOWN');assert.equal(clicks,1);
 inspector.activate=async()=>{clicks++;return {activated:true,uiChanged:true};};assert.equal((await controller.execute({revision:1,actions:[{type:'activate',ref:'r1a0'}]})).outcome,'local_state_verified');assert.equal(clicks,2);
});
test('reviewed goal action contract is not overwritten by read-only words in constraints',async()=>{
 const task='Activate Find once. The query was prepared; do not fill or highlight anything.',goalContext={currentStep:'Apply the query',kind:'activate',allowedActionTypes:['activate']},proposal={message:'Confirm the button.',actions:[{type:'activate',ref:'r1a0'}]};
 assert.equal(deterministicReview({purpose:'digital_adoption_plan',task,observed:snapshot,proposal,goalContext}),null);
 const planner=createPlatformPlanner({gatewayUrl:'https://model.invalid/complete',serviceToken:'x'.repeat(32),fetchImpl:async()=>new Response(JSON.stringify({content:JSON.stringify(proposal),quality:{enabled:true}}))});assert.deepEqual((await planner({text:task,snapshot,goalContext})).actions,proposal.actions);
 assert.match(deterministicReview({purpose:'digital_adoption_plan',task,observed:snapshot,proposal,goalContext:{currentStep:'Inspect',kind:'inspect',allowedActionTypes:['highlight']}}),/only action types/);
});
test('routing format repair and review do not demand an executable plan at the handoff boundary',async()=>{
 const token='x'.repeat(32);let makers=0,checks=0;
 const config={active:'secondary',quality:{enabled:true},checker:{slot:'primary',baseUrl:'https://checker.invalid',model:'checker',apiKey:'synthetic'}};
 const gateway=createPlatformGateway({serviceToken:token,resolveActive:async()=>config,complete:async request=>{
  if(request.config.slot){checks++;assert.match(request.messages[0].content,/Judge ONLY the decision to route/);return {content:JSON.stringify({decision:'accept',feedback:'Appropriate routing only.',checks:{taskMatch:'pass',grounding:'pass',safety:'pass'}})};}
  makers++;if(makers===2){assert.equal(request.outputSchema.properties.actions.maxItems,0);assert.match(JSON.parse(request.messages.at(-1).content).boundedCheckerFeedback,/actions:\[\]/);}
  return {content:JSON.stringify({intent:'plan',message:'Forward the original complete task.',actions:makers===1?[{type:'fill',ref:'r1f0',value:'robotics'}]:[]})};
 }});
 const result=await gateway({authorization:'Bearer '+token,body:{purpose:'digital_adoption_plan',selection:'platform_active',messages:[{role:'user',content:JSON.stringify({task:'Find robotics workshops and show results',observed:snapshot})}]}});
 assert.equal(JSON.parse(result.content).intent,'plan');assert.deepEqual(JSON.parse(result.content).actions,[]);assert.equal(makers,2);assert.equal(checks,1);
});
test('production-style guidance fits by deduplicating canonical refs, not deleting task facts',()=>{
 const controls=Array.from({length:24},(_,i)=>({ref:`r1a${i}`,label:'Control '+i,context:'Rendered item context '.repeat(5)})),targets=Array.from({length:24},(_,i)=>({ref:`r1t${i}`,label:'Target '+i,role:'article',kind:'content',text:'Rendered evidence '.repeat(10)}));
 const observed={...snapshot,controls,targets},context={task:'Find robotics workshops and show actual results',observed,sourceGuidance:{matches:[{description:'Owner field meaning must survive'}]},siteGuidance:{observations:[],policy:'Guidance policy '.repeat(120)},recipeGuidance:{policy:'Published guidance '.repeat(80)},responseContract:{controls,targets:targets.map(({ref,label,role})=>({ref,label,role})),fields:observed.fields,links:[]}};
 const body={messages:[{role:'system',content:'System instructions '.repeat(250)},{role:'user',content:JSON.stringify(context)}]},initial=Buffer.byteLength(JSON.stringify(body)),encoded=encodePlannerRequest(body,{maxBytes:initial-2000}),actual=JSON.parse(JSON.parse(encoded).messages.at(-1).content);
 assert.ok(Buffer.byteLength(encoded)<=initial-2000);assert.equal(actual.task,context.task);assert.deepEqual(actual.observed.controls,controls);assert.deepEqual(actual.observed.targets,targets);assert.equal(actual.sourceGuidance.matches[0].description,'Owner field meaning must survive');assert.match(actual.responseContract.liveReferences,/canonical/);
 assert.throws(()=>encodePlannerRequest({messages:[{role:'system',content:'x'.repeat(10000)},{role:'user',content:JSON.stringify({task:'Must remain intact',observed:snapshot})}]},{maxBytes:1000}),e=>e.publicCode==='COPILOT_CONTEXT_LIMIT');
});

test('current goal stage narrows the actual maker schema rather than merely advising it',()=>{
 const observed={...snapshot,links:[{ref:'r1n0',label:'Archive',path:'/archive'}]};
 for(const type of ['fill','activate','highlight','navigate']){const schema=assistantResponseSchema(observed,{goalStep:true,allowedActionTypes:[type]});assert.ok(schema.properties.actions.items.anyOf.length);assert.deepEqual([...new Set(schema.properties.actions.items.anyOf.map(a=>a.properties.type.const))],[type]);}
});

test('autonomous result information distinguishes field application, navigation and verified submission',()=>{
 assert.match(automaticOutcomeMessage([{type:'navigate',label:'Records'}],[{navigated:true,verified:true}]),/Automatically opened Records/);
 assert.match(automaticOutcomeMessage([{type:'submit',label:'Save'}],[{hostReported:'success'}]),/host reported success/);
 assert.doesNotMatch(automaticOutcomeMessage([{type:'submit',label:'Save'}],[{hostReported:'success'}]),/Save was not clicked/);
 assert.equal(mayApplyAutomatically({approvalRequired:false,actions:[{type:'unknown'}]}),false);
});
