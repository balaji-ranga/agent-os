// Explicit live-test quotas also cover backend utility generations invoked by
// tools (e.g. mailbox digests). Normal, unbound conversations are unchanged.
import {randomUUID} from 'node:crypto';
import {getDb} from '../db/schema.js';
import {nativeModelIdentity,admitNativeModel,settleNativeModel} from './native-model-budget.js';
export async function withNativeTestUtilityBudget(options,complete,{db=getDb(),admit=admitNativeModel,settle=settleNativeModel}={}){
 if(!options.ownerUserId||!options.sessionId||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='native_model_test_sessions'").get())return complete(options);
 const budget=db.prepare('SELECT b.id FROM native_model_test_sessions s JOIN native_model_test_budgets b ON b.id=s.budget_id WHERE s.session_key=? AND b.owner_id=?').get(options.sessionId,options.ownerUserId);
 if(!budget)return complete(options);
 const identity=nativeModelIdentity({session_key:options.sessionId},db);
 if(identity.owner!==options.ownerUserId)throw Error('Test utility owner mismatch');
 const outer=options.traceId&&db.prepare("SELECT 1 FROM native_model_calls WHERE id=? AND owner_id=? AND agent_id=? AND session_key=? AND status='started'").get(options.traceId,identity.owner,identity.agent,identity.session);
 if(outer)return complete(options); // caller already owns this exact reservation
 const call={id:'test-utility-'+randomUUID(),session_key:identity.session,caller_agent_id:identity.session.match(/^agent::?([^:]+):/)[1],run_id:options.runId||'test-utility-'+budget.id,provider:'backend-test-utility',model:options.modelOverride||'configured',input_tokens:Math.max(1,Math.ceil(Buffer.byteLength(JSON.stringify(options.messages||[]))/4)),output_limit:options.maxTokens||1024};
 const admission=admit(call,{db});let response;
 try{
  response=await complete({...options,memberKey:identity.agent,traceId:call.id,maxTokens:Math.min(options.maxTokens||1024,admission.output_limit)});
  const usage=response.usage;
  const recorded=!!db.prepare('SELECT 1 FROM token_usage WHERE owner_user_id=? AND member_key=? AND trace_id=?').get(identity.owner,identity.agent,call.id);
  settle({...call,status:'completed',input_tokens:usage?.input_tokens??call.input_tokens,output_tokens:usage?.output_tokens??Math.ceil(String(response.content||'').length/4),estimated:!usage},{db,usageRecorded:recorded});
  return response;
 }catch(error){
  if(!response)settle({...call,status:'error',input_tokens:call.input_tokens,output_tokens:0,estimated:true},{db});
  throw error;
 }
}
