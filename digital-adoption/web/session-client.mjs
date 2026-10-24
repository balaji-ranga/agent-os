// Serialize renewal with requests so an in-flight request cannot use a token
// invalidated by a concurrent renewal. Never retry a possibly effectful request.
import {MODEL_SESSION_TIMEOUT_MS,sessionRequestTimeoutMs} from './model-timeouts.mjs';
export function createSessionClient({service,fetchImpl=fetch,clock=Date.now,sessionStore}) {
 let requestTimeoutMs=MODEL_SESSION_TIMEOUT_MS;
 let session=null,queue=Promise.resolve(),stopped=false,activeRead=null,analyticsAllowed=false;
 // Interrupt only requests that cannot submit host changes, upload content,
 // renew credentials or consume an approval. Aborted reads are never retried.
 const interruptible=new Set(['/v1/goals/create','/v1/goals/clarify','/v1/goals/next','/v1/goals/observe','/v1/discovery/next','/v1/discovery/status','/v1/discovery/list','/v1/plan','/v1/recipe/plan','/v1/ask','/v1/tasks/plan','/v1/tasks/summary','/v1/tasks/command-plan','/v1/knowledge/search']);
 const initializationKey=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const perform=async(path,data={},timeoutMs)=>{
  if(stopped)throw new Error('Session stopped; start a new session');
  if(session&&(session.expiresAt<=clock()||session.sessionExpiresAt<=clock()))throw new Error('Session expired; start a new session');
  if(path==='/v1/sessions')data={...data,initializationKey};
  const controller=new AbortController(),read=interruptible.has(path)?{controller}:null;
  if(read)activeRead=read;
  try{
  const send=()=>fetchImpl(new URL(path.replace(/^\/+/,''),service),{method:'POST',credentials:'omit',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs||Math.min(sessionRequestTimeoutMs(path),requestTimeoutMs))]),
   headers:{'Content-Type':'application/json',...(!analyticsAllowed?{'X-Adoption-Analytics':'off'}:{}),...(session?{Authorization:`Bearer ${session.sessionToken}`}:{})},body:JSON.stringify(data)});
  let response;
  try{response=await send();}catch(error){
   // Only bootstrap has an idempotency contract. Never retry approval/fill/save.
   if(stopped||session||path!=='/v1/sessions'||!['TypeError','TimeoutError'].includes(error.name))throw error;
   response=await send();
  }
  if(!response.ok){let payload={};try{payload=await response.json();}catch{}const messages={PEER_ACCESS_DENIED:'This paired request belongs to another panel or task.',PEER_REQUEST_ENDED:'This paired request ended. Earlier browser changes remain; it will not be replayed.',PEER_OUTCOME_REQUIRED:'The recipient goal has not completed with recorded outcomes. Review its progress.',PEER_CONTEXT_INVALID:'Only observed, nonsecret form values can be shared.',PEER_CONTEXT_LIMIT:'The current form context is too large. Share fewer values or use a smaller task.',PEER_CAPACITY:'This task reached its paired-request limit. Finish or end it before starting another.',PEER_OPERATION_CONFLICT:'This paired request changed after sending. Inspect its status; nothing was resent.',OWNER_KNOWLEDGE_UPLOAD_REQUIRED:'Shared knowledge uploads require owner or Flolah sign-in in Website configuration.',UPLOAD_COOLDOWN:'Wait before uploading another task file.',UPLOAD_RATE_LIMIT:'The task upload request limit was reached.',UPLOAD_BUDGET_EXCEEDED:'The cumulative task file allowance was reached. Removing a file or ending the task does not reset this allowance.',UPLOAD_BUSY:'Upload capacity is busy. No file was accepted.',UPLOAD_QUEUE_FULL:'Document processing is busy. Wait for queued files to finish.',ACTION_ATTEMPT_DENIED:'This action was already used, expired or superseded. Inspect the host before preparing a new review.',OPERATION_ALREADY_DISPATCHED:'This workflow step was already dispatched before recovery. Inspect its host result; it will not run again.',COPILOT_CHECKER_UNAVAILABLE:'The copilot checker is unavailable. No changes were prepared. Try again or ask the platform administrator.',COPILOT_REVIEW_FAILED:'The assistant returned an invalid response after a repair attempt. Nothing was changed. Please retry; if it repeats, ask the platform administrator.',PAIRING_RESUME_DENIED:'Saved pairing expired or was revoked. Pair again.',PAIRING_ALREADY_ONLINE:'This saved panel is already online in another tab. Disconnect it before reconnecting here.',PAIR_FIRST:'Pair a copilot before linking workflows.',LINK_DENIED:'Check owner workflow permissions, online tabs and the link code expiry.',HANDOFF_DENIED:'Task sharing was refused. Confirm both panels are paired and online, then select the sharing consent checkbox.',RECIPIENT_BUSY:'This copilot is already running a workflow step. Wait for it to finish; no command was queued.',TASK_CONFLICT:'This panel already has another private task. End it before accepting a handoff.',TASK_SHARING_REQUIRED:'Select the existing private Task ID in the workflow node and explicitly share it with its paired recipients.',EXTRACTION_PENDING:'Your transaction file is still processing. Wait until Ready before preparing fields.',PRIVATE_SEARCH_UNAVAILABLE:'Private document search is unavailable. No changes were prepared. Try again later.',TASK_CHANGED:'Task files changed during this request. Review the current files and try again.',TASK_ENDED:'The previous private task ended. Pairing is separate. Resend your request to start fresh; reattach files only if needed.',PAIRING_REJECTED:'Pairing was rejected. Check the code, its expiry and the website owner, then create a new code.',VISITOR_CAPABILITY_DISABLED:'This visitor feature is disabled for this website.',RECIPIENT_OFFLINE:'The selected copilot is offline. Reload its website and pair again; failed steps are not replayed.',POLICY_REVOKED:'Action Policy authorization is no longer valid. Nothing further will run.',SUBMISSION_BINDING_REQUIRED:'The website owner must configure an exact native submission binding before workflows can submit here.',UPLOAD_CAPACITY:'Private task storage is full. Remove a task file or end an unused task.'};const retryAfter=Number(response.headers?.get?.('Retry-After')),retryAfterSeconds=Number.isSafeInteger(retryAfter)&&retryAfter>0?retryAfter:0,uploadRetry=response.status===429&&payload.code?.startsWith('UPLOAD_')&&retryAfterSeconds?` Retry in ${retryAfterSeconds<60?retryAfterSeconds+' seconds':Math.ceil(retryAfterSeconds/60)+' minutes'}.`:'';throw Object.assign(new Error((messages[payload.code]||(payload.code?.startsWith('GOAL_')?payload.error:null)|| (response.status===503?'The copilot service is temporarily unavailable. Check the current task before trying again.':response.status===502?'The assistant could not prepare a valid response. Nothing was changed.':response.status===429?'The request limit was reached. Wait a moment before trying again.':response.status===413?'This request is too large. Review the file or content limits.':'Request refused; reconnect or review configuration'))+uploadRetry), {retryAfterSeconds,code:payload.code,status:response.status,supportReference:response.headers?.get?.('X-Adoption-Request-Id')||undefined});}
  const result=await response.json();
  if(stopped)throw new Error('Session stopped; response discarded');
  if(path==='/v1/sessions'||path==='/v1/renew') {
   if(typeof result.sessionToken!=='string'||!Number.isSafeInteger(result.expiresAt)||!result.sessionId)throw new Error('Invalid session response');
   if(session&&result.sessionId!==session.sessionId)throw new Error('Session identity changed');
   if(result.requestTimeoutMs!==undefined){if(!Number.isSafeInteger(result.requestTimeoutMs)||result.requestTimeoutMs<6000||result.requestTimeoutMs>MODEL_SESSION_TIMEOUT_MS)throw new Error('Invalid service deadline');requestTimeoutMs=result.requestTimeoutMs;}
   session=result;try{sessionStore?.write(session);}catch{}
  }
  return result;
  }catch(error){
   if(controller.signal.aborted&&read)throw Object.assign(new Error('Previous task stopped. No further work will run.'),{name:'AbortError',code:'TASK_CANCELLED'});
   if(!controller.signal.aborted&&['TypeError','TimeoutError','AbortError'].includes(error.name))throw new Error('The copilot connection was interrupted. Check the current task before trying again.');
   throw error;
  }finally{if(activeRead===read)activeRead=null;}
 };
 return {
  resume(data={}){const result=queue.then(async()=>{let saved;try{saved=sessionStore?.read();}catch{}if(!saved)return null;if(typeof saved.sessionToken!=='string'||typeof saved.sessionId!=='string'||!Number.isSafeInteger(saved.expiresAt)||!Number.isSafeInteger(saved.sessionExpiresAt)||saved.expiresAt<=clock()||saved.sessionExpiresAt<=clock()){try{sessionStore?.clear();}catch{}return null;}session=saved;try{return await perform('/v1/renew',data);}catch(error){if(error.status===403){session=null;try{sessionStore?.clear();}catch{}return null;}throw error;}});queue=result.catch(()=>{});return result;},
  request(path,data){const result=queue.then(()=>perform(path,data));queue=result.catch(()=>{});return result;},
  setAnalyticsConsent(accepted){analyticsAllowed=accepted===true;},
  background(path,data){if(!['/v1/analytics/policy','/v1/analytics/consent','/v1/analytics/events'].includes(path))return Promise.reject(new Error('Background route denied'));return perform(path,data,2000);},
  interruptRead(){if(!activeRead)return false;activeRead.controller.abort();return true;},
  stop(){stopped=true;session=null;},
 };
}
