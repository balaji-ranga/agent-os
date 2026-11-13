import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';

const storage=new AsyncLocalStorage();
const initialized=new WeakSet();
export const withExecutionFetchBudget=(context,fn)=>storage.run(context,fn);
export const currentExecutionFetchBudget=()=>storage.getStore();

/** Trusted turn identity keeps tool hops/retries from resetting the deadline. */
export function toolWorkFetchBudget(db,{owner,agent,runId,session,context},windowMs,now=Date.now()){
 const inherited=Number(context?.fetch_deadline_at);
 if(!owner||!agent||!runId)return {...context,fetch_deadline_at:Number.isFinite(inherited)&&inherited>0?Math.min(inherited,now+windowMs):now+windowMs};
 if(!initialized.has(db)){
  db.exec('CREATE TABLE IF NOT EXISTS tool_fetch_windows(owner_user_id TEXT,execution_key TEXT,created_at INTEGER,fetch_deadline_at INTEGER,PRIMARY KEY(owner_user_id,execution_key)); CREATE INDEX IF NOT EXISTS tool_fetch_windows_age ON tool_fetch_windows(created_at)');
  initialized.add(db);
 }
 const key=createHash('sha256').update(JSON.stringify([owner,agent,session||'',runId])).digest('hex');
 const deadline=Number.isFinite(inherited)&&inherited>0?Math.min(inherited,now+windowMs):now+windowMs;
 db.prepare('INSERT OR IGNORE INTO tool_fetch_windows VALUES (?,?,?,?)').run(owner,key,now,deadline);
 const saved=db.prepare('SELECT fetch_deadline_at FROM tool_fetch_windows WHERE owner_user_id=? AND execution_key=?').get(owner,key);
 // Keep active/expired turn guards long enough that a late retry cannot open a
 // fresh window. Retention applies separately; this is bounded runtime expiry.
 db.prepare('DELETE FROM tool_fetch_windows WHERE created_at<?').run(now-7*86400000);
 return {...context,owner,execution_key:key,fetch_deadline_at:Math.min(saved.fetch_deadline_at,deadline)};
}

export function goalWorkFetchBudget(db,owner,context,windowMs){
  let scheduled=context?.scheduled_goal_run_id,step;
  if(context?.goal_run_id&&context?.goal_step_id)step=db.prepare('SELECT g.created_at,g.scheduled_goal_run_id FROM agent_goal_steps s JOIN agent_goal_runs g ON g.id=s.goal_run_id WHERE s.id=? AND g.id=? AND g.owner_user_id=?').get(context.goal_step_id,context.goal_run_id,owner);
  else if(context?.goal_run_id)step=db.prepare('SELECT created_at,scheduled_goal_run_id FROM agent_goal_runs WHERE id=? AND owner_user_id=?').get(context.goal_run_id,owner);
  else if(context?.workflow_run_id)step=db.prepare('SELECT g.created_at,g.scheduled_goal_run_id FROM agent_goal_steps s JOIN agent_goal_runs g ON g.id=s.goal_run_id WHERE s.child_workflow_run_id=? AND g.owner_user_id=? LIMIT 1').get(context.workflow_run_id,owner);
  scheduled=scheduled||step?.scheduled_goal_run_id;
  if(!scheduled&&!step&&!context?.goal_run_id)return null;
  const run=scheduled&&db.prepare('SELECT created_at FROM scheduled_goal_runs WHERE id=? AND owner_user_id=?').get(scheduled,owner);
  const stamp=run?.created_at||step?.created_at;
  const start=stamp?Date.parse(/[zZ]|[+]\d\d:\d\d$/.test(stamp)?stamp:stamp.replace(' ','T')+'Z'):NaN;
  return {fetch_deadline_at:(Number.isFinite(start)?start:0)+windowMs};
}

/** Deadline comes from trusted execution metadata, never model tool arguments. */
export function remainingFetchTime(maxMs,now=Date.now(),context=storage.getStore()){
  const deadline=Number(context?.fetch_deadline_at);
  if(!Number.isFinite(deadline)||deadline<=0)return maxMs;
  const remaining=Math.floor(deadline-now);
  if(remaining<=0)throw Object.assign(new Error('Execution fetch deadline reached. Preserve collected results and report unread coverage; do not restart discovery.'),{code:'EXECUTION_FETCH_DEADLINE',status:408});
  return Math.min(maxMs,remaining);
}

export function assertFetchDelayFits(delayMs,context=storage.getStore()){
  if(remainingFetchTime(delayMs+1,Date.now(),context)<=delayMs)
    throw Object.assign(new Error('Provider retry would exceed the execution fetch deadline.'),{code:'EXECUTION_FETCH_DEADLINE',status:408});
}
