// Serialize renewal with requests so an in-flight request cannot use a token
// invalidated by a concurrent renewal. Never retry a possibly effectful request.
export function createSessionClient({service,fetchImpl=fetch,clock=Date.now}) {
 let session=null,queue=Promise.resolve(),stopped=false,activeRead=null,analyticsAllowed=false;
 // Interrupt only requests that cannot submit host changes, upload content,
 // renew credentials or consume an approval. Aborted reads are never retried.
 const interruptible=new Set(['/v1/discovery/next','/v1/discovery/status','/v1/discovery/list','/v1/plan','/v1/recipe/plan','/v1/ask','/v1/knowledge/search']);
 const initializationKey=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const perform=async(path,data={},timeoutMs)=>{
  if(stopped)throw new Error('Session stopped; start a new session');
  if(session&&(session.expiresAt<=clock()||session.sessionExpiresAt<=clock()))throw new Error('Session expired; start a new session');
  if(path==='/v1/sessions')data={...data,initializationKey};
  const controller=new AbortController(),read=interruptible.has(path)?{controller}:null;
  if(read)activeRead=read;
  try{
  const send=()=>fetchImpl(new URL(path.replace(/^\/+/,''),service),{method:'POST',credentials:'omit',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs||(path==='/v1/sessions'?8000:55_000))]),
   headers:{'Content-Type':'application/json',...(!analyticsAllowed?{'X-Adoption-Analytics':'off'}:{}),...(session?{Authorization:`Bearer ${session.sessionToken}`}:{})},body:JSON.stringify(data)});
  let response;
  try{response=await send();}catch(error){
   // Only bootstrap has an idempotency contract. Never retry approval/fill/save.
   if(stopped||session||path!=='/v1/sessions'||!['TypeError','TimeoutError'].includes(error.name))throw error;
   response=await send();
  }
  if(!response.ok){let payload={};try{payload=await response.json();}catch{}const messages={COPILOT_CHECKER_UNAVAILABLE:'The copilot checker is unavailable. No changes were prepared. Try again or ask the platform administrator.',COPILOT_REVIEW_FAILED:'Copilot review could not validate this request. Nothing was changed. Clarify the task before trying again.',PAIRING_RESUME_DENIED:'Saved pairing expired or was revoked. Pair again.',PAIRING_ALREADY_ONLINE:'This saved panel is already online in another tab. Disconnect it before reconnecting here.',PAIR_FIRST:'Pair a copilot before linking workflows.',LINK_DENIED:'Check owner workflow permissions, online tabs and the link code expiry.',HANDOFF_DENIED:'Task sharing was refused. Confirm both panels are paired and online, then select the sharing consent checkbox.',RECIPIENT_BUSY:'This copilot is already running a workflow step. Wait for it to finish; no command was queued.',TASK_CONFLICT:'This panel already has another private task. End it before accepting a handoff.',TASK_SHARING_REQUIRED:'Select the existing private Task ID in the workflow node and explicitly share it with its paired recipients.',EXTRACTION_PENDING:'Your transaction file is still processing. Wait until Ready before preparing fields.',TASK_ENDED:'This private task has ended. Start a new task and attach the file again.',PAIRING_REJECTED:'Pairing was rejected. Check the code, its expiry and the website owner, then create a new code.',VISITOR_CAPABILITY_DISABLED:'This visitor feature is disabled for this website.',RECIPIENT_OFFLINE:'The selected copilot is offline. Reload its website and pair again; failed steps are not replayed.',POLICY_REVOKED:'Action Policy authorization is no longer valid. Nothing further will run.',SUBMISSION_BINDING_REQUIRED:'The website owner must configure an exact native submission binding before workflows can submit here.',UPLOAD_CAPACITY:'Private task storage is full. Remove a task file or end an unused task.'};throw Object.assign(new Error(messages[payload.code]|| (response.status===503?'The copilot service is temporarily unavailable. Check the current task before trying again.':response.status===502?'The assistant could not prepare a valid response. Nothing was changed.':response.status===429?'The request limit was reached. Wait a moment before trying again.':response.status===413?'This request is too large. Review the file or content limits.':'Request refused; reconnect or review configuration')), {code:payload.code,status:response.status});}
  const result=await response.json();
  if(stopped)throw new Error('Session stopped; response discarded');
  if(path==='/v1/sessions'||path==='/v1/renew') {
   if(typeof result.sessionToken!=='string'||!Number.isSafeInteger(result.expiresAt)||!result.sessionId)throw new Error('Invalid session response');
   if(session&&result.sessionId!==session.sessionId)throw new Error('Session identity changed');
   session=result;
  }
  return result;
  }catch(error){
   if(!controller.signal.aborted&&['TypeError','TimeoutError'].includes(error.name))throw new Error('The copilot connection was interrupted. Check the current task before trying again.');
   throw error;
  }finally{if(activeRead===read)activeRead=null;}
 };
 return {
  request(path,data){const result=queue.then(()=>perform(path,data));queue=result.catch(()=>{});return result;},
  setAnalyticsConsent(accepted){analyticsAllowed=accepted===true;},
  background(path,data){if(!['/v1/analytics/policy','/v1/analytics/consent','/v1/analytics/events'].includes(path))return Promise.reject(new Error('Background route denied'));return perform(path,data,2000);},
  interruptRead(){if(!activeRead)return false;activeRead.controller.abort();return true;},
  stop(){stopped=true;session=null;},
 };
}
