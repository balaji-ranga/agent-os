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
export function assertSourceCoverage(db,owner,run,app,source){
 ensureSourceCoverage(db);const r=db.prepare('SELECT complete,next_request_json FROM floassist_source_coverage WHERE owner_id=? AND run_id=? AND app_id=? AND source_id=?').get(owner,run,app,source);
 if(r&&!r.complete)throw Object.assign(new Error('Finish the current source pages before observing an obligation. The task update remains unapplied.'),{status:409,code:'FLOASSIST_SOURCE_REVIEW_INCOMPLETE',next_action:{tool:'floassist_source_read',input:JSON.parse(r.next_request_json),instruction:'Follow exact next_request values until coverage_complete is true, then reassess and submit the observation.'}});
}
