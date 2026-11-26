// Installed-gateway plugin registration test. Run with --network none and no
// production volumes. All HTTP endpoints and credentials below are fixtures.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
const root=mkdtempSync(join(tmpdir(),'floassist-hooks-')),originalFetch=globalThis.fetch;
const id='t-fixture-owner--fixture-agent',session=`agent:${id}:main`;
try{
 process.env.OPENCLAW_DIR=root;process.env.OPENCLAW_CONFIG_PATH=join(root,'openclaw.json');process.env.PLATFORM_RUNTIME_SECRETS_PATH=join(root,'secrets.json');process.env.OPENCLAW_TOOLS_LIST_PATH=join(root,'tools.json');
 const config={agents:{list:[{id,tools:{allow:['floassist_source_read','physical_entities_list']}}]},plugins:{entries:{'agent-os-content-tools':{config:{baseUrl:'https://fixture.invalid'}}}}};
 writeFileSync(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify(config));writeFileSync(process.env.PLATFORM_RUNTIME_SECRETS_PATH,JSON.stringify({version:1,secrets:{tool_broker:{value:'fixture-only'}}}));writeFileSync(process.env.OPENCLAW_TOOLS_LIST_PATH,'[]');writeFileSync(join(root,'agent-tool-allowlists.json'),JSON.stringify({[id]:['floassist_source_read','physical_entities_list']}));
 const requests=[];let fixtureIntent={mode:'source_review',resolved_request:"Check my Gmail for today's emails and summarize important messages",app_id:'gmail',whole_period:true,relative_day:'today',actionable_only:true};let zone='Asia/Singapore',profileEnabled=true,profileUnavailable=false;globalThis.fetch=async(url,options)=>{
  requests.push({path:new URL(url).pathname,body:JSON.parse(options.body)});
  if(String(url).endsWith('/native-turn-intent'))return new Response(JSON.stringify(fixtureIntent));
  if(String(url).endsWith('/physical-context'))return new Response(JSON.stringify({instructions:'Fixture authorized physical device context'}));
  if(String(url).endsWith('/profile-context'))return profileUnavailable?new Response('{}',{status:503}):new Response(JSON.stringify({enabled:profileEnabled,timezone_available:true,timezone:zone,local_now:'fixture local time'}));
  if(String(url).endsWith('/failure-reason'))return new Response(JSON.stringify({blocked:true,reason:'native_monthly_token_budget'}));
  if(String(url).endsWith('/marketing-inbound-event'))return new Response(JSON.stringify({matched:false}));
  throw Error('Unexpected network target');
 };
 const {default:plugin}=await import('/opt/agent-os/openclaw-extensions/agent-os-content-tools/index.js');const hooks=new Map();let turn=0;
 plugin.register({config,context:{agentId:id,sessionKey:session},logger:{info(){},warn(){},debug(){}},on:(name,handler)=>hooks.set(name,name==='before_prompt_build'?async(event,ctx)=>{ctx.runId='fixture-run-'+(++turn);return handler(event,ctx);}:handler),registerTool(){},registerCommand(){}});
 const ctx={agentId:id,sessionKey:session,channelId:'whatsapp',runId:'fixture-run'};
 const first=await hooks.get('before_prompt_build')({prompt:'Fixture request'},ctx);assert.match(first.appendSystemContext,/Asia\/Singapore/);assert.match(first.appendSystemContext,/Fixture authorized physical device context/);assert.match(first.prependContext,/A tool-search result or a prior assistant answer is not a device inventory result/);
 assert.match(first.appendSystemContext,/floassist_source_read/);
 const web=await hooks.get('before_prompt_build')({prompt:'Fixture request'},{...ctx,channelId:'web'});assert.match(web.appendSystemContext,/Connected-service routing/);
 zone='Asia/Kolkata';const second=await hooks.get('before_prompt_build')({prompt:'Fixture request'},ctx);assert.match(second.appendSystemContext,/Asia\/Kolkata/);assert.ok(!second.appendSystemContext.includes('Asia/Singapore'));
 // Resumed/compacted native turns can omit the channel, and calendar/reminder
 // tools do not require floassist_source_read to obtain profile metadata.
 const sparseSession=`agent:${id}:sparse`;
 writeFileSync(join(root,'agent-tool-session-allowlists.json'),JSON.stringify({[sparseSession]:{tools:[],expires_at:new Date(Date.now()+3600000).toISOString()}}));
 const sparse=await hooks.get('before_prompt_build')({prompt:'Fixture request'},{agentId:id,sessionKey:sparseSession});
 assert.match(sparse.appendSystemContext,/Asia\/Kolkata/);
 assert.ok(!sparse.prependContext,'timezone must not depend on ordinary conversation context');
 const restricted=await hooks.get('before_prompt_build')({prompt:'Fixture request'},{agentId:id,sessionKey:sparseSession,channelId:'whatsapp'});
 assert.match(restricted.appendSystemContext,/Asia\/Kolkata/);
 assert.ok(!restricted.prependContext,'source-reader guidance stays absent when the session denies source tools');
 profileEnabled=false;
 const inactive=await hooks.get('before_prompt_build')({prompt:'Fixture request'},{agentId:id,sessionKey:sparseSession});
 assert.ok(!/Trusted FloAssist profile timezone:|Current owner-local date\/time:/.test(inactive?.appendSystemContext||''),'unregistered agents must not inherit another profile timezone');
 profileEnabled=true;profileUnavailable=true;
 const unavailable=await hooks.get('before_prompt_build')({prompt:'Fixture request'},{agentId:id,sessionKey:sparseSession});
 assert.match(unavailable.appendSystemContext,/Do not assume UTC/);profileUnavailable=false;
 await hooks.get('before_prompt_build')({prompt:'Review my email and calendar for weekly focus areas'},ctx);
 assert.equal((await hooks.get('before_tool_call')({toolName:'tool_call',params:{id:'scheduled_goal_list',args:{}}},ctx)).block,true);
 assert.equal((await hooks.get('before_tool_call')({toolName:'floassist_source_read',params:{app_id:'gmail'}},ctx)).params.review_all,true);
 await hooks.get('before_prompt_build')({prompt:"Check my gmail for today's emails snd summarize any important"},ctx);
 const corrected=await hooks.get('before_tool_call')({toolName:'tool_call',params:{id:'floassist_source_read',args:{app_id:'gmail',source_id:'owner@example.test'}}},ctx);
 assert.deepEqual(corrected.params.args,{app_id:'gmail',review_all:true,relative_day:'today'});
 for(const prompt of ["I need a sunarized view of today's Gmail emails","Give me a summary of today's Gmail emails"]){
  await hooks.get('before_prompt_build')({prompt},ctx);
  const routed=await hooks.get('before_tool_call')({toolName:'tool_call',params:{id:'floassist_source_read',args:{app_id:'gmail',source_id:'owner@example.test',time_min:'2026-11-25T00:00:00+08:00',time_max:'2026-11-26T00:00:00+08:00'}}},ctx);
  assert.equal(routed.params.args.source_id,undefined);assert.equal(routed.params.args.review_all,true);
  assert.equal(routed.params.args.time_min,'2026-11-25T00:00:00+08:00','explicit owner date range is retained');
  const fallback=await hooks.get('before_tool_call')({toolName:'tool_call',params:{id:'scheduled_goal_run_now',args:{goal_id:'saved-briefing'}}},ctx);
  assert.equal(fallback.block,true,'source failure cannot fall back to Morning Briefing');
 }
 const original={role:'user',content:"Check my gmail for today's emails snd summarize any important",__openclaw:{senderIdentity:{accountId:id},transport:{channel:'whatsapp',conversationRef:'fixture-conversation',messageId:'original'}}};
 const retry={role:'user',content:'Retry',__openclaw:{senderIdentity:{accountId:id},transport:{channel:'whatsapp',conversationRef:'fixture-conversation',messageId:'retry',replyToId:'original'}}};
 const contextual=await hooks.get('before_prompt_build')({prompt:'Retry',messages:[original,{role:'user',content:'Unrelated later topic'},retry]},ctx);
 assert.match(contextual.appendSystemContext,/explicit reply/);
 assert.equal((await hooks.get('before_tool_call')({toolName:'tool_call',params:{id:'scheduled_goal_run_now',args:{goal_id:'saved-briefing'}}},ctx)).block,true);
 const sent=requests.filter(r=>r.path==='/api/tools/native-turn-intent').at(-1).body;
 assert.equal(sent.context.current_request,'Retry');assert.equal(sent.context.reply_to.target.content,original.content);
 fixtureIntent={mode:'browser_task',resolved_request:'Read the requested updates in the desktop bridge',app_id:null,whole_period:false,relative_day:null,actionable_only:false,browser_driver:'playwright_chrome',allow_fallback:false};
 await hooks.get('before_prompt_build')({prompt:'Read the visible updates through the browser connected to my computer'},ctx);
 assert.equal(await hooks.get('before_tool_call')({toolName:'tool_call',params:{id:'browse_task_start',args:{goal:'Summarize visible updates'}}},ctx),undefined);
 fixtureIntent={mode:'source_review',resolved_request:'Read Gmail',app_id:'gmail',whole_period:false,relative_day:null,actionable_only:false};
 await hooks.get('before_prompt_build')({prompt:'Read Gmail'},ctx);
 assert.equal((await hooks.get('before_tool_call')({toolName:'tool_call',params:{id:'browse_task_start',args:{goal:'Wrong fallback'}}},ctx)).block,true);
 fixtureIntent={mode:'schedule_run',resolved_request:'Run my morning briefing',app_id:null,whole_period:false,relative_day:null,actionable_only:false};
 await hooks.get('before_prompt_build')({prompt:'Run my morning briefing'},ctx);
 assert.equal(await hooks.get('before_tool_call')({toolName:'scheduled_goal_list',params:{}},ctx),undefined);
 const event={sessionKey:session,runId:'fixture-run',kind:'final',payload:{isError:true,text:'No reply was generated for this message. This is usually a temporary model failure - please try again.'}};
 const reply=await hooks.get('reply_payload_sending')(event,ctx);assert.match(reply.payload.text,/monthly token allowance/);assert.equal(reply.payload.isError,true);
 for(const request of requests.filter(r=>r.path.includes('native-model-budget')))assert.ok(!('prompt'in request.body)&&!('content'in request.body));
 console.log('FLOASSIST_REPLY_HOOKS_RUNTIME_OK: system-level fresh timezone, sparse resumed turns, disabled source-reader grants, inactive profile, lookup failure and budget fallback; zero models/network');
}finally{globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true});}
