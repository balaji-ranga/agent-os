// Operator-only synthetic check; never opens a site or sends a message.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getDb} from '../src/db/schema.js';
import {chatCompletions,resolveChatCompletionsConfig} from '../src/config/llm.js';
import {tenantOpenClawAgentId,baseOpenClawAgentIdForAgent} from '../src/services/openclaw-tenant.js';
import {bindNativeTestBudget,admitNativeModel,settleNativeModel} from '../src/services/native-model-budget.js';
import {browserCompletionMessages} from '../src/services/browser-completion-contract.js';
if(process.env.RUN_LIVE_FLOASSIST_INTENT_TESTS!=='1')throw Error('Explicit live-test opt-in required');
const [owner,agentId,budget]=process.argv.slice(2);if(!owner||!agentId||!budget)throw Error('Supply owner, agent and existing cumulative batch ID');
const db=getDb(),agent=db.prepare('SELECT * FROM agents WHERE id=?').get(agentId),caller=tenantOpenClawAgentId(owner,baseOpenClawAgentIdForAgent(agent));
const session='agent:'+caller+':completion-test-'+randomUUID(),run='completion-test-'+randomUUID();bindNativeTestBudget(owner,agentId,session,budget,db);
const requireLinks=process.env.LIVE_BROWSER_REQUIRE_LINKS==='1';
const facts=['A meeting moved to Thursday.','A report is ready for review.','A release shipped today.','A training session starts Monday.','The office will close Friday.'];
const messages=browserCompletionMessages({goal:requireLinks?'Summarize the five visible updates and provide the exact source URL for each update':'Summarize the five visible updates',plan:{completion_evidence:['Require URLs for every item']},snapshot:facts.map((s,i)=>(i+1)+'. '+s).join('\n'),history:[{action:'snapshot',ok:true}],proposedSummary:facts.map((s,i)=>(i+1)+'. '+s+' Source URL not captured.').join('\n')});
const config=await resolveChatCompletionsConfig({ownerUserId:owner});
const call={id:'browser-check-'+randomUUID(),session_key:session,caller_agent_id:caller,run_id:run,provider:'configured-maker',model:config.cfg.primary.model,input_tokens:Math.ceil(JSON.stringify(messages).length/3),output_limit:700};
let admitted,usage=null,verified=false;
try{
 admitted=admitNativeModel(call,{db});
 const response=await chatCompletions({ownerUserId:owner,memberKey:agentId,sessionId:session,runId:run,traceId:call.id,toolName:'browse_task_start',messages,maxTokens:admitted.output_limit,responseFormat:'json_object',thinkingMode:'disabled',timeoutMs:10000});
 usage=response.usage;db.prepare('UPDATE native_model_calls SET model=?,provider=? WHERE id=?').run(response.actualModel||config.cfg.primary.model,response.endpointHost||'configured-maker',call.id);
 const result=JSON.parse(response.content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
 console.log(JSON.stringify({test:requireLinks?'explicitly required source URLs are missing':'generic content summary with uncaptured optional links',satisfied:result.satisfied}));assert.equal(result.satisfied,!requireLinks);verified=true;
}finally{
 if(admitted){const recorded=!!db.prepare('SELECT 1 FROM token_usage WHERE owner_user_id=? AND member_key=? AND trace_id=?').get(owner,agentId,call.id);settleNativeModel({...call,status:verified?'completed':'error',input_tokens:usage?.input_tokens??call.input_tokens,output_tokens:usage?.output_tokens??0,estimated:!usage},{db,usageRecorded:recorded});}
 const rows=db.prepare('SELECT provider,model,status,input_tokens,output_tokens,estimated FROM native_model_calls WHERE test_budget_id=? ORDER BY created_at').all(budget);console.log(JSON.stringify({batch:budget,calls:rows.length,total_tokens:rows.reduce((n,r)=>n+r.input_tokens+r.output_tokens,0),usage:rows}));
 if(rows.length>=db.prepare('SELECT max_calls FROM native_model_test_budgets WHERE id=?').get(budget).max_calls){assert.throws(()=>admitNativeModel({...call,id:'refused-'+randomUUID(),run_id:'refused-'+randomUUID(),input_tokens:10,output_limit:20},{db}),e=>e.code==='native_test_budget_exhausted');console.log('CUMULATIVE_BATCH_REFUSAL_VERIFIED: no further provider submission');}
 db.prepare('DELETE FROM native_model_test_sessions WHERE budget_id=?').run(budget);
}
