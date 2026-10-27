// Explicit owner/run only; correct historical coverage status without changing tasks.
import {getDb} from '../src/db/schema.js';
import {recordSourceCoverage,pendingSourceCoverage,requireAppCoverage} from '../src/services/floassist/source-coverage.js';
import {responsibilitySources} from '../src/services/floassist/responsibilities.js';
import {readFileSync} from 'node:fs';
import {resolveSourceReference} from '../src/services/floassist/source-references.js';
const [owner,run]=process.argv.slice(2);if(!owner||!run)throw Error('Explicit owner and run IDs are required');
const apply=process.argv.includes('--apply'),db=getDb();
const current=db.prepare('SELECT r.id,r.goal_id,r.status,g.source FROM scheduled_goal_runs r JOIN scheduled_goals g ON g.id=r.goal_id AND g.owner_user_id=r.owner_user_id WHERE r.owner_user_id=? AND r.id=?').get(owner,run);if(!current)throw Error('Owner run not found');
const requiredApps=(process.argv.find(a=>a.startsWith('--require-apps='))?.split('=')[1]||'').split(',').filter(Boolean);
const supported=JSON.parse(readFileSync(new URL('../src/services/floassist/product.json',import.meta.url),'utf8')).connectors.map(c=>c.id);
if(requiredApps.some(a=>!supported.includes(a))||requiredApps.length&&(!current.source.startsWith('floassist:')||responsibilitySources({connectors:requiredApps},current.source.split(':')[1]).length!==requiredApps.length))throw Error('Required apps must be explicitly supplied from the historical selected-source evidence and supported by this responsibility');
const rows=db.prepare("SELECT a.response_summary FROM tool_execution_actions a JOIN floassist_action_context c ON c.action_id=a.id WHERE a.owner_user_id=? AND json_extract(c.context_json,'$.scheduled_goal_run_id')=? AND a.tool_name='floassist_source_read' AND a.observation_status='success' ORDER BY a.rowid").all(owner,run);
const latest=new Map();for(const row of rows){const data=JSON.parse(row.response_summary||'{}');if(!data.app_id||!data.source_id||typeof data.coverage_complete!=='boolean')continue;const id=resolveSourceReference(db,owner,data.app_id,data.source_id,{owner,run});let next=data.next_request;if(next)next={...next,source_id:resolveSourceReference(db,owner,data.app_id,next.source_id,{owner,run})};latest.set(JSON.stringify([data.app_id,id]),{app_id:data.app_id,source_id:id,snapshot_id:data.snapshot_id,complete:data.coverage_complete&&data.provider_complete!==false,next});}
const partial=[...latest.values()].filter(r=>!r.complete);
const missing=requiredApps.filter(app=>![...latest.values()].some(r=>r.app_id===app&&r.complete));
if(apply)db.transaction(()=>{
 for(const app of requiredApps)requireAppCoverage(db,{owner,run},app,{app_id:app});
 for(const row of latest.values())recordSourceCoverage(db,{owner,run},row,row.snapshot_id,row.complete,row.next);
 if((partial.length||missing.length)&&current.status==='ok'){
  const error=`Coverage audit: ${partial.length} source(s) had unread pages; ${missing.length} required app(s) lacked verified content coverage${missing.length?' ('+missing.join(', ')+')':''}. The earlier ok status did not prove complete source review.`;
  db.prepare("UPDATE scheduled_goal_runs SET status='error',error=? WHERE owner_user_id=? AND id=? AND status='ok'").run(error,owner,run);
  const last=db.prepare('SELECT id FROM scheduled_goal_runs WHERE owner_user_id=? AND goal_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(owner,current.goal_id);
  if(last?.id===run)db.prepare("UPDATE scheduled_goals SET last_run_status='error',last_run_error=? WHERE owner_user_id=? AND id=?").run(error,owner,current.goal_id);
  db.exec('CREATE TABLE IF NOT EXISTS floassist_coverage_audit(owner_id TEXT,run_id TEXT,reason TEXT,created_at INTEGER,PRIMARY KEY(owner_id,run_id))');
  db.prepare('INSERT OR IGNORE INTO floassist_coverage_audit VALUES (?,?,?,?)').run(owner,run,error,Date.now());
 }
})();
console.log(JSON.stringify({run,sourceCount:latest.size,partialSources:partial.length,missingApps:missing,applied:apply,tasksUntouched:true,...(apply?{pending:pendingSourceCoverage(db,owner,run).length}:{})}));process.exit(0);
