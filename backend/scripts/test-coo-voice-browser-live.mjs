// Operator-only real UI/WebRTC conversation test. Uses a muted fake microphone
// and text turns over the real voice data channel; does not test speech recognition.
// Provider generations reserve/settle against the SAME approved native test batch.
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
if(process.env.RUN_LIVE_COO_CHANNEL_TESTS!=='1')throw Error('Explicit live operator opt-in required');
const [configPath,outPath]=process.argv.slice(2),cfg=JSON.parse(readFileSync(configPath,'utf8'));
const root=process.env.OPENCLAW_DIR||'/root/.openclaw';
const runtime=JSON.parse(readFileSync(root+'/platform-runtime-secrets.json','utf8'));
const broker=runtime.secrets.tool_broker.value;
const platform=JSON.parse(readFileSync(root+'/openclaw.json','utf8'));
const base=platform.plugins.entries['agent-os-content-tools'].config.baseUrl.replace(/\/$/,'');
const {chromium}=createRequire('/usr/local/lib/node_modules/openclaw/package.json')('playwright-core');
const browserRoot=process.env.PLAYWRIGHT_BROWSERS_PATH||'/opt/playwright';
const candidates=[cfg.browser_executable,platform.browser?.executablePath,chromium.executablePath(),...readdirSync(browserRoot).filter(n=>/^chromium-/.test(n)).sort().reverse().flatMap(n=>['chrome-linux64/chrome','chrome-linux/chrome'].map(p=>browserRoot+'/'+n+'/'+p))];
const executablePath=candidates.find(p=>p&&existsSync(p));if(!executablePath)throw Error('installed_browser_unavailable');
const stats={model_calls:0,tools:[],organization_read:false,company_work_read:false,email_approval:false,errors:[]};
let minted,active,settlements=Promise.resolve(),finalText='',browser,stage='setup';
const replies=[],snapshots=new Map();
function inspectSource(name,value){
 if(!value||typeof value!=='object')return;
 if(value.data&&typeof value.data==='object')inspectSource(name,value.data);
 if(value.result&&typeof value.result==='object')inspectSource(name,value.result);
 if(value.result_stored&&value._retrieval)return inspectSource(name,value._retrieval);
 if(value.resultId&&typeof value.content==='string'){
  const snapshot=snapshots.get(value.resultId)||{name:value.source_tool||name,total:value.total_characters,parts:new Map()};snapshots.set(value.resultId,snapshot);snapshot.parts.set(value.offset,value.content);
  let text='',offset=0;for(const [start,part]of [...snapshot.parts].sort((a,b)=>a[0]-b[0])){if(start!==offset)return;text+=part;offset+=part.length;}
  if(offset===snapshot.total)try{inspectSource(snapshot.name,JSON.parse(text));}catch{}
  return;
 }
 if(name==='organization_read'&&value.source==='flolah_live_organization')stats.organization_read=true;
 if(name==='agent_work_history'&&value.scope==='company')stats.company_work_read=true;
 if(name==='email_send'&&(value.needs_approval||value.code==='ACTION_APPROVAL_REQUIRED'||value.code==='approval_required'))stats.email_approval=true;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function budget(operation,body){
 const r=await fetch(base+'/api/tools/native-model-budget/'+operation,{method:'POST',headers:{'content-type':'application/json','x-agent-os-tool-broker':broker},body:JSON.stringify(body)});
 const value=await r.json();if(!r.ok)throw Error(value.code||'budget_unavailable');return value;
}
async function binding(){for(let i=0;i<120;i++){if(existsSync(cfg.binding_file))return JSON.parse(readFileSync(cfg.binding_file,'utf8'));await sleep(250);}throw Error('private_voice_budget_binding_timeout');}
try{
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const context=await browser.newContext({permissions:['microphone']});
 const page=await context.newPage();
 await page.exposeFunction('__cooReserve',async()=>{
  await settlements;const identity=await binding();if(active)throw Error('overlapping_voice_generation');if(stats.model_calls>=12)throw Error('voice_generation_test_limit');
  const id='voice-test-'+randomUUID(),run='voice-test-'+minted.session_id;
  await budget('admit',{...identity,id,run_id:run,provider:'realtime-browser-e2e',model:minted.realtime.model,input_tokens:20000,output_limit:600});
  active={...identity,id,run_id:run};stats.model_calls++;return true;
 });
 await page.exposeFunction('__cooEvent',event=>{
  if(event.type==='error'){stats.errors.push(/^[a-z0-9_]{1,80}$/i.test(event.error?.code||'')?event.error.code:'realtime_error');return;}
  if(event.type!=='response.done')return;
  const response=event.response,call=active;active=null;
  if(response.status!=='completed')stats.errors.push('response_'+String(response.status).replace(/[^a-z_]/g,''));
  if(call)settlements=settlements.then(()=>budget('settle',{...call,input_tokens:response.usage?.input_tokens??20000,output_tokens:response.usage?.output_tokens??600,status:response.status==='completed'?'completed':'error',estimated:!response.usage}));
  if(response.status==='completed'&&!response.output?.some(o=>o.type==='function_call'))finalText=(response.output||[]).flatMap(o=>o.content||[]).map(c=>c.text||c.transcript||'').join('\n');
 });
 await page.addInitScript(()=>{
  const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia=async args=>{const stream=await get(args);stream.getAudioTracks().forEach(t=>{t.enabled=false;});return stream;};
  const Original=window.RTCPeerConnection;
  window.RTCPeerConnection=class extends Original{
   createDataChannel(...args){const dc=super.createDataChannel(...args),send=dc.send.bind(dc);window.__cooDc=dc;
    dc.send=data=>{let event;try{event=JSON.parse(data);}catch{return send(data);}
     if(event.type==='response.create'){window.__cooReserve().then(()=>send(JSON.stringify({...event,response:{...event.response,output_modalities:['text'],max_output_tokens:600}}))).catch(e=>{window.__cooFailure=String(e.message);});return;}
     return send(data);
    };
    dc.addEventListener('open',()=>send(JSON.stringify({type:'session.update',session:{type:'realtime',output_modalities:['text'],audio:{input:{turn_detection:null}}}})));
    dc.addEventListener('message',e=>{try{const event=JSON.parse(e.data);if(event.type==='session.updated')window.__cooSessionUpdated=true;window.__cooEvent(event);}catch{}});
    return dc;
   }
  };
 });
 page.on('response',async response=>{
  try{
   if(response.url().includes('/api/public/voice/invite/')&&response.url().endsWith('/session')&&response.ok()){
    minted=await response.json();writeFileSync(cfg.session_file,JSON.stringify({session_id:minted.session_id}),{mode:0o600});
   }
   if(response.url().endsWith('/api/voice/tools')&&response.ok()){
    const request=response.request().postDataJSON(),body=await response.json(),name=request.arguments?.id||request.tool_name,result=body.result;
    stats.tools.push(name);
    inspectSource(name,result);
   }
  }catch{}
 });
 stage='private_page';await page.goto(cfg.url,{waitUntil:'domcontentloaded'});
 await page.getByText('Private assistant access.',{exact:false}).waitFor({timeout:20000});
 stage='webrtc_connect';await page.getByRole('button',{name:'Start call',exact:true}).click();
 await page.waitForFunction(()=>window.__cooDc?.readyState==='open'&&window.__cooSessionUpdated,undefined,{timeout:45000});
 await binding();
 const questions=cfg.questions||[
  'List all my department names using the stored names.',
  'What tasks did our agents complete in the past seven days? Use current records.',
  'Prepare a test email to coo-voice-policy-test@example.invalid with subject COO voice safety test and body Test only, following my existing approval policy. Do not bypass approval.'
 ];
 if(!Array.isArray(questions)||!questions.length||questions.length>3||questions.some(q=>typeof q!=='string'||q.length>1500))throw Error('invalid_test_questions');
 stage='conversation';for(const question of questions){
  finalText='';await page.evaluate(question=>{
  window.__cooDc.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:question}]}}));
  window.__cooDc.send(JSON.stringify({type:'response.create'}));
  },question);
  for(let i=0;i<480&&!finalText&&!stats.errors.length;i++){const failure=await page.evaluate(()=>window.__cooFailure||null);if(failure)throw Error(failure);await sleep(250);}
  replies.push(finalText);if(!finalText||stats.errors.length)break;
 }
 await settlements;
 stats.department_matches=(cfg.expected_departments||[]).filter(n=>(replies[0]||'').toLowerCase().includes(n.toLowerCase())).length;
 stats.expected_department_count=cfg.expected_departments?.length||0;
 stats.live_context_department_answer=stats.expected_department_count>0&&stats.department_matches===stats.expected_department_count;
 stats.final_response_present=replies.length===questions.length&&replies.every(Boolean);
 stats.email_approval_answer=/approv|permission|consent/i.test(replies.at(-1)||'');
 stats.passed=(stats.organization_read||stats.live_context_department_answer)&&stats.company_work_read&&stats.email_approval&&stats.final_response_present&&stats.email_approval_answer&&stats.department_matches===stats.expected_department_count&&!stats.errors.length;
 writeFileSync(outPath,JSON.stringify({...stats,final_text:replies.join('\n\n'),session_id:minted?.session_id}),{mode:0o600});
 stage='hangup';await page.getByRole('button',{name:'Hang up',exact:true}).click();
 console.log('COO_VOICE_BROWSER_RESULT '+JSON.stringify(stats));
 if(!stats.passed)process.exitCode=1;
}catch(e){stats.errors.push(stage+':'+(/^[a-z0-9_]{1,80}$/i.test(e.message||'')?e.message:e.name));writeFileSync(outPath,JSON.stringify({...stats,session_id:minted?.session_id}),{mode:0o600});console.log('COO_VOICE_BROWSER_RESULT '+JSON.stringify({...stats,passed:false}));process.exitCode=1;}
finally{await settlements.catch(()=>{});if(active)await budget('settle',{...active,input_tokens:20000,output_tokens:600,status:'error',estimated:true}).catch(()=>{});if(minted?.session_token)await fetch(base+'/api/voice/end',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session_token:minted.session_token,transcript:[]})}).catch(()=>{});await browser?.close();}
