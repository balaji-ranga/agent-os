import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {initializeFloAssist} from '../src/services/floassist/core.js';
import {recordFloAssistConnectorHealth as record,checkFloAssistConnectorHealth as check,connectorFailureState} from '../src/services/floassist/connector-health.js';
import {tickFloAssistNotifications} from '../src/services/floassist/runtime.js';
const db=new Database(':memory:');initializeFloAssist(db);
db.exec('CREATE TABLE platform_users(id TEXT PRIMARY KEY,enabled INTEGER)');
const prefs={connectors:['gmail','google_calendar'],responsibilities:['priority'],timezone:'Asia/Singapore',quiet_start:'00:00',quiet_end:'00:00'};
for(const owner of ['a','b']){db.prepare('INSERT INTO platform_users VALUES (?,1)').run(owner);db.prepare('INSERT INTO floassist_profiles VALUES (?,?,?,?,?,?,?,?)').run(owner,'fixture','+6581234567','active',JSON.stringify(prefs),'{}',0,0);}
let n=0;const eq=(a,b)=>{assert.deepEqual(a,b);n++;};const total=()=>db.prepare('SELECT count(*) n FROM floassist_notifications').get().n;
try{
 eq(record('a','gmail','available',{db}).queued,false);
 eq(record('a','gmail','authorization',{db}).queued,true);
 eq(record('a','gmail','authorization',{db}).queued,false);eq(total(),1);
 eq(record('a','outlook','authorization',{db}).ignored,true);eq(total(),1);
 eq(record('b','gmail','authorization',{db}).queued,true);eq(total(),2);
 let sent=0;await tickFloAssistNotifications({db,send:async()=>{sent++;return {ok:true};}});eq(sent,2);
 eq(record('a','gmail','available',{db}).queued,true);eq(total(),3);
 eq(record('a','gmail','available',{db}).queued,false);
 eq(record('a','gmail','authorization',{db}).queued,true);eq(total(),4);
 await check('a',{db,getInventory:async()=>({connected:['gmail']})});eq(total(),5);
 await check('a',{db,getInventory:async()=>({connected:['gmail','googlecalendar']})});
 eq(db.prepare("SELECT state FROM floassist_connector_health WHERE owner_id='a' AND app_id='gmail'").get().state,'authorization');
 eq(record('a','googlecalendar','available',{db}).queued,false);eq(total(),5);
 eq(db.prepare("SELECT count(*) n FROM floassist_notifications WHERE status='cancelled'").get().n,1);
 eq(connectorFailureState({provider_status:401}),'authorization');eq(connectorFailureState({provider_status:403}),'permission');eq(connectorFailureState({provider_status:429}),'temporary');eq(connectorFailureState({message:'invalid_grant secret must not persist'}),'authorization');eq(connectorFailureState({status:400}),'unknown');
 db.prepare("UPDATE floassist_profiles SET status='paused' WHERE owner_id='a'").run();eq(record('a','gmail','authorization',{db}).ignored,true);
 db.prepare("UPDATE platform_users SET enabled=0 WHERE id='b'").run();eq(record('b','gmail','available',{db}).ignored,true);
 console.log(`FLOASSIST_CONNECTOR_HEALTH_OK: ${n} checks`);
}finally{db.close();}
