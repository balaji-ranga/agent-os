import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initializeFloAssist} from '../src/services/floassist/core.js';
import {ensureTracking,observeTracking} from '../src/services/floassist/tracking.js';
import {readFloAssistSource} from '../src/services/floassist/source-reader.js';
import {deadlineCandidateTrackingInput,verifiedTrackingInput} from '../src/services/floassist/source-receipts.js';
import {pendingSourceCoverage} from '../src/services/floassist/source-coverage.js';
import {tickFloAssistNotifications} from '../src/services/floassist/runtime.js';
import {verifyOrphanClosure} from '../src/services/floassist/reconcile-source.js';

// Real shared processor/dispatcher; isolated DB, synthetic provider and sender.
const db=new Database(':memory:');initializeFloAssist(db);ensureTracking(db);
db.exec(`CREATE TABLE platform_users(id TEXT PRIMARY KEY,enabled INTEGER);
 CREATE TABLE kanban_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,description TEXT,status TEXT,created_by TEXT,owner_user_id TEXT,assigned_user_id TEXT,due_at TEXT,due_date TEXT,updated_at TEXT);
 CREATE TABLE task_messages(id INTEGER PRIMARY KEY,task_id INTEGER,role TEXT,content TEXT);
 CREATE TABLE scheduled_goals(id TEXT,owner_user_id TEXT,source TEXT);
 CREATE TABLE scheduled_goal_runs(id TEXT,owner_user_id TEXT,goal_id TEXT,run_key TEXT,status TEXT);`);
const now=Date.parse('2026-10-27T04:00:00Z'),clock=Date.now;Date.now=()=>now;
const prefs={connectors:['outlook','gmail'],responsibilities:['priority','deadlines','followups'],timezone:'Asia/Singapore',quiet_start:'00:00',quiet_end:'00:00',notification_batch_minutes:0,task_realert_hours:24};
for(const owner of ['a','b']){db.prepare('INSERT INTO platform_users VALUES (?,1)').run(owner);db.prepare('INSERT INTO floassist_profiles VALUES (?,?,?,?,?,?,?,?)').run(owner,'coo','+6500000000','active',JSON.stringify(prefs),'{}',now,now);}
let sequence=0,calls=[],mode='sent',profile={id:'account-a',mail:'Owner@Example.test',userPrincipalName:'owner@tenant.test'};
const message=(id,at,outgoing=true,extra={})=>({id,isDraft:false,conversationId:'conversation-a',subject:'Quotation',body:{contentType:'text',content:'Please send the quotation by 29 October 2026 at 3 PM SGT.'},sentDateTime:new Date(at).toISOString(),from:{emailAddress:{address:outgoing?'OWNER@example.test':'other@example.test'}},...extra});
const sent=message('sent-a',now-72*3600000),reply=message('reply-a',now-3600000,false);
const pageLink="https://graph.microsoft.com/v1.0/me/messages?$skiptoken=opaque";
const execute=async(owner,action,input)=>{
 calls.push({owner,action,input});
 if(mode==='denied')throw Object.assign(Error('Provider denied'),{provider_status:401,code:'authorization_failed'});
 if(action==='outlook.get_profile')return {data:profile};
 if(action==='outlook.get_message')return {data:{...sent,id:input.messageId}};
 assert.equal(action,'outlook.list_messages');
 if(!input.filter?.startsWith('conversationId')&&!input.nextLink)return {data:{messages:[sent,message('same-conversation',now-80*3600000)],nextLink:mode==='discovery-more'?pageLink:null}};
 if(mode==='old')return {data:{messages:[message('sent-a',now-90*86400000)]}};
 if(mode==='empty')return {data:{messages:[],nextLink:null}};
 if(mode==='html')return {data:{messages:[{...sent,body:{contentType:'html',content:'<p>Preview is not verified text</p>'}}]}};
 if(mode==='wrong-conversation')return {data:{messages:[{...sent,conversationId:'another'}]}};
 if(mode==='missing-time')return {data:{messages:[{...sent,sentDateTime:undefined,receivedDateTime:undefined}]}};
 if(mode==='unsafe-next')return {data:{messages:[sent],nextLink:'https://example.test/steal'}};
 if(mode==='foreign-next')return {data:{messages:[sent],nextLink:'https://graph.microsoft.com/v1.0/users/another-account/messages?$skiptoken=x'}};
 if(mode==='repeat-page')return {data:{messages:[sent],nextLink:pageLink}};
 if(mode==='many-pages')return {data:{messages:[message('page-'+calls.length,now-72*3600000)],nextLink:pageLink+'&n='+calls.length}};
 if(mode==='paged')return {data:input.nextLink?{messages:[sent],nextLink:null}:{messages:[reply],nextLink:pageLink}};
 if(mode==='replied')return {data:{messages:[reply,sent]}};
 if(mode==='draft')return {data:{messages:[message('draft',now,true,{isDraft:true}),sent]}};
 if(mode==='tie')return {data:{messages:[sent,message('incoming-tie',now-72*3600000,false)]}};
 if(mode==='large')return {data:{messages:[{...sent,body:{contentType:'text',content:'x'.repeat(14000)+sent.body.content}}]}};
 return {data:{messages:[sent]}};
};
const scope=(module='followups',owner='a')=>{const run='outlook-test-'+(++sequence);db.prepare('INSERT INTO scheduled_goals VALUES (?,?,?)').run(run,owner,'floassist:'+module);db.prepare('INSERT INTO scheduled_goal_runs VALUES (?,?,?,?,?)').run(run,owner,run,run,'running');return {owner,run,origin:'floassist:'+module};};
const options=context=>({db,context,now,execute,authorize:async()=>{}});
const finding=(source,category='followups')=>({app_id:'outlook',account_id:source.account_id,source_id:source.source_id,category,title:'Quotation confirmation',evidence:'Verified latest outgoing request',requested_action:'Send quotation',why_now:'Reply pending after 72 hours',thread_summary:'Latest message is an outgoing request.',latest_message_id:'sent-a',awaiting_reply:true});
let checks=0;const ok=(value,label)=>{assert.ok(value,label);checks++;};
try{
 let context=scope();calls=[];
 const discovered=await readFloAssistSource('a',{app_id:'outlook'},{...options(context),discoverUnknownSources:true});
 ok(discovered.discovery_only&&discovered.source_candidates.length===1,'discovery groups messages by canonical conversation');
 const discovery=calls.find(c=>c.action==='outlook.list_messages').input;
 assert.equal(discovery.mailFolderId,'sentitems');assert.match(discovery.filter,/sentDateTime ge 2026-10-20/);assert.equal(discovered.account_id,'owner@example.test');checks+=3;
 const source=await readFloAssistSource('a',discovered.source_candidates[0],{...options(context),discoverUnknownSources:true});
 ok(source.content_verified&&source.coverage_complete&&pendingSourceCoverage(db,'a',context.run).length===0,'conversation completes its discovered coverage');
 const verified=verifiedTrackingInput(db,'a',finding(source),context);
 const first=observeTracking(db,'a',verified,now);
 const deadline=deadlineCandidateTrackingInput(db,'a',{deadline_candidate:source.deadline_evidence[0].deadline_candidate,why_now:'Actual commitment',thread_summary:'Quotation still outstanding.'},{...context,origin:'floassist:deadlines'},now);
 const second=observeTracking(db,'a',verifiedTrackingInput(db,'a',deadline,{...context,origin:'floassist:deadlines'}),now);
 assert.equal(second.task.task_id,first.task.task_id);checks++;
 const delivered=[];await tickFloAssistNotifications({db,now,send:async n=>{delivered.push(n);return {ok:true};}});
 ok(delivered.length===1,'Outlook uses the common grouped/deduplicated dispatcher');
 ok(delivered[0].text.includes('#'+first.task.task_id)&&/Follow.up|Deadline/i.test(delivered[0].text),'shared notification has task identity and module heading');

 for(const testMode of ['replied','tie']){mode=testMode;context=scope();const read=await readFloAssistSource('a',{app_id:'outlook',source_id:'sent-a'},options(context));assert.throws(()=>verifiedTrackingInput(db,'a',finding(read),context),e=>e.code==='FLOASSIST_NOT_A_FOLLOWUP');checks++;}
 mode='old';context=scope('followups','b');const old=await readFloAssistSource('b',{app_id:'outlook',source_id:'sent-a'},options(context));assert.throws(()=>verifiedTrackingInput(db,'b',finding(old),context),e=>e.code==='FLOASSIST_DISCOVERY_WINDOW');checks++;
 mode='draft';context=scope();const draftRead=await readFloAssistSource('a',{app_id:'outlook',source_id:'sent-a'},options(context));ok(verifiedTrackingInput(db,'a',finding(draftRead),context),'unsent drafts do not supersede the latest actual request');
 mode='paged';context=scope();calls=[];const paged=await readFloAssistSource('a',{app_id:'outlook',source_id:'sent-a'},options(context));ok(paged.message_count===2&&paged.coverage_complete,'conversation follows provider pages before accepting latest state');assert.throws(()=>verifiedTrackingInput(db,'a',finding(paged),context),e=>e.code==='FLOASSIST_NOT_A_FOLLOWUP');checks++;
 ok(calls.some(c=>c.input.nextLink===pageLink),'provider pagination token is used unchanged');
 mode='sent';context=scope();calls=[];await readFloAssistSource('a',{app_id:'outlook'},options(context));const latestQuery=calls.find(c=>c.action==='outlook.list_messages').input;assert.equal(latestQuery.filter,undefined,'latest-mail query avoids Graph filter/orderby conflicts');checks++;
 mode='large';context=scope();calls=[];const large=await readFloAssistSource('a',{app_id:'outlook',source_id:'sent-a'},options(context));const count=calls.length;
 const last=await readFloAssistSource('a',{next_request:large.next_request},{...options(context),discoverUnknownSources:true});
 ok(last.coverage_complete&&last.offset===12000&&calls.length===count,'external cursor paging reuses authorized text without rediscovery');
 await assert.rejects(readFloAssistSource('a',large.next_request,{...options(context),authorize:async()=>{throw Object.assign(Error('policy revoked'),{status:403});}}),e=>e.status===403);checks++;
 await assert.rejects(readFloAssistSource('b',large.next_request,{...options({...context,owner:'b'})}),e=>e.code==='FLOASSIST_SOURCE_SNAPSHOT_EXPIRED');checks++;

 for(const testMode of ['html','wrong-conversation','missing-time','unsafe-next','foreign-next','repeat-page','many-pages','denied']){mode=testMode;context=scope();await assert.rejects(readFloAssistSource('a',{app_id:'outlook',source_id:'sent-a'},options(context)));checks++;}
 context=scope();const quoted=await readFloAssistSource('a',{app_id:'outlook',source_id:'quoted-message'},{...options(context),execute:async(_owner,action,input)=>{if(action==='outlook.get_profile')return {data:profile};if(action==='outlook.get_message')return {data:{...sent,id:'quoted-message',conversationId:"conv'one"}};assert.equal(input.filter,"conversationId eq 'conv''one'");return {data:{messages:[{...sent,id:'quoted-message',conversationId:"conv'one"}]}};}});ok(quoted.coverage_complete,'conversation filter escapes provider identity safely');
 mode='sent';context=scope();profile={id:'account-b',mail:'other@example.test'};calls=[];
 await assert.rejects(readFloAssistSource('a',{app_id:'outlook',source_id:source.source_id},options(context)),e=>e.code==='FLOASSIST_SOURCE_ACCOUNT_MISMATCH');ok(calls.length===1,'changed mailbox cannot read an old account conversation');
 profile={id:'account-a',mail:null,userPrincipalName:'owner@example.test'};context=scope();ok((await readFloAssistSource('a',{app_id:'outlook',source_id:'sent-a'},options(context))).account_id==='owner@example.test','UPN fallback verifies the mailbox');
 profile={id:'account-a'};context=scope();calls=[];await assert.rejects(readFloAssistSource('a',{app_id:'outlook',source_id:'sent-a'},options(context)),e=>e.code==='FLOASSIST_OUTLOOK_IDENTITY_REQUIRED');ok(calls.length===1,'missing identity stops before mailbox access');
 profile={id:'account-a',mail:'owner@example.test'};

 // A pre-existing per-message task must not be duplicated or reopened.
 const legacy=observeTracking(db,'a',{...finding(source),'source_id':'legacy-message',category:'priority'},now);
 db.prepare('INSERT OR REPLACE INTO floassist_message_threads VALUES (?,?,?,?)').run('a','outlook','legacy-message','outlook-conversation:account-a:legacy-conversation');
 const reused=observeTracking(db,'a',{...finding(source),source_id:'outlook-conversation:account-a:legacy-conversation',category:'deadlines'},now);
 assert.equal(reused.task.task_id,legacy.task.task_id);checks++;
 db.prepare("UPDATE kanban_tasks SET status='completed' WHERE id=?").run(legacy.task.task_id);
 assert.equal(observeTracking(db,'a',{...finding(source),source_id:'outlook-conversation:account-a:legacy-conversation'},now).notification,'task_closed');checks++;

 mode='empty';context=scope();const row=db.prepare('SELECT * FROM floassist_task_tracking WHERE task_id=?').get(first.task.task_id);
 const closed=await verifyOrphanClosure('a',{task_id:row.task_id,app_id:row.app_id,account_id:row.account_id,source_id:row.source_id,obligation_key:row.obligation_key,action:'close_orphan'},{...options(context),caller:'coo'});
 assert.equal(closed.action,'clarify');checks++;
 const legacyRow=db.prepare('SELECT * FROM floassist_task_tracking WHERE task_id=?').get(legacy.task.task_id);const legacyClosure=await verifyOrphanClosure('a',{task_id:legacyRow.task_id,app_id:'outlook',account_id:legacyRow.account_id,source_id:legacyRow.source_id,obligation_key:legacyRow.obligation_key,action:'close_orphan'},{...options(context),caller:'coo'});assert.equal(legacyClosure.action,'clarify','known legacy aliases cannot close a conversation through a missing message');checks++;
 ok(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(first.task.task_id).status==='open','conversation search absence cannot close an Outlook task');
 db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify({...prefs,connectors:['gmail']}),'a');mode='sent';calls=[];
 await assert.rejects(readFloAssistSource('a',{app_id:'outlook'},options(scope())),e=>e.code==='FLOASSIST_CONNECTOR_NOT_SELECTED');ok(calls.length===0,'deselected Outlook is rejected before provider access');
 console.log(`FLOASSIST_OUTLOOK_OK: ${checks} checks; normalized identity/conversations, shared tracking and dispatcher, bounded content, isolation and negative provider cases`);
}finally{Date.now=clock;db.close();}
