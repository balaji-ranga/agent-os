import {randomUUID} from 'node:crypto';

/** Claim before any await. Durable keys deduplicate transport retries across workers. */
export function claimScheduledRun(db, row, runKey, {requestKey = null, force = false} = {}) {
  if(requestKey && !/^[A-Za-z0-9_-]{8,150}$/.test(requestKey))
    throw Object.assign(new Error('Invalid run request key'), {status:400});
  db.exec(`CREATE TABLE IF NOT EXISTS scheduled_run_requests (
    owner_id TEXT NOT NULL,goal_id TEXT NOT NULL,request_key TEXT NOT NULL,run_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(owner_id,goal_id,request_key));`);
  return db.transaction(()=>{
    if(requestKey){
      const prior=db.prepare('SELECT run_id FROM scheduled_run_requests WHERE owner_id=? AND goal_id=? AND request_key=?').get(row.owner_user_id,row.id,requestKey);
      if(prior)return {skipped:true,reason:'request_already_started',run_id:prior.run_id};
    }
    const active=db.prepare("SELECT id FROM scheduled_goal_runs WHERE owner_user_id=? AND goal_id=? AND status='running' ORDER BY created_at DESC LIMIT 1").get(row.owner_user_id,row.id);
    if(active)return {skipped:true,reason:'already_running',run_id:active.id};
    // Plan dispatch returns before execution ends; also guard its live durable plan.
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='agent_goal_runs'").get()){
      const plan=db.prepare("SELECT id FROM agent_goal_runs WHERE owner_user_id=? AND scheduled_goal_id=? AND status IN ('planning','pending','running','awaiting_approval','awaiting_plan_review') LIMIT 1").get(row.owner_user_id,row.id);
      if(plan)return {skipped:true,reason:'plan_in_progress',agent_goal_run_id:plan.id};
    }
    const claim=db.prepare(`UPDATE scheduled_goals SET last_run_key=?,last_run_at=datetime('now'),last_run_status='running',updated_at=datetime('now')
      WHERE id=? AND owner_user_id=? AND (?=1 OR last_run_key IS NULL OR last_run_key!=?)`).run(runKey,row.id,row.owner_user_id,force?1:0,runKey);
    if(!claim.changes)return {skipped:true,reason:'already_ran_slot'};
    const id=`sgr-${randomUUID().replace(/-/g,'').slice(0,16)}`;
    db.prepare("INSERT INTO scheduled_goal_runs(id,goal_id,owner_user_id,run_key,status,agent_id,triggered_by) VALUES (?,?,?,?,'running',?,?)").run(id,row.id,row.owner_user_id,runKey,row.agent_id,force?'run_now':'schedule');
    if(requestKey)db.prepare('INSERT INTO scheduled_run_requests(owner_id,goal_id,request_key,run_id) VALUES (?,?,?,?)').run(row.owner_user_id,row.id,requestKey,id);
    return {run_id:id};
  })();
}
