import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

function runtimeTransport(){
 const root=process.env.OPENCLAW_DIR||join(process.env.HOME||process.env.USERPROFILE||'','.openclaw');
 const config=JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH||join(root,'openclaw.json'),'utf8'));
 const secrets=JSON.parse(readFileSync(process.env.PLATFORM_RUNTIME_SECRETS_PATH||join(root,'platform-runtime-secrets.json'),'utf8'));
 const base=config.plugins?.entries?.['agent-os-content-tools']?.config?.baseUrl||process.env.AGENT_OS_API_URL||process.env.AGENT_OS_INTERNAL_API_URL;
 const token=secrets.secrets?.tool_broker?.value||process.env.AGENT_OS_TOOL_BROKER_TOKEN;
 if(!base||!token)throw Error('Native model budget service is not configured; model request stopped.');
 return async(operation,body)=>{
  const response=await fetch(String(base).replace(/\/$/,'')+'/api/tools/native-model-budget/'+operation,{method:'POST',headers:{'Content-Type':'application/json','x-agent-os-tool-broker':token},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(result.error||'Native model budget service unavailable; model request stopped.'),{code:result.code||'native_budget_unavailable'});
  return result;
 };
}
function chars(value){try{return JSON.stringify(value)?.length||0;}catch{throw Error('Cannot estimate native model request; model request stopped.');}}
export function nativeUsage(value){
 const u=value?.usage||value?.message?.usage||value?.partial?.usage;
 if(!u)return null;
 // Native APIs separate uncached input from cache reads/writes. OpenAI usage
 // already includes cached prompt tokens; never count that nested detail twice.
 const input=Number(u.prompt_tokens??u.input_tokens??(Number(u.input||0)+Number(u.cacheRead||0)+Number(u.cacheWrite||0)));
 const output=Number(u.completion_tokens??u.output_tokens??u.output??0);
 return Number.isFinite(input)&&Number.isFinite(output)&&input+output>0?{input_tokens:Math.max(0,Math.ceil(input)),output_tokens:Math.max(0,Math.ceil(output))}:null;
}

/** Wrap the actual stream submission, not a best-effort plugin hook. The native
 * diagnostic wrapper supports Promise streams, iterator/result consumers and
 * compaction. Preserve every original chunk and stream method unchanged. */
export function wrapFlolahBudgetStream(streamFn,ctx,{transport,uuid=randomUUID}={}){
 const agent=String(ctx.sessionKey||'').match(/^agent::?(t-[^:]+):/)?.[1];
 if(!agent)return streamFn;
 return async(model,streamContext,options={})=>{
  const request=transport||runtimeTransport();
  const identity={id:'nmc-'+uuid(),session_key:ctx.sessionKey,caller_agent_id:agent,run_id:String(ctx.runId||ctx.sessionId||''),provider:String(ctx.provider||model.provider||''),model:String(ctx.model||model.id||'')};
  const estimate=Math.max(1,Math.ceil(chars(streamContext)/4));
  const limit=Math.max(1,Math.ceil(Number(options.maxTokens||model.maxTokens||8192)));
  const admission=await request('admit',{...identity,input_tokens:estimate,output_limit:limit});
  if(!admission.allowed)throw Error('Native model budget refused this request.');
  let usage,outputChars=0,settlement,reported=false;
  const observe=value=>{usage=nativeUsage(value)||usage;if(['text_delta','thinking_delta','toolcall_delta'].includes(value?.type)&&typeof value.delta==='string')outputChars+=value.delta.length;};
  const settle=(status,value)=>{
   observe(value);
   if(!usage&&value?.content)outputChars=Math.max(outputChars,chars(value.content));
   if(!settlement||usage&&!reported){
    reported=!!usage;
    const prior=settlement,payload={...identity,status,...(usage||{input_tokens:estimate,output_tokens:Math.ceil(outputChars/4)}),estimated:!usage};
    settlement=(prior||Promise.resolve()).then(()=>request('settle',payload));
   }
   return settlement;
  };
  let stream;
  try{stream=await streamFn(model,streamContext,{...options,maxTokens:Math.min(limit,admission.output_limit)});}
  catch(error){await settle(options.signal?.aborted?'cancelled':'error').catch(()=>{});throw error;}
  if(!stream||typeof stream[Symbol.asyncIterator]!=='function'){await settle(stream?.stopReason==='error'?'error':'completed',stream);return stream;}
  const iterator=async function*(){let complete=false;try{
   for await(const chunk of stream){observe(chunk);if(chunk.type==='done'||chunk.type==='error')await settle(chunk.type==='error'?'error':'completed',chunk.message||chunk.error||chunk);yield chunk;}
   complete=true;await settle('completed');
  }catch(error){await settle(options.signal?.aborted?'cancelled':'error').catch(()=>{});throw error;}
  finally{if(!complete&&!settlement)await settle('cancelled');}};
  return new Proxy(stream,{get(target,key){
   if(key===Symbol.asyncIterator)return ()=>iterator();
   if(key==='result'&&typeof target.result==='function')return async()=>{try{const value=await target.result();await settle(value?.stopReason==='error'?'error':'completed',value);return value;}catch(error){await settle('error').catch(()=>{});throw error;}};
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
 };
}
