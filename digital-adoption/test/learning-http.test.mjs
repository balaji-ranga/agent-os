import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createCoachingGrants} from '../src/coaching-grants.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {createAdoptionServer} from '../src/server.mjs';
const origin='https://staging.example.com';
const snapshot={revision:1,path:'/customer',fields:[{ref:'r1f0',key:'customer_name',label:'Customer name',type:'text'}],links:[]};
test('HTTP coaching/publication/recipe approvals preserve role, session, version and guide-mode boundaries',async()=>{
 const repository=openRepository(),authority=new SessionAuthority({repository});
 const learning=createLearningRuntime(repository,createLearningStore(repository)),coaching=createCoachingGrants(repository),proposals=createProposalStore(repository,{checkBinding:(scope,binding)=>learning.bindingAllowed(scope,binding)});
 const installation=authority.registerApproved({embeddingId:'http-learning',origins:[origin],expiresAt:Date.now()+3_600_000}),a=authority.initialize({...installation,origin}),b=authority.initialize({...installation,origin});
 const owner={embeddingId:'http-learning',audienceIds:['public'],audienceId:'public',origin,role:'maintainer'};
 const server=createAdoptionServer({authority,learning,coaching,proposals,planner:async()=>({message:'Fill draft',actions:[{type:'fill',ref:'r1f0',value:'Synthetic value'}]})});server.listen(0,'127.0.0.1');await once(server,'listening');
 const post=async(path,input,session=a,expected=200)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${session.sessionToken}`},body:JSON.stringify(input)});assert.equal(response.status,expected,path);return response.json();};
 try{
  await post('/v1/learning/observe',{snapshot,role:'maintainer'},b,403);
  const code=coaching.issue(owner);await post('/v1/coaching/exchange',{code:code.code},a);await post('/v1/coaching/exchange',{code:code.code},b,403);
  await post('/v1/learning/observe',{snapshot},a);
  const draft=learning.create(owner,{title:'Customer draft',steps:[{action:'fill',path:'/customer',field:'customer_name',parameter:'company'}]});
  assert.equal((await post('/v1/recipes',{},b)).recipes.length,0);assert.equal((await post('/v1/recipes',{},a)).recipes.length,1);
  learning.validate(owner,{id:draft.id,version:1});learning.publish(owner,{id:draft.id,version:1,reviewed:true});
  const reviewA=await post('/v1/recipe/plan',{id:draft.id,version:2,parameters:{company:'A company'},step:0,snapshot},a);
  const reviewB=await post('/v1/recipe/plan',{id:draft.id,version:2,parameters:{company:'B company'},step:0,snapshot},b);
  assert.equal(reviewA.actions[0].value,'A company');assert.equal(reviewB.actions[0].value,'B company');
  await post('/v1/approve',{id:reviewA.id,revision:1,approved:true},b,403);
  learning.repair(owner,{id:draft.id,version:2,steps:[{action:'fill',path:'/customer',field:'customer_name',parameter:'new_company'}]});
  await post('/v1/approve',{id:reviewA.id,revision:1,approved:true},a,403);
  const guide=await post('/v1/plan',{text:'Guide the customer field',snapshot,mode:'guide'},b);assert.equal(guide.actions[0].type,'highlight');assert.match(guide.message,/Guide only is active/);assert.match(guide.message,/Prepare changes/);assert.equal(Object.hasOwn(guide.actions[0],'value'),false);
  const approved=await post('/v1/approve',{id:guide.id,revision:1,approved:true},b);assert.ok(approved.actions.every(action=>action.type==='highlight'));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repository.close();}
});
