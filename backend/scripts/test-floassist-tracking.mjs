import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initializeFloAssist} from '../src/services/floassist/core.js';
import {observeTracking,listTracking,updateTracking,ensureTracking} from '../src/services/floassist/tracking.js';
import {tickFloAssistNotifications,floAssistDeliveryGate} from '../src/services/floassist/runtime.js';

// Isolated database and fake delivery: no real mailbox, owner, task or WhatsApp send.
const db=new Database(':memory:');initializeFloAssist(db);ensureTracking(db);
db.exec(`CREATE TABLE platform_users(id TEXT PRIMARY KEY,enabled INTEGER);
 CREATE TABLE kanban_tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,description TEXT,status TEXT,created_by TEXT,owner_user_id TEXT,assigned_user_id TEXT,due_at TEXT,due_date TEXT,updated_at TEXT);
 CREATE TABLE task_messages(id INTEGER PRIMARY KEY,task_id INTEGER,role TEXT,content TEXT);`);
const now=Date.parse('2026-10-25T10:00:00+08:00');
const prefs={connectors:['gmail'],responsibilities:['priority','deadlines','followups'],timezone:'Asia/Singapore',quiet_start:'00:00',quiet_end:'00:00'};
for(const owner of ['owner-a','owner-b']){
 db.prepare('INSERT INTO platform_users VALUES (?,1)').run(owner);
 db.prepare('INSERT INTO floassist_profiles VALUES (?,?,?,?,?,?,?,?)').run(owner,'fixture-coo','+6500000000','active',JSON.stringify(prefs),'{}',now,now);
}
let checks=0;const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const throws=(fn)=>{assert.throws(fn);checks++;};
const finding={app_id:'gmail',account_id:'mailbox-1',source_id:'thread-1',category:'priority',title:'Approve test proposal',evidence:'Thread requests approval',due_at:'2026-10-25T17:00:00+08:00'};
const observe=(extra={},owner='owner-a',at=now)=>observeTracking(db,owner,{...finding,...extra},at);
const sent=[];const send=async r=>{sent.push(r);return {ok:true};};
try{
 const first=observe();const id=first.task.task_id;
 eq(first.notification,'queued','new obligation queues');
 eq(db.prepare('SELECT assigned_user_id FROM kanban_tasks WHERE id=?').get(id).assigned_user_id,'owner-a','human-owned task');
 eq(observe({title:'Different alert words',category:'deadlines'}).task.task_id,id,'same obligation across responsibilities');
 eq(observe().notification,'already_pending','retries dedupe before send');
 eq(listTracking(db,'owner-a').tasks[0].categories,['priority','deadlines'],'categories merged');
 await tickFloAssistNotifications({db,send,now});eq(sent.length,1,'one delivery');
 eq(observe({due_at:'2026-10-25T09:00:00Z'}).notification,'already_sent','equivalent timezone representation deduped');
 eq(observe({},'owner-b').notification,'queued','owners isolated');
 throws(()=>updateTracking(db,'owner-b',{task_id:id,action:'acknowledge',evidence:'seen'}));
 throws(()=>observe({app_id:'outlook'}));
 throws(()=>observe({due_at:'2026-10-25T17:00:00'}));
 // Actual board status is authoritative across sessions, filters and later obligations.
 db.prepare("UPDATE kanban_tasks SET status='completed' WHERE id=?").run(id);
 eq(observe({category:'followups',due_at:'2026-10-27T17:00:00+08:00'}).notification,'task_closed','scan cannot reopen closed obligation');
 eq(listTracking(db,'owner-a').tasks[0].closed,true,'closed task visible to new session');
 const second=observe({source_id:'thread-2'}).task.task_id;
 db.prepare("UPDATE kanban_tasks SET status='completed' WHERE id=?").run(second);
 await tickFloAssistNotifications({db,send,now});eq(sent.filter(r=>r.owner_id==='owner-a').length,1,'close before send cancels pending alert');
 const third=observe({source_id:'thread-3'}).task.task_id;
 updateTracking(db,'owner-a',{task_id:third,action:'acknowledge',evidence:'I have seen it'},now);
 eq(observe({source_id:'thread-3'}).notification,'acknowledged','ack suppresses routine repeats');
 eq(db.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(third).status,'open','ack is not completion');
 throws(()=>updateTracking(db,'owner-a',{task_id:third,action:'clarify',evidence:'Not in scan'},now));
 eq(updateTracking(db,'owner-a',{task_id:third,action:'clarify',source_checked:true,evidence:'Original source checked; cannot establish completion'},now).notification,'queued','missing source requests clarification');
 eq(updateTracking(db,'owner-a',{task_id:third,action:'clarify',source_checked:true,evidence:'Still absent'},now).notification,'clarification_already_requested','clarification not repeated');
 const snoozed=observe({source_id:'thread-4'}).task.task_id;
 updateTracking(db,'owner-a',{task_id:snoozed,action:'snooze',until:'2026-10-25T11:00:00+08:00',evidence:'Remind me at 11'},now);
 const before=sent.length;await tickFloAssistNotifications({db,send,now});
 eq(sent.slice(before).some(r=>r.source_key.includes(`:tracking:${snoozed}:`)),false,'snooze suppresses before due');
 await tickFloAssistNotifications({db,send,now:now+3600000});
 eq(sent.filter(r=>r.source_key.includes(`:tracking:${snoozed}:`)).length,1,'snooze expiry delivers once');
 await tickFloAssistNotifications({db,send,now:now+7200000});eq(sent.filter(r=>r.source_key.includes(`:tracking:${snoozed}:`)).length,1,'expiry not repeated');
 const changed=observe({source_id:'thread-5'});await tickFloAssistNotifications({db,send,now});
 eq(observe({source_id:'thread-5',due_at:'2026-10-27T17:00:00+08:00'}).notification,'queued','verified deadline revision alerts');
 eq(observe({source_id:'thread-5',due_at:'2026-10-27T17:00:00+08:00'}).notification,'already_pending','same revised deadline suppressed');
 const page=listTracking(db,'owner-a',{limit:2});eq(page.tasks.length,2,'bounded pagination');eq(listTracking(db,'owner-a',{after_id:page.next_after_id,limit:2}).tasks.some(t=>t.task_id===id),false,'next page progresses');
 const legacy=Number(db.prepare("INSERT INTO kanban_tasks(title,status,owner_user_id) VALUES ('Existing closed task','completed','owner-a')").run().lastInsertRowid);
 eq(observe({source_id:'legacy',existing_task_id:legacy}).notification,'task_closed','correlate preexisting closed task');
 throws(()=>observe({source_id:'other',existing_task_id:legacy},'owner-b'));
 eq(observe({obligation_key:'new-request-with-separate-evidence',evidence:'A new request in the thread'}).notification,'queued','new obligation can be tracked without reopening old');
 const uncertain=observe({source_id:'uncertain'}).task.task_id;
 await tickFloAssistNotifications({db,now,send:async()=>{throw Error('timeout');}});
 eq(observe({source_id:'uncertain'}).notification,'already_uncertain','uncertain send never auto-replayed');
 const paused=observe({source_id:'paused'}).task.task_id;
 db.prepare("UPDATE floassist_profiles SET status='paused' WHERE owner_id='owner-a'").run();const count=sent.length;
 await tickFloAssistNotifications({db,send,now});eq(sent.length,count,'paused profile stays quiet');
 db.prepare("UPDATE floassist_profiles SET status='active' WHERE owner_id='owner-a'").run();
 const quiet={...prefs,quiet_start:'09:00',quiet_end:'12:00'};db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify(quiet),'owner-a');
 await tickFloAssistNotifications({db,send,now});eq(sent.length,count,'quiet hours preserve pending');
 db.prepare('UPDATE floassist_profiles SET preferences_json=? WHERE owner_id=?').run(JSON.stringify(prefs),'owner-a');
 db.prepare("INSERT INTO floassist_resources VALUES ('owner-a','schedule','priority','schedule-fixture')").run();
 eq(floAssistDeliveryGate({ownerUserId:'owner-a',scheduledGoalId:'schedule-fixture',text:'Changed wording for old closed issue'},db).reason,'kanban_tracking_delivery_only','free-form summary cannot bypass lifecycle');
 eq(floAssistDeliveryGate({ownerUserId:'owner-a',scheduledGoalId:'unrelated',text:'ordinary goal'},db).managed,false,'other scheduled goals unchanged');
 // Re-entrant workers cannot claim a pending notification twice.
 const unique=observe({source_id:'race'}).task.task_id;const race=[];
 await Promise.all([1,2].map(()=>tickFloAssistNotifications({db,now,send:async r=>{race.push(r.source_key);await Promise.resolve();return {ok:true};}})));
 eq(race.filter(k=>k.includes(`:tracking:${unique}:`)).length,1,'concurrent ticks claim once');
 eq(db.prepare('SELECT count(*) n FROM floassist_tracking_audit WHERE owner_id=?').get('owner-a').n>0,true,'decisions audited');
 console.log(`FLOASSIST_TRACKING_OK: ${checks} checks; isolated DB, synthetic delivery, no external side effects`);
}finally{db.close();}
