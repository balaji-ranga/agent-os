import {openRepository} from '../src/repository.mjs';
import {createActionAttempts} from '../src/action-attempts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPrivateTasks} from '../src/private-tasks.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {WebSocket} from 'ws';
import {once} from 'node:events';
const snapshot={revision:1,path:'/customer',fields:[{ref:'r1f0',label:'Company name',type:'text'}],submissions:[{ref:'r1s0',label:'Save'}]};
async function fixture(t,options={}){
 const root=await mkdtemp(join(tmpdir(),'adoption-private-test-'));let now=Date.now();const sites=new Map(),revoked=new Set();
 const planner=options.planner||(async({privateGuidance})=>({message:'Review',actions:privateGuidance.evidence.length?[{type:'fill',ref:'r1f0',value:'Synthetic Orchid'}]:[]}));
 const tasks=await createPrivateTasks({root,website:id=>sites.get(id),activeScope:s=>!revoked.has(s.sessionId),planner,clock:()=>now,authorizeEffect:options.authorizeEffect||(async()=>true),...options});
 t.after(async()=>{await tasks.close();await rm(root,{recursive:true,force:true});});
 const add=(name,owner='owner')=>{sites.set(name,{id:name,origin:`https://${name}.test`,environment:'staging',verified:true,status:'approved',organizationId:owner,taskPolicy:{attachments:true,pairing:true,workflow:true,actionBindings:[{id:'save',path:'/customer',label:'Save',family:'write_internal'}]}});const scope={sessionId:crypto.randomUUID(),embeddingId:name,origin:`https://${name}.test`,conversationVersion:0};const ticket=tasks.ticket(scope,{}),messages=[];tasks.connect(ticket.ticket,scope.origin,m=>messages.push(m));return {scope,instanceId:ticket.instanceId,resumeProof:ticket.resumeProof,messages};};
 const pair=(a,b)=>{const invite=tasks.invite(a.scope,a);tasks.join(b.scope,{...b,code:invite.code});const pending=tasks.pairStatus(a.scope,a).pending[0];tasks.confirm(a.scope,{...a,invitationId:pending.invitationId});const out=tasks.confirm(b.scope,{...b,invitationId:pending.invitationId});return out.groupId;};
 const link=(a,user='user')=>tasks.linkUser(user,tasks.linkRequest(a.scope,a));
 const upload=async(a,text='Company name: Synthetic Orchid. Contact email: orchid@example.test.')=>{const task=tasks.start(a.scope,a);const file=await tasks.upload(a.scope,{...a,taskId:task.taskId,filename:'onboarding.txt',mime:'text/plain',content:Buffer.from(text).toString('base64'),operationId:crypto.randomUUID()});return {...task,file};};
 return {tasks,root,sites,revoked,add,pair,link,upload,advance:ms=>now+=ms};
}
test('workflow navigation refuses links requiring visitor confirmation, retaining approved-route behavior',async t=>{
 for(const readOnlyApproved of [false,true]){const f=await fixture(t,{planner:async()=>({message:'Review the destination',actions:[{type:'navigate',ref:'r1n0'}]})}),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);const input={groupId,websiteIds:['alpha'],action:'navigate',instruction:'Open the archive',operationId:'navigation-boundary-'+readOnlyApproved},command=f.tasks.dispatch('user',input,f.tasks.preflight('user',input));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:command.commandId});const pending=f.tasks.commandPlan(a.scope,{...a,commandId:command.commandId,snapshot:{...snapshot,links:[{ref:'r1n0',path:'/archive',label:'Archive',readOnlyApproved}]}});if(readOnlyApproved)assert.equal((await pending).actions[0].readOnlyApproved,true);else await assert.rejects(pending,/EFFECT_MISMATCH/);}
});
test('TX01/TX02: private ciphertext, extraction provenance, fresh review and single-use approval',async t=>{const f=await fixture(t),a=f.add('alpha'),task=await f.upload(a);const ciphertext=await readFile(join(f.root,task.file.id+'.enc'));assert.equal(ciphertext.includes(Buffer.from('Synthetic Orchid')),false);const claim=f.tasks.claim('worker');assert.equal(claim.private,true);const input=await f.tasks.input(claim);assert.match(Buffer.from(input.content,'base64').toString(),/Synthetic Orchid/);f.tasks.complete(claim,{sections:[{locator:'Document',text:Buffer.from(input.content,'base64').toString()}]});const proposal=await f.tasks.plan(a.scope,{...a,taskId:task.taskId,text:'Prepare company name from the file',snapshot});assert.equal(proposal.actions[0].value,'Synthetic Orchid');assert.equal(proposal.evidence[0].locator,'Document');const approve={...a,taskId:task.taskId,id:proposal.id,revision:1,approved:true};assert.equal(f.tasks.approve(a.scope,approve).actions.length,1);assert.throws(()=>f.tasks.approve(a.scope,approve));});
test('TX03: unsupported current fields and invented values cannot become executable reviews',async t=>{const f=await fixture(t,{planner:async()=>({message:'Invented',actions:[{type:'fill',ref:'r1f0',value:'Not in any evidence'}]})}),a=f.add('alpha'),task=await f.upload(a);f.tasks.complete(f.tasks.claim('w'),{sections:[{text:'Company name: Synthetic Orchid',locator:'Document'}]});const out=await f.tasks.plan(a.scope,{...a,taskId:task.taskId,text:'Prepare company',snapshot});assert.deepEqual(out.actions,[]);});
test('TX04: visitor attachment capability is separate; spoofed, unsupported, binary and oversized content is rejected',async t=>{const f=await fixture(t,{limits:{fileBytes:1024}}),a=f.add('alpha'),task=f.tasks.start(a.scope,a),input={...a,taskId:task.taskId,operationId:crypto.randomUUID(),filename:'x.txt',mime:'text/plain',content:Buffer.from('x').toString('base64')};for(const change of [{filename:'x.html',mime:'text/html'},{filename:'x.pdf',mime:'application/pdf'},{content:Buffer.alloc(2048).toString('base64')},{content:Buffer.from([255,0,255]).toString('base64')}])await assert.rejects(f.tasks.upload(a.scope,{...input,...change}));f.sites.get('alpha').taskPolicy.attachments=false;await assert.rejects(f.tasks.upload(a.scope,input),/CAPABILITY_DISABLED/);});
test('PAIR01/PAIR02: bilateral confirmation, exact instance auth, owner isolation, one use and expiry',async t=>{const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),foreign=f.add('foreign','other');const inv=f.tasks.invite(a.scope,a);assert.throws(()=>f.tasks.join(foreign.scope,{...foreign,code:inv.code}));f.tasks.join(b.scope,{...b,code:inv.code});assert.equal(f.tasks.pairStatus(a.scope,a).groupId,undefined);const pending=f.tasks.pairStatus(a.scope,a).pending[0];f.tasks.confirm(a.scope,{...a,invitationId:pending.invitationId});assert.equal(f.tasks.pairStatus(a.scope,a).groupId,undefined);const paired=f.tasks.confirm(b.scope,{...b,invitationId:pending.invitationId});assert.ok(paired.groupId);assert.throws(()=>f.tasks.join(b.scope,{...b,code:inv.code}));assert.throws(()=>f.tasks.pairStatus(a.scope,b));const exp=f.tasks.invite(a.scope,a);f.advance(120001);assert.throws(()=>f.tasks.join(b.scope,{...b,code:exp.code}));});
test('RELAY01: handoff requires consent and group; unrelated visitor cannot retrieve task context',async t=>{const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),c=f.add('gamma');f.pair(a,b);const task=await f.upload(a);assert.throws(()=>f.tasks.relay(a.scope,{...a,taskId:task.taskId,targetId:b.instanceId}));f.tasks.relay(a.scope,{...a,taskId:task.taskId,targetId:b.instanceId,shareConsent:true,instruction:'Prepare search'});assert.equal(f.tasks.status(b.scope,{...b,taskId:task.taskId}).taskId,task.taskId);assert.throws(()=>f.tasks.status(c.scope,{...c,taskId:task.taskId}));assert.equal(b.messages.at(-1).type,'task-shared');});
test('WF01/WF02: user link conflict and captured fanout exclude other groups and arrivals',async t=>{const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),c=f.add('gamma'),groupId=f.pair(a,b);f.link(a);assert.throws(()=>f.link(b,'other'));assert.deepEqual(f.tasks.discover('other').groups,[]);const input={groupId,websiteIds:['alpha','beta'],action:'inspect',instruction:'Inspect',operationId:'run:node:1'};const pre=f.tasks.preflight('user',input);const cmd=f.tasks.dispatch('user',input,pre);assert.equal(cmd.recipients.length,2);assert.equal(c.messages.length,0);const d=f.add('delta');assert.equal(d.messages.length,0);assert.throws(()=>f.tasks.preflight('user',{...input,websiteIds:['alpha','missing']}));assert.throws(()=>f.tasks.preflight('other',input));});
test('WF04: idempotent dispatch, disconnect failure, no replacement and explicit unknown outcome',async t=>{const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);const input={groupId,websiteIds:['alpha','beta'],action:'inspect',instruction:'Inspect',operationId:'run:node'};const pre=f.tasks.preflight('user',input),cmd=f.tasks.dispatch('user',input,pre);assert.equal(f.tasks.dispatch('user',input,pre).commandId,cmd.commandId);assert.equal(a.messages.filter(m=>m.type==='command').length,1);f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:cmd.commandId});f.tasks.commandFrame(a.instanceId,{type:'result',commandId:cmd.commandId,ok:true,result:{observed:true}});f.tasks.commandFrame(b.instanceId,{type:'ack',commandId:cmd.commandId});f.tasks.disconnect(b.instanceId);const status=f.tasks.commandStatus('user',cmd.commandId);assert.equal(status.status,'failed');assert.equal(status.recipients[1].code,'OUTCOME_UNKNOWN');assert.equal(status.recipients[0].status,'succeeded');});
test('WF03: every host effect rechecks policy and a proposal cannot be replayed',async t=>{let allowed=true;const f=await fixture(t,{authorizeEffect:async()=>allowed}),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);const task=await f.upload(a);f.tasks.complete(f.tasks.claim('w'),{sections:[{text:'Company name: Synthetic Orchid',locator:'Document'}]});const input={groupId,websiteIds:['alpha'],taskId:task.taskId,action:'fill',instruction:'Prepare company from file',operationId:'fill:one'},cmd=f.tasks.dispatch('user',input,f.tasks.preflight('user',input));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:cmd.commandId});const p=await f.tasks.commandPlan(a.scope,{...a,commandId:cmd.commandId,snapshot});const effect={...a,commandId:cmd.commandId,proposalId:p.id,revision:1,effectIndex:0};allowed=false;await assert.rejects(f.tasks.effect(a.scope,effect),/POLICY_REVOKED/);allowed=true;assert.equal((await f.tasks.effect(a.scope,effect)).actions.length,1);await assert.rejects(f.tasks.effect(a.scope,effect),/EFFECT_ALREADY_USED/);});
test('PRIV01: end, expiry, restart, stale extraction and ciphertext cleanup cannot revive content',async t=>{const f=await fixture(t),a=f.add('alpha'),task=await f.upload(a),claim=f.tasks.claim('w');f.tasks.end(a.scope,{...a,taskId:task.taskId});assert.throws(()=>f.tasks.complete(claim,{sections:[{text:'late',locator:'Document'}]}));assert.throws(()=>f.tasks.status(a.scope,{...a,taskId:task.taskId}));await f.tasks.cleanup();assert.deepEqual(await readdir(f.root),[]);f.advance(5000);const second=await f.upload(a);const restarted=await createPrivateTasks({root:f.root,website:id=>f.sites.get(id),activeScope:()=>true,planner:async()=>{}});assert.deepEqual(await readdir(f.root),[]);assert.equal(restarted.metrics().tasks,0);await restarted.close();f.advance(3600001);f.tasks.maintain();assert.throws(()=>f.tasks.status(a.scope,{...a,taskId:second.taskId}));});
test('silent loss is bounded; revoked installations stop live task access',async t=>{const f=await fixture(t),a=f.add('alpha'),task=await f.upload(a);f.revoked.add(a.scope.sessionId);f.tasks.maintain();assert.equal(f.tasks.metrics().tasks,0);assert.throws(()=>f.tasks.status(a.scope,{...a,taskId:task.taskId}));});
test('authenticated WS tickets are one-use, Origin bound and absent from URLs',async t=>{const root=await mkdtemp(join(tmpdir(),'adoption-ws-test-')),authority=new SessionAuthority(),origin='https://alpha.test',registration=authority.registerApproved({embeddingId:'alpha',origins:[origin],expiresAt:Date.now()+600000}),session=authority.initialize({...registration,origin}),scope=authority.context({sessionToken:session.sessionToken,origin}),tasks=await createPrivateTasks({root,website:()=>({origin,organizationId:'owner',verified:true,status:'approved',taskPolicy:{attachments:true,pairing:true}}),activeScope:s=>authority.activeScope(s),planner:async()=>{}}),server=createAdoptionServer({authority,privateTasks:tasks});server.listen(0,'127.0.0.1');await once(server,'listening');const ticket=tasks.ticket(scope,{}),url=`ws://127.0.0.1:${server.address().port}/v1/live`,ws=new WebSocket(url,{origin});await once(ws,'open');ws.send(JSON.stringify({type:'authenticate',ticket:ticket.ticket}));const [data]=await once(ws,'message');assert.equal(JSON.parse(data).type,'connected');assert.equal(tasks.metrics().connections,1);ws.close();await once(ws,'close');assert.throws(()=>tasks.connect(ticket.ticket,origin,()=>{}));server.closeAllConnections();await new Promise(r=>server.close(r));await tasks.close();await rm(root,{recursive:true,force:true});});

test('private Guide mode highlights only; unsupported controls cannot gain executable refs',async t=>{const f=await fixture(t),a=f.add('alpha'),task=await f.upload(a);f.tasks.complete(f.tasks.claim('w'),{sections:[{locator:'Document',text:'Company name: Synthetic Orchid'}]});const proposal=await f.tasks.plan(a.scope,{...a,taskId:task.taskId,text:'Prepare Company name',snapshot,mode:'guide'});assert.equal(proposal.actions[0].type,'highlight');assert.equal(Object.hasOwn(proposal.actions[0],'value'),false);});
test('submission binding changes invalidate an already authorized command before its effect',async t=>{const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);const input={groupId,websiteIds:['alpha'],action:'submit',inputs:{bindingId:'save'},operationId:'bound-submit'},pre=f.tasks.preflight('user',input);assert.equal(pre.effectFamily,'write_internal');const command=f.tasks.dispatch('user',input,pre);f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:command.commandId});const proposal=await f.tasks.commandPlan(a.scope,{...a,commandId:command.commandId,snapshot});f.sites.get('alpha').taskPolicy.actionBindings[0].family='financial_destructive';await assert.rejects(f.tasks.effect(a.scope,{...a,commandId:command.commandId,proposalId:proposal.id,revision:1,effectIndex:0}),/POLICY_REVOKED/);});
test('known completion without an authorized effect cannot become workflow success',async t=>{const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);const input={groupId,websiteIds:['alpha'],action:'fill',instruction:'Company name: Synthetic Orchid',operationId:'false-success'},command=f.tasks.dispatch('user',input,f.tasks.preflight('user',input));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:command.commandId});f.tasks.commandFrame(a.instanceId,{type:'result',commandId:command.commandId,ok:true,result:{saved:true}});assert.equal(f.tasks.commandStatus('user',command.commandId).status,'failed');});

test('workflow status excludes private effect bookkeeping before and after task cleanup',async t=>{
 const value='PRIVATE_FILL_BOOKKEEPING_CANARY',f=await fixture(t,{planner:async()=>({message:'Review',actions:[{type:'fill',ref:'r1f0',value}]})}),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);
 const input={groupId,websiteIds:['alpha'],action:'fill',instruction:'Set Company name to '+value,operationId:'private-status-contract'},command=f.tasks.dispatch('user',input,f.tasks.preflight('user',input));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:command.commandId});const proposal=await f.tasks.commandPlan(a.scope,{...a,commandId:command.commandId,snapshot});await f.tasks.effect(a.scope,{...a,commandId:command.commandId,proposalId:proposal.id,revision:1,effectIndex:0});
 const safe=()=>{const status=f.tasks.commandStatus('user',command.commandId);assert.equal(JSON.stringify(status).includes(value),false);for(const key of Object.keys(status.recipients[0]))assert.ok(['instanceId','websiteId','connectionId','status','code','startedAt','inspection','resultHandle','stage','stageAt','outcome','savedVerified','appliedFieldCount'].includes(key),key);return status;};safe();f.tasks.commandFrame(a.instanceId,{type:'result',commandId:command.commandId,ok:true,result:{privateValue:value}});assert.ok(safe().recipients[0].resultHandle);f.tasks.end(a.scope,{...a,taskId:command.taskId});safe();
});
test('a shared recipient gets selected passages, no unrelated private history or delete authority',async t=>{const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);const task=await f.upload(a);f.tasks.complete(f.tasks.claim('w'),{sections:[{text:'Company name: Synthetic Orchid',locator:'Document'}]});f.tasks.relay(a.scope,{...a,taskId:task.taskId,targetId:b.instanceId,shareConsent:true,instruction:'Prepare company'});assert.equal(f.tasks.status(a.scope,{...a,taskId:task.taskId}).files[0].canRemove,true);assert.equal(f.tasks.status(b.scope,{...b,taskId:task.taskId}).files[0].canRemove,false);await assert.rejects(Promise.resolve().then(()=>f.tasks.remove(b.scope,{...b,taskId:task.taskId,attachmentId:task.file.id})));assert.equal((await f.tasks.summary(b.scope,{...b,taskId:task.taskId})).evidence.length,1);f.tasks.remove(a.scope,{...a,taskId:task.taskId,attachmentId:task.file.id});assert.equal((await f.tasks.summary(b.scope,{...b,taskId:task.taskId})).evidence.length,0);});

test('one failed recipient immediately fails required-all fanout and prevents remaining plans',async t=>{const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);const input={groupId,websiteIds:['alpha','beta'],action:'inspect',operationId:'fail-fast'},cmd=f.tasks.dispatch('user',input,f.tasks.preflight('user',input));f.tasks.disconnect(b.instanceId);assert.equal(f.tasks.commandStatus('user',cmd.commandId).status,'failed');f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:cmd.commandId});await assert.rejects(f.tasks.commandPlan(a.scope,{...a,commandId:cmd.commandId,snapshot}),/COMMAND_ENDED/);});
test('commands fail busy rather than overwrite an in-flight operation; an existing private task needs explicit joining',async t=>{const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);const task=await f.upload(a),input={groupId,websiteIds:['alpha'],action:'inspect',operationId:'one'};assert.throws(()=>f.tasks.dispatch('user',input,f.tasks.preflight('user',input)),/TASK_SHARING_REQUIRED/);const selected={...input,taskId:task.taskId},cmd=f.tasks.dispatch('user',selected,f.tasks.preflight('user',selected));assert.throws(()=>f.tasks.preflight('user',{...selected,operationId:'other'}),/RECIPIENT_BUSY/);assert.equal(f.tasks.dispatch('user',selected,f.tasks.preflight('user',selected)).commandId,cmd.commandId);});

test('F08/F18: saved group and workflow binding survive endpoint loss and service restart without private task recovery',async t=>{
 const pairingState=new Map(),f=await fixture(t,{pairingState}),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);
 const task=await f.upload(a);f.tasks.disconnect(a.instanceId);f.tasks.disconnect(b.instanceId);f.advance(20000);f.tasks.maintain();
 assert.equal(f.tasks.discover('user').groups[0].groupId,groupId);assert.equal(f.tasks.metrics().tasks,0);
 assert.throws(()=>f.tasks.preflight('user',{groupId,websiteIds:['alpha'],action:'inspect'}),/RECIPIENT_OFFLINE/);
 assert.equal(JSON.stringify([...pairingState.values()]).includes(a.resumeProof),false);
 await f.tasks.close();
 const restarted=await createPrivateTasks({root:f.root,pairingState,website:id=>f.sites.get(id),activeScope:()=>true,planner:async()=>({message:'Review',actions:[]})});t.after(()=>restarted.close());
 const scope={...a.scope,sessionId:crypto.randomUUID()},ticket=restarted.ticket(scope,{resumeProof:a.resumeProof});assert.notEqual(ticket.instanceId,a.instanceId);restarted.connect(ticket.ticket,scope.origin,()=>{});
 assert.equal(restarted.pairStatus(scope,{instanceId:ticket.instanceId}).groupId,groupId);
 assert.equal(restarted.discover('user').groups[0].groupId,groupId);
 assert.equal(restarted.preflight('user',{groupId,websiteIds:['alpha'],action:'inspect'}).recipients[0].instanceId,ticket.instanceId);
 assert.throws(()=>restarted.status(scope,{instanceId:ticket.instanceId,taskId:task.taskId}),/TASK_ENDED/);
 assert.throws(()=>restarted.ticket({...scope,hostPrincipal:'different-user'},{resumeProof:a.resumeProof}),/PAIRING_RESUME_DENIED/);
});

test('F14/F18: revoked and expired membership cannot reconnect; confirmation/revoke retries are safe',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');const invite=f.tasks.invite(a.scope,{...a,name:'Repeated workflow',lifetimeHours:1});f.tasks.join(b.scope,{...b,code:invite.code});const invitationId=f.tasks.pairStatus(a.scope,a).pending[0].invitationId;
 f.tasks.confirm(a.scope,{...a,invitationId});const confirmed=f.tasks.confirm(b.scope,{...b,invitationId});assert.equal(f.tasks.confirm(b.scope,{...b,invitationId}).groupId,confirmed.groupId);
 f.tasks.revoke(a.scope,{...a,targetId:b.instanceId});f.tasks.revoke(a.scope,{...a,targetId:b.instanceId});f.tasks.disconnect(b.instanceId);
 assert.throws(()=>f.tasks.ticket({...b.scope,sessionId:crypto.randomUUID()},{resumeProof:b.resumeProof}),/PAIRING_RESUME_DENIED/);
 f.advance(3600001);f.tasks.maintain();assert.throws(()=>f.tasks.ticket({...a.scope,sessionId:crypto.randomUUID()},{resumeProof:a.resumeProof}),/PAIRING_RESUME_DENIED/);
});

test('F10: summary-only private request cannot reach a fill planner or create a review',async t=>{
 const f=await fixture(t,{planner:async()=>{throw new Error('Must not plan writes');},answer:async()=>({message:'Inventory API using stdio',citations:[]})}),a=f.add('alpha'),task=await f.upload(a);f.tasks.complete(f.tasks.claim('w'),{sections:[{text:'Requested integration: Inventory API\nTransport: stdio',locator:'Document'}]});
 const out=await f.tasks.plan(a.scope,{...a,taskId:task.taskId,text:'Summarize the requested integration. Do not fill or submit anything.',snapshot});assert.deepEqual(out.actions,[]);assert.match(out.message,/Inventory API/);
});

test('page questions in an empty private task pass the fresh DOM to the reader without requiring a file or reaching the write planner',async t=>{
 let received;const f=await fixture(t,{planner:async()=>{throw new Error('No write planner for a question');},answer:async input=>{received=input;return {message:'The equipment register has ten loaded rows.',citations:[],pageObserved:true};}}),a=f.add('alpha'),task=f.tasks.start(a.scope,a);
 const page={...snapshot,pageContext:{text:'Equipment register',headings:[],headingCount:0,truncated:false}};
 const out=await f.tasks.summary(a.scope,{...a,taskId:task.taskId,text:'What can you see?',snapshot:page,authorizedKnowledgeHistory:[{role:'assistant',text:'Earlier register question'}],authorizedReplyContext:'Earlier register question'});
 assert.equal(received.snapshot.pageContext.text,'Equipment register');assert.equal(received.replyContext,'Earlier register question');assert.equal(received.evidence.length,0);assert.equal(out.pageObserved,true);
});

test('F17: inspection result is consumed as evidence by a following planner before private task cleanup',async t=>{
 let received;
 const f=await fixture(t,{planner:async input=>{received=input.privateGuidance.evidence;return {message:'The prior step observed Company name.',actions:[]};}}),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);
 const first={groupId,websiteIds:['alpha'],action:'inspect',operationId:'inspect-result'},c=f.tasks.dispatch('user',first,f.tasks.preflight('user',first));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:c.commandId});const observation=await f.tasks.commandPlan(a.scope,{...a,commandId:c.commandId,snapshot});f.tasks.commandFrame(a.instanceId,{type:'result',commandId:c.commandId,ok:true,result:observation});const status=f.tasks.commandStatus('user',c.commandId);assert.equal(status.recipients[0].inspection.valuesExcluded,true);
 const next={...first,action:'prepare',instruction:'Prepare a review based on the earlier inspection',operationId:'use-result',taskId:c.taskId,inputs:{taskHandles:[status.recipients[0].resultHandle]}},d=f.tasks.dispatch('user',next,f.tasks.preflight('user',next));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:d.commandId});await f.tasks.commandPlan(a.scope,{...a,commandId:d.commandId,snapshot});assert.match(received[0].text,/Company name/);
 f.tasks.end(a.scope,{...a,taskId:c.taskId});assert.throws(()=>f.tasks.result('user',{commandId:c.commandId,instanceId:a.instanceId}),/PRIVATE_RESULT_ENDED/);assert.equal(f.tasks.commandStatus('user',c.commandId).recipients[0].inspection.fields[0].label,'Company name');
});
test('workflow linking does not require pairing; adding targets never grants peer handoff',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');
 f.sites.get('alpha').taskPolicy.pairing=false;f.sites.get('beta').taskPolicy.pairing=false;
 const groupId=f.tasks.linkUser('user',f.tasks.linkRequest(a.scope,a)).groupId;
 assert.equal(f.tasks.preflight('user',{groupId,websiteIds:['alpha'],action:'inspect'}).recipients.length,1);
 const code=f.tasks.linkRequest(b.scope,b).code;
 assert.throws(()=>f.tasks.linkUser('other',{code,groupId}),/LINK_DENIED/);
 const next=f.tasks.linkRequest(b.scope,b).code;
 assert.equal(f.tasks.linkUser('user',{code:next,groupId}).groupId,groupId);
 assert.equal(f.tasks.preflight('user',{groupId,websiteIds:['alpha','beta'],action:'inspect'}).recipients.length,2);
 const task=await f.upload(a);assert.throws(()=>f.tasks.relay(a.scope,{...a,taskId:task.taskId,targetId:b.instanceId,shareConsent:true}),/HANDOFF_DENIED/);
 f.sites.get('alpha').taskPolicy.pairing=true;f.sites.get('beta').taskPolicy.pairing=true;
 assert.throws(()=>f.tasks.relay(a.scope,{...a,taskId:task.taskId,targetId:b.instanceId,shareConsent:true}),/HANDOFF_DENIED/);
 f.pair(a,b);assert.equal(f.tasks.relay(a.scope,{...a,taskId:task.taskId,targetId:b.instanceId,shareConsent:true}).shared,true);
});
test('chosen until-revoked consent survives old inactivity window; optional inactivity still expires it',async t=>{
 for(const inactivityMinutes of [0,15]){
  const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');const invite=f.tasks.invite(a.scope,{...a,lifetimeHours:0,inactivityMinutes,name:'Chosen lifetime'});f.tasks.join(b.scope,{...b,code:invite.code});const invitationId=f.tasks.pairStatus(a.scope,a).pending[0].invitationId;f.tasks.confirm(a.scope,{...a,invitationId});const group=f.tasks.confirm(b.scope,{...b,invitationId});assert.equal(group.expiresAt,null);
  f.tasks.disconnect(a.instanceId);f.tasks.disconnect(b.instanceId);f.advance(16*60000);f.tasks.maintain();
  const resume=()=>f.tasks.ticket({...a.scope,sessionId:crypto.randomUUID()},{resumeProof:a.resumeProof});
  if(inactivityMinutes)assert.throws(resume,/PAIRING_RESUME_DENIED/);else assert.equal(resume().paired,true);
 }
});
test('workflow summaries and read-only preparation consume prior task handles as answer evidence',async t=>{
 let evidence=[];const f=await fixture(t,{answer:async input=>{evidence=input.evidence;return {message:'The prior step observed Company name.',citations:[]};}}),a=f.add('alpha'),b=f.add('beta'),groupId=f.pair(a,b);f.link(a);
 const input={groupId,websiteIds:['alpha'],action:'inspect',operationId:'observed-first'},first=f.tasks.dispatch('user',input,f.tasks.preflight('user',input));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:first.commandId});const result=await f.tasks.commandPlan(a.scope,{...a,commandId:first.commandId,snapshot});f.tasks.commandFrame(a.instanceId,{type:'result',commandId:first.commandId,ok:true,result});const handle=f.tasks.commandStatus('user',first.commandId).recipients[0].resultHandle;
 for(const action of ['summarize','prepare']){const next={...input,taskId:first.taskId,action,instruction:'Summarize the prior inspection. Do not fill fields.',operationId:'summary-'+action,inputs:{taskHandles:[handle]}},command=f.tasks.dispatch('user',next,f.tasks.preflight('user',next));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:command.commandId});const response=await f.tasks.commandPlan(a.scope,{...a,commandId:command.commandId,snapshot:{...snapshot,fields:[]}});assert.match(evidence[0].text,/Company name/);assert.equal(evidence[0].chunkId,handle);assert.match(response.message,/prior step/);f.tasks.commandFrame(a.instanceId,{type:'result',commandId:command.commandId,ok:true,result:response});}
 f.tasks.end(a.scope,{...a,taskId:first.taskId});assert.throws(()=>f.tasks.result('user',{commandId:first.commandId,instanceId:a.instanceId}),/PRIVATE_RESULT_ENDED/);
});

test('dependency continuation requires observed prior effects and dispatch rechecks revoked policy',async t=>{
 const repository=openRepository();t.after(()=>repository.close());const attempts=createActionAttempts(repository),f=await fixture(t,{actionAttempts:attempts,planner:async({snapshot})=>({message:'Review',actions:snapshot.fields.map(field=>({type:'fill',ref:field.ref,value:field.label==='Country'?'Singapore':'Central'}))})}),a=f.add('alpha'),linked=f.link(a);
 const input={groupId:linked.groupId,websiteIds:['alpha'],action:'fill',instruction:'Country: Singapore; Province: Central',operationId:'dependency-test',requiredOutcome:'local_state_verified'},c=f.tasks.dispatch('user',input,f.tasks.preflight('user',input));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:c.commandId});
 const first={revision:1,path:'/customer',fields:[{ref:'r1f0',label:'Country',key:'country',type:'text'}]},p=await f.tasks.commandPlan(a.scope,{...a,commandId:c.commandId,snapshot:first}),grant=await f.tasks.effect(a.scope,{...a,commandId:c.commandId,proposalId:p.id,revision:1,effectIndex:0});
 await f.tasks.dispatchAction(a.scope,grant.actions[0]);attempts.observe(a.scope,{...grant.actions[0],outcome:'local_state_verified'});
 const next={revision:2,path:'/customer',fields:[{ref:'r2f0',label:'Country',key:'country',type:'text'},{ref:'r2f1',label:'Province',key:'province',type:'text'}]},p2=await f.tasks.commandPlan(a.scope,{...a,commandId:c.commandId,snapshot:next,continuation:true});assert.equal(p2.actions.length,1);assert.equal(p2.actions[0].label,'Province');
 const grant2=await f.tasks.effect(a.scope,{...a,commandId:c.commandId,proposalId:p2.id,revision:2,effectIndex:0});f.sites.get('alpha').taskPolicy.workflow=false;await assert.rejects(f.tasks.dispatchAction(a.scope,grant2.actions[0]));assert.equal(attempts.status(a.scope,grant2.actions[0].actionId).state,'reserved');
});
test('browser success booleans cannot fabricate workflow business verification',async t=>{
 const f=await fixture(t),a=f.add('alpha'),linked=f.link(a),input={groupId:linked.groupId,websiteIds:['alpha'],action:'submit',instruction:'Save',inputs:{bindingId:'save'},operationId:'strict-outcome',requiredOutcome:'business_verified'},c=f.tasks.dispatch('user',input,f.tasks.preflight('user',input));f.tasks.commandFrame(a.instanceId,{type:'ack',commandId:c.commandId});const p=await f.tasks.commandPlan(a.scope,{...a,commandId:c.commandId,snapshot});await f.tasks.effect(a.scope,{...a,commandId:c.commandId,proposalId:p.id,revision:1,effectIndex:0});f.tasks.commandFrame(a.instanceId,{type:'result',commandId:c.commandId,ok:true,result:{observations:[{hostReported:'success',businessVerified:true}],savedVerified:true}});const status=f.tasks.commandStatus('user',c.commandId);assert.equal(status.status,'failed');assert.equal(status.recipients[0].code,'REQUIRED_OUTCOME_NOT_MET');assert.equal(status.recipients[0].resultHandle,undefined);
});
test('recovery tombstone rejects redispatch through a freshly authorized session and group',async t=>{
 const repository=openRepository();t.after(()=>repository.close());const commandState=repository.map('command_attempts'),f=await fixture(t,{commandState}),a=f.add('alpha'),linked=f.link(a),input={groupId:linked.groupId,websiteIds:['alpha'],action:'inspect',operationId:'stable-run-node'};f.tasks.dispatch('user',input,f.tasks.preflight('user',input));await f.tasks.close();const restarted=await fixture(t,{commandState}),b=restarted.add('alpha'),linked2=restarted.link(b),retry={...input,groupId:linked2.groupId};assert.throws(()=>restarted.tasks.dispatch('user',retry,restarted.tasks.preflight('user',retry)),/OPERATION_ALREADY_DISPATCHED/);assert.doesNotMatch(JSON.stringify(commandState.values()),/instruction|passage|fieldValue/);
});


test('RELAY02: fresh no-file handoff needs pairing, not attachment permission',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);
 for(const site of f.sites.values())site.taskPolicy.attachments=false;
 const result=await f.tasks.relay(a.scope,{...a,targetId:b.instanceId,shareConsent:true,instruction:'Inspect the current form'});
 assert.equal(result.shared,true);assert.deepEqual(result.context,[]);
 assert.deepEqual(f.tasks.status(a.scope,{...a,taskId:result.taskId}).files,[]);
 assert.equal(f.tasks.status(b.scope,{...b,taskId:result.taskId}).taskId,result.taskId);
 assert.equal(b.messages.at(-1).instruction,'Inspect the current form');
 assert.throws(()=>f.tasks.start(a.scope,a),/VISITOR_CAPABILITY_DISABLED/);
 await assert.rejects(f.tasks.upload(a.scope,{...a,taskId:result.taskId,operationId:crypto.randomUUID(),filename:'x.txt',mime:'text/plain',content:Buffer.from('x').toString('base64')}),/VISITOR_CAPABILITY_DISABLED/);
});
test('RELAY03: rejected pairing/consent/offline/conflict never allocates a handoff task',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),c=f.add('gamma');
 const relay=extra=>f.tasks.relay(a.scope,{...a,targetId:b.instanceId,shareConsent:true,...extra});
 assert.throws(()=>relay({}),/HANDOFF_DENIED/);assert.equal(f.tasks.metrics().tasks,0);f.pair(a,b);
 assert.throws(()=>relay({shareConsent:false}),/HANDOFF_DENIED/);assert.equal(f.tasks.metrics().tasks,0);
 assert.throws(()=>relay({targetId:c.instanceId}),/HANDOFF_DENIED/);assert.equal(f.tasks.metrics().tasks,0);
 f.tasks.start(b.scope,b);assert.throws(()=>relay({}),/TASK_CONFLICT/);assert.equal(f.tasks.metrics().tasks,1);
 f.tasks.disconnect(b.instanceId);assert.throws(()=>relay({}),/HANDOFF_DENIED/);assert.equal(f.tasks.metrics().tasks,0);
});
test('RELAY04: ending a shared task preserves pairing and the next handoff has no old files',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');const group=f.pair(a,b),task=await f.upload(a);
 f.tasks.complete(f.tasks.claim('w'),{sections:[{text:'Secret prior file',locator:'Text'}]});
 await f.tasks.relay(a.scope,{...a,taskId:task.taskId,targetId:b.instanceId,shareConsent:true,instruction:'Share file'});
 f.tasks.end(a.scope,{...a,taskId:task.taskId});assert.equal(f.tasks.pairStatus(a.scope,a).groupId,group);
 const result=await f.tasks.relay(a.scope,{...a,targetId:b.instanceId,shareConsent:true,instruction:'Inspect only'});
 assert.notEqual(result.taskId,task.taskId);assert.deepEqual(result.context,[]);assert.deepEqual(f.tasks.status(b.scope,{...b,taskId:result.taskId}).files,[]);
 assert.throws(()=>f.tasks.status(a.scope,{...a,taskId:task.taskId}),/TASK_ENDED/);
});
test('RELAY05: expired task IDs fail without delivery or revival; a fresh start discards old content',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);const task=await f.upload(a);
 for(let n=0;n<901;n++){f.advance(1000);f.tasks.heartbeat(a.instanceId);f.tasks.heartbeat(b.instanceId);}
 const count=b.messages.filter(m=>m.type==='task-shared').length;
 assert.throws(()=>f.tasks.relay(a.scope,{...a,taskId:task.taskId,targetId:b.instanceId,shareConsent:true,instruction:'Old file'}),/TASK_ENDED/);
 assert.equal(b.messages.filter(m=>m.type==='task-shared').length,count);
 const next=f.tasks.start(a.scope,a);assert.notEqual(next.taskId,task.taskId);assert.deepEqual(next.files,[]);
 assert.throws(()=>f.tasks.status(a.scope,{...a,taskId:task.taskId}),/TASK_ENDED/);
});

test('PEER01: paired inspection RPC returns validated form structure without an attachment or values',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta'),c=f.add('gamma');f.pair(a,b);
 const request=await f.tasks.peerRequest(a.scope,{...a,targetId:b.instanceId,mode:'inspect',instruction:'Inspect forms',shareConsent:true,operationId:'inspect-one'});
 assert.equal(b.messages.at(-1).type,'peer-request');assert.equal(request.status,'pending');
 assert.throws(()=>f.tasks.peerStatus(c.scope,{...c,requestId:request.requestId}),/PEER_ACCESS_DENIED/);
 assert.throws(()=>f.tasks.peerAnswer(a.scope,{...a,requestId:request.requestId,snapshot}),/PEER_ACCESS_DENIED/);
 f.tasks.peerAnswer(b.scope,{...b,requestId:request.requestId,snapshot:{...snapshot,fields:[{...snapshot.fields[0],required:true,value:'Never copy this arbitrary property'}]}});
 const result=f.tasks.peerStatus(a.scope,{...a,requestId:request.requestId});assert.equal(result.status,'completed');assert.equal(result.result.fields[0].required,true);assert.deepEqual(result.result.values,[]);assert.equal(JSON.stringify(result).includes('Never copy'),false);
 assert.match(JSON.stringify((await f.tasks.goalContext(a.scope,{...a,taskId:request.taskId,text:'Use inspection'})).evidence),/Company name/);
});
test('PEER02: private form values become recipient goal evidence only after consent, with no upload permission',async t=>{
 let evidence;const f=await fixture(t,{planner:async input=>{evidence=input.privateGuidance.evidence;return {message:'Review',actions:[{type:'fill',ref:'r1f0',value:'Peer Orchid'}]};}}),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);f.sites.get('alpha').taskPolicy.attachments=false;f.sites.get('beta').taskPolicy.attachments=false;
 const input={...a,targetId:b.instanceId,mode:'goal',instruction:'Use the privately shared company',operationId:'carry',sourceSnapshot:snapshot,values:[{ref:'r1f0',value:'Peer Orchid'}]};
 await assert.rejects(f.tasks.peerRequest(a.scope,input),/HANDOFF_DENIED/);assert.equal(f.tasks.metrics().tasks,0);
 const r=await f.tasks.peerRequest(a.scope,{...input,shareConsent:true}),binding=f.tasks.peerBinding(b.scope,{...b,requestId:r.requestId});assert.equal(binding.peerRequestId,r.requestId);
 const proposal=await f.tasks.plan(b.scope,{...b,taskId:r.taskId,text:'Use the privately shared company',snapshot});assert.equal(proposal.actions[0].value,'Peer Orchid');assert.match(JSON.stringify(evidence),/Peer Orchid/);
 f.tasks.end(a.scope,{...a,taskId:r.taskId});assert.throws(()=>f.tasks.peerBinding(b.scope,{...b,requestId:r.requestId}));
});
test('PEER03: duplicate dispatch is idempotent, altered reuse is refused and terminal replies require trusted completed goal evidence',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);const input={...a,targetId:b.instanceId,mode:'goal',instruction:'Prepare a record; do not save',shareConsent:true,operationId:'one'};
 const r=await f.tasks.peerRequest(a.scope,input);assert.equal((await f.tasks.peerRequest(a.scope,input)).requestId,r.requestId);assert.equal(b.messages.filter(m=>m.type==='peer-request').length,1);
 await assert.rejects(f.tasks.peerRequest(a.scope,{...input,instruction:'Changed'}),/PEER_OPERATION_CONFLICT/);
 assert.throws(()=>f.tasks.peerAnswer(b.scope,{...b,requestId:r.requestId,goalId:'fabricated',status:'completed'}),/PEER_OUTCOME_REQUIRED/);
 f.tasks.peerAnswer(b.scope,{...b,requestId:r.requestId,rejected:true});assert.equal(f.tasks.peerStatus(a.scope,{...a,requestId:r.requestId}).code,'PEER_DECLINED');assert.throws(()=>f.tasks.peerBinding(b.scope,{...b,requestId:r.requestId}),/PEER_REQUEST_ENDED/);
});
test('PEER04: disconnect fails pending work and reconnect cannot replay or revive the request',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);const r=await f.tasks.peerRequest(a.scope,{...a,targetId:b.instanceId,mode:'goal',instruction:'Continue',shareConsent:true,operationId:'disconnect'});f.tasks.disconnect(b.instanceId);
 assert.equal(f.tasks.peerStatus(a.scope,{...a,requestId:r.requestId}).code,'RECIPIENT_OFFLINE');assert.equal(b.messages.filter(m=>m.type==='peer-request').length,1);
 assert.equal(f.tasks.goalBinding(b.scope,{taskId:r.taskId,instanceId:b.instanceId,contentRevision:0,peerRequestId:r.requestId}),false);
});
test('PEER05: cancelled/revoked peer requests invalidate existing private action bindings',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);const r=await f.tasks.peerRequest(a.scope,{...a,targetId:b.instanceId,mode:'goal',instruction:'Continue',shareConsent:true,operationId:'cancel'}),binding={...f.tasks.peerBinding(b.scope,{...b,requestId:r.requestId}),contentRevision:0};assert.equal(f.tasks.goalBinding(b.scope,binding),true);
 f.tasks.peerCancel(a.scope,{...a,requestId:r.requestId});assert.equal(f.tasks.goalBinding(b.scope,binding),false);await assert.rejects(f.tasks.goalContext(b.scope,{...binding,text:'Late context'}),/PEER_REQUEST_ENDED/);
});
test('PEER06: unobserved/secret value refs and oversized private context are rejected before dispatch',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);const input={...a,targetId:b.instanceId,mode:'goal',instruction:'Continue',shareConsent:true,operationId:'bad-values',sourceSnapshot:snapshot};
 for(const values of [[{ref:'invented',value:'secret'}],[{ref:'r1f0',value:'x'.repeat(1001)}]])await assert.rejects(f.tasks.peerRequest(a.scope,{...input,values}),/PEER_CONTEXT_INVALID/);
 assert.equal(f.tasks.metrics().tasks,0);
});

test('PEER07: planning excludes self, self requests fail, and disabling pairing invalidates pending bindings',async t=>{
 const f=await fixture(t),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);
 assert.deepEqual(f.tasks.peerCatalog(a.scope,a).map(p=>p.instanceId),[b.instanceId]);
 await assert.rejects(f.tasks.peerRequest(a.scope,{...a,targetId:a.instanceId,mode:'goal',instruction:'Self',shareConsent:true,operationId:'self'}),/HANDOFF_DENIED/);
 const r=await f.tasks.peerRequest(a.scope,{...a,targetId:b.instanceId,mode:'goal',instruction:'Continue',shareConsent:true,operationId:'policy'}),binding={...f.tasks.peerBinding(b.scope,{...b,requestId:r.requestId}),contentRevision:0};
 f.sites.get('beta').taskPolicy.pairing=false;assert.equal(f.tasks.goalBinding(b.scope,binding),false);assert.equal(f.tasks.peerStatus(a.scope,{...a,requestId:r.requestId}).status,'failed');
});

test('PEER08: concurrent retries share one in-flight request and cannot duplicate a handoff',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);const f=await fixture(t,{passageStore:{search:async()=>{await gate;return [];}}}),a=f.add('alpha'),b=f.add('beta');f.pair(a,b);
 const input={...a,targetId:b.instanceId,mode:'goal',instruction:'Continue privately',shareConsent:true,operationId:'concurrent'};
 const first=f.tasks.peerRequest(a.scope,input),second=f.tasks.peerRequest(a.scope,input);release();const [x,y]=await Promise.all([first,second]);assert.equal(x.requestId,y.requestId);assert.equal(b.messages.filter(m=>m.type==='peer-request').length,1);
});

test('PEER09: a sender that disconnects during context lookup cannot deliver late to another paired tab',async t=>{
 let wait=false,release;const gate=new Promise(resolve=>release=resolve);const f=await fixture(t,{passageStore:{search:async()=>{if(wait)await gate;return [];}}}),a=f.add('alpha'),b=f.add('beta'),c=f.add('gamma');f.pair(a,b);f.pair(a,c);
 const task=f.tasks.start(a.scope,a);await f.tasks.relay(a.scope,{...a,taskId:task.taskId,targetId:b.instanceId,shareConsent:true,instruction:'Existing task'});
 wait=true;const pending=f.tasks.peerRequest(a.scope,{...a,taskId:task.taskId,targetId:c.instanceId,mode:'goal',instruction:'Late request',shareConsent:true,operationId:'late'});f.tasks.disconnect(a.instanceId);release();await assert.rejects(pending,/HANDOFF_DENIED/);assert.equal(c.messages.filter(m=>m.type==='peer-request').length,0);
});
