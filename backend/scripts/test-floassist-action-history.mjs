import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initializeFloAssist} from '../src/services/floassist/core.js';
import {listActionHistory,linkActionContext,notifyActionOutcome} from '../src/services/floassist/action-history.js';
const db=new Database(':memory:');initializeFloAssist(db);
db.exec(`CREATE TABLE platform_users(id TEXT PRIMARY KEY,enabled INTEGER); CREATE TABLE tool_execution_actions(id TEXT PRIMARY KEY,owner_user_id TEXT,agent_id TEXT,tool_name TEXT,request_payload TEXT,observation_status TEXT,reason_code TEXT,created_at TEXT DEFAULT (datetime('now')),completed_at TEXT,execution_key TEXT);`);
for(const o of ['a','b']){db.prepare('INSERT INTO platform_users VALUES (?,1)').run(o);db.prepare('INSERT INTO floassist_profiles VALUES (?,?,?,?,?,?,?,?)').run(o,'coo','+6581234567','active','{}','{}',0,0);}
const add=(id,owner,agent,action,status)=>db.prepare("INSERT INTO tool_execution_actions(id,owner_user_id,agent_id,tool_name,request_payload,observation_status,execution_key) VALUES (?,?,?,'connector_execute_action',?,?,?)").run(id,owner,agent,JSON.stringify({action_id:action,input:{eventId:'event-1',start:'2026-10-26T10:00:00+08:00',token:'secret',body:'private'}}),status,'execution');
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
try{
 add('one','a','coo','googlecalendar.update_event','success');add('two','b','coo','googlecalendar.update_event','success');add('three','a','other','googlecalendar.delete_event','permanent_error');add('four','a','coo','googlecalendar.list_calendars','success');
 linkActionContext('one','a',{goal_run_id:'goal-1',scheduled_goal_run_id:'schedule-1',original_request:'do not persist'},db);
 const rows=listActionHistory({ownerUserId:'a',agentId:'coo',database:db});eq(rows.length,2);const changed=rows.find(r=>r.evidence_id==='one');eq(changed.context,{goal_run_id:'goal-1',scheduled_goal_run_id:'schedule-1'});eq(changed.resources,{eventId:'event-1'});eq(JSON.stringify(rows).includes('secret'),false);eq(JSON.stringify(rows).includes('private'),false);eq(changed.submitted_fields.includes('token'),false);
 notifyActionOutcome('one',db);notifyActionOutcome('one',db);notifyActionOutcome('four',db);eq(db.prepare('SELECT count(*) n FROM floassist_notifications').get().n,1);
 add('read-availability','a','coo','googlecalendar.free_busy_query','success');notifyActionOutcome('read-availability',db);eq(db.prepare('SELECT count(*) n FROM floassist_notifications').get().n,1);
 notifyActionOutcome('three',db);eq(db.prepare('SELECT count(*) n FROM floassist_notifications').get().n,2);
 eq(listActionHistory({ownerUserId:'b',agentId:'coo',database:db})[0].evidence_id,'two');
 eq(changed.verification.includes('read-back'),true);
 db.prepare("UPDATE floassist_profiles SET status='paused' WHERE owner_id='b'").run();notifyActionOutcome('two',db);eq(db.prepare('SELECT count(*) n FROM floassist_notifications').get().n,2);
 console.log(`FLOASSIST_ACTION_HISTORY_OK: ${checks} checks`);
}finally{db.close();}
