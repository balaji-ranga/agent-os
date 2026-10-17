import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {once} from 'node:events';
import {openRepository} from '../src/repository.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createDiscoveryJobs} from '../src/discovery-jobs.mjs';
import {createPlatformPlanner} from '../src/platform-model.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {encodePlannerRequest} from '../src/planner-budget.mjs';
import {createCoachingGrants} from '../src/coaching-grants.mjs';
const origin='http://127.0.0.1:4194',owner={embeddingId:'memory-A',audienceId:'public',audienceIds:['public'],role:'maintainer',origin,sessionId:'teaching'},visitor={...owner,role:'visitor',capabilities:{coach:false},sessionId:'fresh'},screen=(path,key)=>({revision:1,path,fields:[{ref:'r1f0',key,label:key+' field',type:'text'}],links:[]});

test('inspected/discovered structure and saved teaching survive repository restart with audience and owner-draft isolation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'adoption-planning-')),path=join(root,'state.sqlite');let repo=openRepository(path),now=1_000_000;
 try{
  let learning=createLearningRuntime(repo,createLearningStore(repo),{clock:()=>now});
  learning.observe(owner,screen('/stock','inventory'));
  const discovery=createDiscoveryJobs(repo,learning,{clock:()=>now}),job=discovery.start(owner,{origin,seed:'/shipping',paths:['/shipping']});discovery.next(owner,job.id,{hasUnsavedWork:false});discovery.observe(owner,job.id,screen('/shipping','delivery'));
  learning.observe({...owner,audienceId:'staff',audienceIds:['staff']},screen('/private','PRIVILEGED_STAFF_CANARY'));
  learning.observe({...owner,embeddingId:'memory-B'},screen('/foreign','FOREIGN_WEBSITE_CANARY'));
  learning.create(owner,{title:'Inventory teaching lesson',steps:[{action:'fill',path:'/stock',field:'inventory',parameter:'inventory'}]});
  repo.close();repo=openRepository(path);learning=createLearningRuntime(repo,createLearningStore(repo),{clock:()=>now});
  const memory=learning.planningMemory(visitor,'inventory delivery',screen('/home','query'));
  assert.deepEqual(new Set(memory.observations.map(o=>o.originOfObservation)),new Set(['inspected','discovered']));assert.equal(memory.ownerDrafts.length,0);assert.doesNotMatch(JSON.stringify(memory),/PRIVILEGED_STAFF_CANARY|FOREIGN_WEBSITE_CANARY|r1f0|"value"/);
  assert.equal(learning.planningMemory(owner,'inventory',screen('/home','query')).ownerDrafts.length,1);
  now+=86400001;assert.equal(learning.planningMemory(visitor,'inventory delivery',screen('/home','query')).observations.length,0);
 }finally{repo.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep+'adoption-planning-'));await rm(root,{recursive:true,force:true});}
});

test('fresh HTTP session supplies persisted observations and published lessons to the actual LLM request contract',async()=>{
 const repo=openRepository(),authority=new SessionAuthority({repository:repo,development:true}),learning=createLearningRuntime(repo,createLearningStore(repo)),coaching=createCoachingGrants(repo),seen=[];
 const install=authority.registerApproved({embeddingId:owner.embeddingId,origins:[origin],expiresAt:Date.now()+3600000});
 learning.observe(owner,screen('/stock','inventory'));
 const draft=learning.create(owner,{title:'Inventory replenishment lesson',metadata:{purpose:'Manage inventory replenishment',use_when:'Inventory replenishment request',expected_outcome:'Reviewed inventory'},steps:[{action:'fill',path:'/stock',field:'inventory',parameter:'inventory'}]});learning.validate(owner,{id:draft.id,version:1});learning.publish(owner,{id:draft.id,version:1,reviewed:true});
 const planner=createPlatformPlanner({gatewayUrl:'https://synthetic.test/model',serviceToken:'synthetic-service-token-not-a-secret-0000',fetchImpl:async(_url,init)=>{const body=JSON.parse(init.body);seen.push(JSON.parse(body.messages.at(-1).content));return {ok:true,json:async()=>({content:JSON.stringify({message:'Review inventory guidance',actions:[]})})};}}),server=createAdoptionServer({authority,learning,coaching,planner,proposals:createProposalStore(repo)});server.listen(0,'127.0.0.1');await once(server,'listening');
 const post=async(path,input,token)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
 try{const a=await post('sessions',install),b=await post('sessions',install);await post('messages',{text:'PRIVATE_OTHER_SESSION_CANARY'},a.sessionToken);await post('plan',{text:'Help with inventory replenishment',snapshot:screen('/home','query')},b.sessionToken);assert.equal(seen.length,1);assert.equal(seen[0].siteGuidance.observations[0].path,'/stock');assert.equal(seen[0].recipeGuidance.matches[0].id,draft.id);assert.deepEqual(seen[0].siteGuidance.ownerDrafts,[]);assert.doesNotMatch(JSON.stringify(seen),/PRIVATE_OTHER_SESSION_CANARY/);assert.match(seen[0].instructions,/freshly observed refs/);
  const unpublished=learning.create(owner,{title:'Inventory counting draft',steps:[{action:'fill',path:'/stock',field:'inventory',parameter:'inventory'}]});
  await post('plan',{text:'Help with inventory counting',snapshot:screen('/home','query')},b.sessionToken);assert.equal(seen.at(-1).siteGuidance.ownerDrafts.length,0);
  await post('coaching/exchange',{code:coaching.issue(owner).code},b.sessionToken);await post('plan',{text:'Help with inventory counting',snapshot:screen('/home','query')},b.sessionToken);assert.equal(seen.at(-1).siteGuidance.ownerDrafts[0].id,unpublished.id);
 }finally{await new Promise(r=>server.close(r));repo.close();}
});

test('planner byte budget trims advisory memory without dropping current task, live refs or selected workflow',()=>{
 const task='任务'.repeat(1000),workflow={id:'selected',steps:[{action:'fill',field:'inventory',parameter:'inventory'}]},context={task,observed:{fields:[{ref:'r1f0',label:'Inventory',type:'text'}]},recipeGuidance:{matches:[workflow]},siteGuidance:{observations:Array(5).fill({fields:['保存'.repeat(1500)]}),ownerDrafts:[]}};
 const body={messages:[{role:'system',content:'Policy'},{role:'assistant',content:'old '.repeat(3000)},{role:'user',content:JSON.stringify(context)}]},encoded=encodePlannerRequest(body),actual=JSON.parse(JSON.parse(encoded).messages.at(-1).content);
 assert.ok(Buffer.byteLength(encoded)<=30000);assert.equal(actual.task,task);assert.equal(actual.observed.fields[0].ref,'r1f0');assert.deepEqual(actual.recipeGuidance.matches[0],workflow);assert.equal(actual.siteGuidance.omittedForRequestBudget,true);
 assert.throws(()=>encodePlannerRequest({messages:[{role:'system',content:'Policy'},{role:'user',content:JSON.stringify({task:'x'.repeat(40000)})}]}));
});
