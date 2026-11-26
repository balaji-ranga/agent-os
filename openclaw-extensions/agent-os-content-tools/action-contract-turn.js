import {randomUUID} from 'node:crypto';
import {sourceToolTarget} from './source-turn-context.js';

// Per-turn orchestration only. The backend owns semantic selection, persistent
// claims, grants, policy, budgeting and artifact evidence. No phrase routing.
export function createActionContractController({post,invoke,now=Date.now,invokeTimeoutMs=6000}={}){
 const turns=new Map(),byRun=new Map();
 const sessionKey=s=>typeof s==='string'?s.replace(/^agent::/,'agent:'):null;
 const runKey=(session,run)=>JSON.stringify([sessionKey(session),run]);
 const forRun=(session,run)=>{const value=run?byRun.get(runKey(session,run)):null;return value&&value.until>now()?value:get(session);};
 const get=session=>{const s=turns.get(sessionKey(session));return s&&s.until>now()?s:null;};
 async function prepare(context,ctx,caller){
  const session=sessionKey(ctx?.sessionKey);if(!session||!caller)return null;
  for(const[k,s]of turns)if(s.until<=now())turns.delete(k);
  for(const[k,s]of byRun)if(s.until<=now())byRun.delete(k);
  const previous=get(session);
  if(previous&&!previous.closed&&ctx.runId&&previous.aliases.has(String(ctx.runId).split(':compaction:')[0])&&(!context.turn_id||context.turn_id===previous.turn))return previous.route;
  if(turns.size>=2048)turns.delete(turns.keys().next().value);
  const run=ctx.runId?String(ctx.runId).split(':compaction:')[0]:'action-turn-'+randomUUID(),turn=context.turn_id||run;
  const s={session,caller,run,turn,ctx:{...ctx},aliases:new Set([run]),until:now()+3600000,closed:false};turns.set(session,s);byRun.set(runKey(session,run),s);
  if(byRun.size>4096)byRun.delete(byRun.keys().next().value);
  try{s.route=await post({operation:'route',session_key:session,caller_agent_id:caller,run_id:run,turn_id:turn,context});}catch{s.route={decision:'clarify',status:'failed',reply:'I could not verify this request at the moment. No action was performed.'};}
  return s.route;
 }
 async function bind(ctx,run){
  const s=forRun(ctx?.sessionKey,run);if(!s||!run)return;
  s.aliases.add(run);s.aliases.add(String(run).split(':compaction:')[0]);s.nativeRun=run;byRun.set(runKey(s.session,run),s);
  if(s.route?.id)try{await post({operation:'bind',session_key:s.session,caller_agent_id:s.caller,run_id:run,id:s.route.id});}catch{}
 }
 function prompt(session){
  const s=get(session);if(!['execute','clarify'].includes(s?.route?.decision))return null;
  // The staging model cannot act or publish facts. Its output is replaced by
  // verified evidence at delivery, so domain manuals and old artifacts are
  // irrelevant to this non-executing stage. Normal turns keep their context.
  return {systemPrompt:'You are staging a registered platform action. The platform controller will execute the selected API through normal owner, grant, policy and budget checks and render its verified result. Do not call tools, create URLs, quote historical results or claim completion. Respond only: Processing your request.',toolsAllow:s.route.decision==='execute'?[s.route.tool_name]:[]};
 }
 function block(event,ctx){
  const s=forRun(ctx?.sessionKey,ctx?.runId);if(!['execute','clarify'].includes(s?.route?.decision))return;
  if(ctx?.runId&&!s.aliases.has(ctx.runId)&&!s.aliases.has(String(ctx.runId).split(':compaction:')[0]))return;
  const name=sourceToolTarget(event.toolName,event.params);
  return {block:true,blockReason:`The registered action ${s.route.tool_name} is owned by this turn's platform controller. Do not dispatch ${name} or any alternative. Finish the staging acknowledgement; the controller will execute the authorized API and report its actual result.`};
 }
 async function finish(event){
  if(event?.kind&&event.kind!=='final')return;
  const text=event?.payload?.text,session=sessionKey(event?.sessionKey);
  if(typeof text!=='string'||typeof session!=='string')return;
  const s=forRun(session,event.runId);
  if(s?.route?.decision==='clarify'&&(!event.runId||s.aliases.has(event.runId))){s.closed=true;return {payload:{...event.payload,text:s.route.reply||'Please clarify which action and target you want. No action has been performed.',isError:false}};}
  if(s?.route?.decision==='execute'&&(!event.runId||s.aliases.has(event.runId))){
   if((event.payload.isError||s.ctx.abortSignal?.aborted)&&!s.dispatchAttempted){s.closed=true;return {payload:{...event.payload,text:'I could not finish this request. No action was performed.',isError:true}};}
   if(!s.inFlight)s.inFlight=(async()=>{
    let reply;
   try{
    let result=await post({operation:'claim',session_key:session,caller_agent_id:s.caller,id:s.route.id});
    if(result.status==='claimed'){
     let output,timer;const abort=new AbortController();
     try{if(!s.canDispatch||!s.ctx.toolAuthority)throw Error('No authorized tool dispatch was started for this result.');s.ctx.toolAuthority.assertActive();if(!s.ctx.toolAuthority.allows(result.tool_name))throw Error('This tool is not permitted in the current request.');output=await Promise.race([invoke(result.tool_name,result.arguments,{...s.ctx,sessionKey:session,agentId:s.caller,runId:s.nativeRun||s.run,platformActionSignal:abort.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error('Action response timed out; dispatch is uncertain.');abort.abort(error);reject(error);},invokeTimeoutMs);})]);}
     catch(e){output={ok:false,uncertain:abort.signal.aborted,error:String(e.message||'The platform action failed')};}
     finally{clearTimeout(timer);}
     result=await post({operation:'complete',session_key:session,caller_agent_id:s.caller,id:s.route.id,result:output});
    }
    reply=result.reply||'The platform action has not produced a verified result. I have not repeated it.';
   }catch{reply='I could not verify the platform action result. I have not supplied a cached result or repeated the action.';}
    return reply;
   })();
   let reply;try{reply=await s.inFlight;}finally{s.inFlight=null;}
   s.closed=true;
   return {payload:{...event.payload,text:(text.match(/^From:[^\n]+\r?\n\s*/)?.[0]||'')+reply,isError:false}};
  }
  if(s&&(!event.runId||s.aliases.has(event.runId)))s.closed=true;
  if(!s&&event.runId){
   const caller=session.match(/^agent::?([^:]+):/)?.[1];
   if(caller)try{const stored=await post({operation:'lookup',session_key:session,caller_agent_id:caller,run_id:event.runId});if(stored.decision==='execute'&&stored.reply)return {payload:{...event.payload,text:stored.reply,isError:false}};}catch{}
  }
  // Validate platform artifacts regardless of what the model claimed.
  if(/https?:\/\/[^\s<>)]*\/p\/[^\s<>)]*/.test(text)){
   const caller=session.match(/^agent::?([^:]+):/)?.[1];if(!caller)return;
   try{
    const checked=await post({operation:'validate_reply',session_key:session,caller_agent_id:caller,text});
    if(checked.invalid_artifact)return {payload:{...event.payload,text:checked.reply,isError:false}};
   }catch{return {payload:{...event.payload,text:'I could not verify that private result link, so I have withheld it.',isError:false}};}
  }
 }
 async function fulfill(ctx){
  const s=forRun(ctx?.sessionKey,ctx?.runId);if(s?.route?.decision!=='execute')return;
  s.dispatchAttempted=true;s.canDispatch=true;s.ctx.toolAuthority=ctx.toolAuthority;
  try{return await finish({sessionKey:s.session,runId:ctx.runId||s.run,kind:'final',payload:{text:''}});}finally{s.canDispatch=false;}
 }
 return {prepare,bind,prompt,block,finish,fulfill};
}
