import assert from 'node:assert/strict';
import {withExecutionFetchBudget,remainingFetchTime,assertFetchDelayFits,goalWorkFetchBudget,toolWorkFetchBudget} from '../src/services/execution-fetch-budget.js';
import {DatabaseSync} from 'node:sqlite';
import {retryConnectorRead} from '../src/services/connector-execution-policy.js';
assert.equal(remainingFetchTime(60000,1000,{fetch_deadline_at:4500}),3500);
assert.equal(remainingFetchTime(60000,1000,null),60000);
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE scheduled_goal_runs(id TEXT,owner_user_id TEXT,created_at TEXT);
CREATE TABLE agent_goal_runs(id TEXT,owner_user_id TEXT,scheduled_goal_run_id TEXT,created_at TEXT);
CREATE TABLE agent_goal_steps(id TEXT,goal_run_id TEXT,started_at TEXT,child_workflow_run_id INTEGER);
INSERT INTO scheduled_goal_runs VALUES('schedule','owner','2026-11-11 01:00:00');
INSERT INTO agent_goal_runs VALUES('goal','owner','schedule','2026-11-11 01:01:00');
INSERT INTO agent_goal_steps VALUES('step','goal','2026-11-11 01:02:00',42);`);
const expected=Date.parse('2026-11-11T01:04:00Z');
assert.equal(goalWorkFetchBudget(db,'owner',{scheduled_goal_run_id:'schedule'},240000).fetch_deadline_at,expected);
assert.equal(goalWorkFetchBudget(db,'owner',{goal_run_id:'goal',goal_step_id:'step'},240000).fetch_deadline_at,expected);
assert.equal(goalWorkFetchBudget(db,'owner',{goal_run_id:'goal'},240000).fetch_deadline_at,expected,'goal-level work shares its parent deadline before a step is assigned');
assert.equal(goalWorkFetchBudget(db,'owner',{workflow_run_id:42},240000).fetch_deadline_at,expected,'child workflow inherits schedule cutoff, not a new window');
assert.equal(goalWorkFetchBudget(db,'other',{workflow_run_id:42},240000),null);
assert.throws(()=>remainingFetchTime(60000,Date.now(),goalWorkFetchBudget(db,'other',{scheduled_goal_run_id:'schedule'},240000)),{code:'EXECUTION_FETCH_DEADLINE'});
db.exec("INSERT INTO agent_goal_runs VALUES('adhoc','owner',NULL,'2026-11-11 01:00:00'); INSERT INTO agent_goal_steps VALUES('late-step','adhoc','2026-11-11 01:03:00',43)");
assert.equal(goalWorkFetchBudget(db,'owner',{goal_run_id:'adhoc',goal_step_id:'late-step'},240000).fetch_deadline_at,expected,'later goal steps do not reset the goal fetch deadline');
assert.equal(goalWorkFetchBudget(db,'owner',{workflow_run_id:43},240000).fetch_deadline_at,expected);
const turn={owner:'owner',agent:'employee',runId:'turn-one',session:'conversation'};
assert.equal(toolWorkFetchBudget(db,turn,4000,1000).fetch_deadline_at,5000);
assert.equal(toolWorkFetchBudget(db,turn,4000,3000).fetch_deadline_at,5000,'later tools and retries cannot restart the turn window');
assert.throws(()=>remainingFetchTime(60000,6000,toolWorkFetchBudget(db,turn,4000,6000)),{code:'EXECUTION_FETCH_DEADLINE'});
assert.equal(toolWorkFetchBudget(db,{...turn,runId:'turn-two'},4000,6000).fetch_deadline_at,10000);
assert.equal(toolWorkFetchBudget(db,{...turn,owner:'another'},4000,6000).fetch_deadline_at,10000);
assert.equal(toolWorkFetchBudget(db,{...turn,runId:'child',context:{fetch_deadline_at:4500}},4000,3000).fetch_deadline_at,4500,'inherited parent deadline wins');
db.close();
assert.throws(()=>remainingFetchTime(60000,4500,{fetch_deadline_at:4500}),{code:'EXECUTION_FETCH_DEADLINE'});
await withExecutionFetchBudget({fetch_deadline_at:Date.now()+1000},async()=>{
  assert.throws(()=>assertFetchDelayFits(60000),{code:'EXECUTION_FETCH_DEADLINE'});
  let calls=0,sleeps=0;
  await assert.rejects(retryConnectorRead(async()=>{calls++;throw Object.assign(new Error('quota'),{code:'rate_limited'});},{readOnly:true,sleep:async()=>sleeps++}),{code:'EXECUTION_FETCH_DEADLINE'});
  assert.equal(calls,1);assert.equal(sleeps,0);
  await Promise.resolve();
  assert.ok(remainingFetchTime(60000)<=1000);
});
assert.equal(remainingFetchTime(60000),60000);
await Promise.all([withExecutionFetchBudget({fetch_deadline_at:1},async()=>{
  await Promise.resolve();assert.throws(()=>remainingFetchTime(60000),{code:'EXECUTION_FETCH_DEADLINE'});
}),withExecutionFetchBudget(null,async()=>{await Promise.resolve();assert.equal(remainingFetchTime(60000),60000);})]);
console.log('FETCH_BUDGET_OK: shared deadline, retry refusal, async propagation and concurrent scope isolation');
const {createServer}=await import('node:http');
let disconnected=false;
const server=createServer((req,res)=>{req.on('close',()=>{disconnected=true;});res.writeHead(200,{'Content-Type':'application/json'});res.write('{');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try {
  await withExecutionFetchBudget({fetch_deadline_at:Date.now()+100},async()=>{
    await assert.rejects(async()=>{
      const response=await fetch(`http://127.0.0.1:${server.address().port}`,{signal:AbortSignal.timeout(remainingFetchTime(60000))});
      await response.json();
    },error=>['AbortError','TimeoutError'].includes(error.name));
  });
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(disconnected,true);
} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
console.log('FETCH_ABORT_OK: deadline closes an in-progress HTTP body, not just the caller wait');
