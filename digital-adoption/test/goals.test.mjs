import {deterministicReview} from '../integrations/checker-contract.mjs';
import {explicitEditProposal} from '../src/edit-intent.mjs';
import {reviewContext,goalCheckerPrompt} from '../integrations/checker-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRepository} from '../src/repository.mjs';
import {createGoalStore} from '../src/goal-store.mjs';
import {parseGoalResponse} from '../src/goal-contract.mjs';
import {handleGoal} from '../src/goal-service.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {createPlatformGateway} from '../integrations/platform-gateway.mjs';
const scope={embeddingId:'synthetic-site',sessionId:'synthetic-visitor',conversationVersion:0};
const snapshot={revision:1,path:'/entry',fields:[{ref:'r1f0',label:'Company name',type:'text'}],links:[],submissions:[{ref:'r1s0',label:'Save record'}]};
const plan={message:'Review the plan.',steps:[{title:'Prepare company',kind:'fill',instruction:'Set Company name to Orchid.',expected:'Company name locally observed as Orchid.'},{title:'Save company',kind:'save',instruction:'Save the reviewed company record.',expected:'Host acknowledges the saved record.'}]};
const fixture=()=>{const repo=openRepository(),goals=createGoalStore(repo),proposals=createProposalStore(repo,{checkGoal:(s,id,pid,write)=>goals.allows(s,id,pid,write)});const model=async({stage})=>stage==='assess'?{message:'Browser-reported step observed.',status:'complete',remainingInstruction:''}:plan;return {repo,goals,proposals,model,call:input=>handleGoal({operation:input.op,scope,input,goals,proposals,goalModel:model,planner:async()=>({message:'Review Orchid',actions:[{type:'fill',ref:'r1f0',value:'Orchid'}]}),stillCurrent(){}})};};
test('goal schema contains descriptions only and rejects executable metadata/oversized plans',()=>{
 assert.equal(parseGoalResponse(JSON.stringify(plan)).steps.length,2);
 for(const bad of [{...plan,actions:[]},{...plan,steps:[{...plan.steps[0],ref:'r1f0'}]},{...plan,steps:Array(13).fill(plan.steps[0])}])assert.throws(()=>parseGoalResponse(JSON.stringify(bad)));
 assert.throws(()=>parseGoalResponse(JSON.stringify({message:'ok',status:'continue',remainingInstruction:''}),'assess'));
});
test('goal scope and version fencing prevent cross-site/session/conversation access and duplicate planning',()=>{
 const f=fixture();try{const row=f.goals.create(scope,{text:'Prepare and save Orchid.',plan});
 for(const other of [{...scope,sessionId:'other'},{...scope,embeddingId:'other'},{...scope,conversationVersion:1}])assert.throws(()=>f.goals.get(other,row.id));
 const started=f.goals.control(scope,{id:row.id,version:row.version,action:'start'}),lease=f.goals.reserve(scope,{id:row.id,version:started.version});assert.throws(()=>f.goals.reserve(scope,{id:row.id,version:started.version}));
 const paused=f.goals.control(scope,{id:row.id,version:lease.row.version,action:'pause'});assert.throws(()=>f.goals.prepared(scope,row.id,lease.claim,()=>assert.fail('late proposal must not be created')));assert.equal(f.goals.block(scope,row.id,'late failure',lease.claim).status,'paused');assert.equal(paused.status,'paused');
 }finally{f.repo.close();}
});
test('goals persist across repository restart; expired goal and cleared conversation are inaccessible',()=>{
 const dir=mkdtempSync(join(tmpdir(),'adoption-goal-')),path=join(dir,'goals.db');let repo=openRepository(path),now=1000,goals=createGoalStore(repo,{clock:()=>now,retentionMs:600000}),row=goals.create(scope,{text:'Prepare and save Orchid.',plan});repo.close();repo=openRepository(path);goals=createGoalStore(repo,{clock:()=>now,retentionMs:600000});try{assert.equal(goals.get(scope,row.id).steps.length,2);now+=600001;assert.throws(()=>goals.get(scope,row.id));goals.maintain();assert.equal(repo.map('goal_plans').values().length,0);}finally{repo.close();rmSync(dir,{recursive:true,force:true});}
});
test('recorded effects gate advancement and Save remains a distinct reviewed action',async()=>{
 const f=fixture();try{let row=(await f.call({op:'create',text:'Prepare and save Orchid.',snapshot})).goal;row=(await f.call({op:'control',id:row.id,version:row.version,action:'start'})).goal;
 let prepared=await f.call({op:'next',id:row.id,version:row.version,snapshot});assert.equal(prepared.proposal.actions[0].type,'fill');row=prepared.goal;
 await assert.rejects(()=>f.call({op:'observe',id:row.id,version:row.version,snapshot}),e=>e.publicCode==='GOAL_OUTCOME_REQUIRED');
 assert.throws(()=>f.proposals.consume(scope,{id:prepared.proposal.id,revision:1,approved:true}));row=f.goals.get(scope,row.id);row=(await f.call({op:'control',id:row.id,version:row.version,action:'resume'})).goal;prepared=await f.call({op:'next',id:row.id,version:row.version,snapshot});
 const approved=f.proposals.consume(scope,{id:prepared.proposal.id,revision:1,approved:true});const action=approved.actions[0];f.proposals.dispatch(scope,action);f.proposals.observeAttempt(scope,{...action,outcome:'local_state_verified'});
 row=f.goals.get(scope,row.id);row=(await f.call({op:'observe',id:row.id,version:row.version,snapshot})).goal;assert.equal(row.current,1);assert.equal(row.status,'ready');
 prepared=await f.call({op:'next',id:row.id,version:row.version,snapshot});assert.equal(prepared.proposal.actions[0].type,'submit');assert.equal(prepared.goal.current,1);assert.equal(prepared.goal.status,'awaiting_review');
 }finally{f.repo.close();}
});
test('unknown approved effects cannot be resumed into another write or completed by client claims',async()=>{
 const f=fixture();try{let row=f.goals.create(scope,{text:'Prepare and save Orchid.',plan});row=f.goals.control(scope,{id:row.id,version:row.version,action:'start'});const p=await f.call({op:'next',id:row.id,version:row.version,snapshot});const action=f.proposals.consume(scope,{id:p.proposal.id,revision:1,approved:true}).actions[0];f.proposals.dispatch(scope,action);f.proposals.observeAttempt(scope,{...action,outcome:'unknown'});
 await assert.rejects(()=>f.call({op:'observe',id:row.id,version:p.goal.version,snapshot,completed:true}),e=>e.publicCode==='GOAL_OUTCOME_REQUIRED');row=f.goals.get(scope,row.id);await assert.rejects(()=>f.call({op:'control',id:row.id,version:row.version,action:'resume'}),e=>e.publicCode==='GOAL_OUTCOME_REQUIRED');assert.equal(f.goals.get(scope,row.id).current,0);
 }finally{f.repo.close();}
});
test('private goal reviews are invalid after task access changes, including after approval before dispatch',()=>{
 const repo=openRepository();let allowed=true;const proposals=createProposalStore(repo,{checkPrivateTask:()=>allowed});try{const p=proposals.prepare(scope,snapshot,{message:'Review',actions:[{type:'fill',ref:'r1f0',value:'Orchid'}]});proposals.bindPrivateTask(scope,p.id,{taskId:'synthetic-task',instanceId:'synthetic-instance',contentRevision:0});const action=proposals.consume(scope,{id:p.id,revision:1,approved:true}).actions[0];allowed=false;assert.throws(()=>proposals.dispatch(scope,action));assert.throws(()=>proposals.goalEvidence(scope,p.id));}finally{repo.close();}
});
test('goal plans and assessments pass the existing global maker/checker policy',async()=>{
 const token='synthetic-goal-service-token-00000000',calls=[],gateway=createPlatformGateway({serviceToken:token,resolveActive:async()=>({active:'primary',quality:{enabled:true},checker:{slot:'secondary',baseUrl:'https://synthetic.invalid',model:'test',apiKey:'synthetic'}}),complete:async request=>{calls.push(request);return {content:JSON.stringify(request.config.slot?{decision:'accept',feedback:'Descriptions match the requested goal.',checks:{taskMatch:'pass',grounding:'pass',safety:'pass'}}:plan)};}});
 const result=await gateway({authorization:'Bearer '+token,body:{purpose:'digital_adoption_goal',selection:'platform_active',messages:[{role:'user',content:JSON.stringify({stage:'plan',task:'Prepare and save Orchid.',observed:snapshot})}]}});assert.equal(calls.length,2);assert.equal(JSON.parse(result.content).steps.length,2);assert.equal(result.quality.enabled,true);
});


test('invalid goal drafts receive goal-specific repair feedback instead of executable-action instructions',async()=>{
 const token='synthetic-goal-service-token-00000000';let makers=0,feedback;
 const gateway=createPlatformGateway({serviceToken:token,resolveActive:async()=>({active:'primary',quality:{enabled:true},checker:{slot:'secondary',baseUrl:'https://synthetic.invalid',model:'test',apiKey:'synthetic'}}),complete:async input=>{if(input.config.slot)return {content:JSON.stringify({decision:'accept',feedback:'Descriptions match the task.',checks:{taskMatch:'pass',grounding:'pass',safety:'pass'}})};makers++;if(makers===2)feedback=JSON.parse(input.messages.at(-1).content).boundedCheckerFeedback;return {content:JSON.stringify(makers===1?{steps:Array(13).fill(plan.steps[0])}:plan)};}});
 const result=await gateway({authorization:'Bearer '+token,body:{purpose:'digital_adoption_goal',selection:'platform_active',messages:[{role:'user',content:JSON.stringify({stage:'plan',task:'Prepare and save Orchid.',observed:snapshot})}]}});assert.equal(result.quality.revisions,1);assert.match(feedback,/message:string,steps:array/);assert.match(feedback,/No actions/);assert.equal(JSON.parse(result.content).steps.length,2);
});


test('goal assessment checker reviews the current step while retaining the overall goal as background',()=>{
 const goal='Create and save a customer, note and opportunity.',currentStep={...plan.steps[1],effects:[]};
 const context=reviewContext([{role:'user',content:JSON.stringify({task:goal,stage:'assess',observed:snapshot,goalContext:{currentStep,latestEvidence:{actions:[{type:'submit',outcome:'host_reported_saved'}]}}})}],'digital_adoption_goal',{message:'The browser reports the save acknowledgment.',status:'complete',remainingInstruction:''});
 assert.equal(context.task,currentStep.instruction);assert.equal(context.overallGoal,goal);assert.match(goalCheckerPrompt,/CURRENT-step/);assert.match(goalCheckerPrompt,/not a request to finish every remaining step now/);
});


test('mixed set/keep instructions delegate semantic reasoning instead of absorbing a second field clause',()=>{
 const observed={revision:1,fields:[{ref:'r1f0',label:'Search records, publishers, capabilities',type:'text'},{ref:'r1f1',label:'transport',type:'select-one',choices:['All transports','stdio']}],links:[]};
 assert.equal(explicitEditProposal("Set the Search records field to 'orchid' and keep the transport on 'All transports'.",observed),null);
});
test('known navigation and host Save evidence advance without asking a model to reinterpret those outcomes',async()=>{
 const repo=openRepository(),goals=createGoalStore(repo),proposals=createProposalStore(repo,{checkGoal:(s,id,pid,write)=>goals.allows(s,id,pid,write)});try{
 const steps=[{title:'Open target',kind:'navigate',instruction:'Open Target',expected:'Target page is observed'},{title:'Save target',kind:'save',instruction:'Save the current target form',expected:'Host acknowledges submission'}];let row=goals.create(scope,{text:'Open Target and save its form',plan:{message:'Review navigation and Save separately.',steps}});row=goals.control(scope,{id:row.id,version:row.version,action:'start'});
 const from={...snapshot,path:'/entry',links:[{ref:'r1n0',label:'Target',path:'/target'}]},at={...snapshot,path:'/target'};
 const call=input=>handleGoal({operation:input.op,scope,input,goals,proposals,goalModel:async()=>assert.fail('No semantic assessment is needed for this known outcome'),planner:async()=>({message:'Review navigation',actions:[{type:'navigate',ref:'r1n0'}]}),stillCurrent(){}});
 let p=await call({op:'next',id:row.id,version:row.version,snapshot:from});let a=proposals.consume(scope,{id:p.proposal.id,revision:1,approved:true}).actions[0];proposals.dispatch(scope,a);proposals.observeAttempt(scope,{...a,outcome:'local_state_verified'});row=(await call({op:'observe',id:row.id,version:p.goal.version,snapshot:at})).goal;assert.equal(row.current,1);
 p=await call({op:'next',id:row.id,version:row.version,snapshot:at});a=proposals.consume(scope,{id:p.proposal.id,revision:1,approved:true}).actions[0];proposals.dispatch(scope,a);proposals.observeAttempt(scope,{...a,outcome:'host_reported_saved'});row=(await call({op:'observe',id:row.id,version:p.goal.version,snapshot:at})).goal;assert.equal(row.status,'completed');assert.match(row.message,/not independent business verification/);
 }finally{repo.close();}
});
test('ended private tasks do not expose saved goal text through status',async()=>{
 const f=fixture();try{const row=f.goals.create(scope,{text:'Prepare Orchid from the task file',plan,privateTask:{taskId:'private-task',instanceId:'private-instance',contentRevision:0}});const result=await handleGoal({operation:'status',scope,input:{id:row.id},goals:f.goals,goalModel:f.model,planner:async()=>{},proposals:f.proposals,privateTasks:{goalBinding:()=>false},stillCurrent(){}});assert.equal(result.goal,null);assert.equal(f.repo.map('goal_plans').values().length,0);}finally{f.repo.close();}
});
test('missing consequential facts produce clarification without persisting an executable plan',()=>{
 const f=fixture();try{const result=f.goals.create(scope,{text:'Create a customer',plan:{message:'What email should I use?',steps:[]}});assert.equal(result.message,'What email should I use?');assert.equal(result.status,'clarifying');assert.equal(result.steps.length,0);assert.equal(f.repo.map('goal_plans').values().length,1);}finally{f.repo.close();}
});


test('a private goal cannot ground invented facts in its own model-generated step instruction',async()=>{
 const f=fixture();try{const planWithInventedName={message:'Review this step',steps:[{title:'Fill company',kind:'fill',instruction:'Set Company name to Invented Company',expected:'Company observed'}]};let row=f.goals.create(scope,{text:'Fill the company name from my attached file.',plan:planWithInventedName,privateTask:{taskId:'private-task',instanceId:'private-instance',contentRevision:0}});row=f.goals.control(scope,{id:row.id,version:row.version,action:'start'});
 await assert.rejects(()=>handleGoal({operation:'next',scope,input:{id:row.id,version:row.version,snapshot},goals:f.goals,goalModel:f.model,planner:async()=>({message:'Review invented data',actions:[{type:'fill',ref:'r1f0',value:'Invented Company'}]}),proposals:f.proposals,privateTasks:{goalContext:async()=>({contentRevision:0,evidence:[{text:'Company name: Actual Company'}]})},stillCurrent(){}}),e=>e.publicCode==='GOAL_BLOCKED');assert.equal(f.repo.map('proposals').values().length,0);
 }finally{f.repo.close();}
});


test('a field step cannot bundle a later read-only goal action in its model review',()=>{
 const context={purpose:'digital_adoption_plan',task:'Set the company name to Orchid',observed:snapshot,goalContext:{currentStep:'Fill company',allowedActionTypes:['fill','navigate']},proposal:{actions:[{type:'fill',ref:'r1f0',value:'Orchid'},{type:'highlight',ref:'r1f0'}]}};assert.match(deterministicReview(context),/current goal step/);
});


test('pausing or cancelling a plan invalidates cached approval and dispatch authority on the server',async()=>{
 for(const action of ['pause','cancel']){const f=fixture();try{let row=f.goals.create(scope,{text:'Prepare and save Orchid',plan});row=f.goals.control(scope,{id:row.id,version:row.version,action:'start'});const p=await f.call({op:'next',id:row.id,version:row.version,snapshot});const a=f.proposals.consume(scope,{id:p.proposal.id,revision:1,approved:true}).actions[0];f.goals.control(scope,{id:row.id,version:p.goal.version,action});assert.throws(()=>f.proposals.dispatch(scope,a));assert.equal(f.repo.map('action_attempts').get(a.actionId).state,'reserved');}finally{f.repo.close();}}
});
test('coaching/audience/config changes invalidate cached goal writes and cannot reactivate an old plan',async()=>{
 const f=fixture();try{let row=f.goals.create(scope,{text:'Prepare and save Orchid',plan});row=f.goals.control(scope,{id:row.id,version:row.version,action:'start'});const p=await f.call({op:'next',id:row.id,version:row.version,snapshot});
 for(const changed of [{...scope,capabilities:{coach:true}},{...scope,audienceIds:['private']},{...scope,websiteRevision:2},{...scope,hostPrincipal:'different-user'}])assert.throws(()=>f.proposals.consume(changed,{id:p.proposal.id,revision:1,approved:true}));
 assert.equal(f.goals.current({...scope,capabilities:{coach:true}}),null);assert.throws(()=>f.proposals.consume(scope,{id:p.proposal.id,revision:1,approved:true}));
 }finally{f.repo.close();}
});
test('legacy unbound preview plans are cancelled and their cached reviews cannot dispatch after upgrade',()=>{
 const repo=openRepository();try{repo.map('goal_plans').set('legacy',{id:'legacy',...scope,status:'awaiting_review',expiresAt:Date.now()+10000,pendingProposalId:'legacy-review'});repo.map('proposals').set('legacy-review',{id:'legacy-review',...scope,status:'pending'});createGoalStore(repo);assert.equal(repo.map('goal_plans').get('legacy').status,'cancelled');assert.equal(repo.map('proposals').get('legacy-review').status,'rejected');assert.equal(repo.map('proposals').get('legacy-review').goalId,'legacy');}finally{repo.close();}
});


test('clarification preserves the original goal and produces a new reviewed plan without effects',async()=>{
 const f=fixture();try{const initial=f.goals.create(scope,{text:'Create Orchid and save it; ask for its contact email.',plan:{message:'What contact email should I use?',steps:[]}});let seen;
 const result=await handleGoal({operation:'clarify',scope,input:{id:initial.id,version:initial.version,answer:'Use orchid@example.test',snapshot},goals:f.goals,goalModel:async input=>{seen=input;return plan;},planner:async()=>assert.fail('Clarifying must not execute a step'),proposals:f.proposals,stillCurrent(){}});
 assert.equal(result.goal.id,initial.id);assert.equal(result.goal.status,'draft');assert.match(seen.text,/Create Orchid/);assert.match(seen.text,/orchid@example.test/);assert.equal(seen.goalContext.replanning,true);assert.equal(seen.goalContext.clarificationPrompt,'What contact email should I use?');assert.equal(seen.goalContext.resolvedClarification.answer,'Use orchid@example.test');assert.equal(f.repo.map('proposals').values().length,0);
 }finally{f.repo.close();}
});
test('clarification retains completed work and refuses to replace an approved uncertain effect',async()=>{
 const f=fixture();try{let row=f.goals.create(scope,{text:'Prepare and save Orchid.',plan});row=f.goals.control(scope,{id:row.id,version:row.version,action:'start'});let prepared=await f.call({op:'next',id:row.id,version:row.version,snapshot});const a=f.proposals.consume(scope,{id:prepared.proposal.id,revision:1,approved:true}).actions[0];
 await assert.rejects(()=>f.call({op:'clarify',id:row.id,version:prepared.goal.version,snapshot,answer:'Use a different company'}),e=>e.publicCode==='GOAL_OUTCOME_REQUIRED');f.proposals.dispatch(scope,a);f.proposals.observeAttempt(scope,{...a,outcome:'local_state_verified'});row=(await f.call({op:'observe',id:row.id,version:prepared.goal.version,snapshot})).goal;
 const revised=await handleGoal({operation:'clarify',scope,input:{id:row.id,version:row.version,snapshot,answer:'Continue with the save only'},goals:f.goals,goalModel:async input=>{assert.equal(input.goalContext.completedSteps.length,1);return {...plan,steps:[plan.steps[1]]};},planner:async()=>assert.fail('No step execution during clarification'),proposals:f.proposals,stillCurrent(){}});
 assert.equal(revised.goal.current,1);assert.equal(revised.goal.steps[0].status,'completed');assert.equal(revised.goal.steps[1].kind,'save');assert.equal(revised.goal.status,'draft');
 }finally{f.repo.close();}
});


test('clarification cannot add a Save absent from the user goal or clarification',async()=>{
 const f=fixture();try{const initial=f.goals.create(scope,{text:'Prepare Orchid. Do not save.',plan:{message:'What email?',steps:[]}});await assert.rejects(()=>handleGoal({operation:'clarify',scope,input:{id:initial.id,version:initial.version,answer:'Use orchid@example.test',snapshot},goals:f.goals,goalModel:async()=>plan,planner:async()=>assert.fail('No execution'),proposals:f.proposals,stillCurrent(){}}),e=>e.publicCode==='GOAL_BLOCKED');assert.equal(f.repo.map('proposals').values().length,0);assert.equal(f.goals.get(scope,initial.id).status,'blocked');}finally{f.repo.close();}
});


test('current goal-step proposals use focused checker instructions and preserve existing token policy',async()=>{
 const {reviewCopilotResponse}=await import('../integrations/maker-checker.mjs');let seen;const result=await reviewCopilotResponse({config:{active:'primary',checker:{slot:'secondary',baseUrl:'https://synthetic.invalid',model:'test',apiKey:'synthetic',maxTokens:1536}},purpose:'digital_adoption_plan',messages:[{role:'user',content:JSON.stringify({task:'Set Company name to Orchid.',observed:snapshot,goalContext:{currentStep:'Prepare company',allowedActionTypes:['fill','navigate']}})}],draft:JSON.stringify({message:'Review Orchid',actions:[{type:'fill',ref:'r1f0',value:'Orchid'}]}),complete:async request=>{seen=request;return {content:JSON.stringify({decision:'accept',feedback:'Matches observed facts.',checks:{taskMatch:'pass',grounding:'pass',safety:'pass'}})};}});assert.match(seen.messages[0].content,/ONLY this current goal-step/);assert.equal(seen.maxTokens,1536);assert.equal(result.quality.decision,'accept');
});


test('goal observation context excludes stale pre-approval wording but retains recorded effects and unknown outcomes',async()=>{
 const {goalObservationContext}=await import('../src/goal-model.mjs');const input={currentStep:{instruction:'Fill company',effects:[{responseMessage:'Nothing changed yet.',actions:[{type:'fill',label:'Company',value:'Orchid',outcome:'local_state_verified'},{type:'fill',label:'Email',value:'x@example.test',outcome:'unknown'}]}]}};const result=goalObservationContext(input);assert.equal(JSON.stringify(result).includes('Nothing changed yet'),false);assert.equal(result.currentStep.effects[0].actions[0].outcome,'local_state_verified');assert.equal(result.currentStep.effects[0].actions[1].outcome,'unknown');assert.equal(input.currentStep.effects[0].responseMessage,'Nothing changed yet.');
});


test('goal model requests retain the provider JSON-mode cue in both planning and assessment',async()=>{
 const {createGoalModel}=await import('../src/goal-model.mjs');const model=createGoalModel({gatewayUrl:'https://synthetic.invalid',serviceToken:'synthetic-goal-service-token-00000000',fetchImpl:async(_url,request)=>{const body=JSON.parse(request.body),context=JSON.parse(body.messages.at(-1).content);assert.match(body.messages[0].content,/JSON/);if(context.stage==='assess'){assert.equal(JSON.stringify(context.goalContext).includes('Nothing changed yet'),false);assert.equal(context.overallGoal,undefined);return new Response(JSON.stringify({content:JSON.stringify({message:'Local fields observed.',status:'complete',remainingInstruction:''})}));}return new Response(JSON.stringify({content:JSON.stringify(plan)}));}});await model({text:'Prepare and save Orchid.',snapshot});await model({stage:'assess',text:'Prepare and save Orchid.',snapshot,goalContext:{currentStep:{...plan.steps[0],effects:[{responseMessage:'Nothing changed yet',actions:[]}]}}});
});


test('explicit assignments strip sentence punctuation outside quotes but preserve quoted field punctuation',()=>{
 const observed={revision:1,path:'/entry',fields:[{ref:'r1f0',label:'Title',type:'text'},{ref:'r1f1',label:'Body',type:'textarea'}],links:[]};const p=explicitEditProposal("Set Title to 'Followup Orchid' and Body to 'Follow up about renewal!'.",observed);assert.deepEqual(p.actions.map(a=>a.value),['Followup Orchid','Follow up about renewal!']);
});


test('an empty checker provider response gets one inference-only retry with unchanged model and token policy, then fails closed',async()=>{
 const {reviewCopilotResponse}=await import('../integrations/maker-checker.mjs');const config={active:'primary',checker:{slot:'secondary',baseUrl:'https://synthetic.invalid',model:'test',apiKey:'synthetic',maxTokens:1536}},messages=[{role:'user',content:JSON.stringify({stage:'plan',task:'Prepare and save Orchid.',observed:snapshot})}];for(const recover of [true,false]){let checks=0;const work=reviewCopilotResponse({config,purpose:'digital_adoption_goal',messages,draft:JSON.stringify(plan),complete:async request=>{checks++;assert.equal(request.config,config.checker);assert.equal(request.maxTokens,1536);if(checks===1||!recover)throw Object.assign(new Error('Empty provider response'),{diagnosticCode:'PROVIDER_EMPTY_OR_INVALID'});return {content:JSON.stringify({decision:'accept',feedback:'Grounded plan.',checks:{taskMatch:'pass',grounding:'pass',safety:'pass'}})};}});if(recover){const result=await work;assert.equal(result.quality.checkerRetries,1);assert.equal(result.quality.decision,'accept');}else await assert.rejects(()=>work,e=>e.code==='COPILOT_CHECKER_UNAVAILABLE');assert.equal(checks,2);}
});


test('a clarification request focuses the maker on the latest reply and retains original goal as quoted context',async()=>{
 const {createGoalModel}=await import('../src/goal-model.mjs');let captured;const model=createGoalModel({gatewayUrl:'https://synthetic.invalid',serviceToken:'synthetic-goal-service-token-00000000',fetchImpl:async(_url,request)=>{captured=JSON.parse(JSON.parse(request.body).messages.at(-1).content);return new Response(JSON.stringify({content:JSON.stringify(plan)}));}});await model({text:'Create Orchid, ask for email before filling.',snapshot,goalContext:{replanning:true,originalGoal:'Create Orchid, ask for email before filling.',resolvedClarification:{question:'What email?',answer:'Use orchid@example.test'}}});assert.match(captured.task,/Incorporate this latest user answer: Use orchid@example.test/);assert.match(captured.task,/historical request to ask a question has already been fulfilled/);assert.equal(captured.goalContext.originalGoal,'Create Orchid, ask for email before filling.');
});


test('goal schema repair does not consume its one semantic checker repair and both remain bounded',async()=>{
 const {reviewCopilotResponse}=await import('../integrations/maker-checker.mjs');let makers=0,judges=0;const malformed={...plan,steps:plan.steps.map(({title,...rest})=>rest)};const result=await reviewCopilotResponse({config:{active:'primary',checker:{slot:'secondary',baseUrl:'https://synthetic.invalid',model:'test',apiKey:'synthetic'}},purpose:'digital_adoption_goal',messages:[{role:'user',content:JSON.stringify({stage:'plan',task:'Prepare and save Orchid.',observed:snapshot})}],draft:JSON.stringify(malformed),complete:async request=>{if(request.config.slot){judges++;return {content:JSON.stringify({decision:judges===1?'revise':'accept',feedback:judges===1?'Remove the resolved question step.':'Grounded remaining plan.',checks:{taskMatch:judges===1?'fail':'pass',grounding:'pass',safety:'pass'}})};}makers++;return {content:JSON.stringify(makers===1?{...plan,steps:[{title:'Ask email',kind:'fill',instruction:'Ask for email',expected:'Email supplied'},...plan.steps]}:plan)};}});assert.equal(makers,2);assert.equal(judges,2);assert.equal(result.quality.revisions,2);assert.equal(result.quality.decision,'accept');
});

test('peer goal contract accepts only described peer operations and exact recipient metadata',()=>{
 const step={title:'Ask paired form',kind:'peer',recipient:'observed-instance',mode:'inspect',instruction:'Inspect the paired form',expected:'Form schema returned'};
 assert.equal(parseGoalResponse(JSON.stringify({message:'Reviewed delegation',steps:[step]})).steps[0].mode,'inspect');
 for(const bad of [{...step,mode:'execute'},{...step,recipient:undefined},{...plan.steps[0],recipient:'foreign',mode:'goal'}])assert.throws(()=>parseGoalResponse(JSON.stringify({message:'Bad',steps:[bad]})));
});
test('peer goal waiting and completion are version-fenced and do not claim a direct local write',()=>{
 const f=fixture();try{const p={message:'Inspect the paired form',steps:[{title:'Inspect peer',kind:'peer',recipient:'known',mode:'inspect',instruction:'Inspect only',expected:'Schema returned'}]},r=f.goals.create(scope,{text:'Inspect only',plan:p}),started=f.goals.control(scope,{id:r.id,version:r.version,action:'start'}),claim=f.goals.reserve(scope,{id:r.id,version:started.version}),waiting=f.goals.peerPrepared(scope,r.id,claim.claim,{requestId:'rpc',taskId:'private',sourceInstanceId:'source',contentRevision:0});
 assert.equal(waiting.status,'awaiting_peer');assert.throws(()=>f.goals.reserve(scope,{id:r.id,version:waiting.version}));
 assert.throws(()=>f.goals.peerAssessed(scope,{id:r.id,version:waiting.version-1},{requestId:'rpc',status:'completed'}));
 const done=f.goals.peerAssessed(scope,{id:r.id,version:waiting.version},{requestId:'rpc',status:'completed',to:'https://peer.test',result:{fields:[]}});assert.equal(done.status,'completed');assert.equal(done.steps[0].effects[0].peer,'rpc');
 }finally{f.repo.close();}
});
