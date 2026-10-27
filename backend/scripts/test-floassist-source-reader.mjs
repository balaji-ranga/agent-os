import {sourceReference,connectorReferenceResult} from '../src/services/floassist/source-references.js';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFloAssistSource,decodeDocument} from '../src/services/floassist/source-reader.js';
import {assertDeadlineEvidence,recordVerifiedSourceText,historicalDeadlineConfirmed} from '../src/services/floassist/deadline-evidence.js';
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
mode='long';let out=await readFloAssistSource('a',{app_id:'gmail'},options);assert.equal(out.content.length,12000);assert.equal(out.next_offset,12000);out=await readFloAssistSource('a',{app_id:'gmail',source_id:out.source_id,offset:12000},options);assert.equal(out.next_offset,null);assert.match(out.content,/Please submit/);
mode='normal';await assert.rejects(()=>readFloAssistSource('a',{app_id:'google_calendar',time_min:'2026-10-27T00:00Z',time_max:'2027-10-27T00:00Z'}, {...options,context:{owner:'a',origin:'whatsapp'}}),e=>e.code==='FLOASSIST_SOURCE_WINDOW_REQUIRED');
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
const old='Please submit by 7 January 2026 at 3 PM SGT.';recordVerifiedSourceText('a',context,'google_drive','video',[{text:old,at:null}],now);const oldInput={app_id:'google_drive',source_id:'video',deadline_excerpt:old,due_at:'2026-01-07T15:00:00+08:00'};
assert.throws(()=>assertDeadlineEvidence('a',context,oldInput,'Asia/Singapore',now),e=>e.code==='FLOASSIST_DEADLINE_CONFIRMATION_REQUIRED');assert.equal(historicalDeadlineConfirmed(db,'a',oldInput),false);
db.prepare("INSERT INTO kanban_user_action_audit(owner_user_id,task_id,status,action,evidence) VALUES ('a',1,'ok','update','This is still required; keep tracking.')").run();assert.equal(historicalDeadlineConfirmed(db,'a',oldInput),true);assert.equal(historicalDeadlineConfirmed(db,'b',oldInput),false);assert.equal(assertDeadlineEvidence('a',context,oldInput,'Asia/Singapore',now,{historicalConfirmed:historicalDeadlineConfirmed(db,'a',oldInput)}).verified,true);
console.log('FLOASSIST_SOURCE_READER_OK: provider bodies, pagination, provenance, revocation, policy denial, scope inheritance, MCP blocking, timezone/precision/ambiguity and confirmed historical obligations');

mode='normal';calls=[];const draft=await readFloAssistSource('a',{app_id:'gmail',kind:'draft'},options);assert.equal(calls.length,1);assert.equal(draft.source_id,'latest');assert.match(draft.content,/latest saved body/);mode='more';await assert.rejects(readFloAssistSource('a',{app_id:'gmail',kind:'draft'},options),e=>e.code==='FLOASSIST_DRAFT_COVERAGE_LIMIT');console.log('FLOASSIST_DRAFT_READ_OK: bounded single call, latest timestamp selection, incomplete coverage rejected');

mode='normal';
const projectedOptions={...options,execute:async(owner,action,input)=>connectorReferenceResult(db,owner,action,await execute(owner,action,input),context)};
for(const [app,id]of [['gmail','real-thread'],['google_drive','doc']]){
 const ref=sourceReference(db,'a',app,id,context);
 const result=await readFloAssistSource('a',{app_id:app,source_id:ref},projectedOptions);
 assert.equal(result.content_verified,true);assert.equal(result.source_id,id);
}
db.prepare('INSERT INTO floassist_task_tracking VALUES (?,?,?,?,?)').run('a',2,'gmail','real-thread','action');
const reference=sourceReference(db,'a','gmail','real-thread',context);
assert.equal((await readFloAssistSource('a',{app_id:'gmail',source_id:reference,task_id:2},projectedOptions)).content_verified,true);
console.log('FLOASSIST_RUN_REFERENCES_OK: projected provider IDs and task-linked references resolve before identity comparison');
rememberRuntimeChannel({sessionKey:'same-chat',channel:'whatsapp',runId:'first'},now);assert.equal(runtimeRunId({sessionKey:'same-chat'},null,now),'first');rememberRuntimeChannel({sessionKey:'same-chat',channel:'whatsapp',runId:'second'},now);assert.equal(runtimeRunId({sessionKey:'same-chat'},null,now),'second');assert.equal(runtimeRunId({sessionKey:'other-chat'},null,now),null);
db.prepare('INSERT OR REPLACE INTO floassist_message_threads VALUES (?,?,?,?)').run('a','gmail','message-alias','real-thread');
const messageRef=sourceReference(db,'a','gmail','message-alias',context);assert.equal((await readFloAssistSource('a',{app_id:'gmail',source_id:messageRef},projectedOptions)).source_id,'real-thread');
db.close();
