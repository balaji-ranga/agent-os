import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createGoalStore} from '../src/goal-store.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {handleGoal} from '../src/goal-service.mjs';

const scope={embeddingId:'recipient-site',sessionId:'recipient-session',origin:'https://recipient.test',conversationVersion:0};
const snapshot={revision:1,path:'/search',fields:[{ref:'r1f0',label:'Find records',type:'search'}],links:[],submissions:[]};
const fill={title:'Prepare current search',kind:'fill',instruction:'Use Orchid in this search; do not submit.',expected:'Reviewed search field updated.'};
const binding={taskId:'private-task',instanceId:'receiver',peerRequestId:'request',delegation:{sourceInstanceId:'sender',sourceOrigin:'https://sender.test',recipientOrigin:scope.origin,instruction:'Use the shared reference in the receiving page.'}};

test('incoming goals and replans cannot bounce to the sender; other authorized peers remain available',async()=>{
 const repo=openRepository(),goals=createGoalStore(repo),captured=[];
 try{
  const common={scope,goals,proposals:{},planner:async()=>{},stillCurrent(){},privateTasks:{peerCatalog:()=>[{instanceId:'sender',origin:'https://sender.test'},{instanceId:'third',origin:'https://third.test'}],peerBinding:()=>binding,goalBinding:()=>true,goalContext:async()=>({contentRevision:0,evidence:[]})},goalModel:async context=>{captured.push(context);return {message:'Review',steps:[fill]};}};
  let result=await handleGoal({...common,operation:'create',input:{text:'Use the shared reference here.',snapshot,instanceId:'receiver',peerRequestId:'request'}});
  assert.deepEqual(captured[0].peerGuidance.map(p=>p.instanceId),['third']);assert.equal(captured[0].goalContext.delegation.sourceInstanceId,'sender');
  result=await handleGoal({...common,operation:'clarify',input:{id:result.goal.id,version:result.goal.version,answer:'Keep the current page.',snapshot,instanceId:'receiver'}});
  assert.deepEqual(captured[1].peerGuidance.map(p=>p.instanceId),['third']);assert.equal(captured[1].goalContext.delegation.sourceInstanceId,'sender');assert.equal(result.goal.steps.length,1);
 }finally{repo.close();}
});

test('even a model ignoring the incoming-role schema cannot create a return-to-sender goal',async()=>{
 const repo=openRepository(),goals=createGoalStore(repo);
 try{
  await assert.rejects(()=>handleGoal({operation:'create',scope,input:{text:'Use the shared reference here.',snapshot,instanceId:'receiver',peerRequestId:'request'},goals,proposals:{},planner:async()=>{},stillCurrent(){},privateTasks:{peerCatalog:()=>[{instanceId:'sender',origin:'https://sender.test'}],peerBinding:()=>binding,goalContext:async()=>({contentRevision:0,evidence:[]})},goalModel:async()=>({message:'Incorrect relay',steps:[{...fill,kind:'peer',recipient:'sender',mode:'goal'}]})}),e=>e.publicCode==='GOAL_PEER_UNAVAILABLE');
  assert.equal(goals.current(scope),null);
 }finally{repo.close();}
});

test('recovered interruptions survive replanning and replace a false no-failures final summary',async()=>{
 const repo=openRepository(),goals=createGoalStore(repo),proposals=createProposalStore(repo,{checkGoal:(s,id,pid,write)=>goals.allows(s,id,pid,write)});
 try{
  let goal=goals.create(scope,{text:'Summarize recorded outcomes.',plan:{message:'Review',steps:[{...fill,kind:'inspect',title:'Summarize',instruction:'Summarize recorded outcomes.'}]}});
  goal=goals.block(scope,goal.id,'The selected paired tab was offline. No work was queued.',undefined,'GOAL_PEER_UNAVAILABLE');
  const lease=goals.reserveClarification(scope,{id:goal.id,version:goal.version,answer:'Resume only remaining work.'});
  goal=goals.clarified(scope,goal.id,lease.claim,{message:'Review remaining work',steps:[{...fill,kind:'inspect',title:'Summarize',instruction:'Summarize recorded outcomes.'}]});
  goal=goals.control(scope,{id:goal.id,version:goal.version,action:'start'});
  const common={scope,goals,proposals,stillCurrent(){},planner:async()=>({intent:'explain',message:'No failures were reported.',actions:[]}),goalModel:async()=>({message:'No failures were reported.',status:'complete',remainingInstruction:''})};
  const prepared=await handleGoal({...common,operation:'next',input:{id:goal.id,version:goal.version,snapshot}});
  assert.match(prepared.proposal.message,/GOAL_PEER_UNAVAILABLE/);assert.doesNotMatch(prepared.proposal.message,/No failures/);
  const completed=await handleGoal({...common,operation:'observe',input:{id:goal.id,version:prepared.goal.version,snapshot}});
  assert.equal(completed.goal.status,'completed');assert.equal(completed.goal.interruptions.length,1);assert.match(completed.goal.message,/GOAL_PEER_UNAVAILABLE/);assert.doesNotMatch(completed.goal.message,/No failures/);
 }finally{repo.close();}
});
