import {randomUUID} from 'node:crypto';
import {getDb} from '../db/schema.js';
import {normalizeRetentionDays} from './data-retention.js';

function database(){const db=getDb();db.exec(`CREATE TABLE IF NOT EXISTS native_retention_requests(
 id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL,cutoff_ms INTEGER NOT NULL,dry_run INTEGER NOT NULL,
 status TEXT NOT NULL,lease TEXT,lease_until INTEGER,created_at TEXT NOT NULL,finished_at TEXT,result_json TEXT)`);return db;}
export function enqueueNativeRetention(owner,cutoffMs,dryRun=false){
 const db=database();
 const pending=db.prepare("SELECT id FROM native_retention_requests WHERE owner_user_id=? AND status IN ('queued','running') LIMIT 1").get(owner);
 if(pending)return {id:pending.id,status:'pending'};
 const id=randomUUID();db.prepare("INSERT INTO native_retention_requests(id,owner_user_id,cutoff_ms,dry_run,status,created_at) VALUES(?,?,?,?,'queued',?)").run(id,owner,cutoffMs,dryRun?1:0,new Date().toISOString());
 return {id,status:'queued'};
}
export function claimNativeRetention(){
 const db=database();return db.transaction(()=>{
  const row=db.prepare("SELECT r.*,u.data_retention_days FROM native_retention_requests r JOIN platform_users u ON u.id=r.owner_user_id AND u.role='ceo' WHERE r.status='queued' OR (r.status='running' AND r.lease_until<?) ORDER BY r.created_at LIMIT 1").get(Date.now());
  if(!row)return null;
  const lease=randomUUID();db.prepare("UPDATE native_retention_requests SET status='running',lease=?,lease_until=? WHERE id=?").run(lease,Date.now()+30*60000,row.id);
  return {id:row.id,owner:row.owner_user_id,cutoffMs:Math.min(row.cutoff_ms,Date.now()-normalizeRetentionDays(row.data_retention_days)*86400000),dryRun:!!row.dry_run,lease};
 }).immediate();
}
export function completeNativeRetention({id,lease,result}){
 if(!result||typeof result!=='object'||JSON.stringify(result).length>200000)throw Error('Invalid retention result');
 const changed=database().prepare("UPDATE native_retention_requests SET status=?,finished_at=?,result_json=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='running'").run(result.ok?'completed':'failed',new Date().toISOString(),JSON.stringify(result),id,lease).changes;
 if(!changed)throw Error('Retention lease no longer valid');return {ok:true};
}
export function latestNativeRetention(owner){
 const row=database().prepare('SELECT id,status,created_at,finished_at,result_json FROM native_retention_requests WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 1').get(owner);
 return row?{...row,result:row.result_json?JSON.parse(row.result_json):null,result_json:undefined}:null;
}
