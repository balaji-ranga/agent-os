import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createCoachingGrants} from '../src/coaching-grants.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createProposalStore} from '../src/proposals.mjs';
const owner={embeddingId:'learning-A',audienceId:'public',audienceIds:['public'],role:'maintainer',origin:'https://staging.example.com'};
const visitor={embeddingId:'learning-A',audienceIds:['public'],sessionId:'session-A',capabilities:{coach:false}},other={...visitor,embeddingId:'learning-B'};
const snapshot={revision:1,path:'/customer',fields:[{ref:'r1f0',key:'customer_name',label:'Customer name',type:'text'}],links:[]};

test('published interaction profiles bind visitor approvals and disappear immediately when disabled',()=>{
 const repository=openRepository();try{
  const learning=createLearningRuntime(repository,createLearningStore(repository)),proposals=createProposalStore(repository,{checkBinding:(scope,binding)=>learning.bindingAllowed(scope,binding)});
  const draft=learning.create(owner,{title:'Generic mouse-down navigation',steps:[{action:'navigate',path:'/target',activation:'mousedown'}]});assert.equal(learning.navigationProfile(visitor,'/target'),null);
  learning.observe(owner,{revision:1,path:'/target',fields:[],links:[]});learning.validate(owner,{id:draft.id,version:1});learning.publish(owner,{id:draft.id,version:1,reviewed:true});
  const binding=learning.navigationProfile(visitor,'/target');assert.equal(binding.activation,'mousedown');assert.equal(learning.navigationProfile(other,'/target'),null);
  const proposal=proposals.prepare(visitor,{revision:1,path:'/start',fields:[],links:[{ref:'r1n0',label:'Target',path:'/target'}]},{message:'Review navigation',actions:[{type:'navigate',ref:'r1n0'}]},binding);assert.equal(proposal.actions[0].activation,'mousedown');
  learning.disable(owner,{id:draft.id,version:2});assert.equal(learning.navigationProfile(visitor,'/target'),null);assert.throws(()=>proposals.consume(visitor,{id:proposal.id,revision:1,approved:true}));
 }finally{repository.close();}
});
test('coaching grants require owner issuance, exact origin/embedding, one use, expiry and session revocation',()=>{
 let now=1_000_000;const repository=openRepository();try{
  const authority=new SessionAuthority({repository,clock:()=>now}),grants=createCoachingGrants(repository,{clock:()=>now});
  const install=authority.registerApproved({embeddingId:owner.embeddingId,origins:[owner.origin],expiresAt:now+3_600_000}),session=authority.initialize({...install,origin:owner.origin}),auth={sessionToken:session.sessionToken,origin:owner.origin};
  assert.throws(()=>grants.issue(visitor));const first=grants.issue(owner);assert.throws(()=>grants.exchange(other,owner.origin,first.code));assert.throws(()=>grants.exchange(visitor,'https://evil.example.com',first.code));
  authority.grantCoaching(auth,grants.exchange(authority.context(auth),owner.origin,first.code));assert.equal(authority.context(auth).capabilities.coach,true);assert.throws(()=>grants.exchange(visitor,owner.origin,first.code));
  const next=grants.issue(owner);now+=4*60_000;auth.sessionToken=authority.renew(auth).sessionToken;now+=4*60_000;auth.sessionToken=authority.renew(auth).sessionToken;now+=2*60_000;
  assert.throws(()=>grants.exchange(visitor,owner.origin,next.code));assert.equal(authority.context(auth).capabilities.coach,false);authority.revokeInstallation(install.installationId);assert.throws(()=>authority.context(auth));
 }finally{repository.close();}
});
test('inspection and server validation precede publication; drift/version changes deny reviewed execution',()=>{
 const repository=openRepository();try{
  const store=createLearningStore(repository),learning=createLearningRuntime(repository,store),proposals=createProposalStore(repository,{checkBinding:(scope,binding)=>learning.bindingAllowed(scope,binding)});
  const draft=learning.create(owner,{title:'Customer draft',steps:[{action:'fill',path:'/customer',field:'customer_name',parameter:'company'}]});
  assert.equal(learning.list(visitor).length,0);assert.throws(()=>learning.publish(owner,{id:draft.id,version:1,reviewed:true}));
  assert.throws(()=>learning.observe(visitor,snapshot));learning.observe(owner,snapshot);assert.equal(learning.validate(owner,{id:draft.id,version:1}).compatible,true);
  const published=learning.publish(owner,{id:draft.id,version:1,reviewed:true});assert.equal(published.version,2);assert.equal(learning.list(visitor).length,1);assert.equal(learning.list(other).length,0);
  const review=learning.review(visitor,snapshot,{id:draft.id,version:2,parameters:{company:'Session A customer'}});assert.equal(review.response.actions[0].value,'Session A customer');
  const proposal=proposals.prepare(visitor,snapshot,review.response,review.binding);
  learning.repair(owner,{id:draft.id,version:2,steps:[{action:'fill',path:'/customer',field:'renamed_company',parameter:'company'}]});
  assert.throws(()=>proposals.consume(visitor,{id:proposal.id,revision:1,approved:true}));
  assert.equal(learning.validate(owner,{id:draft.id,version:3}).compatible,false);
  learning.observe(owner,{...snapshot,revision:2,fields:[{ref:'r2f0',key:'renamed_company',label:'Company',type:'text'}]});assert.equal(learning.validate(owner,{id:draft.id,version:3}).compatible,true);
  learning.observe(owner,{...snapshot,revision:3,fields:[]});assert.throws(()=>learning.publish(owner,{id:draft.id,version:3,reviewed:true}));
 }finally{repository.close();}
});
test('portable package imports stay draft, map routes without expanding origins, and replay uses distinct session parameters',()=>{
 const repository=openRepository();try{
  const learning=createLearningRuntime(repository,createLearningStore(repository)),target={...owner,embeddingId:'learning-B',origin:'https://production.example.com'};
  let draft=learning.create(owner,{title:'Portable customer',steps:[{action:'fill',path:'/customer',field:'customer_name',parameter:'company'}]});learning.observe(owner,snapshot);learning.validate(owner,{id:draft.id,version:1});draft=learning.publish(owner,{id:draft.id,version:1,reviewed:true});
  const pack=learning.export(owner,{id:draft.id});assert.doesNotMatch(JSON.stringify(pack),/Session A customer|sessionToken|installationToken/);
  const input={package:pack,operationId:'import-operation-176',routes:{'/customer':'/clients'}};
  const imported=learning.import(target,input);assert.equal(imported.id,learning.import(target,input).id);assert.equal(imported.status,'draft');assert.equal(imported.steps[0].path,'/clients');
  assert.throws(()=>learning.import(target,{...input,package:{...pack,sdk:99}}));assert.throws(()=>learning.import(target,{...input,routes:{'/customer':'https://evil.example.com'}}));assert.throws(()=>learning.import(target,{...input,package:{...pack,bundle:{...pack.bundle,title:'tampered'}}}));
  learning.observe(target,{...snapshot,path:'/clients'});learning.validate(target,{id:imported.id,version:1});const published=learning.publish(target,{id:imported.id,version:1,reviewed:true});
  for(const [sessionId,value] of [['one','Acme'],['two','BrightBox']]){const review=learning.review({...visitor,embeddingId:target.embeddingId,sessionId},{...snapshot,path:'/clients'},{id:imported.id,version:published.version,parameters:{company:value}});assert.equal(review.response.actions[0].value,value);}
 }finally{repository.close();}
});
