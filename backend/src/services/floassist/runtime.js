import { createHash, randomUUID } from 'node:crypto';
import { getDb } from '../../db/schema.js';
import { fail } from './core.js';
import { readFileSync } from 'node:fs';
const product=JSON.parse(readFileSync(new URL('./product.json',import.meta.url),'utf8'));

export function floAssistResponsibilityEnabled(preferences,responsibility){
  return Boolean(responsibility&&preferences.responsibilities?.includes(responsibility.id)&&
    responsibility.requires_any_connector?.some(id=>preferences.connectors?.includes(id)));
}

export function inQuietHours(preferences,date=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:preferences.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const time=parts.find(p=>p.type==='hour').value+':'+parts.find(p=>p.type==='minute').value;
  const start=preferences.quiet_start,end=preferences.quiet_end;
  return start===end?false:start<end?time>=start&&time<end:time>=start||time<end;
}
function enrolled(db,owner){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='floassist_profiles'").get())return null;
  return db.prepare('SELECT * FROM floassist_profiles WHERE owner_id=?').get(owner);
}
/** Only FloAssist-owned resources are gated; existing platform schedules keep their behavior. */
export function floAssistScheduleGate(row,date=new Date(),db=getDb()){
  if(!String(row.source||'').startsWith('floassist:'))return {ok:true};
  const p=enrolled(db,row.owner_user_id);
  if(!p||p.status!=='active'||p.agent_id!==row.agent_id)return {ok:false,reason:'floassist_paused'};
  const preferences=JSON.parse(p.preferences_json);
  const responsibility=product.responsibilities.find(r=>row.source===`floassist:${r.id}`);
  if(!floAssistResponsibilityEnabled(preferences,responsibility))return {ok:false,reason:'floassist_source_unavailable'};
  if(inQuietHours(preferences,date))return {ok:false,reason:'floassist_quiet_hours'};
  return {ok:true};
}
export function ensureFloAssistRuntime(db=getDb()){
  db.exec(`CREATE TABLE IF NOT EXISTS floassist_reminders (
    id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,text TEXT,
    due_at INTEGER NOT NULL,repeat_minutes INTEGER,status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(owner_id,request_key));
    CREATE TABLE IF NOT EXISTS floassist_deliveries (
    source_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,content_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS floassist_notifications (
    source_key TEXT PRIMARY KEY,owner_id TEXT NOT NULL,agent_id TEXT NOT NULL,text TEXT,
    status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS floassist_reminders_due ON floassist_reminders(status,due_at);`);
}
export function createReminder(db,owner,input,now=Date.now()){
  ensureFloAssistRuntime(db);
  return reminderReceipt(db,owner,db.transaction(()=>createReminderLocked(db,owner,input,now))());
}
function reminderReceipt(db,owner,row){
  const timezone=JSON.parse(enrolled(db,owner)?.preferences_json||'{}').timezone||'UTC';
  const due_local=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'shortOffset'}).format(new Date(row.due_at));
  return {...row,timezone,due_local,display_instruction:'Use due_local and timezone verbatim when confirming or listing this reminder. Do not display UTC unless it is the user’s configured timezone.'};
}
function createReminderLocked(db,owner,input,now){
  const text=String(input.text||'').trim(),key=String(input.request_key||'').trim();
  const due=Date.parse(input.due_at);
  if(!text||text.length>2000||!key||key.length>150)fail(400,'reminder','Provide reminder text (up to 2000 characters) and a stable request_key.');
  if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(String(input.due_at))||!Number.isFinite(due))fail(400,'due_at','Provide a future ISO datetime including timezone offset.');
  const repeat=input.repeat_minutes??null;
  if(repeat!==null&&(!Number.isSafeInteger(repeat)||repeat<60||repeat>525600))fail(400,'repeat','Repeat must be between 60 and 525600 whole minutes.');
  const requestHash=createHash('sha256').update(JSON.stringify({text,due,repeat})).digest('hex');
  const existing=db.prepare('SELECT * FROM floassist_reminders WHERE owner_id=? AND request_key=?').get(owner,key);
  if(existing){
    if(existing.request_hash!==requestHash)fail(409,'request_reused','This request key belongs to a different reminder.');
    return existing;
  }
  if(due<=now)fail(400,'due_at','Provide a future ISO datetime including timezone offset.');
  const count=db.prepare("SELECT count(*) AS n FROM floassist_reminders WHERE owner_id=? AND status IN ('pending','sending')").get(owner).n;
  if(count>=50)fail(429,'reminder_limit','You can have up to 50 active reminders.');
  const id=randomUUID();
  db.prepare('INSERT INTO floassist_reminders(id,owner_id,request_key,request_hash,text,due_at,repeat_minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,owner,key,requestHash,text,due,repeat,now,now);
  return db.prepare('SELECT * FROM floassist_reminders WHERE id=?').get(id);
}
export function listReminders(db,owner){ensureFloAssistRuntime(db);return db.prepare('SELECT id,text,due_at,repeat_minutes,status FROM floassist_reminders WHERE owner_id=? ORDER BY due_at LIMIT 100').all(owner).map(row=>reminderReceipt(db,owner,row));}
export function cancelReminder(db,owner,id){ensureFloAssistRuntime(db);const r=db.prepare("UPDATE floassist_reminders SET status='cancelled',text=NULL,updated_at=? WHERE owner_id=? AND id=? AND status='pending'").run(Date.now(),owner,String(id||''));if(!r.changes)fail(409,'reminder_unavailable','Reminder is missing, cancelled or already being sent.');return {cancelled:true};}

/** Claim once before send. Uncertain sends are retained for reconciliation, never blindly retried. */
export async function tickReminders({db=getDb(),send,now=Date.now()}={}){
  ensureFloAssistRuntime(db);
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_profiles'").get())return {sent:0};
  let sent=0;
  const rows=db.prepare(`SELECT r.*,p.agent_id,p.phone,p.preferences_json FROM floassist_reminders r
    JOIN floassist_profiles p ON p.owner_id=r.owner_id JOIN platform_users u ON u.id=r.owner_id
    WHERE r.status='pending' AND r.due_at<=? AND p.status='active' AND u.enabled=1 ORDER BY r.due_at LIMIT 20`).all(now);
  for(const row of rows){
    const current=enrolled(db,row.owner_id);
    if(!current||current.status!=='active'||!db.prepare('SELECT 1 FROM platform_users WHERE id=? AND enabled=1').get(row.owner_id))continue;
    if(inQuietHours(JSON.parse(row.preferences_json),new Date(now)))continue;
    if(!db.prepare("UPDATE floassist_reminders SET status='sending',updated_at=? WHERE id=? AND status='pending'").run(now,row.id).changes)continue;
    let result;try{result=await send(row);}catch{result={ok:false};}
    if(result?.ok&&!result.skipped){
      if(row.repeat_minutes){const interval=row.repeat_minutes*60000,next=row.due_at+(Math.floor((now-row.due_at)/interval)+1)*interval;
        db.prepare("UPDATE floassist_reminders SET status='pending',due_at=?,updated_at=? WHERE id=?").run(next,now,row.id);
      }else db.prepare("UPDATE floassist_reminders SET status='sent',text=NULL,updated_at=? WHERE id=?").run(now,row.id);
      sent++;
    }else db.prepare("UPDATE floassist_reminders SET status=?,updated_at=? WHERE id=?").run(result?.skipped?'pending':'uncertain',now,row.id);
  }
  db.prepare("UPDATE floassist_reminders SET status='uncertain' WHERE status='sending' AND updated_at<?").run(now-300000);
  db.prepare("DELETE FROM floassist_reminders WHERE status IN ('sent','cancelled') AND updated_at<?").run(now-30*86400000);
  db.prepare("UPDATE floassist_reminders SET text=NULL WHERE status='uncertain' AND updated_at<?").run(now-86400000);
  db.prepare('DELETE FROM floassist_deliveries WHERE created_at<?').run(now-30*86400000);
  return {sent};
}

export function floAssistDeliveryGate({ownerUserId,scheduledGoalId,sourceKey,text},db=getDb()){
  const p=enrolled(db,ownerUserId);
  if(!p||!scheduledGoalId)return {managed:false};
  const r=db.prepare("SELECT 1 FROM floassist_resources WHERE owner_id=? AND kind='schedule' AND resource_id=?").get(ownerUserId,scheduledGoalId);
  if(!r)return {managed:false};
  if(p.status!=='active'||!db.prepare('SELECT 1 FROM platform_users WHERE id=? AND enabled=1').get(ownerUserId))return {managed:true,skip:true,reason:'floassist_paused'};
  if(!String(text||'').trim()||/\bFLOASSIST_NO_UPDATE\b/.test(String(text)))return {managed:true,skip:true,reason:'no_update'};
  // Old plan-mode runs may finish after upgrading. Their internal progress reports
  // are retained in Flolah but are never personal-assistant notifications.
  if(/^agr:.*:terminal$/.test(String(sourceKey||'')))return {managed:true,skip:true,reason:'internal_goal_report'};
  ensureFloAssistRuntime(db);
  const digest=createHash('sha256').update(String(text).trim()).digest('hex');
  const duplicate=db.prepare('SELECT 1 FROM floassist_deliveries WHERE owner_id=? AND content_hash=? AND created_at>?').get(ownerUserId,digest,Date.now()-86400000);
  if(duplicate)return {managed:true,skip:true,reason:'duplicate'};
  const key=`${ownerUserId}:${sourceKey||`${scheduledGoalId}:${digest}`}`;
  const queued=db.transaction(()=>{
    if(!db.prepare('INSERT OR IGNORE INTO floassist_deliveries VALUES (?,?,?,?)').run(key,ownerUserId,digest,Date.now()).changes)return false;
    db.prepare('INSERT INTO floassist_notifications(source_key,owner_id,agent_id,text,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(key,ownerUserId,p.agent_id,String(text).slice(0,12000),Date.now(),Date.now(),Date.now()+86400000);
    return true;
  })();
  return {managed:true,skip:true,reason:queued?'floassist_queued':'duplicate',authorizedTo:p.phone};
}

/** Proactive output waits through quiet hours instead of being lost at completion time. */
export async function tickFloAssistNotifications({db=getDb(),send,now=Date.now()}={}){
  ensureFloAssistRuntime(db);let sent=0;
  db.prepare("UPDATE floassist_notifications SET text=NULL,status='expired' WHERE expires_at<=? AND status='pending'").run(now);
  const rows=db.prepare("SELECT * FROM floassist_notifications WHERE status='pending' ORDER BY created_at LIMIT 40").all();
  for(const row of rows){
    const p=enrolled(db,row.owner_id);
    if(!p||p.status!=='active'||!db.prepare('SELECT 1 FROM platform_users WHERE id=? AND enabled=1').get(row.owner_id))continue;
    if(inQuietHours(JSON.parse(p.preferences_json),new Date(now)))continue;
    if(!db.prepare("UPDATE floassist_notifications SET status='sending',updated_at=? WHERE source_key=? AND status='pending'").run(now,row.source_key).changes)continue;
    let result;try{result=await send({...row,phone:p.phone});}catch{result={ok:false};}
    if(result?.ok&&!result.skipped){db.prepare("UPDATE floassist_notifications SET status='sent',text=NULL,updated_at=? WHERE source_key=?").run(now,row.source_key);sent++;}
    else db.prepare('UPDATE floassist_notifications SET status=?,updated_at=? WHERE source_key=?').run(result?.skipped?'pending':'uncertain',now,row.source_key);
  }
  db.prepare("UPDATE floassist_notifications SET status='uncertain' WHERE status='sending' AND updated_at<?").run(now-300000);
  db.prepare('UPDATE floassist_notifications SET text=NULL WHERE expires_at<=?').run(now);
  db.prepare('DELETE FROM floassist_notifications WHERE created_at<?').run(now-30*86400000);
  return {sent};
}
