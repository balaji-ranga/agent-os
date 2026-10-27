// Native model admission/settlement. Only numeric telemetry crosses this boundary.
import {getDb} from '../db/schema.js';
import {enforceBudget,getAgentBudget} from './agent-budgets.js';
import {getMonthlyTokens,monthPeriod,recordTokenUsage} from './token-usage.js';
import {parseTenantOpenClawAgentId,resolveAgentFromOpenClawCallerId} from './openclaw-tenant.js';
import {lookupSessionExecutionContext} from './tool-owner-scope.js';
import {resolveFloAssistScope} from './floassist/execution-scope.js';
import {randomUUID} from 'node:crypto';
const ensured=new WeakSet();
export function ensureNativeModelBudget(db=getDb()){
 if(ensured.has(db))return;
 db.exec(`CREATE TABLE IF NOT EXISTS native_model_calls(
 id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,agent_id TEXT NOT NULL,session_key TEXT NOT NULL,run_key TEXT NOT NULL,
 scheduled_run_id TEXT,provider TEXT,model TEXT,status TEXT NOT NULL,input_tokens INTEGER NOT NULL DEFAULT 0,
 output_tokens INTEGER NOT NULL DEFAULT 0,estimated INTEGER NOT NULL DEFAULT 1,reserved_tokens INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,test_budget_id TEXT);
 CREATE TABLE IF NOT EXISTS native_model_test_budgets(id TEXT PRIMARY KEY,owner_id TEXT,agent_id TEXT,max_calls INTEGER,max_tokens INTEGER,expires_at INTEGER);
 CREATE TABLE IF NOT EXISTS native_model_test_sessions(session_key TEXT PRIMARY KEY,budget_id TEXT);
 CREATE INDEX IF NOT EXISTS native_model_calls_run ON native_model_calls(owner_id,agent_id,run_key);
 CREATE INDEX IF NOT EXISTS native_model_calls_owner ON native_model_calls(owner_id,created_at);`);
 ensured.add(db);
}
export function createNativeTestBudget(owner,agent,{maxCalls=10,maxTokens=200000,minutes=30}={},db=getDb()){
 ensureNativeModelBudget(db);
 if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>80||!Number.isInteger(maxTokens)||maxTokens<1000||maxTokens>2000000||!Number.isInteger(minutes)||minutes<1||minutes>120)fail(400,'native_test_budget_invalid','Supply a bounded live test allowance.');
 const id='nmt-'+randomUUID();db.prepare('INSERT INTO native_model_test_budgets VALUES (?,?,?,?,?,?)').run(id,owner,agent,maxCalls,maxTokens,Date.now()+minutes*60000);return id;
}
export function bindNativeTestBudget(owner,agent,session,id,db=getDb()){
 ensureNativeModelBudget(db);const budget=db.prepare('SELECT * FROM native_model_test_budgets WHERE id=? AND owner_id=? AND agent_id=?').get(id,owner,agent);
 if(!budget||budget.expires_at<=Date.now())fail(403,'native_test_budget_invalid','An active owner/agent live test budget is required.');
 db.prepare('INSERT OR REPLACE INTO native_model_test_sessions VALUES (?,?)').run(session,id);
}
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function nativeModelIdentity(input,db=getDb()){
 const match=String(input.session_key||'').match(/^agent::?([^:]+):/),tenant=parseTenantOpenClawAgentId(match?.[1]);
 if(!tenant||input.caller_agent_id&&input.caller_agent_id!==match[1])fail(403,'native_owner_invalid','A tenant-bound native session is required.');
 const agent=resolveAgentFromOpenClawCallerId(match[1]);
 if(!agent||!db.prepare('SELECT 1 FROM user_agents WHERE user_id=? AND agent_id=? AND enabled=1').get(tenant.ceoUserId,agent.id))fail(403,'native_owner_invalid','The owner does not have this agent enabled.');
 return {owner:tenant.ceoUserId,agent:agent.id,session:String(input.session_key)};
}
function integer(value,max=100000000){return Number.isSafeInteger(value)&&value>=0&&value<=max;}
function recoverStaleReservations(db,identity,now){
 // Crash recovery is conservative: unknown terminal usage retains the full
 // admitted allowance as estimated usage, rather than silently erasing spend.
 for(const call of db.prepare("SELECT * FROM native_model_calls WHERE owner_id=? AND agent_id=? AND status='started' AND updated_at<?").all(identity.owner,identity.agent,now-30*60000)){
  db.prepare("UPDATE native_model_calls SET status='error',output_tokens=?,estimated=1,reserved_tokens=0,updated_at=? WHERE id=?").run(Math.max(0,call.reserved_tokens-call.input_tokens),now,call.id);
  if(!recordTokenUsage(identity.owner,{memberKey:identity.agent,agentId:identity.agent,source:'native_model_recovery',modelId:call.model,inputTokens:call.input_tokens,outputTokens:Math.max(0,call.reserved_tokens-call.input_tokens),estimated:true,sessionId:call.session_key,runId:call.scheduled_run_id||call.run_key,traceId:call.id}))throw Error('Native recovery usage ledger write failed.');
 }
}
export function admitNativeModel(input,{db=getDb(),now=Date.now()}={}){
 ensureNativeModelBudget(db);const identity=nativeModelIdentity(input,db);
 if(!/^[a-zA-Z0-9:_-]{8,160}$/.test(input.id||'')||!input.run_id||String(input.run_id).length>200||!integer(input.input_tokens)||!integer(input.output_limit,1000000)||!input.output_limit)fail(400,'native_budget_input','Valid call identity and bounded numeric token estimates are required.');
 db.transaction(()=>recoverStaleReservations(db,identity,now))();
 return db.transaction(()=>{
  const prior=db.prepare('SELECT * FROM native_model_calls WHERE id=?').get(input.id);
  if(prior){if(prior.owner_id!==identity.owner||prior.agent_id!==identity.agent||prior.session_key!==identity.session)fail(403,'native_call_conflict','Call identity belongs to another owner/session.');if(prior.status!=='started')fail(409,'native_call_settled','This model call has already settled.');return {allowed:true,id:prior.id,output_limit:prior.reserved_tokens-prior.input_tokens};}
  const budget=enforceBudget(identity.owner,identity.agent,{action:'native_model'});
  if(budget.error)fail(503,'native_budget_unavailable','Native budget status is unavailable; no model request was started.');
  const prefsRow=db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_profiles'").get()?db.prepare("SELECT preferences_json FROM floassist_profiles WHERE owner_id=? AND agent_id=? AND status='active'").get(identity.owner,identity.agent):null;
  const prefs=JSON.parse(prefsRow?.preferences_json||'{}');
  const context=lookupSessionExecutionContext(identity.session,identity.owner)||{};
  const persisted=resolveFloAssistScope(db,identity.owner,identity.agent,{session_key:identity.session},'web');
  const scheduledRun=context.scheduled_goal_run_id||persisted?.run;
  const runKey=String(scheduledRun||String(input.run_id).split(':compaction:')[0]);
  // Include compaction/fallback requests in the scheduled run, not a new allowance.
  const sums=db.prepare("SELECT count(*) calls,COALESCE(sum(CASE WHEN status='started' THEN reserved_tokens ELSE input_tokens+output_tokens END),0) tokens FROM native_model_calls WHERE owner_id=? AND agent_id=? AND run_key=?").get(identity.owner,identity.agent,runKey);
  const callLimit=prefsRow?(prefs.model_call_budget??80):null,tokenLimit=prefsRow?(prefs.model_token_budget??2000000):null;
  if(callLimit&&sums.calls>=callLimit)fail(429,'native_model_call_budget','Model-call limit reached for this request; remaining source coverage is incomplete.');
  let remaining=tokenLimit?tokenLimit-sums.tokens:Infinity;
  const testBudget=db.prepare('SELECT b.* FROM native_model_test_budgets b JOIN native_model_test_sessions s ON s.budget_id=b.id WHERE s.session_key=? AND b.owner_id=? AND b.agent_id=?').get(identity.session,identity.owner,identity.agent);
  if(testBudget){
   const testUsed=db.prepare("SELECT count(*) calls,COALESCE(sum(CASE WHEN status='started' THEN reserved_tokens ELSE input_tokens+output_tokens END),0) tokens FROM native_model_calls WHERE test_budget_id=?").get(testBudget.id);
   if(testBudget.expires_at<=now||testUsed.calls>=testBudget.max_calls)fail(429,'native_test_budget_exhausted','Live test model-call allowance exhausted or expired; no further model call was started.');
   remaining=Math.min(remaining,testBudget.max_tokens-testUsed.tokens);
  }
  const monthly=getAgentBudget(identity.owner,identity.agent),period=monthPeriod();
  if(monthly?.monthly_token_budget){
   const used=getMonthlyTokens(identity.owner,identity.agent,period).total_tokens;
   const reserved=db.prepare("SELECT COALESCE(sum(reserved_tokens),0) n FROM native_model_calls WHERE owner_id=? AND agent_id=? AND status='started'").get(identity.owner,identity.agent).n;
   remaining=Math.min(remaining,monthly.monthly_token_budget-used-reserved);
  }
  const outputLimit=Math.min(input.output_limit,remaining-input.input_tokens);
  if(outputLimit<1)fail(429,'native_model_token_budget','Token budget reached for this request or owner; no further model request was started.');
  db.prepare('INSERT INTO native_model_calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(input.id,identity.owner,identity.agent,identity.session,runKey,scheduledRun||null,String(input.provider||'').slice(0,160),String(input.model||'').slice(0,160),'started',input.input_tokens,0,1,input.input_tokens+outputLimit,now,now,testBudget?.id||null);
  return {allowed:true,id:input.id,output_limit:outputLimit};
 })();
}
export function settleNativeModel(input,{db=getDb(),now=Date.now()}={}){
 ensureNativeModelBudget(db);const identity=nativeModelIdentity(input,db);
 if(!integer(input.input_tokens)||!integer(input.output_tokens)||!['completed','error','cancelled'].includes(input.status)||typeof input.estimated!=='boolean')fail(400,'native_budget_input','Bounded numeric usage and a terminal status are required.');
 return db.transaction(()=>{
  const call=db.prepare('SELECT * FROM native_model_calls WHERE id=?').get(input.id);
  if(!call||call.owner_id!==identity.owner||call.agent_id!==identity.agent||call.session_key!==identity.session)fail(403,'native_call_conflict','No matching owner/session admission.');
  if(call.status!=='started'){
   if(call.estimated&&!input.estimated){
    // A late final usage report replaces its estimate, never adds another row.
    const amended=db.prepare("UPDATE token_usage SET input_tokens=?,output_tokens=?,total_tokens=?,tokens_estimated=0 WHERE owner_user_id=? AND member_key=? AND trace_id=? AND source IN ('native_model','native_model_recovery')").run(input.input_tokens,input.output_tokens,input.input_tokens+input.output_tokens,identity.owner,identity.agent,call.id);
    if(amended.changes!==1)throw Error('Native usage estimate could not be reconciled exactly once.');
    db.prepare('UPDATE native_model_calls SET input_tokens=?,output_tokens=?,estimated=0,updated_at=? WHERE id=?').run(input.input_tokens,input.output_tokens,now,call.id);
    return {ok:true,reconciled:true};
   }
   return {ok:true,duplicate:true};
  }
  db.prepare('UPDATE native_model_calls SET status=?,input_tokens=?,output_tokens=?,estimated=?,reserved_tokens=0,updated_at=? WHERE id=?').run(input.status,input.input_tokens,input.output_tokens,input.estimated?1:0,now,call.id);
  if((input.input_tokens||input.output_tokens)&&!recordTokenUsage(identity.owner,{memberKey:identity.agent,agentId:identity.agent,source:'native_model',modelId:call.model,inputTokens:input.input_tokens,outputTokens:input.output_tokens,estimated:input.estimated,sessionId:call.session_key,runId:call.scheduled_run_id||call.run_key,traceId:call.id}))throw Error('Native usage ledger write failed.');
  return {ok:true};
 })();
}
