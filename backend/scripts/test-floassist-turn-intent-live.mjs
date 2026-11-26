// Explicit operator-only semantic test. No mailbox reads, goal runs or sends.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getDb} from '../src/db/schema.js';
import {tenantOpenClawAgentId,baseOpenClawAgentIdForAgent} from '../src/services/openclaw-tenant.js';
import {createNativeTestBudget,bindNativeTestBudget,admitNativeModel} from '../src/services/native-model-budget.js';
import {resolveFloAssistTurnIntent} from '../src/services/floassist/turn-intent.js';
if(process.env.RUN_LIVE_FLOASSIST_INTENT_TESTS!=='1')throw Error('Explicit live-test opt-in required');
const [owner,agentId,reuseBudget]=process.argv.slice(2);if(!owner||!agentId)throw Error('Supply authorized owner and agent IDs');
const db=getDb(),agent=db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);assert.ok(agent);
const caller=tenantOpenClawAgentId(owner,baseOpenClawAgentIdForAgent(agent));
const budget=reuseBudget||createNativeTestBudget(owner,agentId,{maxCalls:3,maxTokens:20000,minutes:30},db);
console.log(JSON.stringify({batch:budget,max_calls:3,max_tokens:20000,reused:!!reuseBudget}));
const original="Check my gmail for today's emails snd summarize any important";
const cases=[
 {name:'explicit WhatsApp reply retry',context:{current_request:'Retry',reply_to:{message_id:'fixture-message',missing:false,target:{role:'user',content:original}},recent_messages:[{role:'user',content:'What is the weather?'},{role:'assistant',content:'I could run Morning Briefing instead.'}]},expected:'source_review'},
 {name:'misspelled mailbox summary',context:{current_request:"I need a sunarized view of today's Gmail emails",recent_messages:[]},expected:'source_review'},
 {name:'explicit saved responsibility',context:{current_request:'Please run the saved Morning Briefing now.',recent_messages:[]},expected:'schedule_run'},
];
let failure;
try{
 for(const test of cases){
  const session='agent:'+caller+':intent-test-'+randomUUID();bindNativeTestBudget(owner,agentId,session,budget,db);
  const result=await resolveFloAssistTurnIntent({owner,agent:agentId,session},{session_key:session,caller_agent_id:caller,run_id:'intent-test-'+randomUUID(),context:test.context},{db});
  console.log(JSON.stringify({case:test.name,mode:result.mode,app_id:result.app_id,whole_period:result.whole_period,relative_day:result.relative_day,verification_failed:result.verification_failed||false}));
  assert.equal(result.mode,test.expected);
  if(test.expected==='source_review'){assert.equal(result.app_id,'gmail');assert.equal(result.whole_period,true);assert.equal(result.relative_day,'today');}
 }
 const refusalSession='agent:'+caller+':intent-refusal-'+randomUUID();bindNativeTestBudget(owner,agentId,refusalSession,budget,db);
 assert.throws(()=>admitNativeModel({id:'refusal-'+randomUUID(),session_key:refusalSession,caller_agent_id:caller,run_id:'refusal-'+randomUUID(),provider:'not-submitted',model:'not-submitted',input_tokens:10,output_limit:20},{db}),e=>e.code==='native_test_budget_exhausted');
 console.log('LIVE_CONTEXTUAL_INTENT_OK: three configured-checker decisions, correct reply target, no keyword routing; fourth provider submission refused');
}catch(e){failure=e;}finally{
 const usage=db.prepare('SELECT id,provider,model,status,input_tokens,output_tokens,estimated FROM native_model_calls WHERE test_budget_id=? ORDER BY created_at').all(budget);
 console.log(JSON.stringify({batch:budget,calls:usage.length,total_tokens:usage.reduce((n,r)=>n+r.input_tokens+r.output_tokens,0),usage}));
 db.prepare('DELETE FROM native_model_test_sessions WHERE budget_id=?').run(budget);
}
if(failure)throw failure;
