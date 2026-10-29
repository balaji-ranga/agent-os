// Installed-gateway plugin registration test. Run with --network none and no
// production volumes. All HTTP endpoints and credentials below are fixtures.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
const root=mkdtempSync(join(tmpdir(),'floassist-hooks-')),originalFetch=globalThis.fetch;
const id='t-fixture-owner--fixture-agent',session=`agent:${id}:main`;
try{
 process.env.OPENCLAW_DIR=root;process.env.OPENCLAW_CONFIG_PATH=join(root,'openclaw.json');process.env.PLATFORM_RUNTIME_SECRETS_PATH=join(root,'secrets.json');process.env.OPENCLAW_TOOLS_LIST_PATH=join(root,'tools.json');
 const config={agents:{list:[{id,tools:{allow:['floassist_source_read']}}]},plugins:{entries:{'agent-os-content-tools':{config:{baseUrl:'https://fixture.invalid'}}}}};
 writeFileSync(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify(config));writeFileSync(process.env.PLATFORM_RUNTIME_SECRETS_PATH,JSON.stringify({version:1,secrets:{tool_broker:{value:'fixture-only'}}}));writeFileSync(process.env.OPENCLAW_TOOLS_LIST_PATH,'[]');writeFileSync(join(root,'agent-tool-allowlists.json'),JSON.stringify({[id]:['floassist_source_read']}));
 const requests=[];let zone='Asia/Singapore',profileEnabled=true,profileUnavailable=false;globalThis.fetch=async(url,options)=>{
  requests.push({path:new URL(url).pathname,body:JSON.parse(options.body)});
  if(String(url).endsWith('/profile-context'))return profileUnavailable?new Response('{}',{status:503}):new Response(JSON.stringify({enabled:profileEnabled,timezone_available:true,timezone:zone,local_now:'fixture local time'}));
  if(String(url).endsWith('/failure-reason'))return new Response(JSON.stringify({blocked:true,reason:'native_monthly_token_budget'}));
  if(String(url).endsWith('/marketing-inbound-event'))return new Response(JSON.stringify({matched:false}));
  throw Error('Unexpected network target');
 };
 const {default:plugin}=await import('/opt/agent-os/openclaw-extensions/agent-os-content-tools/index.js');const hooks=new Map();
 plugin.register({config,context:{agentId:id,sessionKey:session},logger:{info(){},warn(){},debug(){}},on:(name,handler)=>hooks.set(name,handler),registerTool(){},registerCommand(){}});
 const ctx={agentId:id,sessionKey:session,channelId:'whatsapp'};
 const first=await hooks.get('before_prompt_build')({prompt:'Fixture request'},ctx);assert.match(first.appendSystemContext,/Asia\/Singapore/);
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
 assert.ok(!inactive?.appendSystemContext,'unregistered agents must not inherit another profile timezone');
 profileEnabled=true;profileUnavailable=true;
 const unavailable=await hooks.get('before_prompt_build')({prompt:'Fixture request'},{agentId:id,sessionKey:sparseSession});
 assert.match(unavailable.appendSystemContext,/Do not assume UTC/);profileUnavailable=false;
 const event={sessionKey:session,runId:'fixture-run',kind:'final',payload:{isError:true,text:'No reply was generated for this message. This is usually a temporary model failure - please try again.'}};
 const reply=await hooks.get('reply_payload_sending')(event,ctx);assert.match(reply.payload.text,/monthly token allowance/);assert.equal(reply.payload.isError,true);
 for(const request of requests.filter(r=>r.path.includes('native-model-budget')))assert.ok(!('prompt'in request.body)&&!('content'in request.body));
 console.log('FLOASSIST_REPLY_HOOKS_RUNTIME_OK: system-level fresh timezone, sparse resumed turns, disabled source-reader grants, inactive profile, lookup failure and budget fallback; zero models/network');
}finally{globalThis.fetch=originalFetch;rmSync(root,{recursive:true,force:true});}
