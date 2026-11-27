import assert from 'node:assert/strict';
import {createActionContractController} from '../../openclaw-extensions/agent-os-content-tools/action-contract-turn.js';
const authority={assertActive(){},allows:n=>n==='fixture_export'};
const session='agent:t-fixture--coo:main',ctx={sessionKey:session,agentId:'t-fixture--coo',runId:'run-one'};
let calls=0,claims=0,status='ready',reply=null,decision='execute';
const controller=createActionContractController({
 post:async body=>{
  if(body.operation==='route')return {id:'contract',decision,tool_name:'fixture_export',arguments:{format:'csv'},status:'ready'};
  if(body.operation==='bind')return {};
  if(body.operation==='claim'){claims++;if(status==='ready'){status='running';return {status:'claimed',tool_name:'fixture_export',arguments:{format:'csv'}};}return {status,reply};}
  if(body.operation==='complete'){assert.equal(body.result.data.receipt,'new-export');status='completed';reply='Fresh verified export result';return {status,reply};}
  if(body.operation==='validate_reply')return {invalid_artifact:true,reply:'Expired artifact withheld'};
  throw Error('Unknown fixture operation');
 },
 invoke:async(tool,args,identity)=>{calls++;assert.equal(tool,'fixture_export');assert.deepEqual(args,{format:'csv'});assert.equal(identity.runId,'native-one');await new Promise(r=>setTimeout(r,10));return {ok:true,data:{receipt:'new-export'}};}
});
await controller.prepare({current_request:'Create an export'},ctx,ctx.agentId);await controller.bind(ctx,'native-one');
const prompt=controller.prompt(session);assert.deepEqual(prompt.toolsAllow,['fixture_export']);assert(prompt.systemPrompt.length<500,'single-action staging excludes manuals and cached facts');
assert(controller.block({toolName:'connector_search_actions',params:{}},ctx)?.block);
assert(controller.block({toolName:'physical_entities_list',params:{}},ctx)?.block);
const event={sessionKey:session,runId:'native-one',kind:'final',payload:{text:'Here is an old cached result'}};
await controller.fulfill({...ctx,runId:'native-one',toolAuthority:authority});
const outputs=await Promise.all([controller.finish(event),controller.finish(event)]);
assert(outputs.every(x=>x.payload.text===reply));assert.equal(calls,1);assert.equal(claims,2,'concurrent final callbacks share the in-flight dispatch');
assert.equal((await controller.finish(event)).payload.text,reply);assert.equal(calls,1,'later callbacks reuse persisted completion rather than executing again');
assert.equal(await controller.finish({...event,kind:'tool'}),undefined,'intermediate progress is not terminal execution');
decision='other';await controller.prepare({current_request:'Read Gmail'}, {...ctx,runId:'run-two'},ctx.agentId);
assert.equal(controller.prompt(session),null);assert.equal(controller.block({toolName:'floassist_source_read'},{...ctx,runId:'run-two'}),undefined);
assert.equal(await controller.finish({...event,runId:'run-two',payload:{text:'Verified email summary'}}),undefined);
assert.equal((await controller.finish({...event,runId:'run-two',payload:{text:'https://fixture.invalid/p/private-artifact/expired'}})).payload.text,'Expired artifact withheld');
assert.equal(calls,1);
console.log('ACTION_CONTRACT_TURN_OK: generic fixture export; compact staging; no wrong-domain calls; one correlated dispatch; duplicate callbacks; normal source turns; stale-artifact fence');

const unavailable=createActionContractController({post:async()=>{throw Error('unavailable');},invoke:async()=>{throw Error('must not dispatch');}});
await unavailable.prepare({current_request:'Fixture'},ctx,ctx.agentId);
assert.deepEqual(unavailable.prompt(session).toolsAllow,[]);
assert.match((await unavailable.finish({...event,runId:ctx.runId})).payload.text,/No action was performed/);
let timedCalls=0,timedState='ready';
const timed=createActionContractController({invokeTimeoutMs:5,post:async b=>{if(b.operation==='route')return {id:'timed',decision:'execute',tool_name:'fixture_export'};if(b.operation==='claim'){const status=timedState==='ready'?'claimed':timedState;timedState='uncertain';return {status,tool_name:'fixture_export',arguments:{},reply:'Dispatch uncertain; not repeated'};}if(b.operation==='complete'){assert.equal(b.result.uncertain,true);return {status:'uncertain',reply:'Dispatch uncertain; not repeated'};}},invoke:async()=>{timedCalls++;return new Promise(()=>{});}});
await timed.prepare({current_request:'Fixture'},ctx,ctx.agentId);
await timed.fulfill({...ctx,toolAuthority:authority});
assert.match((await timed.finish({...event,runId:ctx.runId})).payload.text,/uncertain/);
assert.match((await timed.finish({...event,runId:ctx.runId})).payload.text,/uncertain/);assert.equal(timedCalls,1);
console.log('ACTION_CONTRACT_FAILURES_OK: routing outage fails truthfully; deadline yields uncertain; no blind replay');

const recovered=createActionContractController({post:async b=>{assert.equal(b.operation,'lookup');return {decision:'execute',reply:'Persisted verified completion'};},invoke:async()=>{throw Error('must not replay');}});
assert.equal((await recovered.finish(event)).payload.text,'Persisted verified completion');
assert.equal((await controller.finish({...event,payload:{text:'model failed',isError:true}})).payload.text,reply);

let deniedInvocations=0;
const denied=createActionContractController({post:async b=>b.operation==='route'?{id:'denied',decision:'execute',tool_name:'fixture_export'}:b.operation==='claim'?{status:'claimed',tool_name:'fixture_export',arguments:{}}:{status:'failed',reply:b.result.error},invoke:async()=>{deniedInvocations++;}});
await denied.prepare({current_request:'Fixture'},ctx,ctx.agentId);
const deniedResult=await denied.fulfill({...ctx,toolAuthority:{assertActive(){},allows:()=>false}});
assert.match(deniedResult.payload.text,/not permitted/);assert.equal(deniedInvocations,0);
console.log('ACTION_CONTRACT_AUTHORITY_OK: finalized native scope enforced; persisted result recovered without replay');

const {rememberStatusTurn,statusTurnBlock}=await import('../../openclaw-extensions/agent-os-content-tools/async-status-turn.js');
rememberStatusTurn(session,'What is the status of the last completed task?');
for(const name of ['agent_work_history','organization_read','kanban_get_task'])assert.equal(statusTurnBlock(session,'tool_call',{id:name,args:{}}),null,'observational questions may inspect the correct authoritative ledger');
assert.match(statusTurnBlock(session,'browse_task_start',{}),/No new action/);assert.match(statusTurnBlock(session,'email_send',{}),/No new action/);
console.log('OBSERVATIONAL_SOURCE_SCOPE_OK: work/organisation/task reads remain available; original actions cannot replay');
