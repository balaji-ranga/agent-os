import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {wrapFlolahBudgetStream,nativeUsage} from '../../openclaw-extensions/agent-os-content-tools/model-budget-transport.js';
const root=mkdtempSync(join(tmpdir(),'native-budget-'));
process.env.AGENT_OS_DATA_DIR=join(root,'data');process.env.OPENCLAW_DIR=join(root,'openclaw');
let db;
try{
 const {initDb}=await import('../src/db/schema.js');db=initDb();
 const {initializeFloAssist}=await import('../src/services/floassist/core.js');initializeFloAssist(db);
 const {admitNativeModel,settleNativeModel,createNativeTestBudget,bindNativeTestBudget}=await import('../src/services/native-model-budget.js');
 const {setAgentBudget,getMemberBudgetStatus}=await import('../src/services/agent-budgets.js');
 const {getMonthlyTokens}=await import('../src/services/token-usage.js');
 const {registerOpenClawSessionOwner}=await import('../src/services/tool-owner-scope.js');
 const agent='budget-fixture';let seq=0;
 for(const owner of ['budget-owner','budget-other']){
  db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES (?,?,'fixture',?,'ceo',1)").run(owner,owner+'@example.test',owner);
 }
 db.prepare('INSERT INTO agents(id,name,openclaw_agent_id) VALUES (?,?,?)').run(agent,agent,agent);
 for(const owner of ['budget-owner','budget-other']){
  db.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES (?,?,1)').run(owner,agent);
  db.prepare("INSERT INTO floassist_profiles(owner_id,agent_id,phone,status,preferences_json,consent_json,created_at,updated_at) VALUES (?,?,'+6580000000','active',?,'{}',0,0)").run(owner,agent,JSON.stringify({model_call_budget:80,model_token_budget:2000000}));
 }
 const call=(owner='budget-owner',run='turn')=>({id:'fixture-call-'+(++seq),session_key:`agent:t-${owner}--${agent}:whatsapp:fixture`,caller_agent_id:`t-${owner}--${agent}`,run_id:run,provider:'fixture',model:'fixture-model',input_tokens:200,output_limit:3000});
 const finish=(c,extra={})=>settleNativeModel({...c,status:'completed',input_tokens:200,output_tokens:10,estimated:false,...extra});
 setAgentBudget('budget-owner',agent,{monthly_token_budget:5000});
 const first=call(),second=call();assert.equal(admitNativeModel(first).output_limit,3000);assert.equal(admitNativeModel(second).output_limit,1600);
 assert.throws(()=>admitNativeModel(call()),e=>e.code==='native_model_token_budget','parallel reservations cannot overspend the monthly allowance');
 finish(first);finish(first);assert.equal(getMonthlyTokens('budget-owner',agent).total_tokens,210,'settlement retries are idempotent');
 finish(second,{output_tokens:20,estimated:true});assert.equal(getMonthlyTokens('budget-owner',agent).total_tokens,430);
 finish(second,{input_tokens:100,output_tokens:5,estimated:false});assert.equal(getMonthlyTokens('budget-owner',agent).total_tokens,315,'late reported usage replaces its estimate rather than adding spend');
 assert.throws(()=>settleNativeModel({...call('budget-other'),id:first.id,status:'completed',input_tokens:1,output_tokens:1,estimated:false}),e=>e.status===403);
 setAgentBudget('budget-owner',agent,{monthly_token_budget:null});
 db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify({model_call_budget:2,model_token_budget:2000000}),'budget-owner');
 for(let i=0;i<2;i++){const c=call('budget-owner','limited');admitNativeModel(c);finish(c);}
 assert.throws(()=>admitNativeModel(call('budget-owner','limited:compaction:fixture')),e=>e.code==='native_model_call_budget','compaction shares the parent turn budget');
 const scheduled=call('budget-owner','native-one');registerOpenClawSessionOwner(scheduled.session_key,'budget-owner',null,'schedule',{scheduled_goal_run_id:'scheduled-fixture'});
 admitNativeModel(scheduled);finish(scheduled);const fallback={...call('budget-owner','native-fallback')};admitNativeModel(fallback);finish(fallback);
 assert.throws(()=>admitNativeModel(call('budget-owner','native-three')),e=>e.code==='native_model_call_budget','scheduled continuations and fallbacks share one budget');
 scheduled.session_key=scheduled.session_key+'-adhoc';registerOpenClawSessionOwner(scheduled.session_key,'budget-owner',null,'whatsapp',{});
 db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify({model_call_budget:80,model_token_budget:2000000}),'budget-owner');
 let upstream=0;const chunks=[{type:'text_delta',delta:'hello'},{type:'done',message:{content:[{type:'text',text:'hello'}],usage:{input:10,cacheRead:20,cacheWrite:5,output:3}}}];
 const transport=async(op,body)=>op==='admit'?admitNativeModel(body):settleNativeModel(body);
 const wrap=wrapFlolahBudgetStream(async()=>{upstream++;return {[Symbol.asyncIterator]:async function*(){yield* chunks;},result:async()=>chunks.at(-1).message};},{sessionKey:scheduled.session_key,runId:'stream',model:'fixture-model'},{transport,uuid:()=>String(++seq).padStart(10,'0')});
 const stream=await wrap({maxTokens:100},{messages:[{role:'user',content:'private body'}]});const emitted=[];for await(const chunk of stream)emitted.push(chunk);await stream.result();
 assert.deepEqual(emitted,chunks,'all tool/text/usage stream chunks preserved');assert.equal(upstream,1);
 const row=db.prepare("SELECT * FROM native_model_calls WHERE run_key='stream'").get();assert.equal(row.input_tokens,35);assert.equal(row.output_tokens,3);assert.equal(row.estimated,0);
 const denied=wrapFlolahBudgetStream(()=>{upstream++;},{sessionKey:scheduled.session_key,runId:'blocked'},{transport:async()=>{throw Error('budget stopped');}});
 await assert.rejects(denied({maxTokens:100},{messages:[]}));assert.equal(upstream,1,'admission refusal makes no provider request');
 assert.deepEqual(nativeUsage({usage:{prompt_tokens:100,completion_tokens:4,prompt_tokens_details:{cached_tokens:80}}}),{input_tokens:100,output_tokens:4},'OpenAI cached tokens not double counted');
 assert.equal(nativeUsage({usage:{input:0,output:0}}),null,'missing native usage must fall back to an explicit estimate');
 const batch=createNativeTestBudget('budget-owner',agent,{maxCalls:2,maxTokens:10000});
 for(let i=0;i<2;i++){const c=call('budget-owner','test-run-'+i);c.session_key+='-test-'+i;bindNativeTestBudget('budget-owner',agent,c.session_key,batch);admitNativeModel(c);finish(c);}
 const nextTest=call('budget-owner','another-test-run');nextTest.session_key+='-test-next';bindNativeTestBudget('budget-owner',agent,nextTest.session_key,batch);
 assert.throws(()=>admitNativeModel(nextTest),e=>e.code==='native_test_budget_exhausted','live test budget spans multiple goal runs and sessions');
 assert.throws(()=>bindNativeTestBudget('budget-other',agent,nextTest.session_key,batch),e=>e.status===403);
 const stale=call('budget-owner','crash-recovery');stale.session_key+='-stale';admitNativeModel(stale,{now:Date.now()-31*60000});const recoveryTrigger=call('budget-owner','after-recovery');recoveryTrigger.session_key+='-recovery';admitNativeModel(recoveryTrigger);finish(recoveryTrigger);
 assert.equal(db.prepare('SELECT estimated FROM native_model_calls WHERE id=?').get(stale.id).estimated,1);assert.equal(db.prepare('SELECT count(*) n FROM token_usage WHERE trace_id=?').get(stale.id).n,1);
 finish(stale,{input_tokens:10,output_tokens:1,estimated:false});assert.equal(db.prepare('SELECT total_tokens FROM token_usage WHERE trace_id=?').get(stale.id).total_tokens,11,'late actual usage replaces conservative crash recovery');
 setAgentBudget('budget-other',agent,{error_budget_pct:50});
 for(let i=0;i<10;i++){const c=call('budget-other','error-'+i);admitNativeModel(c);finish(c,{status:'error',output_tokens:0,estimated:true});}
 assert.equal(getMemberBudgetStatus('budget-other',agent).state,'blocked');
 assert.throws(()=>admitNativeModel(call('budget-other','after-errors')),e=>e.code==='budget_exceeded');
 const before=db.prepare('SELECT count(*) n FROM native_model_calls').get().n;
 assert.throws(()=>admitNativeModel({...call(),caller_agent_id:'t-budget-other--'+agent}),e=>e.status===403);assert.equal(db.prepare('SELECT count(*) n FROM native_model_calls').get().n,before);
 console.log('NATIVE_MODEL_BUDGET_OK: monthly reservations, once-only accounting, cache tokens, owner isolation, compaction/fallback/run caps, error budgets and transparent streaming');
}finally{try{db?.close();}catch{}rmSync(root,{recursive:true,force:true});}
