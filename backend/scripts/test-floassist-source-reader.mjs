import {sourceReference,connectorReferenceResult} from '../src/services/floassist/source-references.js';
import {recordRunError} from '../src/services/floassist/source-receipts.js';
import {pendingSourceCoverage,requireAppCoverage} from '../src/services/floassist/source-coverage.js';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFloAssistSource,decodeDocument,briefingCalendarWindow} from '../src/services/floassist/source-reader.js';
import {assertDeadlineEvidence,recordVerifiedSourceText,historicalDeadlineConfirmed,deadlineEvidenceSuggestions} from '../src/services/floassist/deadline-evidence.js';
import {assertFloAssistConnector,resolveFloAssistScope,bindFloAssistWork,withFloAssistScope,assertFloAssistMcpRoute} from '../src/services/floassist/execution-scope.js';
import {rememberRuntimeChannel,runtimeChannel,runtimeRunId} from '../../openclaw-extensions/agent-os-content-tools/runtime-channel.js';
const db=new Database(':memory:');
db.exec(`CREATE TABLE floassist_profiles(owner_id TEXT,agent_id TEXT,status TEXT,preferences_json TEXT);
 CREATE TABLE floassist_task_tracking(owner_id TEXT,task_id INTEGER,app_id TEXT,source_id TEXT,obligation_key TEXT);
 CREATE TABLE scheduled_goals(id TEXT,owner_user_id TEXT,source TEXT);
 CREATE TABLE scheduled_goal_runs(id TEXT,owner_user_id TEXT,goal_id TEXT);
 CREATE TABLE agent_goal_runs(id TEXT,owner_user_id TEXT,scheduled_goal_run_id TEXT);
 CREATE TABLE kanban_user_action_audit(id INTEGER PRIMARY KEY,owner_user_id TEXT,task_id INTEGER,status TEXT,action TEXT,evidence TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
const prefs={connectors:['gmail','outlook','google_drive','onedrive','google_calendar'],timezone:'Asia/Singapore'};
for(const owner of ['a','b'])db.prepare('INSERT INTO floassist_profiles VALUES (?,?,?,?)').run(owner,'coo','active',JSON.stringify(prefs));
db.prepare('INSERT INTO floassist_task_tracking VALUES (?,?,?,?,?)').run('a',1,'google_drive','video','action');
const now=Date.parse('2026-10-27T00:00:00Z'),context={owner:'a',run:'run',origin:'floassist:deadlines'};
const passage='Please submit the report by 27 October 2026 at 3 PM SGT.';
let calls=[],authorizations=[],mode='normal';
const execute=async(owner,action,input)=>{
 calls.push({owner,action,input});
 if(mode==='denied')throw Object.assign(new Error('Provider denied'),{status:403,code:'authorization_failed'});
 const data={
  'gmail.list_drafts':{drafts:[{id:'older',message:{messageTimestamp:'2026-10-25T00:00:00Z',messageText:'old'}},{id:'latest',message:{messageTimestamp:'2026-10-26T00:00:00Z',messageText:'latest saved body',subject:'Draft'}}],...(mode==='more'?{nextPageToken:'next'}:{})},
  'gmail.list_threads':{threads:[{threadId:'real-thread'}]},
  'gmail.fetch_message_by_thread_id':{threadId:mode==='wrong'?'other':input.threadId,messages:[{subject:'Report',messageText:mode==='long'?'x'.repeat(13000)+passage:passage,messageTimestamp:'2026-10-26T10:00:00Z'}]},
  'outlook.list_messages':{messages:[{id:'outlook-real'}]},
  'outlook.get_message':{id:input.messageId,subject:'Report',body:{contentType:'text',content:passage},receivedDateTime:'2026-10-26T10:00:00Z'},
  'googledrive.files.list':{files:[{id:'file-a',name:'Source',mimeType:'text/plain'}]},
  'googledrive.files.get':{id:input.fileId,mimeType:input.fileId==='video'?'video/quicktime':'application/vnd.google-apps.document',name:'source'},
  'googledrive.files.export':{fileId:input.fileId,file:{fileId:'server-returned-transit-id',mimeType:'text/plain',name:'source.txt'}},
  'one_drive.get_item':{id:input.itemId,file:{mimeType:'text/plain'},name:'source.txt'},
  'one_drive.download_file':{contentBase64:Buffer.from(passage).toString('base64'),mimeType:'text/plain'},
  'googlecalendar.list_events':{items:[],...(mode==='more'?{nextPageToken:'next'}:{})},
 }[action];
 assert.ok(data,`Unexpected provider action ${action}`);
 return {ok:true,data:{success:true,data}};
};
const authorize=async(...args)=>authorizations.push(args);
const options={db,context,execute,authorize,now,readTransit:async(owner,id)=>{assert.equal(owner,'a');assert.equal(id,'server-returned-transit-id');return Buffer.from(passage);}};
let gmailEvidenceReference;
for(const [app,id]of [['gmail',undefined],['outlook',undefined],['google_drive','doc'],['onedrive','file']]){
 calls=[];const out=await readFloAssistSource('a',{app_id:app,source_id:id},options);
 assert.equal(out.content_verified,true);assert.match(out.content,/Please submit/);assert.equal(out.next_offset,null);
 assert.equal(assertDeadlineEvidence('a',context,{app_id:app,source_id:out.source_id,due_at:'2026-10-27T15:00:00+08:00',deadline_excerpt:passage},'Asia/Singapore',now).verified,true);
 assert.ok(calls.every(x=>x.owner==='a'));
}
assert.equal(authorizations.length,8);
const media=await readFloAssistSource('a',{task_id:1},options);assert.equal(media.unsupported,true);assert.equal(media.app_id,'google_drive');assert.equal(media.content_verified,false);
await assert.rejects(()=>readFloAssistSource('b',{task_id:1},{...options,context:null}),e=>e.status===404);
await assert.rejects(()=>readFloAssistSource('a',{task_id:1,app_id:'gmail'},options),e=>e.code==='FLOASSIST_SOURCE_MISMATCH');
mode='wrong';await assert.rejects(()=>readFloAssistSource('a',{app_id:'gmail'},options),e=>e.code==='FLOASSIST_SOURCE_READ_FAILED');
mode='denied';await assert.rejects(()=>readFloAssistSource('a',{app_id:'gmail'},options),e=>e.status===403);
mode='long';let out=await readFloAssistSource('a',{app_id:'gmail'},options);assert.equal(out.content.length,12000);assert.equal(out.next_offset,12000);out=await readFloAssistSource('a',{app_id:'gmail',source_id:out.source_id,snapshot_id:out.snapshot_id,offset:12000},options);assert.equal(out.next_offset,null);assert.match(out.content,/Please submit/);
mode='normal';await assert.rejects(()=>readFloAssistSource('a',{app_id:'google_calendar',time_min:'2026-10-27T00:00Z',time_max:'2027-10-27T00:00Z'}, {...options,context:{owner:'a',origin:'whatsapp'}}),e=>e.code==='FLOASSIST_SOURCE_WINDOW_REQUIRED');
for(const [zone,start]of [['Asia/Singapore','2026-10-26T16:00:00.000Z'],['Asia/Kolkata','2026-10-26T18:30:00.000Z'],['Asia/Jakarta','2026-10-26T17:00:00.000Z']])assert.equal(briefingCalendarWindow(now,zone).time_min,start);
calls=[];await readFloAssistSource('a',{app_id:'google_calendar'},{...options,context:{...context,origin:'floassist:briefing'}});assert.equal(calls.at(-1).input.timeMin,'2026-10-26T16:00:00.000Z');assert.equal(calls.at(-1).input.timeMax,'2026-10-27T16:00:00.000Z');
await assert.rejects(()=>readFloAssistSource('a',{app_id:'google_calendar'},{...options,context:{owner:'a',origin:'whatsapp'}}),e=>e.code==='FLOASSIST_SOURCE_WINDOW_REQUIRED','ad hoc requests still require their explicit intended window');
mode='more';out=await readFloAssistSource('a',{app_id:'google_calendar',time_min:'2026-10-27T00:00Z',time_max:'2026-10-28T00:00Z'},{...options,context:{owner:'a',origin:'whatsapp'}});assert.equal(out.provider_complete,false);
mode='normal';await assert.rejects(()=>decodeDocument(Buffer.from('video'),'video/quicktime','source.mov'),e=>e.code==='FLOASSIST_SOURCE_UNSUPPORTED');
await assert.rejects(()=>decodeDocument(Buffer.alloc(5*1024*1024+1),'text/plain','big.txt'),e=>e.code==='FLOASSIST_SOURCE_SIZE_LIMIT');
// Revocation between discovery and content retrieval is checked again.
let providerCalls=0;
await assert.rejects(()=>readFloAssistSource('a',{app_id:'gmail'},{...options,execute:async(...args)=>{const r=await execute(...args);providerCalls++;db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify({connectors:[]}),'a');return r;}}),e=>e.code==='FLOASSIST_CONNECTOR_NOT_SELECTED');assert.equal(providerCalls,1);
db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify(prefs),'a');
await assert.rejects(()=>readFloAssistSource('a',{app_id:'gmail'},{...options,authorize:()=>{throw Object.assign(new Error('Denied'),{status:403});}}),e=>e.status===403);
// All registered execution paths preserve the same owner scope.
for(const kind of ['session','delegation','goal','workflow']){
 bindFloAssistWork(db,'a',kind,'work',context);
 const field={session:'session_key',delegation:'delegation_task_id',goal:'goal_run_id',workflow:'workflow_run_id'}[kind];
 const restored=resolveFloAssistScope(db,'a','other',{[field]:'work'});
 assert.deepEqual(restored,context);assert.equal(resolveFloAssistScope(db,'b','other',{[field]:'work'}),null);
 await withFloAssistScope(restored,async()=>{await Promise.resolve();assert.throws(()=>assertFloAssistConnector('a','github.get_issue',db),e=>e.code==='FLOASSIST_CONNECTOR_NOT_SELECTED');assert.throws(()=>assertFloAssistMcpRoute(),e=>e.code==='FLOASSIST_CONNECTOR_ROUTE_REQUIRED');});
}
assert.equal(resolveFloAssistScope(db,'a','coo',{},'web'),null);
assert.throws(()=>assertFloAssistConnector('a','gmail.get_profile',db,resolveFloAssistScope(db,'a','coo',{},'unknown')),e=>e.code==='FLOASSIST_CONTEXT_REQUIRED');
assert.doesNotThrow(()=>assertFloAssistMcpRoute(null));
rememberRuntimeChannel({sessionKey:'one',channel:'whatsapp'},100);assert.equal(runtimeChannel({sessionKey:'one'},null,101),'whatsapp');assert.equal(runtimeChannel({sessionKey:'two'},null,101),null);assert.equal(runtimeChannel({sessionKey:'one'},null,3600101),null);
// Date precision, source timezone, ambiguous dates, and old confirmation.
for(const [quote,due,precision]of [['Please send by 27/10/2026 at 3 PM SGT.','2026-10-27T15:00:00+08:00','minute'],['Please send by 27 October 2026.','2026-10-27T15:00:00+08:00','day'],['Please send by tomorrow at 3 PM IST.','2026-10-27T15:00:00+05:30','minute']]){
 recordVerifiedSourceText('a',context,'outlook','date',[{text:quote,at:'2026-10-26T10:00:00Z'}],now);
 const verified=assertDeadlineEvidence('a',context,{app_id:'outlook',source_id:'date',deadline_excerpt:quote,due_at:due},'Asia/Singapore',now);assert.equal(verified.precision,precision);if(precision==='day')assert.equal(verified.due_at,'2026-10-27T15:59:59.000Z');
}
const ambiguous='Please send by 03/04/2026 at 3 PM.';recordVerifiedSourceText('a',context,'gmail','amb',[{text:ambiguous,at:null}],now);assert.throws(()=>assertDeadlineEvidence('a',context,{app_id:'gmail',source_id:'amb',deadline_excerpt:ambiguous,due_at:'2026-04-03T15:00:00+08:00'},'Asia/Singapore',now));
const dateFirst='27 October 2026, 3 PM SGT: please submit the test report.';recordVerifiedSourceText('a',context,'gmail','date-first',[{text:dateFirst,at:now}],now);const suggested=deadlineEvidenceSuggestions('a',context,'gmail','date-first','Asia/Singapore',dateFirst,now);assert.equal(suggested.length,1);assert.equal(suggested[0].due_at,'2026-10-27T07:00:00.000Z');assert.equal(assertDeadlineEvidence('a',context,{app_id:'gmail',source_id:'date-first',...suggested[0]},'Asia/Singapore',now).verified,true);
const old='Please submit by 7 January 2026 at 3 PM SGT.';recordVerifiedSourceText('a',context,'google_drive','video',[{text:old,at:null}],now);const oldInput={app_id:'google_drive',source_id:'video',deadline_excerpt:old,due_at:'2026-01-07T15:00:00+08:00'};
assert.throws(()=>assertDeadlineEvidence('a',context,oldInput,'Asia/Singapore',now),e=>e.code==='FLOASSIST_DEADLINE_CONFIRMATION_REQUIRED');assert.equal(historicalDeadlineConfirmed(db,'a',oldInput),false);
db.prepare("INSERT INTO kanban_user_action_audit(owner_user_id,task_id,status,action,evidence) VALUES ('a',1,'ok','update','This is still required; keep tracking.')").run();assert.equal(historicalDeadlineConfirmed(db,'a',oldInput),true);assert.equal(historicalDeadlineConfirmed(db,'b',oldInput),false);assert.equal(assertDeadlineEvidence('a',context,oldInput,'Asia/Singapore',now,{historicalConfirmed:historicalDeadlineConfirmed(db,'a',oldInput)}).verified,true);
console.log('FLOASSIST_SOURCE_READER_OK: provider bodies, pagination, provenance, revocation, policy denial, scope inheritance, MCP blocking, timezone/precision/ambiguity and confirmed historical obligations');

mode='normal';for(const source_id of ['latest','most_recent','@latest'])assert.match((await readFloAssistSource('a',{app_id:'gmail',kind:'draft',source_id},options)).content,/latest saved body/);await assert.rejects(readFloAssistSource('a',{app_id:'gmail',kind:'draft',source_id:'real-draft-id'},options),e=>e.code==='FLOASSIST_SOURCE_UNSUPPORTED');calls=[];const draft=await readFloAssistSource('a',{app_id:'gmail',kind:'draft'},options);assert.equal(calls.length,1);assert.equal(draft.source_id,'latest');assert.match(draft.content,/latest saved body/);mode='more';await assert.rejects(readFloAssistSource('a',{app_id:'gmail',kind:'draft'},options),e=>e.code==='FLOASSIST_DRAFT_COVERAGE_LIMIT');console.log('FLOASSIST_DRAFT_READ_OK: bounded single call, latest timestamp selection, incomplete coverage rejected');

mode='normal';
const projectedOptions={...options,execute:async(owner,action,input)=>connectorReferenceResult(db,owner,action,await execute(owner,action,input),context)};
for(const [app,id]of [['gmail','real-thread'],['google_drive','doc']]){
 const ref=sourceReference(db,'a',app,id,context);
 const result=await readFloAssistSource('a',{app_id:app,source_id:ref},projectedOptions);
 assert.equal(result.content_verified,true);assert.equal(result.source_id,id);
}
db.prepare('INSERT INTO floassist_task_tracking VALUES (?,?,?,?,?)').run('a',2,'gmail','real-thread','action');
const reference=sourceReference(db,'a','gmail','real-thread',context);
const mismatchCalls=calls.length;let taskMismatch;
try{await readFloAssistSource('a',{app_id:'google_drive',source_id:'wrong-file',task_id:2},projectedOptions);}catch(e){taskMismatch=e;}
assert.equal(taskMismatch.code,'FLOASSIST_SOURCE_MISMATCH');assert.deepEqual(taskMismatch.next_action.input,{task_id:2});assert.equal(calls.length,mismatchCalls,'wrong source overrides cause no provider request');
recordRunError(taskMismatch,{db,context,sourceInput:{task_id:2,app_id:'google_drive',source_id:'wrong-file'}});
recordRunError(taskMismatch,{db,context:{...context,owner:'b'},sourceInput:{task_id:2}});
assert.equal((await readFloAssistSource('a',{app_id:'gmail',source_id:reference,task_id:2},projectedOptions)).content_verified,true);
assert.equal(db.prepare("SELECT COUNT(*) n FROM floassist_run_errors WHERE owner_id='a' AND code='FLOASSIST_SOURCE_MISMATCH' AND resolved_at IS NOT NULL").get().n,1,'a full canonical task read resolves only that rejected override');
assert.equal(db.prepare("SELECT COUNT(*) n FROM floassist_run_errors WHERE owner_id='b' AND code='FLOASSIST_SOURCE_MISMATCH' AND resolved_at IS NULL").get().n,1,'another owner mismatch remains unresolved');
console.log('FLOASSIST_RUN_REFERENCES_OK: projected provider IDs and task-linked references resolve before identity comparison');
rememberRuntimeChannel({sessionKey:'same-chat',channel:'whatsapp',runId:'first'},now);assert.equal(runtimeRunId({sessionKey:'same-chat'},null,now),'first');rememberRuntimeChannel({sessionKey:'same-chat',channel:'whatsapp',runId:'second'},now);assert.equal(runtimeRunId({sessionKey:'same-chat'},null,now),'second');assert.equal(runtimeRunId({sessionKey:'other-chat'},null,now),null);
db.prepare('INSERT OR REPLACE INTO floassist_message_threads VALUES (?,?,?,?)').run('a','gmail','message-alias','real-thread');
const messageRef=sourceReference(db,'a','gmail','message-alias',context);assert.equal((await readFloAssistSource('a',{app_id:'gmail',source_id:messageRef},projectedOptions)).source_id,'real-thread');
const discovery=await readFloAssistSource('a',{app_id:'google_drive'},options);assert.equal(discovery.discovery_only,true);assert.equal(discovery.content_verified,false);assert.equal(discovery.source_candidates[0].source_id,'file-a');assert.match(calls.at(-1).input.q,/modifiedTime > /);
const refOnce=sourceReference(db,'a','gmail','real-thread',context);assert.equal(sourceReference(db,'a','gmail',refOnce,context),refOnce,'projection is idempotent');
const largeText='x'.repeat(150000)+'\n'+passage;calls=[];
const largePage=await readFloAssistSource('a',{app_id:'google_drive',source_id:'large-doc'},{...options,extract:async()=>largeText});assert.equal(largePage.total_characters,largeText.length);assert.equal(largePage.content.length,12000);assert.ok(largePage.next_request);assert.equal(largePage.coverage_complete,false);await assert.rejects(readFloAssistSource('a',{app_id:'google_drive',source_id:'large-doc',offset:12000,snapshot_id:'other-snapshot'},options),e=>e.code==='FLOASSIST_SOURCE_SNAPSHOT_EXPIRED'&&e.next_action?.input?.offset===0&&e.next_action.input.source_id==='large-doc','pages cannot mix source versions; exact safe restart is supplied');
const lastOnly=await readFloAssistSource('a',{app_id:'google_drive',source_id:'large-doc',snapshot_id:largePage.snapshot_id,offset:144000},options);assert.equal(lastOnly.coverage_complete,false);assert.equal(lastOnly.next_offset,12000,'jumping to the last page cannot claim full coverage');
const snapshotProviderCalls=calls.length;
const largeNext=await readFloAssistSource('a',largePage.next_request,options);assert.equal(calls.length,snapshotProviderCalls,'snapshot pages do not repeat provider downloads');assert.equal(largeNext.offset,12000);assert.equal((await readFloAssistSource('a',{...largePage.next_request,app_id:'google_drive',source_id:'large-doc'},options)).offset,12000,'matching source context is harmless and cursor remains authoritative');assert.ok(largePage.next_request.cursor);assert.deepEqual(Object.keys(largePage.next_request),['cursor']);await assert.rejects(readFloAssistSource('a',largePage.next_request,{...options,context:{...context,run:'foreign-run'}}),e=>e.code==='FLOASSIST_SOURCE_SNAPSHOT_EXPIRED','cursor is run-bound');await assert.rejects(readFloAssistSource('a',{...largePage.next_request,app_id:'gmail'},options),e=>e.code==='FLOASSIST_SOURCE_OFFSET_INVALID','cursor source cannot be overridden');
await assert.rejects(readFloAssistSource('a',largePage.next_request,{...options,authorize:async()=>{throw Object.assign(Error('policy denied'),{status:403});}}),e=>e.status===403,'cached pages recheck policy');
db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify({...prefs,connectors:['gmail']}),'a');await assert.rejects(readFloAssistSource('a',largePage.next_request,options),e=>e.code==='FLOASSIST_CONNECTOR_NOT_SELECTED');db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify(prefs),'a');
await assert.rejects(readFloAssistSource('b',largePage.next_request,{...options,context:{...context,owner:'b'}}),e=>e.code==='FLOASSIST_SOURCE_SNAPSHOT_EXPIRED','snapshots never cross owners');
const pagingError=Object.assign(Error('invalid page'),{code:'FLOASSIST_SOURCE_OFFSET_INVALID'});
for(const [sourceInput,ctx]of [[{app_id:'google_drive',source_id:'large-doc'},context],[{app_id:'google_drive',source_id:'other-doc'},context],[{app_id:'google_drive',source_id:'large-doc'},{...context,owner:'b'}],[{app_id:'google_drive',source_id:'large-doc'},{...context,run:'other-run'}]])recordRunError(pagingError,{db,context:ctx,sourceInput});
recordRunError(Object.assign(Error('provider denied'),{code:'authorization_failed'}),{db,context,sourceInput:{app_id:'google_drive',source_id:'large-doc'}});
assert.equal(db.prepare("SELECT COUNT(*) n FROM floassist_run_errors WHERE code='FLOASSIST_SOURCE_OFFSET_INVALID' AND resolved_at IS NOT NULL").get().n,0,'partial reads cannot resolve paging failures');
let reviewed=largeNext;while(reviewed.next_request)reviewed=await readFloAssistSource('a',reviewed.next_request,options);assert.equal(reviewed.coverage_complete,true);assert.equal(calls.length,snapshotProviderCalls,'all pages share one authenticated download');
assert.equal(db.prepare("SELECT COUNT(*) n FROM floassist_run_errors WHERE code='FLOASSIST_SOURCE_OFFSET_INVALID' AND resolved_at IS NOT NULL").get().n,1,'only the completed exact owner/run/source paging error is resolved');
assert.equal(db.prepare("SELECT COUNT(*) n FROM floassist_run_errors WHERE code='authorization_failed' AND resolved_at IS NULL").get().n,1,'complete content never erases authorization failures');
await assert.rejects(readFloAssistSource('a',largePage.next_request,{...options,now:now+300001}),e=>e.code==='FLOASSIST_SOURCE_SNAPSHOT_EXPIRED','snapshots expire after five minutes');
const chunks=[];for(let i=0;i<3;i++)chunks.push(await readFloAssistSource('a',{app_id:'google_drive',source_id:'bounded-'+i},{...options,extract:async()=>'x'.repeat(800000)}));
await assert.rejects(readFloAssistSource('a',chunks[0].next_request,options),e=>e.code==='FLOASSIST_SOURCE_SNAPSHOT_EXPIRED','global snapshot capacity evicts old content');
await assert.rejects(readFloAssistSource('a',{app_id:'google_drive',source_id:'oversized'},{...options,extract:async()=>'x'.repeat(1000001)}),e=>e.code==='FLOASSIST_SOURCE_SIZE_LIMIT');
console.log('FLOASSIST_SOURCE_SNAPSHOTS_OK: large text pages, no repeated downloads, fresh policy/selection checks, owner isolation, expiry and global memory bound');
const discoveryContext={owner:'a',run:'guarded-discovery',origin:'floassist:deadlines'};
const guarded={...options,discoverUnknownSources:true,context:discoveryContext,execute:async(owner,action,input)=>{
 if(action==='gmail.get_profile')return {ok:true,data:{emailAddress:'fixture@example.test'}};
 if(action==='googledrive.about.get')return {ok:true,data:{user:{emailAddress:'fixture@example.test'}}};
 if(action==='googlecalendar.list_calendars')return {ok:true,data:{items:[{id:'primary'}]}};
 return execute(owner,action,input);
}};
for(const [app,guessed]of [['gmail','invented-gmail-id'],['google_drive','invented-drive-id']]){
 calls=[];const found=await readFloAssistSource('a',{app_id:app,source_id:guessed},guarded);
 assert.equal(found.requested_source_read,false);assert.equal(found.content_verified,false);assert.equal(found.discovery_only,true);assert.ok(found.source_candidates.length);
 assert.equal(calls.some(c=>Object.values(c.input).includes(guessed)),false,'guessed IDs never reach provider requests');
 assert.ok(pendingSourceCoverage(db,'a',discoveryContext.run).some(c=>c.app_id===app),'metadata discovery is not complete review');
 const verified=await readFloAssistSource('a',found.source_candidates[0],guarded);assert.equal(verified.content_verified,true);assert.equal(verified.coverage_complete,true);
 assert.equal(pendingSourceCoverage(db,'a',discoveryContext.run).some(c=>c.app_id===app),false);
}
const calendarGuard={...guarded,context:{...discoveryContext,origin:'floassist:briefing'}};
const discoveredCalendar=await readFloAssistSource('a',{app_id:'google_calendar',source_id:'invented-calendar-id'},calendarGuard);assert.equal(discoveredCalendar.content_verified,false);
await readFloAssistSource('a',discoveredCalendar.source_candidates[0],calendarGuard);assert.equal(pendingSourceCoverage(db,'a',discoveryContext.run).length,0);
await assert.rejects(readFloAssistSource('a',{app_id:'gmail',source_id:'another-guessed-id'},{...guarded,authorize:async()=>{throw Object.assign(Error('fixture denied'),{status:403});}}),e=>e.status===403,'discovery cannot bypass action authorization');
console.log('FLOASSIST_DISCOVERY_GUARD_OK: guessed IDs not executed, bounded real discovery, full candidate review and grants retained');
const emptyScope={...discoveryContext,run:'verified-empty-mail'};requireAppCoverage(db,emptyScope,'gmail',{app_id:'gmail'});
const emptyMail=await readFloAssistSource('a',{app_id:'gmail'},{...guarded,context:emptyScope,execute:async(owner,action,input)=>action==='gmail.list_threads'?{ok:true,data:{threads:[]}}:guarded.execute(owner,action,input)});
assert.equal(emptyMail.empty,true);assert.equal(pendingSourceCoverage(db,'a',emptyScope.run).length,0,'only a real empty provider result satisfies empty-mailbox coverage');
db.close();

rememberRuntimeChannel({sessionKey:"turn-preserve",channel:"whatsapp",runId:"turn-a"});
rememberRuntimeChannel({sessionKey:"turn-preserve",channel:"whatsapp"});
assert.equal(runtimeRunId({sessionKey:"turn-preserve"}),"turn-a");
rememberRuntimeChannel({sessionKey:"turn-preserve",runId:"turn-b"});
assert.equal(runtimeRunId({sessionKey:"turn-preserve"}),"turn-b");
