import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
const dir=mkdtempSync(join(tmpdir(),'goal-grounding-'));process.env.AGENT_OS_DATA_DIR=dir;process.env.GOAL_PLAN_COO_COMPLETION_NUDGE='0';
Object.assign(process.env,{MODEL_ROUTING_ENABLED:'0',OPENSEARCH_ENABLED:'0',OPENAI_BASE_URL:'https://maker.invalid/v1',OPENAI_API_KEY:'fixture',OPENAI_PRIMARY_BASE_URL:'https://maker.invalid/v1',OPENAI_PRIMARY_API_KEY:'fixture',OPENAI_PRIMARY_MODEL:'fixture-maker',OPENAI_SECONDARY_BASE_URL:'https://checker.invalid/v1',OPENAI_SECONDARY_API_KEY:'fixture',OPENAI_SECONDARY_MODEL:'fixture-checker'});
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('Unexpected network call');};
const {getDb}=await import('../src/db/schema.js');
const {synthesisNeedsGrounding,boundedSynthesisEvidence,assertSynthesisEvidence,checkGroundedSynthesis}=await import('../src/services/goal-synthesis-grounding.js');
const {normalizeStepSpec,createAndStartGoalRun,createGoalRun,getGoalRun,startGoalRunExecution,ensureAgentGoalRunTables,isApprovedScheduledBaseline,listGoalStepToolEvidence}=await import('../src/services/agent-goal-run.js');
const {validateTypedGoalPlan}=await import('../src/services/goal-plan-quality.js');
const {createScheduledGoal}=await import('../src/services/scheduled-goals.js');
const {upsertExceptionPolicy}=await import('../src/services/exception-policy.js');
ensureAgentGoalRunTables();const d=getDb(),owner='grounding-owner',agent='grounding-coo';
d.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)').run(owner,'grounding@example.test','x','Grounding fixture','ceo');
d.prepare('INSERT INTO agents(id,name,role,is_coo,owner_user_id) VALUES(?,?,?,?,?)').run(agent,'Grounding COO','COO',1,owner);
d.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)').run(owner,agent);
upsertExceptionPolicy(owner,{retry_limit:0,create_kanban:false,agent_pickup:false});
try {
 for(const type of ['email_summary','task_summary','key_updates','made_up']){
  assert.throws(()=>normalizeStepSpec({type}),e=>e.code==='GOAL_STEP_TYPE_UNSUPPORTED');
  await assert.rejects(()=>createAndStartGoalRun({ownerUserId:owner,agentId:agent,prompt:'Morning digest',steps:[{type}]}),e=>e.code==='GOAL_STEP_TYPE_UNSUPPORTED');
 }
 assert.equal(synthesisNeedsGrounding('Generate a morning digest including emails, tasks and key updates.'),true);
 assert.equal(synthesisNeedsGrounding('Write a fictional morning digest.'),false);assert.equal(synthesisNeedsGrounding('Write a poem about the sea.',{operation_mode:'create',deliverable_kind:'status_report'}),false);
 const broken=createGoalRun({ownerUserId:owner,agentId:agent,prompt:'Generate a morning digest including emails, tasks and key updates for today.',steps:[{type:'agent_continue',label:'Summarize today’s emails',quality_checked:true,step_key:'summary'}]});
 await startGoalRunExecution(broken.id,{ownerUserId:owner});
 for(let i=0;i<80&&!['failed','completed'].includes(getGoalRun(broken.id,owner).status);i++)await new Promise(r=>setTimeout(r,5));
 const stopped=getGoalRun(broken.id,owner);assert.equal(stopped.status,'failed');assert.equal(stopped.source_evidence_status,'unverified');assert.match(stopped.steps[0].error_message,/no verified source reads/);assert.ok(!stopped.steps[0].result.reply_preview);assert.match(stopped.evidence_notice,/not proof/);assert.equal(network,0);
 const validation=validateTypedGoalPlan([{key:'summary',type:'agent_continue',label:'Summarize today’s emails',depends_on:[],required_inputs:[],produces:[],spec:{operation_mode:'analyze',deliverable_kind:'status_report'}}],{tools:[],agents:[],workflows:[],humans:[]});assert.ok(validation.errors.some(e=>e.includes('upstream source-read')));
 const baseSteps=[{type:'agent_tool',label:'Read workflows',tool_name:'agent_workflow_list'}];
 const schedule=await createScheduledGoal(owner,{agent_id:agent,prompt:'Read workflows',execution_mode:'goal_plan',approve_plan:true,plan:{steps:baseSteps}});
 d.prepare("INSERT INTO scheduled_goal_runs(id,goal_id,owner_user_id,run_key,status) VALUES(?,?,?,?,'running')").run('approved-run',schedule.id,owner,'fixture-key');
 const opts={ownerUserId:owner,agentId:agent,scheduledGoalId:schedule.id,scheduledGoalRunId:'approved-run',steps:baseSteps};assert.equal(isApprovedScheduledBaseline(opts),true);
 assert.equal(isApprovedScheduledBaseline({...opts,ownerUserId:'another-owner'}),false);assert.equal(isApprovedScheduledBaseline({...opts,steps:[{type:'agent_continue'}]}),false);assert.equal(isApprovedScheduledBaseline({ownerUserId:owner,agentId:agent,source:'scheduled_goal',steps:baseSteps.map(s=>({...s,quality_checked:true}))}),false);
 const source={evidence_id:'tool-log-actual-source',tool_name:'kanban_get_task',status:'ok',request:{task_id:7},response:{id:7,title:'Submit test report',due_at:'2026-11-01T07:00:00Z'}};
 const prior=[{id:'read',status:'completed',step_type:'agent_tool'},{id:'summary',status:'completed',step_type:'agent_continue'}];
 const sources=boundedSynthesisEvidence(prior,()=>({tool_calls:[source]}));assert.equal(sources.length,1);assert.equal(sources[0].data.result.id,7);
 assert.equal(boundedSynthesisEvidence(prior,()=>({tool_calls:[{...source,tool_name:'agent_goal_status'}]})).length,0);
 assert.equal(boundedSynthesisEvidence(prior,()=>({tool_calls:[{...source,tool_name:'connector_execute_action',request:{action_id:'gmail.create_draft'}}]})).length,0);
 assert.equal(boundedSynthesisEvidence(prior,()=>({tool_calls:[{...source,status:'error'}]})).length,0);
 assert.equal(boundedSynthesisEvidence(prior,()=>({tool_calls:[{...source,response:{truncated:true,summary:'clipped'}}]})).length,0);
 assert.equal(boundedSynthesisEvidence(prior,()=>({tool_calls:[source]}),{maxCharacters:10}).length,0);
 assert.throws(()=>assertSynthesisEvidence([]),e=>e.code==='GOAL_SOURCE_EVIDENCE_REQUIRED');
 const checked=await checkGroundedSynthesis({text:'Task #7: Submit test report.',sources,goal:'List tasks'},async()=>({content:JSON.stringify({approved:true,reason:'Exact task matches',unsupported_claims:[],claims:[{claim:'Submit test report',source_refs:[source.evidence_id]}]})}));assert.equal(checked.approved,true);
 await assert.rejects(()=>checkGroundedSynthesis({text:'Review the quarterly budget.',sources,goal:'Morning digest'},async()=>({content:JSON.stringify({approved:false,reason:'Unrelated task',claims:[],unsupported_claims:['quarterly budget']})})),e=>e.code==='GOAL_SYNTHESIS_UNGROUNDED');
 await assert.rejects(()=>checkGroundedSynthesis({text:'Task #7',sources},async()=>({content:JSON.stringify({approved:true,reason:'OK',claims:[{claim:'Task',source_refs:['fabricated-ref']}],unsupported_claims:[]})})),e=>e.code==='GOAL_SYNTHESIS_UNGROUNDED');
 await assert.rejects(()=>checkGroundedSynthesis({text:'Task',sources},async()=>{throw Error('quota');}),e=>e.code==='GOAL_SYNTHESIS_UNVERIFIED');
 // Evidence is resolved from exact owner/run/step audit rows, not model-cited IDs.
 d.prepare("INSERT INTO content_tool_logs(tool_name,source,request_payload,response_payload,status,owner_user_id,trace_id,goal_step_id) VALUES ('kanban_get_task','fixture','{}',?,'ok',?,?,?)").run(JSON.stringify(source.response),owner,broken.id,broken.steps[0].id);
 assert.equal(listGoalStepToolEvidence({ownerUserId:owner,goalRunId:broken.id,goalStepId:broken.steps[0].id}).tool_calls.length,1);
 assert.equal(listGoalStepToolEvidence({ownerUserId:'other',goalRunId:broken.id,goalStepId:broken.steps[0].id}).tool_calls.length,0);
 assert.equal(listGoalStepToolEvidence({ownerUserId:owner,goalRunId:'other',goalStepId:broken.steps[0].id}).tool_calls.length,0);
 assert.equal(network,0);
 const modelCalls=[];let rejectClaims=false;globalThis.fetch=async(url,init)=>{
  assert.ok(/https:\/\/(?:maker|checker)\.invalid\//.test(String(url)),'Only fake model endpoints are permitted');
  const body=JSON.parse(init.body),checking=body.messages[0].content.includes('factual evidence checker');modelCalls.push({url:String(url),checking});
  const input=checking?JSON.parse(body.messages[1].content):null;
  const text=checking?JSON.stringify(rejectClaims?{approved:false,reason:'No matching source record',claims:[],unsupported_claims:['Invented business task']}:{approved:true,reason:'Actual empty workflow list matches',claims:[{claim:'No published workflows were found.',source_refs:[input.sources[0].ref]}],unsupported_claims:[]}):rejectClaims?'Review the quarterly budget proposal by EOD.':'No published workflows were found.';
  return new Response(JSON.stringify({model:checking?'fixture-checker':'fixture-maker',choices:[{message:{content:text},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}}));
 };
 const grounded=createGoalRun({ownerUserId:owner,agentId:agent,prompt:'Summarize current workflows.',steps:[{type:'agent_tool',tool_name:'agent_workflow_list',label:'Read workflow source',quality_checked:true,step_key:'read'},{type:'agent_continue',label:'Summarize current workflows',quality_checked:true,step_key:'summary',depends_on:['read']}]});
 await startGoalRunExecution(grounded.id,{ownerUserId:owner});for(let i=0;i<250&&!['completed','failed'].includes(getGoalRun(grounded.id,owner).status);i++)await new Promise(r=>setTimeout(r,5));
 const success=getGoalRun(grounded.id,owner);assert.equal(success.status,'completed');assert.equal(success.source_evidence_status,'verified');assert.equal(success.steps[1].result.grounding.approved,true);
 assert.equal(modelCalls.length,2);assert.ok(modelCalls[1].checking);assert.ok(modelCalls[1].url.includes('checker.invalid'));
 rejectClaims=true;
 const rejected=createGoalRun({ownerUserId:owner,agentId:agent,prompt:'Summarize current workflows.',steps:[{type:'agent_tool',tool_name:'agent_workflow_list',label:'Read real source',quality_checked:true,step_key:'read'},{type:'agent_continue',label:'Summarize current workflows',quality_checked:true,step_key:'summary',depends_on:['read']}]});
 await startGoalRunExecution(rejected.id,{ownerUserId:owner});for(let i=0;i<250&&!['completed','failed'].includes(getGoalRun(rejected.id,owner).status);i++)await new Promise(r=>setTimeout(r,5));
 const denied=getGoalRun(rejected.id,owner);assert.equal(denied.status,'failed');assert.equal(denied.source_evidence_status,'unverified');assert.ok(!denied.steps[1].result.reply_preview);assert.ok(!denied.final_outcome.includes('quarterly budget proposal'));assert.equal(modelCalls.length,4,'checker rejection must not start another maker pass');
 console.log('GOAL_DIGEST_GROUNDING_OK: incident blocked before model, unknown types rejected, factual preflight, saved-plan reuse, owner/run isolation, readonly bounded sources, checker failures, plus actual source-read→maker→configured checker→verified completion; zero external network/paid calls');
}finally{globalThis.fetch=originalFetch;d.close();rmSync(dir,{recursive:true,force:true});}
