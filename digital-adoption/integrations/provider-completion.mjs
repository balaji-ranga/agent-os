const capabilityCache=new Map();
export const providerFailure=(category,extra={})=>Object.assign(new Error('Model completion failed'),{diagnosticCode:category,...extra});
export async function completeProvider({config:ep,messages,maxTokens,signal,outputSchema},fetchImpl=fetch){
 const started=Date.now(),base=new URL(ep.baseUrl.replace(/\/$/,'')+'/');
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['litellm','ollama','localhost','127.0.0.1','[::1]'].includes(base.hostname)))throw providerFailure('TRANSPORT_DENIED');
 if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>8192)throw providerFailure('OUTPUT_BUDGET_INVALID');
 let capabilities;
 try{
  if(ep.nativeOllama){
   const key=base.origin+'|'+ep.model,old=capabilityCache.get(key);
   if(fetchImpl===fetch&&old?.expires>Date.now())capabilities=old.value;
   else{
    const r=await fetchImpl(new URL('/api/show',base),{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${ep.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:ep.model})});
    if(!r.ok)throw providerFailure('MODEL_CAPABILITY_HTTP',{providerStatus:r.status});
    const data=await r.json();if(!Array.isArray(data.capabilities)||!data.capabilities.includes('completion'))throw providerFailure('MODEL_CAPABILITY_UNAVAILABLE');
    capabilities=data.capabilities;if(fetchImpl===fetch){if(capabilityCache.size>=128)capabilityCache.delete(capabilityCache.keys().next().value);capabilityCache.set(key,{value:capabilities,expires:Date.now()+300_000});}
   }
  }
  const url=ep.nativeOllama?new URL('/api/chat',base):new URL('chat/completions',base);
  const body=ep.nativeOllama?{model:ep.model,messages,stream:false,format:outputSchema||'json',truncate:false,
   ...(capabilities.includes('thinking')&&typeof ep.thinking==='boolean'?{think:ep.thinking}:{}),
   options:{num_predict:maxTokens,num_thread:Math.max(1,Math.min(8,Number(ep.threads)||2)),temperature:0}}:
   {model:ep.model,messages,max_tokens:maxTokens,temperature:0,response_format:{type:'json_object'}};
  // Protocol adaptation only, never a model/website alias or an acceptance
  // fallback. DeepSeek's documented thinking default can consume the entire
  // bounded verdict budget before emitting content. Only the one recovery call
  // for a structured verdict requests its documented non-thinking JSON mode.
  if(!ep.nativeOllama&&base.hostname==='api.deepseek.com'&&ep.compactVerdict===true&&outputSchema)body.thinking={type:'disabled'};
  if(ep.thinking===true&&ep.nativeOllama&&!capabilities.includes('thinking'))throw providerFailure('MODEL_THINKING_UNSUPPORTED');
  if(Buffer.byteLength(JSON.stringify(body))>98_304)throw providerFailure('MODEL_CONTEXT_BUDGET');
  const response=await fetchImpl(url,{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${ep.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw providerFailure('PROVIDER_HTTP',{providerStatus:response.status});
  const data=await response.json(),content=ep.nativeOllama?data.message?.content:data.choices?.[0]?.message?.content;
  const diagnostics={model:ep.model,latencyMs:Date.now()-started,loadMs:ep.nativeOllama?Math.round((data.load_duration||0)/1e6):undefined,promptTokens:data.prompt_eval_count??data.usage?.prompt_tokens,outputTokens:data.eval_count??data.usage?.completion_tokens};
  if(ep.nativeOllama&&(data.done!==true||data.done_reason==='length'))throw providerFailure('PROVIDER_INCOMPLETE',{providerDiagnostics:diagnostics});
  if(!ep.nativeOllama&&data.choices?.[0]?.finish_reason==='length')throw providerFailure('PROVIDER_INCOMPLETE',{providerDiagnostics:diagnostics});
  if(ep.nativeOllama&&ep.thinking===false&&data.message?.thinking?.trim())throw providerFailure('MODEL_THINKING_NOT_DISABLED',{providerDiagnostics:diagnostics});
  if(typeof content!=='string'||!content.trim()||content.length>32_000)throw providerFailure('PROVIDER_EMPTY_OR_INVALID',{providerDiagnostics:diagnostics});
  return {content,diagnostics}; // No provider payloads, reasoning text or keys leave this adapter.
 }catch(error){
  if(signal?.aborted)throw providerFailure(signal.reason?.name==='TimeoutError'?'MODEL_TIMEOUT':'CLIENT_CANCELLED');
  if(error.diagnosticCode)throw error;
  throw providerFailure('PROVIDER_TRANSPORT');
 }
}
export function createProviderCompletion({localConcurrency=1,fetchImpl=fetch}={}){
 if(!Number.isInteger(localConcurrency)||localConcurrency<1||localConcurrency>16)throw new Error('Invalid local checker concurrency');
 let localActive=0;
 return async request=>{const local=request.config.nativeOllama===true;if(local&&localActive>=localConcurrency)throw providerFailure('LOCAL_CAPACITY');if(local)localActive++;try{return await completeProvider(request,fetchImpl);}finally{if(local)localActive--;}};
}
