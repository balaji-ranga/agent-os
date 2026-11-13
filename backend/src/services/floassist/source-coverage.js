import {withExecutionProviderAttempt,executionProviderFailure} from '../execution-provider-guard.js';
import {resolveSourceReference} from './source-references.js';
// Coverage receipts contain only source identity and page pointers, never bodies.
export function ensureSourceCoverage(db){db.exec(`CREATE TABLE IF NOT EXISTS floassist_source_coverage(owner_id TEXT,run_id TEXT,app_id TEXT,source_id TEXT,snapshot_id TEXT,complete INTEGER NOT NULL,next_request_json TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(owner_id,run_id,app_id,source_id));`);}
export function requireAppCoverage(db,context,app,nextRequest){
 ensureSourceCoverage(db);db.prepare('INSERT OR IGNORE INTO floassist_source_coverage VALUES (?,?,?,?,?,0,?,?)').run(context.owner,context.run,app,'@app:'+app,'required-app',JSON.stringify(nextRequest),Date.now());
}
export function requireSourceReview(db,context,metadata,nextRequest){
 ensureSourceCoverage(db);db.prepare('INSERT OR IGNORE INTO floassist_source_coverage VALUES (?,?,?,?,?,0,?,?)').run(context.owner,context.run,metadata.app_id,metadata.source_id,'discovery',JSON.stringify(nextRequest||null),Date.now());
}
export function verifyEmptyAppCoverage(db,context,app){
 if(!context?.run)return;ensureSourceCoverage(db);
 if(db.prepare("SELECT 1 FROM floassist_source_coverage WHERE owner_id=? AND run_id=? AND app_id=? AND complete=0 AND source_id NOT LIKE '@app:%'").get(context.owner,context.run,app))return;
 db.prepare("UPDATE floassist_source_coverage SET complete=1,next_request_json='null',updated_at=? WHERE owner_id=? AND run_id=? AND app_id=? AND source_id=?").run(Date.now(),context.owner,context.run,app,'@app:'+app);
}
export function recordSourceCoverage(db,context,metadata,snapshotId,complete,nextRequest){
 if(!context?.run||!context.owner)return;
 ensureSourceCoverage(db);
 db.prepare(`INSERT INTO floassist_source_coverage VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,run_id,app_id,source_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,complete=excluded.complete,next_request_json=excluded.next_request_json,updated_at=excluded.updated_at`).run(context.owner,context.run,metadata.app_id,metadata.source_id,snapshotId,complete?1:0,JSON.stringify(nextRequest||null),Date.now());
 db.prepare('DELETE FROM floassist_source_coverage WHERE updated_at<?').run(Date.now()-7*86400000);
 if(complete&&!String(metadata.source_id).startsWith('@'))verifyEmptyAppCoverage(db,context,metadata.app_id);
}
export function pendingSourceCoverage(db,owner,run){
 ensureSourceCoverage(db);const rows=db.prepare('SELECT app_id,source_id,next_request_json FROM floassist_source_coverage WHERE owner_id=? AND run_id=? AND complete=0').all(owner,run);
 return rows.filter(r=>!r.source_id.startsWith('@app:')||!rows.some(p=>p.app_id===r.app_id&&!p.source_id.startsWith('@app:'))).map(r=>({app_id:r.app_id,...(!r.source_id.startsWith('@')?{source_id:r.source_id}:{}),next_request:JSON.parse(r.next_request_json),reason:r.source_id.startsWith('@app:')?'app_not_checked':JSON.parse(r.next_request_json)?'unread_source_pages':'provider_coverage_incomplete'}));
}
// A provider failure/truncation without a continuation cannot be repaired by
// replaying the whole model request. Leave it incomplete and surface the blocker.
export function continuableSourceCoverage(pending){
 return pending.filter(source=>source.next_request&&typeof source.next_request==='object'&&Object.keys(source.next_request).length>0);
}

// Share provider failure accounting with all connector/tool executions.
export async function withSourceProviderAttempt(db,context,app,execute){
 try{return await withExecutionProviderAttempt(db,context,app,execute);}
 catch(error){
  if(context?.owner&&context?.run&&executionProviderFailure(db,context,app)){
   ensureSourceCoverage(db);
   db.prepare("UPDATE floassist_source_coverage SET next_request_json='null',updated_at=? WHERE owner_id=? AND run_id=? AND app_id=? AND complete=0").run(Date.now(),context.owner,context.run,app);
  }
  throw error;
 }
}
export function assertSourceCoverage(db,owner,run,app,source){
 ensureSourceCoverage(db);const r=db.prepare('SELECT complete,next_request_json FROM floassist_source_coverage WHERE owner_id=? AND run_id=? AND app_id=? AND source_id=?').get(owner,run,app,source);
 if(r&&!r.complete)throw Object.assign(new Error('Finish the current source pages before observing an obligation. The task update remains unapplied.'),{status:409,code:'FLOASSIST_SOURCE_REVIEW_INCOMPLETE',next_action:{tool:'floassist_source_read',input:JSON.parse(r.next_request_json),instruction:'Follow exact next_request values until coverage_complete is true, then reassess and submit the observation.'}});
}

// A scheduled scan may repeat the source selector instead of copying its cursor.
// Resume only an already verified, partial snapshot in this exact owner/run.
// Ad hoc re-reads, explicit restarts and explicit cursors retain their semantics.
export function resumeScheduledSourceInput(db,owner,input,context){
 if(!context?.run||context.owner!==owner||!String(context.origin||'').startsWith('floassist:')||!input?.source_id||Object.keys(input).some(k=>!['app_id','source_id'].includes(k)))return input;
 const app=({googledrive:'google_drive',googlecalendar:'google_calendar',one_drive:'onedrive'})[input.app_id]||input.app_id;
 let source;try{source=resolveSourceReference(db,owner,app,input.source_id,context);}catch{return input;}
 ensureSourceCoverage(db);
 const row=db.prepare("SELECT next_request_json FROM floassist_source_coverage WHERE owner_id=? AND run_id=? AND app_id=? AND source_id=? AND complete=0 AND snapshot_id NOT IN ('discovery','required-app')").get(owner,context.run,app,source);
 let next;try{next=JSON.parse(row?.next_request_json||'null');}catch{return input;}
 return next&&typeof next.cursor==='string'&&Object.keys(next).length===1?{cursor:next.cursor}:input;
}
