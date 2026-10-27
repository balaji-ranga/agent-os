import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const digest=value=>createHash('sha256').update(value).digest('hex');
// Any classifier/lifecycle change invalidates earlier decisions automatically.
const rules=digest(['responsibilities.js','product.json','deadline-evidence.js','tracking.js','alert-policy.js'].map(name=>readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n')).join('\n'));
const ensured=new WeakSet();
function ensure(db){
 if(ensured.has(db))return;
 db.exec(`CREATE TABLE IF NOT EXISTS floassist_source_assessments(owner_id TEXT,app_id TEXT,source_id TEXT,module TEXT,signature TEXT,completed_at INTEGER,PRIMARY KEY(owner_id,app_id,source_id,module));
 CREATE TABLE IF NOT EXISTS floassist_run_assessment_context(owner_id TEXT,run_id TEXT,signature TEXT,created_at INTEGER,PRIMARY KEY(owner_id,run_id));
 CREATE TABLE IF NOT EXISTS floassist_run_source_versions(owner_id TEXT,run_id TEXT,app_id TEXT,source_id TEXT,module TEXT,signature TEXT,reviewed INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,PRIMARY KEY(owner_id,run_id,app_id,source_id));`);
 ensured.add(db);
}
export function setRunAssessmentContext(db,owner,run,instructions,now=Date.now()){
 ensure(db);db.prepare('INSERT OR REPLACE INTO floassist_run_assessment_context VALUES (?,?,?,?)').run(owner,run,digest(instructions),now);
}
export function sourceAssessmentVersion(db,scope,metadata,text,preferences,now){
 if(!scope?.run||!['floassist:priority','floassist:deadlines','floassist:followups'].includes(scope.origin))return null;
 ensure(db);const module=scope.origin.split(':')[1];
 const direction=db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_thread_receipts'").get()?db.prepare('SELECT latest_message_id,latest_at,latest_sent FROM floassist_thread_receipts WHERE owner_id=? AND run_id=? AND app_id=? AND thread_id=?').get(scope.owner,scope.run,metadata.app_id,metadata.source_id):null;
 const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:preferences.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 const instructions=db.prepare('SELECT signature FROM floassist_run_assessment_context WHERE owner_id=? AND run_id=?').get(scope.owner,scope.run)?.signature;
 // Reassess time-sensitive classifications each hour even when bytes match;
 // task due-date escalation and user completion still run on every check.
 const hour=Math.floor(now/3600000);
 const signature=digest(JSON.stringify({rules,preferences,localDay,hour,metadata,direction,text,instructions}));
 db.prepare('INSERT OR REPLACE INTO floassist_run_source_versions VALUES (?,?,?,?,?,?,0,?)').run(scope.owner,scope.run,metadata.app_id,metadata.source_id,module,signature,now);
 const cached=db.prepare('SELECT signature,completed_at FROM floassist_source_assessments WHERE owner_id=? AND app_id=? AND source_id=? AND module=?').get(scope.owner,metadata.app_id,metadata.source_id,module);
 const minutes=preferences.source_assessment_cache_minutes??120;
 return {signature,reusable:minutes>0&&cached?.signature===signature&&now>=cached.completed_at&&now-cached.completed_at<minutes*60000,completed_at:cached?.completed_at};
}
export function markSourceAssessmentReviewed(db,scope,metadata){
 if(!scope?.run||!ensured.has(db))return;
 db.prepare('UPDATE floassist_run_source_versions SET reviewed=1 WHERE owner_id=? AND run_id=? AND app_id=? AND source_id=?').run(scope.owner,scope.run,metadata.app_id,metadata.source_id);
}
export function commitRunSourceAssessments(db,owner,run,now=Date.now()){
 ensure(db);
 // Called only after this run passes complete coverage and error checks.
 const rows=db.prepare('SELECT * FROM floassist_run_source_versions WHERE owner_id=? AND run_id=? AND reviewed=1').all(owner,run);
 const save=db.prepare('INSERT OR REPLACE INTO floassist_source_assessments VALUES (?,?,?,?,?,?)');
 db.transaction(()=>{for(const row of rows)save.run(owner,row.app_id,row.source_id,row.module,row.signature,now);})();
 db.prepare('DELETE FROM floassist_run_source_versions WHERE created_at<?').run(now-7*86400000);
 db.prepare('DELETE FROM floassist_source_assessments WHERE completed_at<?').run(now-7*86400000);
 db.prepare('DELETE FROM floassist_run_assessment_context WHERE created_at<?').run(now-7*86400000);
 return rows.length;
}
