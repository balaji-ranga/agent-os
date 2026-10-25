import {createHash,randomUUID} from 'node:crypto';
import {getDb} from '../../db/schema.js';
import {ensureFloAssistRuntime} from './runtime.js';

// Incident defaults: 90% alert, 2 percentage-point worsening, 24h reminder,
// reset below 88%. Unknown quotas never count as healthy capacity.
export function quotaReading(value){
  const used=Number(value?.used),limit=Number(value?.limit);
  if(value?.used==null||value?.limit==null||!Number.isFinite(used)||!Number.isFinite(limit)||used<0||limit<=0)return null;
  return {used,limit,percent:100*used/limit};
}
export function ensureStorage(db){
  ensureFloAssistRuntime(db);
  db.exec(`CREATE TABLE IF NOT EXISTS floassist_storage_health(
    owner_id TEXT NOT NULL,app_id TEXT NOT NULL,pool TEXT NOT NULL,coverage TEXT NOT NULL,
    used REAL,allocated REAL,percent REAL,alert_percent REAL,alert_at INTEGER,incident TEXT,
    checked_at INTEGER NOT NULL,PRIMARY KEY(owner_id,app_id,pool));`);
}
export function recordStorage(db,owner,app,account,value,now=Date.now()){
  ensureStorage(db);
  const p=db.prepare("SELECT p.* FROM floassist_profiles p JOIN platform_users u ON u.id=p.owner_id WHERE p.owner_id=? AND p.status='active' AND u.enabled=1").get(owner);
  const prefs=JSON.parse(p?.preferences_json||'{}');
  if(!p||!prefs.connectors?.includes(app)||!prefs.responsibilities?.includes('priority'))return {ignored:true};
  const reading=quotaReading(value),pool=createHash('sha256').update(`${app}:${account||'unknown'}`).digest('hex');
  const threshold=90,reset=88,worsening=2,interval=86400000;
  return db.transaction(()=>{
    const old=db.prepare('SELECT * FROM floassist_storage_health WHERE owner_id=? AND app_id=? AND pool=?').get(owner,app,pool);
    let incident=old?.incident||null,alertAt=old?.alert_at||null,alertPercent=old?.alert_percent||null,queued=false;
    if(reading&&reading.percent<reset){
      if(incident)db.prepare("UPDATE floassist_notifications SET status='cancelled',text=NULL WHERE owner_id=? AND source_key LIKE ? AND status='pending'").run(owner,`${owner}:storage:${app}:${incident}:%`);
      incident=null;alertAt=null;alertPercent=null;
    }
    if(reading&&reading.percent>=threshold&&(!incident||reading.percent>=alertPercent+worsening||now-alertAt>=interval)){
      incident ||= randomUUID();
      const outstanding=db.prepare("SELECT 1 FROM floassist_notifications WHERE owner_id=? AND source_key LIKE ? AND status IN ('pending','sending','uncertain')").get(owner,`${owner}:storage:${app}:${incident}:%`);
      if(!outstanding){
        const fmt=n=>`${(n/1e9).toFixed(2)} GB`;
        const label=app==='google_drive'?'Google account storage (shared across Drive, Gmail and Photos)':'OneDrive storage';
        const text=`*FloAssist · Priority Alerts*\nStorage capacity\n\n${label}: ${reading.percent.toFixed(1)}% used (${fmt(reading.used)} of ${fmt(reading.limit)}). Account: ${String(account||'connected account').slice(0,200)}. Review storage or upgrade the allocation. No files have been changed.`;
        db.prepare('INSERT INTO floassist_notifications(source_key,owner_id,agent_id,text,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(`${owner}:storage:${app}:${incident}:${now}`,owner,p.agent_id,text,now,now,now+interval);
        queued=true;alertAt=now;alertPercent=reading.percent;
      }
    }
    db.prepare(`INSERT INTO floassist_storage_health VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,app_id,pool) DO UPDATE SET
      coverage=excluded.coverage,used=excluded.used,allocated=excluded.allocated,percent=excluded.percent,alert_percent=excluded.alert_percent,alert_at=excluded.alert_at,incident=excluded.incident,checked_at=excluded.checked_at`).run(owner,app,pool,reading?'measured':'unavailable',reading?.used??null,reading?.limit??null,reading?.percent??null,alertPercent,alertAt,incident,now);
    return {queued,coverage:reading?'measured':'unavailable',percent:reading?.percent??null};
  })();
}
export async function checkFloAssistStorage(owner,{db=getDb(),probe}={}){
  ensureStorage(db);
  const p=db.prepare('SELECT * FROM floassist_profiles WHERE owner_id=?').get(owner);
  if(!p||p.status!=='active')return {checked:0};
  const prefs=JSON.parse(p.preferences_json);let checked=0;
  if(!prefs.responsibilities?.includes('priority'))return {checked};
  const {probeFloAssistConnector}=await import('./connector-health.js');
  for(const app of prefs.connectors||[]){
    const config=app==='google_drive'?{action_id:'googledrive.about.get',input:{fields:'storageQuota,user(emailAddress,permissionId)'}}:app==='onedrive'?{action_id:'one_drive.get_drive',input:{select:['id','quota','owner']}}:null;
    if(!config)continue;
    try{
      const result=await (probe||probeFloAssistConnector)(owner,config,p.agent_id,db);
      const data=result?.data?.data||result?.data||result;
      const account=app==='google_drive'?data?.user?.emailAddress:data?.id;
      const value=app==='google_drive'?{used:data?.storageQuota?.usage,limit:data?.storageQuota?.limit}:{used:data?.quota?.used,limit:data?.quota?.total};
      recordStorage(db,owner,app,account,value);checked++;
    }catch{recordStorage(db,owner,app,null,null);}
  }
  return {checked};
}
