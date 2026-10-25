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
 eq(db.prepare("SELECT text FROM floassist_notifications WHERE owner_id='a'").get().text.startsWith('*FloAssist · Priority Alerts*\nConnection health'),true);
 eq(record('a','gmail','authorization',{db}).queued,false);eq(total(),1);
 eq(record('a','outlook','authorization',{db}).ignored,true);eq(total(),1);
 eq(record('b','gmail','authorization',{db}).queued,true);eq(total(),2);
 let sent=0;await tickFloAssistNotifications({db,send:async()=>{sent++;return {ok:true};}});eq(sent,2);
 eq(record('a','gmail','available',{db}).queued,false);eq(total(),2);
 eq(record('a','gmail','available',{db}).queued,false);
 eq(record('a','gmail','authorization',{db}).queued,true);eq(total(),3);
 await check('a',{db,probe:async()=>{throw {provider_status:401};},getInventory:async()=>({connected:['gmail']})});eq(total(),4);
 await check('a',{db,probe:async()=>{throw {provider_status:401};},getInventory:async()=>({connected:['gmail','googlecalendar']})});
 eq(db.prepare("SELECT state FROM floassist_connector_health WHERE owner_id='a' AND app_id='gmail'").get().state,'authorization');
 eq(record('a','googlecalendar','available',{db}).queued,false);eq(total(),5);
 eq(db.prepare("SELECT count(*) n FROM floassist_notifications WHERE status='cancelled'").get().n,2);
 eq(connectorFailureState({provider_status:401}),'authorization');eq(connectorFailureState({provider_status:403}),'permission');eq(connectorFailureState({provider_status:429}),'temporary');eq(connectorFailureState({message:'invalid_grant secret must not persist'}),'authorization');eq(connectorFailureState({status:400}),'unknown');
 const every={...prefs,connectors:['gmail','outlook','google_calendar','google_drive','onedrive','outlook_calendar']};
 db.prepare("UPDATE floassist_profiles SET preferences_json=? WHERE owner_id='a'").run(JSON.stringify(every));
 const probes=[];await check('a',{db,getInventory:async()=>({connected:['gmail','outlook','googlecalendar','googledrive','one_drive','outlook_calendar']}),probe:async(owner,config)=>{probes.push(config.action_id);}});
 eq(probes.sort(),['gmail.get_profile','outlook.get_profile','googlecalendar.list_calendars','googledrive.about.get','one_drive.get_drive'].sort());
 eq(db.prepare("SELECT state FROM floassist_connector_health WHERE owner_id='a' AND app_id='outlook_calendar'").get().state,'unsupported');
 const healthyCount=total();await check('a',{db,getInventory:async()=>({connected:['gmail','outlook','googlecalendar','googledrive','one_drive','outlook_calendar']}),probe:async()=>{}});eq(total(),healthyCount);
 eq(record('b','gmail','temporary',{db}).queued,true);
 eq(record('b','gmail','authorization',{db}).queued,true); // Changed failure now needs user action.
 eq(record('b','gmail','authorization',{db}).queued,false);
 const beforeRecovery=total();eq(record('b','gmail','available',{db}).queued,false);eq(total(),beforeRecovery);
 eq(record('b','gmail','unknown',{db}).queued,true);eq(record('b','gmail','unknown',{db}).queued,false);
 record('b','gmail','available',{db});
 const stamp=Date.now();db.prepare('INSERT INTO floassist_notifications VALUES (?,?,?,?,?,?,?,?)').run('b:connector-health:gmail:legacy:recovered','b','fixture','Old success notification','pending',stamp,stamp,stamp+60000);
 const delivered=[];await tickFloAssistNotifications({db,send:async r=>{delivered.push(r.text);return {ok:true};}});
 eq(delivered.includes('Old success notification'),false);
 db.prepare("UPDATE floassist_profiles SET status='paused' WHERE owner_id='a'").run();eq(record('a','gmail','authorization',{db}).ignored,true);
 db.prepare("UPDATE platform_users SET enabled=0 WHERE id='b'").run();eq(record('b','gmail','available',{db}).ignored,true);
 console.log(`FLOASSIST_CONNECTOR_HEALTH_OK: ${n} checks`);
}finally{db.close();}
