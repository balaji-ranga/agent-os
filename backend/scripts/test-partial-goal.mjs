import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'partial-goal-'));process.env.AGENT_OS_DATA_DIR=dir;
const originalFetch=globalThis.fetch;let networkCalls=0;
globalThis.fetch=async()=>{networkCalls++;throw new Error('Unexpected network/model request');};
const {getDb}=await import('../src/db/schema.js');
const {resolvePartialGoal,promptRequestsPartialGoal}=await import('../src/services/goal-failure-mode.js');
const {ensureAgentGoalRunTables,createGoalPlanningRun,createGoalRun,getGoalRun,completeGoalStep,startGoalRunExecution,retryGoalRun,terminalGoalStatusFromSteps}=await import('../src/services/agent-goal-run.js');
const {createScheduledGoal,updateScheduledGoal,getScheduledGoal}=await import('../src/services/scheduled-goals.js');
const {upsertExceptionPolicy}=await import('../src/services/exception-policy.js');
ensureAgentGoalRunTables();const db=getDb(),owner='partial-owner',agent='partial-coo';
db.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)').run(owner,'partial@example.test','x','Partial test','ceo');
db.prepare('INSERT INTO agents(id,name,role,is_coo,owner_user_id) VALUES(?,?,?,?,?)').run(agent,'Partial COO','COO',1,owner);
db.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)').run(owner,agent);
upsertExceptionPolicy(owner,{retry_limit:0,create_kanban:false,agent_pickup:false});
const quietContext={coo_completion_nudge_at:new Date().toISOString()};
const steps=[
 {type:'agent_tool',label:'Controlled missing tool',step_key:'failure',quality_checked:true},
 {type:'agent_tool',label:'Independent local workflow read',tool_name:'agent_workflow_list',step_key:'read',quality_checked:true,depends_on:['failure']},
 {type:'agent_tool',label:'Missing required artifact',tool_name:'agent_workflow_list',step_key:'dependent',quality_checked:true,depends_on:['failure'],required_inputs:[{key:'document',kind:'artifact',source_step_key:'failure',required:true}]},
 {type:'agent_tool',label:'Final independent local read',tool_name:'agent_workflow_list',step_key:'last',quality_checked:true,depends_on:['dependent']},
];
try {
 for(const text of ['Continue remaining steps even if a step fails.','Proceed steps irrespective of any step failure.','Allow partial success.','Do not halt the whole goal if a step fails.','Continue on any step failure.'])assert.equal(promptRequestsPartialGoal(text),true,text);
 for(const text of ['Summarize my inbox.','Do not continue after any step failure.','Stop on the first step failure.','Allow partial success, but stop on any step failure.'])assert.equal(promptRequestsPartialGoal(text),false,text);
 assert.equal(resolvePartialGoal(false,'Allow partial success.'),false);assert.throws(()=>resolvePartialGoal('true'),e=>e.status===400);
 const planning=createGoalPlanningRun({ownerUserId:owner,agentId:agent,prompt:'Allow partial success.',context:quietContext});assert.equal(planning.partial_goal,true);
 const ordinary=createGoalPlanningRun({ownerUserId:owner,agentId:agent,prompt:'Same request',context:quietContext});
 const distinct=createGoalPlanningRun({ownerUserId:owner,agentId:agent,prompt:'Same request',context:{...quietContext,partial_goal:true}});assert.notEqual(ordinary.id,distinct.id,'dedupe must retain execution preference');
 const create=(partial,prompt='Local acceptance checks',extra={})=>createGoalRun({ownerUserId:owner,agentId:agent,prompt,steps,partial_goal:partial,context:quietContext,...extra});
 const enabled=create(true);const output=await startGoalRunExecution(enabled.id,{ownerUserId:owner});
 assert.equal(output.goal.status,'partial_success');assert.deepEqual(output.goal.steps.map(s=>s.status),['failed','completed','failed','completed']);
 assert.match(output.goal.steps[0].error_message,/tool_name/);assert.match(output.goal.steps[2].error_message,/Required input/);assert.match(output.goal.final_outcome,/Gaps/);
 assert.equal(output.goal.steps[1].result.tool_name,'agent_workflow_list');assert.equal(output.goal.steps[3].result.tool_name,'agent_workflow_list');
 const disabled=create(false);await startGoalRunExecution(disabled.id,{ownerUserId:owner});assert.deepEqual(getGoalRun(disabled.id,owner).steps.map(s=>s.status),['failed','pending','pending','pending']);
 const instructed=create(undefined,'Continue remaining steps even if a step fails.');await startGoalRunExecution(instructed.id,{ownerUserId:owner});assert.equal(getGoalRun(instructed.id,owner).status,'partial_success');
 assert.equal(terminalGoalStatusFromSteps([{status:'failed'},{status:'failed'}]),'failed');assert.equal(terminalGoalStatusFromSteps([{status:'completed'}]),'completed');
 const failedLast=create(true,'Last step failure',{steps:[steps[1],steps[0]].map(s=>({...s,depends_on:[]}))});
 const failedLastResult=await startGoalRunExecution(failedLast.id,{ownerUserId:owner});assert.equal(failedLastResult.ok,true);assert.equal(failedLastResult.goal.status,'partial_success');
 const allFailed=create(true,'No successful steps',{steps:[steps[0]]});await startGoalRunExecution(allFailed.id,{ownerUserId:owner});assert.equal(getGoalRun(allFailed.id,owner).status,'failed');
 const retry=create(true);upsertExceptionPolicy(owner,{retry_limit:1,create_kanban:false,agent_pickup:false});
 const retried=completeGoalStep({goalRunId:retry.id,stepId:retry.steps[0].id,ownerUserId:owner,failed:true,error:'temporary timeout'});assert.equal(retried.decision.action,'retry');assert.equal(retried.goal.steps[0].status,'pending');
 upsertExceptionPolicy(owner,{retry_limit:0,create_kanban:false,agent_pickup:false});
 assert.throws(()=>completeGoalStep({goalRunId:retry.id,stepId:retry.steps[0].id,ownerUserId:'other',failed:true,error:'x'}),e=>e.status===404);
 const denied=completeGoalStep({goalRunId:retry.id,stepId:retry.steps[0].id,ownerUserId:owner,failed:true,error:'Policy denied',result:{policy_denied:true}});assert.equal(denied.continued_after_failure,true);assert.equal(denied.goal.steps[0].status,'failed');
 const late=completeGoalStep({goalRunId:enabled.id,stepId:enabled.steps[0].id,ownerUserId:owner,result:{ok:true}});assert.equal(late.skipped,true);assert.equal(late.goal.steps[0].status,'failed');
 const schedule=await createScheduledGoal(owner,{agent_id:agent,title:'Partial acceptance',prompt:'Local checks',execution_mode:'goal_plan',partial_goal:true,cadence:'daily',time_local:'12:00',plan:{steps},approve_plan:false});
 assert.equal(schedule.partial_goal,true);assert.equal(getScheduledGoal(owner,schedule.id).partial_goal,true);
 const baseline=JSON.stringify(schedule.plan);updateScheduledGoal(owner,schedule.id,{partial_goal:false});assert.equal(JSON.stringify(getScheduledGoal(owner,schedule.id).plan),baseline,'toggling must retain saved plan');
 updateScheduledGoal(owner,schedule.id,{partial_goal:true});assert.throws(()=>updateScheduledGoal(owner,schedule.id,{partial_goal:'yes'}),e=>e.status===400);
 await assert.rejects(()=>createScheduledGoal(owner,{agent_id:agent,prompt:'x',execution_mode:'direct_agent',partial_goal:true}),e=>e.status===400);
 const runId='partial-scheduled-run',key='fixture-key';db.prepare("INSERT INTO scheduled_goal_runs(id,goal_id,owner_user_id,run_key,status,agent_id) VALUES(?,?,?,?,'running',?)").run(runId,schedule.id,owner,key,agent);
 db.prepare("UPDATE scheduled_goals SET last_run_key=?,last_run_status='running' WHERE id=?").run(key,schedule.id);
 const scheduled=create(true,'Scheduled acceptance',{scheduledGoalId:schedule.id,scheduledGoalRunId:runId});await startGoalRunExecution(scheduled.id,{ownerUserId:owner});
 const history=db.prepare('SELECT * FROM scheduled_goal_runs WHERE id=?').get(runId);assert.equal(history.status,'partial');assert.match(history.reply_preview,/2\/4 steps completed/);assert.equal(getScheduledGoal(owner,schedule.id).last_run_status,'partial');
 const oldSuccessIds=output.goal.steps.filter(s=>s.status==='completed').map(s=>s.id);
 const retryPartial=await retryGoalRun(enabled.id,owner,{executeGoal:async()=>({ok:true})});
 assert.deepEqual(retryPartial.goal.steps.filter(s=>s.status==='completed').map(s=>s.id),oldSuccessIds,'retry must not repeat successful later actions');
 assert.deepEqual(retryPartial.goal.steps.map(s=>s.status),['pending','completed','pending','completed']);
 await new Promise(r=>setTimeout(r,20));assert.equal(networkCalls,0);
 console.log('PARTIAL_GOAL_OK: real execution continues failures, retains errors, guards required inputs, retries/policies/owner boundaries, ad hoc directives, opt-out defaults, saved-plan toggle and partial scheduled history; zero model/network calls');
} finally {globalThis.fetch=originalFetch;db.close();rmSync(dir,{recursive:true,force:true});}
