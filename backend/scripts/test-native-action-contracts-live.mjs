// Operator-only bounded provider tests. Prepare two semantic cases, then run
// one native delivered turn (router + staging = two further invocations).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {getDb} from '../src/db/schema.js';
import {tenantOpenClawAgentId,baseOpenClawAgentIdForAgent} from '../src/services/openclaw-tenant.js';
import {createNativeTestBudget,bindNativeTestBudget} from '../src/services/native-model-budget.js';
import {routeNativeAction} from '../src/services/native-action-contracts.js';
import {createVoiceInvite} from '../src/services/agent-voice-sessions.js';
if(process.env.RUN_LIVE_FLOASSIST_ACTION_TESTS!=='1')throw Error('Explicit operator opt-in required');
const [owner,agentId,reuse]=process.argv.slice(2);if(!owner||!agentId)throw Error('Authorized owner and agent required');
const db=getDb(),agent=db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);assert(agent);
const caller=tenantOpenClawAgentId(owner,baseOpenClawAgentIdForAgent(agent));
const batch=reuse||createNativeTestBudget(owner,agentId,{maxCalls:4,maxTokens:12000,minutes:120},db);
const budget=db.prepare('SELECT * FROM native_model_test_budgets WHERE id=? AND owner_id=? AND agent_id=?').get(batch,owner,agentId);
assert(budget&&budget.max_calls===4&&budget.max_tokens===12000,'preserve the approved cumulative allowance');
console.log(JSON.stringify({batch,max_calls:4,max_tokens:12000,reused:!!reuse}));
let failure;
try{
 const cases=[
  {key:'explicit',request:'Generate a new private voice call link for this assistant.',expected:'execute'},
  {key:'explanation',request:'Why did the earlier private voice call link expire? Explain only; do not generate or renew anything.',expected:'other'},
 ];
 for(const c of cases){
  const session=`agent:${caller}:${batch}-${c.key}`;bindNativeTestBudget(owner,agentId,session,batch,db);
  const r=await routeNativeAction({owner,agent:agentId,session},{caller_agent_id:caller,run_id:batch+'-'+c.key,turn_id:batch+'-'+c.key,context:{current_request:c.request,recent_messages:[{role:'assistant',content:'A previous attempt incorrectly said an external app was not enabled.'}]}});
  console.log(JSON.stringify({case:c.key,decision:r.decision,tool:r.tool_name,status:r.status}));
  assert.equal(r.decision,c.expected);if(c.expected==='execute')assert.equal(r.tool_name,'voice_call_invite');
 }
 const session=`agent:${caller}:${batch}-native`;bindNativeTestBudget(owner,agentId,session,batch,db);
 const old=createVoiceInvite(owner,agentId,{ttlSeconds:600},{now:()=>Date.now()-7200000});
 const messageFile='/tmp/'+batch+'-message.txt';
 writeFileSync(messageFile,'The previous assistant supplied this private call link, which is now expired:\n'+old.url+'\n\nRegenerate a fresh private voice call link for this assistant now.',{mode:0o600});
 console.log(JSON.stringify({batch,caller,session,message_file:messageFile,old_artifact_hash:createHash('sha256').update(JSON.stringify(old.url)).digest('hex'),old_expires_at:old.expires_at,remaining_native_invocations:2}));
}catch(e){failure=e;}finally{
 const rows=db.prepare('SELECT provider,model,status,input_tokens,output_tokens,estimated FROM native_model_calls WHERE test_budget_id=? ORDER BY created_at').all(batch);
 console.log(JSON.stringify({batch,calls:rows.length,metered_tokens:rows.reduce((n,r)=>n+r.input_tokens+r.output_tokens,0),usage:rows}));
}
if(failure)throw failure;
