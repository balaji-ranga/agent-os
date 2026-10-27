import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=mkdtempSync(join(tmpdir(),'floassist-local-'));
process.env.AGENT_OS_DATA_DIR=root;process.env.OPENCLAW_DIR=root;process.env.OPENSEARCH_ENABLED='0';
const {assessFloAssistSource,summarizeFloAssistNotification,validateSourceAssessment,notificationCandidates,applyNotificationSummary}=await import('../src/services/floassist/local-assistance.js');
const {readFloAssistSource}=await import('../src/services/floassist/source-reader.js');
const {tickFloAssistNotifications,ensureFloAssistRuntime}=await import('../src/services/floassist/runtime.js');
const {pendingSourceCoverage}=await import('../src/services/floassist/source-coverage.js');
const {ensureTracking}=await import('../src/services/floassist/tracking.js');
const now=Date.parse('2026-10-27T04:00:00Z');
let checks=0;const equal=(a,b,message)=>{assert.deepEqual(a,b,message);checks++;};
const plan={endpoint:{model:'fixture-local'}};
let calls=0;
const quote='Please submit the test report by 28 October 2026 at 3 PM SGT.';
const base={owner:'fixture-a',scope:{owner:'fixture-a',agent_id:'fixture-coo',run:'assessment-1',origin:'floassist:priority'},metadata:{app_id:'gmail',source_id:'thread-1',account_id:'a@example.test',provider_complete:true},text:quote,preferences:{timezone:'Asia/Singapore'},now};
const deps={resolvePlan:()=>plan,complete:async options=>{
 calls++;equal(options.efficiencyLocalOnly,true,'No new hosted utility fallback');
 equal(options.thinkingMode,'disabled');equal(options.toolName,'floassist_source_assessment');
 const value={uncertain:false,confidence:0.99,findings:[{kind:'deadline',quote,due_at:'invented',source_id:'foreign',completed:true}]};
 equal(options.validateResponse(JSON.stringify(value)),true);
 return {content:JSON.stringify(value)};
}};
try{
 const result=await assessFloAssistSource(base,deps);
 equal(result.findings,[{kind:'deadline',quote}],'Only verbatim advisory evidence survives');
 equal(result.full_source_review_required,true);equal(result.advisory_only,true);
 const shared=await assessFloAssistSource({...base,scope:{...base.scope,run:'assessment-2',origin:'floassist:followups'}},deps);
 equal(shared.reused,true);equal(calls,1,'Cross-module reuse avoids a second extraction');
 for(const [field,value]of [['account_id','other@example.test'],['source_id','thread-2'],['app_id','outlook'],['latest_sent',1]]){
  await assessFloAssistSource({...base,metadata:{...base.metadata,[field]:value}},deps);
 }
 equal(calls,5,'Account, source, provider and direction are cache boundaries');
 await assessFloAssistSource({...base,owner:'fixture-b',scope:{...base.scope,owner:'fixture-b'}},deps);equal(calls,6,'Owner isolation');
 await assessFloAssistSource({...base,preferences:{timezone:'Asia/Kolkata'}},deps);equal(calls,7,'Preference changes invalidate reuse');
 await assessFloAssistSource({...base,text:quote+' A later reply arrived.'},deps);equal(calls,8,'Changed content invalidates reuse');
 for(const changed of [{scope:{...base.scope,origin:'whatsapp'}},{metadata:{...base.metadata,provider_complete:false}},{metadata:{...base.metadata,source_kind:'draft'}},{text:'x'.repeat(24001)},{scope:{...base.scope,owner:'foreign'}}]){
  equal(await assessFloAssistSource({...base,...changed},deps),null);
 }
 equal(await assessFloAssistSource(base,{...deps,resolvePlan:()=>null}),null,'Mode disabled never calls local inference');equal(calls,8);
 for(const value of [{uncertain:true,confidence:1,findings:[{kind:'action',quote}]},{uncertain:false,confidence:0.4,findings:[{kind:'action',quote}]},{uncertain:false,confidence:1,findings:[]},{uncertain:false,confidence:1,findings:[{kind:'deadline',quote:'Invented source passage'}]}]){
  assert.throws(()=>validateSourceAssessment(value,quote));checks++;
 }
 equal(await assessFloAssistSource({...base,metadata:{...base.metadata,source_id:'failed'}},{...deps,complete:async()=>{throw Error('local timeout');}}),null,'Local error preserves normal review');
 equal(await assessFloAssistSource({...base,metadata:{...base.metadata,source_id:'uncertain'}},{...deps,complete:async()=>({content:'{"uncertain":true}'})}),null);
 let failedAttempts=0;
 const failed={...base,metadata:{...base.metadata,source_id:'negative-cache'}};
 const failureDeps={...deps,complete:async()=>{failedAttempts++;throw Error('fixture timeout');}};
 await assessFloAssistSource(failed,failureDeps);await assessFloAssistSource({...failed,scope:{...failed.scope,origin:'floassist:followups'}},failureDeps);
 equal(failedAttempts,1,'A failed extraction does not repeat across concurrent module checks');
 let permitted=true;
 equal(await assessFloAssistSource({...base,metadata:{...base.metadata,source_id:'revoked'}},{...deps,resolvePlan:()=>permitted?plan:null,complete:async()=>{permitted=false;return {content:JSON.stringify({uncertain:false,confidence:1,findings:[{kind:'action',quote}]})};}}),null,'Policy revoked during inference');
 const before=calls;
 const concurrent={...base,metadata:{...base.metadata,source_id:'concurrent'},scope:{...base.scope,run:'concurrent'}};
 await Promise.all([assessFloAssistSource(concurrent,deps),assessFloAssistSource(concurrent,deps)]);equal(calls,before+1,'Concurrent responsibilities coalesce');
 let bounded=0;
 for(let i=0;i<15;i++)await assessFloAssistSource({...base,metadata:{...base.metadata,source_id:`budget-${i}`},scope:{...base.scope,run:'bounded'},preferences:{model_call_budget:2}},{...deps,complete:async()=>{bounded++;throw Error('fixture failure');}});
 equal(bounded,2,'Failures consume the bounded local attempt allowance');

 const first='The supplier is waiting for your review of the quotation before the team can continue.';
 const context=first+' Earlier messages describe the background discussion and the original request in more detail.';
 const original=`*FloAssist · Priority Alerts*\n\n*#42 · Review quotation*\n🔴 *Due:* 28 Oct 2026, 15:00 (Asia/Singapore)\n*Context:* ${context}\n*Next action:* Review quotation\n*Source:* outlook\n*Reply:* #42 done, stop tracking, or snooze.`;
 const candidates=notificationCandidates(original);
 equal(candidates.length,1);
 const selection={selections:[{index:candidates[0].index,sentence_count:1}]};
 const shortened=applyNotificationSummary(original,candidates,selection);
 equal(shortened,original.replace(context,first),'Only descriptive context shortened');
 equal(applyNotificationSummary(original,candidates,{selections:[...selection.selections,{index:0,sentence_count:1}]}),shortened,'Unknown model indices cannot target protected headings');
 for(const value of [{selections:[{index:0,quote:first}]},{selections:[{index:candidates[0].index,quote:'Invented facts.'}]},{selections:[selection.selections[0],selection.selections[0]]}]){assert.throws(()=>applyNotificationSummary(original,candidates,value));checks++;}
 const withNumber=original.replace(context,context+' The reference is 12345.');
 assert.throws(()=>applyNotificationSummary(withNumber,notificationCandidates(withNumber),selection),/fact_removed/);checks++;
 const negated=original.replace(context,context+' Approval is not completed.');
 assert.throws(()=>applyNotificationSummary(negated,notificationCandidates(negated),selection),/qualification_removed/);checks++;
 let wordingCalls=0;
 const wordDeps={resolvePlan:()=>plan,runId:'wording',now,complete:async options=>{wordingCalls++;equal(options.efficiencyLocalOnly,true);return {content:JSON.stringify(selection)};}};
 equal(await summarizeFloAssistNotification('fixture-a',original,wordDeps),shortened);
 equal(await summarizeFloAssistNotification('fixture-a',original,wordDeps),shortened);equal(wordingCalls,1,'Wording reuse avoids repeat inference');
 equal(await summarizeFloAssistNotification('disabled',original,{...wordDeps,resolvePlan:()=>null}),original);
 equal(await summarizeFloAssistNotification('failure',original,{...wordDeps,complete:async()=>{throw Error('local unavailable');}}),original,'Formatting fails to template, not cloud');

 // Real source reader: optional assistance never replaces content, paging,
 // complete coverage, backend deadline candidates or current authorization.
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE floassist_profiles(owner_id TEXT,agent_id TEXT,status TEXT,phone TEXT,preferences_json TEXT);
 CREATE TABLE platform_users(id TEXT,enabled INTEGER);
 CREATE TABLE floassist_task_tracking(owner_id TEXT,task_id INTEGER,app_id TEXT,source_id TEXT,obligation_key TEXT);`);
 const prefs={connectors:['gmail'],responsibilities:['priority','briefing'],timezone:'Asia/Singapore',quiet_start:'22:00',quiet_end:'08:00',notification_batch_minutes:0};
 db.prepare('INSERT INTO floassist_profiles VALUES (?,?,?,?,?)').run('fixture-a','fixture-coo','active','fixture-phone',JSON.stringify(prefs));
 db.prepare('INSERT INTO platform_users VALUES (?,1)').run('fixture-a');
 const full=quote+'\n'+'x'.repeat(12500);
 let providerReads=0,auth=0;
 const sourceOptions={db,now,context:{...base.scope,run:'paging'},authorize:async()=>{auth++;},execute:async()=>{providerReads++;return {data:{threadId:'verified',messages:[{subject:'Report',messageText:full,messageTimestamp:'2026-10-26T10:00:00Z'}]}};},assess:async()=>result};
 const page=await readFloAssistSource('fixture-a',{app_id:'gmail',source_id:'verified'},sourceOptions);
 equal(page.content.length,12000);equal(page.coverage_complete,false);equal(page.local_assessment,result);
 assert.ok(pendingSourceCoverage(db,'fixture-a','paging').length);checks++;
 const last=await readFloAssistSource('fixture-a',page.next_request,sourceOptions);
 equal(page.content+last.content,'Subject: Report\n'+full);equal(last.coverage_complete,true);equal(providerReads,1);
 assert.ok(auth>=3);checks++;
 const adHoc=await readFloAssistSource('fixture-a',{app_id:'gmail',source_id:'verified'},{...sourceOptions,context:{owner:'fixture-a',origin:'whatsapp'},assess:async()=>null});equal(adHoc.local_assessment,undefined);equal(adHoc.content,page.content);
 const failure=await readFloAssistSource('fixture-a',{app_id:'gmail',source_id:'verified'},{...sourceOptions,context:{...base.scope,run:'assessor-failure'},assess:async()=>{throw Error('fixture');}});equal(failure.content,page.content);

 // Real dispatcher: headings, due dates, reply actions, delivery state and
 // cancellation after local inference remain backend-controlled.
 db.exec('DROP TABLE floassist_task_tracking');ensureFloAssistRuntime(db);
 const briefingText='*FloAssist · Morning Briefing*\n\n'+context;
 const insert=db.prepare('INSERT INTO floassist_notifications(source_key,owner_id,agent_id,text,status,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?)');
 insert.run('briefing-1','fixture-a','fixture-coo',briefingText,'pending',now,now,now+86400000);
 let delivered=[];
 const summarizer=async(owner,text,options)=>summarizeFloAssistNotification(owner,text,{...options,resolvePlan:()=>plan,complete:async()=>({content:JSON.stringify({selections:[{index:2,sentence_count:1}]})})});
 const sent=await tickFloAssistNotifications({db,now,send:async n=>{delivered.push(n.text);return {ok:true};},summarize:summarizer});equal(sent.sent,1);equal(delivered,['*FloAssist · Morning Briefing*\n\n'+first]);
 equal(db.prepare('SELECT status FROM floassist_notifications WHERE source_key=?').get('briefing-1').status,'sent');
 insert.run('briefing-paused','fixture-a','fixture-coo',briefingText,'pending',now+1,now+1,now+86400000);
 await tickFloAssistNotifications({db,now:now+2,send:async()=>{throw Error('must not send');},summarize:async(_owner,text)=>{db.prepare("UPDATE floassist_profiles SET status='paused'").run();return text;}});
 equal(db.prepare('SELECT status FROM floassist_notifications WHERE source_key=?').get('briefing-paused').status,'pending','Pause during inference prevents delivery');
 db.exec("CREATE TABLE kanban_tasks(id INTEGER PRIMARY KEY,owner_user_id TEXT,title TEXT,status TEXT,due_at TEXT,created_by TEXT)");ensureTracking(db);
 db.prepare("UPDATE floassist_notifications SET status='cancelled' WHERE status='pending'").run();
 db.prepare("UPDATE floassist_profiles SET status='active',preferences_json=?").run(JSON.stringify({...prefs,notification_batch_minutes:1}));
 for(const id of [7,8]){
  db.prepare('INSERT INTO kanban_tasks VALUES (?,?,?,?,?,?)').run(id,'fixture-a','Review quotation','todo','2026-10-28T07:00:00Z','floassist-tracking');
  db.prepare('INSERT INTO floassist_task_tracking(owner_id,task_id,source_key,app_id,account_id,source_id,obligation_key,categories_json,fingerprint,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run('fixture-a',id,`source-${id}`,'gmail','a@example.test',`thread-${id}`,'action','["priority"]','fingerprint',now);
  insert.run(`fixture-a:tracking:${id}:1:finding:fixture`,'fixture-a','fixture-coo',original.replaceAll('#42',`#${id}`),'pending',now-120000,now-120000,now+86400000);
 }
 let grouped=[];
 await tickFloAssistNotifications({db,now,send:async n=>{grouped.push(n.text);return {ok:true};},summarize:async(_owner,text)=>{db.prepare("UPDATE kanban_tasks SET status='completed' WHERE id=7").run();return text;}});
 equal(grouped.length,0,'Completion during batch inference invalidates the old grouped body');
 equal(db.prepare('SELECT status FROM floassist_notifications WHERE source_key=?').get('fixture-a:tracking:7:1:finding:fixture').status,'cancelled');
 equal(db.prepare('SELECT status FROM floassist_notifications WHERE source_key=?').get('fixture-a:tracking:8:1:finding:fixture').status,'pending');
 await tickFloAssistNotifications({db,now:now+120000,send:async n=>{grouped.push(n.text);return {ok:true};},summarize:async(_owner,text)=>text});
 equal(grouped.length,1);equal(grouped[0].includes('#7'),false);equal(grouped[0].includes('#8'),true);
 db.close();console.log(`FLOASSIST_LOCAL_ASSISTANCE_OK: ${checks} checks; evidence, shared cache, bounded calls, no hosted fallback, unchanged source coverage and actual dispatcher`);
}finally{rmSync(root,{recursive:true,force:true});}
