import {once} from 'node:events';
import {createAdoptionServer} from '../src/server.mjs';
import {constrainEdit,explicitEditProposal} from '../src/edit-intent.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRepository} from '../src/repository.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {createActionAttempts} from '../src/action-attempts.mjs';
import {createTaskController,outcomeOf,outcomeMeets} from '../web/task-controller.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {reviewContext,deterministicReview} from '../integrations/checker-contract.mjs';
import {requestedField,newlyAvailableFields} from '../web/dependent-controls.mjs';

const scope={embeddingId:'alpha',sessionId:'one'},snapshot={revision:1,path:'/customer',fields:[{ref:'r1f0',key:'company',form:'customer',type:'text',label:'Company'},{ref:'r1f1',key:'region',form:'customer',type:'select-one',label:'Region',choices:['North','South']}]};
const response={message:'Review',actions:[{type:'fill',ref:'r1f0',value:'Synthetic'}]};
test('review edits require matching fresh structure; replacement fences original approval and foreign sessions',()=>{
 const repo=openRepository();try{const store=createProposalStore(repo),p=store.prepare(scope,snapshot,response),fresh={...snapshot,revision:2,fields:snapshot.fields.map((f,i)=>({...f,ref:`r2f${i}`}))};
  assert.throws(()=>store.revise({...scope,sessionId:'other'},{id:p.id,snapshot:fresh,edits:[{ref:'r1f0',value:'Edited'}]}));
  assert.throws(()=>store.revise(scope,{id:p.id,snapshot:{...fresh,path:'/other'},edits:[{ref:'r1f0',value:'Edited'}]}));
  const revised=store.revise(scope,{id:p.id,snapshot:fresh,edits:[{ref:'r1f0',value:'Edited'}]});assert.equal(revised.actions[0].value,'Edited');assert.equal(revised.actions[0].ref,'r2f0');
  assert.throws(()=>store.consume(scope,{id:p.id,revision:1,approved:true}));assert.equal(store.consume(scope,{id:revised.id,revision:2,approved:true}).actions[0].value,'Edited');
 }finally{repo.close();}
});
test('edited choices cannot invent options or replace actions with unreviewed fields',()=>{
 const repo=openRepository();try{const store=createProposalStore(repo),p=store.prepare(scope,snapshot,{message:'Review',actions:[{type:'fill',ref:'r1f1',value:'North'}]});for(const edits of [[{ref:'r1f1',value:'Invented'}],[{ref:'r1f0',value:'North'}],[{ref:'r1f1',value:'North'},{ref:'r1f1',value:'South'}]])assert.throws(()=>store.revise(scope,{id:p.id,snapshot,edits}));assert.equal(store.consume(scope,{id:p.id,revision:1,approved:true}).actions[0].value,'North');}finally{repo.close();}
});
test('dispatch tombstone survives real database reopen, rejects stale scope and never persists values',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'adoption-attempt-')),path=join(dir,'state.db');let repo=openRepository(path);try{let ledger=createActionAttempts(repo),grant=ledger.reserve(scope,{id:'opaque-action',proposalId:'opaque-review',index:0,grantExpiresAt:Date.now()+30_000});assert.throws(()=>ledger.dispatch({...scope,embeddingId:'other'},grant));ledger.dispatch(scope,grant);repo.close();repo=openRepository(path);ledger=createActionAttempts(repo);assert.throws(()=>ledger.dispatch(scope,grant));assert.equal(ledger.status(scope,grant.actionId).state,'dispatch_started');assert.doesNotMatch(JSON.stringify(repo.map('action_attempts').values()),/Synthetic|fieldValue|prompt|passage/);}finally{repo.close();await rm(dir,{recursive:true,force:true});}
});
test('expired grants cannot be renewed through missing or expired tombstones',()=>{
 let now=1000;const repo=openRepository();try{const ledger=createActionAttempts(repo,{clock:()=>now,retentionMs:600_000}),grant=ledger.reserve(scope,{id:'action',proposalId:'p',index:0,grantExpiresAt:1500});now=1501;assert.throws(()=>ledger.dispatch(scope,grant));now=602000;assert.equal(ledger.expire(),1);assert.throws(()=>ledger.dispatch(scope,grant));}finally{repo.close();}
});
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};};
test('shared controller rejects duplicate local dispatch and classifies host success honestly',async()=>{
 let clicks=0;const stages=[],storage=memory(),controller=createTaskController({storage,request:async()=>({allowed:true}),inspector:{submit:async()=>{clicks++;return {dispatched:true,hostReported:'success',businessVerified:false};}},onState:s=>stages.push(s.stage)}),proposal={revision:1,actions:[{type:'submit',ref:'r1s0',actionId:'a',fence:'f',grantExpiresAt:100}]};
 const result=await controller.execute(proposal);assert.equal(result.outcome,'host_reported_saved');assert.equal(result.saved,false);await assert.rejects(controller.execute(proposal));assert.equal(clicks,1);assert.ok(stages.includes('verifying'));assert.equal(outcomeMeets(result.outcome,'business_verified'),false);
});
test('lost Save acknowledgement never retries and cannot satisfy a stronger outcome',async()=>{
 let clicks=0;const c=createTaskController({inspector:{submit:async()=>{clicks++;return {dispatched:true,reason:'No host result'};}}});await assert.rejects(c.execute({revision:1,actions:[{type:'submit',ref:'r1s0'}]}),e=>e.outcome==='unknown');assert.equal(clicks,1);assert.equal(outcomeOf({businessVerified:false,hostReported:'success'}),'host_reported_saved');
});
test('Stop interrupts remaining effects; stale field failure preserves earlier applied observations',async()=>{
 let calls=0;const c=createTaskController({inspector:{fill:async()=>{calls++;if(calls===2)throw new Error('Options changed; inspect again');return {valueObserved:true};}}});await assert.rejects(c.execute({revision:1,actions:[{type:'fill',ref:'r1f0'},{type:'fill',ref:'r1f1'}]}),e=>e.outcome==='rejected'&&e.results.length===1);assert.equal(calls,2);
 let release;const d=createTaskController({inspector:{fill:()=>new Promise(r=>release=r)}});const run=d.execute({revision:1,actions:[{type:'fill'},{type:'fill'}]});await new Promise(r=>setImmediate(r));await assert.rejects(d.execute({actions:[]}),/already running/);d.stop();release({valueObserved:true});await assert.rejects(run,/stopped/);
});
test('owner setup separates issuance from observed installation and fences DNS renewal races',async()=>{
 const repo=openRepository();let release;const authority=new SessionAuthority({repository:repo}),owner={id:'owner',organizationId:'org',role:'owner'},admin={id:'admin',organizationId:'platform',role:'platform_admin'};const control=createControlPlane(repo,authority,{dns:()=>new Promise(r=>release=r)});
 try{const registration=control.register(owner,{origin:'https://synthetic.example',environment:'staging'}),state=control.readiness(owner,registration.id);assert.equal(state.recentlyConnected,false);const check=control.verify(owner,registration.id);const next=control.renewChallenge(owner,registration.id,{expectedExpiry:state.challengeExpiry,expectedRevision:state.challengeRevision});release([[registration.dnsValue]]);await assert.rejects(check);assert.notEqual(next.dnsValue,registration.dnsValue);assert.throws(()=>control.approve(owner,registration.id));assert.throws(()=>control.readiness({...owner,organizationId:'foreign'},registration.id));assert.throws(()=>control.approve(admin,registration.id));}finally{repo.close();}
});

test('task-tested readiness needs consumed, observed effects and invalidates on map, policy and recipe changes',()=>{
 const repo=openRepository();try{
  const coach={...scope,audienceId:'public',audienceIds:['public'],role:'maintainer',capabilities:{coach:true},websiteRevision:0};
  const learning=createLearningRuntime(repo,createLearningStore(repo)),proposals=createProposalStore(repo,{checkBinding:(s,b)=>learning.bindingAllowed(s,b)});
  const recipe=learning.create(coach,{title:'Synthetic customer task',steps:[{action:'fill',path:'/customer',field:'company',parameter:'company'}]});learning.observe(coach,snapshot);
  assert.equal(learning.validate(coach,{id:recipe.id,version:1}).taskTested,false);
  const run=learning.startTest(coach,{id:recipe.id,version:1}),review=learning.testReview(coach,snapshot,{id:recipe.id,version:1,step:0,parameters:{company:'Synthetic'},testRunId:run.testRunId});
  const p=proposals.prepare(coach,snapshot,review.response,review.binding);
  assert.throws(()=>proposals.testEvidence(coach,p.id));
  const grant=proposals.consume(coach,{id:p.id,revision:1,approved:true});assert.throws(()=>proposals.testEvidence(coach,p.id));
  proposals.dispatch(coach,grant.actions[0]);proposals.observeAttempt(coach,{...grant.actions[0],outcome:'local_state_verified'});
  learning.observeTest(coach,{proposalId:p.id,evidence:proposals.testEvidence(coach,p.id)});
  learning.finishTest(coach,{id:recipe.id,testRunId:run.testRunId,snapshot});
  assert.equal(learning.taskTestStatus(coach,{id:recipe.id,version:1}).tested,true);
  const published=learning.publish(coach,{id:recipe.id,version:1,reviewed:true});assert.equal(learning.taskTestStatus(coach,{id:recipe.id,version:published.version}).tested,true);
  assert.equal(learning.taskTestStatus({...coach,websiteRevision:1},{id:recipe.id,version:published.version}).tested,false);
  learning.observe(coach,{...snapshot,fields:[...snapshot.fields,{ref:'r1f2',key:'new_field',type:'text',label:'New field'}]});
  assert.equal(learning.taskTestStatus(coach,{id:recipe.id,version:published.version}).tested,false);
 }finally{repo.close();}
});

test('explicit preserve constraints remove that field without becoming a literal assignment',()=>{
 const observed={revision:1,fields:[{ref:'r1f0',label:'Company name',type:'text'},{ref:'r1f1',label:'Contact email',type:'email'}]};const text='Set Contact email to synthetic@example.test and leave Company name unchanged';const selected=constrainEdit(text,observed);assert.deepEqual(selected.fields.map(f=>f.label),['Contact email']);assert.equal(explicitEditProposal(text,selected),null);
});

test('checker deterministic guards separate mixed control instructions and preserve-current clauses',()=>{
 const observed={revision:1,fields:[{ref:'r1f0',label:'Shipping method',type:'select-one',choices:['Express','Standard']},{ref:'r1f1',label:'Include gift wrap',type:'checkbox'},{ref:'r1f2',label:'Contact email',type:'email'}]};
 const check=(task,actions)=>deterministicReview(reviewContext([{role:'user',content:JSON.stringify({task,observed})}],'digital_adoption_plan',{message:'Review',actions}));
 assert.equal(check('Set Shipping method to Express and select Include gift wrap. Do not save.',[{type:'fill',ref:'r1f0',value:'Express'},{type:'fill',ref:'r1f1',value:'true'}]),null);
 assert.equal(check('Set Contact email to synthetic@example.test and leave Company name unchanged.',[{type:'fill',ref:'r1f2',value:'synthetic@example.test'}]),null);
 assert.match(check('Set Shipping method to Teleport.',[{type:'fill',ref:'r1f0',value:'Express'}]),/does not match/);
});

test('dependency matching distinguishes short labels from longer observed field names',()=>{
 const labels=['Contact','Contact email','Region','Subregion'];
 assert.equal(requestedField('Set Contact email to synthetic@example.test','Contact',labels),false);
 assert.equal(requestedField('Set Contact email to synthetic@example.test, then select Contact Primary','Contact',labels),true);
 assert.equal(requestedField('Set Subregion to Central','Region',labels),false);
 const before={fields:[{key:'email',label:'Contact email',type:'email'}]},after={fields:[...before.fields,{key:'contact',label:'Contact',type:'select-one'}]};
 assert.deepEqual(newlyAvailableFields(before,after,'Set Contact email to synthetic@example.test'),[]);
 assert.equal(newlyAvailableFields(before,after,'Set Contact email to synthetic@example.test and Contact to Primary').length,1);
 const choice={key:'shipping',label:'Shipping method',type:'select-one',choices:['Choose','Standard','Express']};
 assert.deepEqual(newlyAvailableFields({fields:[choice]},{fields:[{...choice,choices:['Standard','Choose','Express']}]},'Set Shipping method to Standard'),[]);
 assert.equal(newlyAvailableFields({fields:[choice]},{fields:[{...choice,choices:['Standard','Express','Overnight']}]},'Set Shipping method to Overnight').length,1);
});
test('aborting a model read cancels downstream planning and releases its real HTTP capacity slot',async()=>{
 const repo=openRepository(),authority=new SessionAuthority({repository:repo}),origin='https://synthetic.test';const installation=authority.registerApproved({embeddingId:'abort-test',origins:[origin],expiresAt:Date.now()+60000});let entered,aborted,calls=0;const began=new Promise(r=>entered=r),ended=new Promise(r=>aborted=r);
 const server=createAdoptionServer({authority,proposals:createProposalStore(repo),capacity:{modelConcurrency:1,modelPerDomain:1},planner:async({signal})=>{if(++calls>1)return {message:'Ready',actions:[]};entered();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(new Error('cancelled'));},{once:true}));}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,session=authority.initialize({...installation,origin}),headers={Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+session.sessionToken},body=JSON.stringify({text:'Set Company to Synthetic',snapshot});
 try{const controller=new AbortController(),pending=fetch(base+'/v1/plan',{method:'POST',headers,body,signal:controller.signal}).catch(e=>e);await began;controller.abort();await pending;await Promise.race([ended,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Downstream abort missing')),1000))]);const next=await fetch(base+'/v1/plan',{method:'POST',headers,body});assert.equal(next.status,200);assert.equal(repo.map('proposals').values().filter(p=>p.actions.length).length,0);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));repo.close();}
});

test('review retains useful interpretation but suppresses unverified completion claims',()=>{const repo=openRepository();try{const store=createProposalStore(repo),good=store.prepare(scope,snapshot,{...response,message:'I interpreted the requested option using the unique observed label.'}),bad=store.prepare(scope,snapshot,{...response,message:'I saved your record successfully.'});assert.match(good.message,/interpreted/);assert.match(good.message,/Nothing has been changed/);assert.doesNotMatch(bad.message,/saved your record/);}finally{repo.close();}});
