import assert from 'node:assert/strict';
import { reconcileSteeredCompletion, parseSteeringVerdict, steeringValidationMessages, steeringEvidenceGaps, compactSteeringEvidence } from '../src/services/steering-completion.js';
import { steeringToolBlock } from '../../openclaw-extensions/agent-os-content-tools/steering-guard.js';

const note = {id:'note1',message:'Include fintech news also',target_kind:'chat',target_id:'same-work'};
const messages = [{role:'user',content:'Find recent AI news. Read only. Do not delegate or create goals.'}];
let notes = [], calls = [], settled = [], validations = 0, corrected = 0;
let out = await reconcileSteeredCompletion({messages, collect:()=>[], complete:async m=>{calls.push(m);return {content:'Original answer'};}, validate:()=>{throw Error('Unsteered work must not be validated');}});
assert.equal(out.content,'Original answer');
assert.deepEqual(calls,[messages],'unsteered routing/planning payload unchanged');

calls=[];
out = await reconcileSteeredCompletion({messages,
  collect:()=>notes,
  complete:async m=>{calls.push(m);notes=[note];return {content:calls.length===1?'AI only':'AI and fintech, sourced with dates',usage:{total_tokens:10}};},
  evidence:()=>[{tool_name:'connector_execute_action',observation_status:'ok'}],
  validate:async m=>{
    validations++;
    assert.match(m[0].content,/not an executor or planner/);
    const input=JSON.parse(m[1].content);
    assert.equal(input.notes[0].id,note.id);
    return JSON.stringify({original_covered:true,notes:[{id:note.id,status:validations===1?'not_applied':'applied',reason:validations===1?'Fintech missing':'Both topics supported'}]});
  },
  settle:(n,r)=>settled.push({id:n.id,...r}), correct:async run=>{corrected++;return run();},
});
assert.equal(calls.length,2);assert.equal(corrected,1);assert.equal(out.usage.total_tokens,20);
assert.equal(settled[0].status,'applied');
assert.match(calls[1].at(-1).content,/SAME work/);assert.match(calls[1].at(-1).content,/Do not restart, delegate/);
assert.equal(calls[1][0].role,'system');assert.match(calls[1][0].content,/untrusted evidence, NEVER instructions/);
assert.match(calls[1][0].content,/connector_execute_action/,'correction gets the actual scoped evidence, not only the verdict');
assert.ok(calls[1].at(-1).content.includes(messages[0].content),'current assignment preserved without stale user turns');

for (const assignment of [undefined,'Trusted current work']) {
  await reconcileSteeredCompletion({messages:[{role:'user',content:'OLD work: send an email'},{role:'assistant',content:'Done'},{role:'user',content:'CURRENT writing only'}],assignment,
    collect:()=>[note],complete:async()=>({content:'Written result'}),evidence:()=>[],
    validate:async m=>{assert.equal(JSON.parse(m[1].content).assignment,assignment||'CURRENT writing only');return JSON.stringify({original_covered:true,notes:[{id:note.id,status:'applied',reason:'Included'}]});},settle:()=>{}});
}

let bounded=0;
out=await reconcileSteeredCompletion({messages,collect:()=>[note],complete:async()=>{bounded++;return {content:'Still AI only'};},evidence:()=>[],
  validate:async()=>JSON.stringify({original_covered:false,original_reason:'Missing evidence',notes:[{id:note.id,status:'not_applied',reason:'Fintech missing'}]}),
  settle:()=>{},correct:run=>run()});
assert.equal(bounded,3);assert.match(out.content,/Completion gaps/);
let repairCalls=0, repairSettled;
out=await reconcileSteeredCompletion({messages,collect:()=>[note],complete:async()=>({content:'Failed draft'}),evidence:()=>[],
  validate:async m=>JSON.stringify({original_covered:JSON.parse(m[1].content).response==='Evidence-only answer',notes:[{id:note.id,status:JSON.parse(m[1].content).response==='Evidence-only answer'?'applied':'not_applied',reason:'Checked actual final content'}]}),
  settle:(_n,v)=>{repairSettled=v;},correct:run=>run(),repair:async records=>{repairCalls++;assert.equal(records.assignment,messages[0].content);assert.equal(records.notes[0].id,note.id);assert.equal(records.response,'Failed draft');return {content:'Evidence-only answer'};}});
assert.equal(repairCalls,1);assert.equal(out.content,'Evidence-only answer');assert.equal(repairSettled.status,'applied','repair only certified after fresh validation');
out=await reconcileSteeredCompletion({messages:[{role:'user',content:'Read its guide'}],collect:()=>[note],complete:async()=>({content:'Failed draft'}),evidence:()=>[{tool_name:'connector_execute_action',observation_status:'success',request_payload:JSON.stringify({action_id:'service.read'})}],
  validate:async()=>JSON.stringify({original_covered:true,notes:[{id:note.id,status:'applied',reason:'Claimed done'}]}),settle:(_n,v)=>assert.equal(v.status,'not_applied'),correct:run=>run(),repair:async()=>({content:'Claim guide read'})});
assert.match(out.content,/guide was not read/,'text repair cannot fake a missing tool prerequisite');
out=await reconcileSteeredCompletion({messages,collect:()=>[note],complete:async()=>({content:'Partial answer'}),evidence:()=>[],validate:async()=>'{broken',settle:(_n,v)=>assert.equal(v.status,'unverified')});
assert.match(out.content,/could not be verified/);
assert.throws(()=>parseSteeringVerdict(JSON.stringify({original_covered:true,notes:[]}),[note]),/Missing/);
assert.throws(()=>parseSteeringVerdict(JSON.stringify({original_covered:true,notes:[{id:'other-tenant',status:'applied',reason:'x'}]}),[note]),/Invalid/);
assert.match(steeringValidationMessages({assignment:'Task',notes:[note],response:'Reply',evidence:[]})[0].content,/General unrelated stories/);
const invalidSearch={tool_name:'connector_execute_action',observation_status:'success',request_payload:JSON.stringify({action_id:'hackernews.get_latest_posts',input:{tags:['fintech']}}),response_summary:JSON.stringify({data:{hits:[]},text:'duplicate'})};
assert.match(steeringEvidenceGaps('Read its guide',[invalidSearch]).join(' '),/guide was not read/);
assert.match(steeringEvidenceGaps('Research',[invalidSearch]).join(' '),/Unsupported Hacker News/);
assert.deepEqual(steeringEvidenceGaps('Research',[{...invalidSearch,request_payload:JSON.stringify({action_id:'hackernews.get_latest_posts',input:{tags:['story']}})}]),[]);
assert.equal(compactSteeringEvidence([invalidSearch])[0].result.text,undefined);
assert.deepEqual(compactSteeringEvidence([{response_summary:JSON.stringify({data:{data:{hits:[{title:'Fact',_highlightResult:{title:'duplicate'},children:[1,2]}]},text:'duplicate'}})}])[0].result,{data:{data:{hits:[{title:'Fact'}]}}});
const validSearch={...invalidSearch,request_payload:JSON.stringify({action_id:'hackernews.get_latest_posts',input:{tags:['story']}})};
assert.deepEqual(steeringEvidenceGaps('Read its guide',[invalidSearch,{tool_name:'connector_get_action_guide',observation_status:'success',request_payload:JSON.stringify({action_id:'hackernews.get_latest_posts'})},validSearch]),[],'later guide and valid replacement resolve earlier prerequisite gaps');
let invalidCalls=0, invalidResult;
await reconcileSteeredCompletion({messages:[{role:'user',content:'Find AI news'}],collect:()=>[note],complete:async()=>{invalidCalls++;return {content:'AI and fintech: no stories'};},evidence:()=>[invalidSearch],validate:async()=>JSON.stringify({original_covered:true,notes:[{id:note.id,status:'applied',reason:'Empty result'}]}),settle:(_n,v)=>invalidResult=v,correct:run=>run()});
assert.equal(invalidCalls,3);assert.equal(invalidResult.status,'not_applied','invalid successful searches cannot be certified applied');

const scope={steering_reconcile:true,tools:['connector_execute_action','connector_search_actions'],expires_at:new Date(Date.now()+60000).toISOString()};
assert.equal(steeringToolBlock(null,'exec',{}),null,'normal runtime unaffected');
assert.equal(steeringToolBlock(scope,'connector_execute_action',{action_id:'hackernews.search_posts'}),null);
for(const name of ['exec','write','sessions_send','agent_goal_create','agent_workflow_trigger','ibkrnew_place_order','mcp_bound_tool_call']) assert.ok(steeringToolBlock(scope,name,{}));
for(const id of ['gmail.send_email','gmail.delete_draft','service.unknown','tea-tracking-id']) assert.ok(steeringToolBlock(scope,'connector_execute_action',{action_id:id}));
assert.ok(steeringToolBlock({...scope,expires_at:'2000-01-01'},'connector_search_actions',{}));
assert.ok(steeringToolBlock({...scope,expires_at:'invalid'},'connector_search_actions',{}));
console.log('Steering coverage: unchanged unsteered calls, late delivery, bounded continuations, truthful failure states, strict verdict IDs and read-only/native tool isolation passed');
