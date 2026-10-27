import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// The production scheduler, connector transport, policy checks, source reader,
// task processor and dispatcher run unchanged. Only external systems are fake.
const root=mkdtempSync(join(tmpdir(),'floassist-outlook-pipeline-'));
Object.assign(process.env,{AGENT_OS_DATA_DIR:join(root,'data'),OPENCLAW_DIR:join(root,'openclaw'),OPENCLAW_CONFIG_PATH:join(root,'openclaw','openclaw.json'),OPENCLAW_TOOLS_LIST_PATH:join(root,'tools.json'),OPENCLAW_TOOL_CREDENTIALS_PATH:join(root,'credentials.json'),PLATFORM_RUNTIME_SECRETS_PATH:join(root,'runtime-secrets.json'),OPENCONNECTOR_URL:'https://outlook-emulator.invalid',OPENCONNECTOR_ADMIN_TOKEN:'fixture-only',OPENCONNECTOR_AUTH_RETRY_DELAYS_MS:'0',AGENT_OS_INTERNAL_TOKEN:'fixture-only',OPENSEARCH_ENABLED:'0'});
mkdirSync(process.env.OPENCLAW_DIR,{recursive:true});
writeFileSync(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify({gateway:{mode:'local'},agents:{defaults:{workspace:join(root,'workspace')},list:[]},tools:{},channels:{}}));
const originalFetch=globalThis.fetch,originalClock=Date.now;
let now=Date.parse('2026-10-27T04:00:00Z');Date.now=()=>now;
const owner='emulator-owner',other='emulator-other',agent='emulator-coo';
let db,agentHook=async()=>{},outlookDown=false,incomingReply=false,checks=0,sequence=0;
const calls=[],deliveries=[],scenarios=[];
const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const gateway=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;await agentHook(JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'FLOASSIST_NO_UPDATE'}}]}));}catch(error){console.error('Emulator hook:',error.code,error.message);res.statusCode=500;res.end(JSON.stringify({error:'emulator agent hook failed',code:error.code||'fixture_error'}));}});
await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
process.env.OPENCLAW_GATEWAY_URL=`http://127.0.0.1:${gateway.address().port}`;
const mail=(id,conversation,body,outgoing=false,at=now-3600000)=>({id,conversationId:conversation,isDraft:false,subject:`Fixture ${conversation}`,body:{contentType:'text',content:body},sentDateTime:new Date(at).toISOString(),receivedDateTime:new Date(at).toISOString(),from:{emailAddress:{address:outgoing?'owner@example.test':'sender@example.test'}}});
const records=()=>[
 mail('p-old','p','Background discussion.',false,now-2*86400000),
 mail('p-new','p','Please approve the proposal by 28 October 2026 at 3 PM SGT. This is urgent.'),
 mail('d-new','d','Please submit the report by 29 October 2026 at 3 PM SGT.'),
 mail('f-sent','f','Could you confirm the quotation?',true,now-72*3600000),
 ...(incomingReply?[mail('f-reply','f','Here is the quotation confirmation.',false,now-1000)]:[]),
];
globalThis.fetch=async(url,options={})=>{
 const target=new URL(String(url));
 if(target.origin===process.env.OPENCLAW_GATEWAY_URL)return originalFetch(url,options);
 assert.equal(target.origin,'https://outlook-emulator.invalid','all external requests must terminate at the emulator');
 if(target.pathname==='/api/connections')return new Response(JSON.stringify([{service:'outlook',connectionName:`ceo-${owner}`,configured:true}]));
 if(target.pathname==='/mcp')return new Response('{}',{status:404});
 if(target.pathname.startsWith('/api/actions/'))return new Response(JSON.stringify({id:'outlook.get_profile',description:'Emulated Outlook metadata',inputSchema:{type:'object',properties:{},additionalProperties:false}}));
 if(!target.pathname.startsWith('/v1/actions/'))return new Response('{}',{status:404});
 const action=decodeURIComponent(target.pathname.slice('/v1/actions/'.length)),input=JSON.parse(options.body||'{}').input||{};
 const alias=new Headers(options.headers).get('x-oo-connector-alias');check(alias,`ceo-${owner}`,'connector transport retains the authenticated owner binding');
 calls.push({action,input});
 if(outlookDown)return new Response(JSON.stringify({error:'401 authorization_failed fixture token revoked',code:'authorization_failed'}),{status:401});
 let data;
 if(action==='outlook.get_profile')data={id:'fixture-mailbox',mail:'owner@example.test',userPrincipalName:'owner@tenant.test'};
 else if(action==='outlook.get_message'){data=records().find(m=>m.id===input.messageId);assert.ok(data,'only actual message IDs are readable');}
 else if(action==='outlook.list_messages'){
  let messages=records();
  if(input.filter?.startsWith('conversationId')){const conversation=input.filter.match(/^conversationId eq '([^']+)'$/)?.[1];messages=messages.filter(m=>m.conversationId===conversation);}
  else if(input.mailFolderId==='sentitems')messages=messages.filter(m=>m.from.emailAddress.address==='owner@example.test');
  data={messages,nextLink:null};
 }else assert.fail('The pipeline attempted a non-read Outlook action: '+action);
 return new Response(JSON.stringify(data));
};

try{
 const {initDb}=await import('../src/db/schema.js');db=initDb();
 const {getFloAssist}=await import('../src/services/floassist/platform.js');const service=getFloAssist();
 const {upsertOpenConnectorLink}=await import('../src/services/openconnector.js');
 const {addAgentToolGrantsIfMissing}=await import('../src/services/openclaw-agent-tools.js');
 const {seedConnectorToolsIfMissing}=await import('../src/db/seed-content-tools-meta.js');seedConnectorToolsIfMissing();
 const {createAgentChannel}=await import('../src/services/ceo-agent-channels.js');
 const {runScheduledGoal,listRecentRuns}=await import('../src/services/scheduled-goals.js');
 const {readFloAssistSource}=await import('../src/services/floassist/source-reader.js');
 const {withFloAssistScope}=await import('../src/services/floassist/execution-scope.js');
 const {verifiedTrackingInput,deadlineCandidateTrackingInput,runEvidenceSummary,isTrackingExclusion}=await import('../src/services/floassist/source-receipts.js');
 const {observeTracking,updateTracking,listTracking}=await import('../src/services/floassist/tracking.js');
 const {tickFloAssistNotifications}=await import('../src/services/floassist/runtime.js');
 const {executeKanbanUserAction}=await import('../src/services/kanban-user-actions.js');
 for(const id of [owner,other])db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role,enabled,mobile) VALUES (?,?,'fixture',?,'ceo',1,'+6581234567')").run(id,id+'@example.test',id);
 db.prepare('INSERT INTO agents(id,name,openclaw_agent_id,is_coo) VALUES (?,?,?,1)').run(agent,'Emulator COO',agent);
 db.prepare('INSERT INTO user_agents(user_id,agent_id,enabled) VALUES (?,?,1)').run(owner,agent);
 addAgentToolGrantsIfMissing(db.prepare('SELECT * FROM agents WHERE id=?').get(agent),['connector_execute_action']);
 upsertOpenConnectorLink(owner,{runtime_token:'fixture-only',connection_name:`ceo-${owner}`});
 const prefs={connectors:['outlook'],responsibilities:['briefing','priority','deadlines','followups'],timezone:'Asia/Singapore',briefing_time:'09:00',quiet_start:'00:00',quiet_end:'00:00',notification_batch_minutes:5};
 db.prepare("INSERT INTO floassist_profiles VALUES (?,?,?,'onboarding',?,'{}',?,?)").run(owner,agent,'+6581234567',JSON.stringify(prefs),now,now);
 const channel=createAgentChannel(owner,{agent_id:agent,channel:'whatsapp',config:{dmPolicy:'allowlist',allowFrom:['+6581234567'],groupPolicy:'disabled'}});
 db.prepare("UPDATE ceo_agent_channels SET status='enabled' WHERE id=?").run(channel.id);
 const creds=join(process.env.OPENCLAW_DIR,'credentials','whatsapp',`t-${owner}--${agent}`);mkdirSync(creds,{recursive:true});writeFileSync(join(creds,'creds.json'),JSON.stringify({me:{id:'6599999999:2@s.whatsapp.net'}}));
 await service.activate(owner);
 db.prepare("UPDATE scheduled_goals SET status='paused' WHERE owner_user_id=?").run(owner);
 const ids={};for(const row of db.prepare('SELECT id,source FROM scheduled_goals WHERE owner_user_id=?').all(owner))ids[row.source.split(':')[1]]=row.id;
 check(Object.keys(ids).sort(),['briefing','deadlines','followups','priority'],'Outlook offers the four mail-supported schedules');
 const tasks=()=>db.prepare('SELECT f.*,k.status FROM floassist_task_tracking f JOIN kanban_tasks k ON k.id=f.task_id WHERE f.owner_id=?').all(owner);
 const pending=()=>db.prepare("SELECT count(*) n FROM floassist_notifications WHERE owner_id=? AND status='pending'").get(owner).n;
 const send=async payload=>{deliveries.push(payload);return {ok:true};};
 const dispatch=()=>tickFloAssistNotifications({db,now,send});
 agentHook=async()=>{
  const running=db.prepare("SELECT r.id,g.source FROM scheduled_goal_runs r JOIN scheduled_goals g ON g.id=r.goal_id WHERE r.owner_user_id=? AND r.status='running' ORDER BY r.rowid DESC LIMIT 1").get(owner);
  assert.ok(running);const module=running.source.split(':')[1],context={owner,run:running.id,origin:running.source};
  await withFloAssistScope(context,async()=>{
   const discovery=await readFloAssistSource(owner,{app_id:'outlook'},{db,context,caller:agent,discoverUnknownSources:true});
   for(const candidate of discovery.source_candidates||[]){
    let source=await readFloAssistSource(owner,candidate,{db,context,caller:agent,discoverUnknownSources:true});
    while(source.next_request)source=await readFloAssistSource(owner,source.next_request,{db,context,caller:agent,discoverUnknownSources:true});
    const conversation=decodeURIComponent(source.source_id.split(':').at(-1));
    let input;
    if(module==='priority'&&conversation==='p')input={app_id:'outlook',account_id:source.account_id,source_id:source.source_id,category:module,title:'Approve proposal',evidence:'Current urgent incoming request',requested_action:'Approve proposal',why_now:'Explicit urgent action',thread_summary:'Approval requested by the sender.',urgency:'high'};
    if(module==='deadlines')for(const evidence of source.deadline_evidence||[]){const normalized=deadlineCandidateTrackingInput(db,owner,{deadline_candidate:evidence.deadline_candidate,why_now:'Verified outstanding commitment',thread_summary:'Current conversation contains a dated request.'},context);try{observeTracking(db,owner,verifiedTrackingInput(db,owner,normalized,context),now);}catch(e){if(!isTrackingExclusion(e))throw e;}}
    if(module==='followups')input={app_id:'outlook',account_id:source.account_id,source_id:source.source_id,category:module,title:'Quotation confirmation',evidence:'Current outgoing request remains unanswered',requested_action:'Obtain quotation confirmation',why_now:'Waiting more than 48 hours',thread_summary:'Quotation request and its latest reply state were checked.',latest_message_id:source.latest_message_id,awaiting_reply:true};
    if(input)try{observeTracking(db,owner,verifiedTrackingInput(db,owner,input,context),now);}catch(e){if(!isTrackingExclusion(e))throw e;}
   }
  });
 };
 const fire=async(module,expected=true)=>{now+=1000;const result=await runScheduledGoal(owner,ids[module],{force:true,requestKey:`emulator-${++sequence}`});check(result.ok,expected,module+' scheduled outcome');check(db.prepare('SELECT status FROM scheduled_goals WHERE id=?').get(ids[module]).status,'paused','manual test preserves schedule pause');const history=listRecentRuns(owner,ids[module],1)[0];check(history.id,result.run_id,'UI history returns the actual scheduled run');check(history.status,expected?'ok':'error','UI history matches execution');if(expected){const proof=runEvidenceSummary(db,owner,result.run_id);check([proof.errors,proof.incomplete_sources,proof.budget_exhausted],[0,0,false],'success requires verified provider coverage');}scenarios.push({module,status:history.status});return result;};

 await fire('priority');await fire('deadlines');await fire('followups');
 check(tasks().length,3,'cross-module observations share three source-backed tasks');
 check(tasks().filter(t=>JSON.parse(t.categories_json).includes('priority')&&JSON.parse(t.categories_json).includes('deadlines')).length,1,'priority and deadline share the same obligation');
 await dispatch();check(deliveries.length,0,'collection window prevents a message burst');now+=6*60000;await dispatch();
 check(deliveries.length,1,'one consolidated delivery for the three module findings');
 for(const task of tasks())check(deliveries[0].text.split('#'+task.task_id+' ·').length-1,1,'each task appears once in the grouped delivery');
 check(/\*FloAssist · Your action update\*/.test(deliveries[0].text),true,'WhatsApp group has a bold heading');check(/\*Context:\*|\*Next action:\*/.test(deliveries[0].text),true,'message carries useful details');
 const seenIds=tasks().map(t=>t.task_id).sort();await fire('priority');await fire('deadlines');await fire('followups');now+=6*60000;await dispatch();check(deliveries.length,1,'unchanged reruns respect the shared cooldown');check(tasks().map(t=>t.task_id).sort(),seenIds,'reruns create no duplicate tasks');
 const proposal=tasks().find(t=>t.categories_json.includes('priority'));
 await executeKanbanUserAction({ownerUserId:owner,actor:{id:owner,role:'ceo'},taskId:proposal.task_id,action:'complete',channel:'whatsapp',evidence:'I completed this proposal approval.'});
 await fire('priority');check(tasks().find(t=>t.task_id===proposal.task_id).status,'completed','scan cannot reopen a user-completed task');
 await assert.rejects(executeKanbanUserAction({ownerUserId:other,actor:{id:other,role:'ceo'},taskId:proposal.task_id,action:'complete',channel:'whatsapp',evidence:'Complete it'}));checks++;
 incomingReply=true;await fire('followups');now+=6*60000;await dispatch();check(deliveries.length,1,'latest incoming reply does not generate another outgoing follow-up');
 const quotation=tasks().find(t=>t.categories_json.includes('followups'));updateTracking(db,owner,{task_id:quotation.task_id,action:'stop',evidence:'Stop tracking this quotation.'},now);incomingReply=false;await fire('followups');now+=6*60000;await dispatch();check(deliveries.length,1,'stop-tracking suppresses rediscovered source alerts');
 now+=25*3600000;await fire('deadlines');await service.save(owner,{quiet_start:'00:00',quiet_end:'23:59'});const held=await runScheduledGoal(owner,ids.deadlines,{force:true,requestKey:'quiet-held'});check(held.reason,'floassist_quiet_hours','manual runs also respect quiet hours');now+=6*60000;await dispatch();check(deliveries.length,1,'quiet hours hold eligible deliveries');check(pending()>0,true,'quiet-hour items remain pending');
 await service.save(owner,{quiet_start:'00:00',quiet_end:'00:00'});await dispatch();check(deliveries.length,2,'quiet-hour release uses the same dispatcher');
 const sentRows=db.prepare("SELECT count(*) n FROM floassist_notifications WHERE owner_id=? AND status='sent'").get(owner).n;check(sentRows>=3,true,'delivery records persist successful item outcomes');
 await fire('briefing');check(listRecentRuns(owner,ids.briefing,1)[0].status,'ok','briefing reads Outlook with the common run verifier');
 const beforeFailure=tasks().map(t=>[t.task_id,t.status]);outlookDown=true;
 await fire('priority',false);
 check(tasks().map(t=>[t.task_id,t.status]),beforeFailure,'authorization failure cannot close or mutate source-backed tasks');
 outlookDown=false;await fire('priority');
 check(tasks().map(t=>[t.task_id,t.status]),beforeFailure,'recovery uses the same shared processor without duplicate tasks');
 check(db.prepare('SELECT count(*) n FROM floassist_task_tracking WHERE owner_id=?').get(other).n,0,'foreign owner receives no tasks');
 check(calls.every(c=>['outlook.get_profile','outlook.get_message','outlook.list_messages'].includes(c.action)),true,'no external mail write/publish/delete action was attempted');
 console.log('FLOASSIST_OUTLOOK_PIPELINE_OK: '+JSON.stringify({checks,scheduledRuns:scenarios.length,source:'emulated Outlook over real connector transport',processor:'production shared tracker',dispatcher:'production shared dispatcher with fake sender',realMicrosoftCalls:0,realWhatsAppSends:0}));
}finally{globalThis.fetch=originalFetch;Date.now=originalClock;await new Promise(resolve=>gateway.close(resolve));try{db?.close();}catch{}rmSync(root,{recursive:true,force:true});}
