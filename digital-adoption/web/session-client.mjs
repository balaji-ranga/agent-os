// Serialize renewal with requests so an in-flight request cannot use a token
// invalidated by a concurrent renewal. Never retry a possibly effectful request.
export function createSessionClient({service,fetchImpl=fetch,clock=Date.now}) {
 let session=null,queue=Promise.resolve(),stopped=false;
 const initializationKey=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const perform=async(path,data={})=>{
  if(stopped)throw new Error('Session stopped; start a new session');
  if(session&&(session.expiresAt<=clock()||session.sessionExpiresAt<=clock()))throw new Error('Session expired; start a new session');
  if(path==='/v1/sessions')data={...data,initializationKey};
  const send=()=>fetchImpl(new URL(path.replace(/^\/+/,''),service),{method:'POST',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(55_000),
   headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.sessionToken}`}:{})},body:JSON.stringify(data)});
  let response;
  try{response=await send();}catch(error){
   // Only bootstrap has an idempotency contract. Never retry approval/fill/save.
   if(stopped||session||path!=='/v1/sessions'||!['TypeError','TimeoutError'].includes(error.name))throw error;
   response=await send();
  }
  if(!response.ok)throw new Error('Request refused; reconnect or review configuration');
  const result=await response.json();
  if(stopped)throw new Error('Session stopped; response discarded');
  if(path==='/v1/sessions'||path==='/v1/renew') {
   if(typeof result.sessionToken!=='string'||!Number.isSafeInteger(result.expiresAt)||!result.sessionId)throw new Error('Invalid session response');
   if(session&&result.sessionId!==session.sessionId)throw new Error('Session identity changed');
   session=result;
  }
  return result;
 };
 return {
  request(path,data){const result=queue.then(()=>perform(path,data));queue=result.catch(()=>{});return result;},
  stop(){stopped=true;session=null;},
 };
}
