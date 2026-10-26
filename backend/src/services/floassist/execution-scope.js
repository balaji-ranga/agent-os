import {AsyncLocalStorage} from 'node:async_hooks';
import {readFileSync} from 'node:fs';
import {getDb} from '../../db/schema.js';
import {responsibilitySources} from './responsibilities.js';
const scope=new AsyncLocalStorage();
const product=JSON.parse(readFileSync(new URL('./product.json',import.meta.url),'utf8'));
export const withFloAssistScope=(context,fn)=>scope.run(context,fn);
export const currentFloAssistScope=()=>scope.getStore();

export function bindFloAssistWork(db,owner,kind,id,context=currentFloAssistScope()){
  if(!context||context.owner!==owner||!id)return;
  db.exec(`CREATE TABLE IF NOT EXISTS floassist_execution_scopes(owner_id TEXT NOT NULL,kind TEXT NOT NULL,work_id TEXT NOT NULL,context_json TEXT NOT NULL,PRIMARY KEY(owner_id,kind,work_id))`);
  db.prepare('INSERT OR IGNORE INTO floassist_execution_scopes VALUES (?,?,?,?)').run(owner,kind,String(id),JSON.stringify(context));
}
function boundWork(db,owner,kind,id){
  if(!id||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_execution_scopes'").get())return null;
  const row=db.prepare('SELECT context_json FROM floassist_execution_scopes WHERE owner_id=? AND kind=? AND work_id=?').get(owner,kind,String(id));
  return row?JSON.parse(row.context_json):null;
}

/** Only server-registered execution metadata is accepted here, never tool arguments. */
export function resolveFloAssistScope(db,owner,agent,context={},channel='web'){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_profiles'").get())return null;
  const p=db.prepare('SELECT * FROM floassist_profiles WHERE owner_id=?').get(owner);
  if(!p)return null;
  for(const [kind,key] of [['session','session_key'],['delegation','delegation_task_id'],['goal','goal_run_id'],['workflow','workflow_run_id']]){
    const bound=boundWork(db,owner,kind,context?.[key]);if(bound)return bound;
  }
  if(channel==='whatsapp'&&p.agent_id===agent)return {owner,origin:'whatsapp'};
  let run=context?.scheduled_goal_run_id;
  if(!run&&context?.goal_run_id)run=db.prepare('SELECT scheduled_goal_run_id FROM agent_goal_runs WHERE id=? AND owner_user_id=?').get(context.goal_run_id,owner)?.scheduled_goal_run_id;
  if(!run)return null;
  const r=db.prepare('SELECT g.source FROM scheduled_goal_runs r JOIN scheduled_goals g ON g.id=r.goal_id AND g.owner_user_id=r.owner_user_id WHERE r.id=? AND r.owner_user_id=?').get(run,owner);
  return r?.source?.startsWith('floassist:')?{owner,origin:r.source,run}:null;
}
export function assertFloAssistConnector(owner,action,db=getDb(),context=currentFloAssistScope()){
  if(!context)return;
  if(context.owner!==owner)throw Object.assign(new Error('FloAssist execution owner mismatch'),{status:403,code:'FLOASSIST_OWNER_DENIED'});
  const p=db.prepare('SELECT * FROM floassist_profiles WHERE owner_id=?').get(owner);
  const provider=String(action).split('.')[0];
  const app=product.connectors.find(a=>(a.provider_id||a.id)===provider);
  if(!p||p.status!=='active'||!app||!JSON.parse(p.preferences_json).connectors?.includes(app.id))
    throw Object.assign(new Error('This app is not enabled for this FloAssist execution. Manage apps before retrying.'),{status:403,code:'FLOASSIST_CONNECTOR_NOT_SELECTED'});
  if(context.run&&!responsibilitySources(JSON.parse(p.preferences_json),context.origin?.split(':')[1]).includes(app.id))
    throw Object.assign(new Error('This source belongs to another FloAssist responsibility. Use only the sources assigned to the current check.'),{status:403,code:'FLOASSIST_RESPONSIBILITY_MISMATCH'});
}
export function assertFloAssistCalendarRoute(owner,operation,db=getDb(),context=currentFloAssistScope()){
  if(context&&operation.startsWith('email_'))
    throw Object.assign(new Error('For this FloAssist request use connector_search_actions for the selected Gmail or Outlook app, read connector_get_action_guide, then execute that exact action. This productivity email tool is a separate binding, not the connected mailbox. Do not infer a mailbox permission failure from this routing correction.'),{status:409,code:'FLOASSIST_CONNECTOR_ROUTE_REQUIRED'});
  if(context&&operation.startsWith('calendar_'))
    throw Object.assign(new Error('Use the selected Calendar connector action and its guide. Productivity/ICS fallback requires an explicitly configured source route; a missing binding does not mean OAuth is disconnected.'),{status:409,code:'FLOASSIST_CONNECTOR_ROUTE_REQUIRED'});
}

export function validateFloAssistMailWindow(action,input,context=currentFloAssistScope(),now=Date.now()){
  if(context?.origin!=='floassist:followups'||action!=='gmail.fetch_emails')return;
  const query=String(input.query||input.q||'');
  const before=query.match(/\b(?:before|older):([0-9/\-]+)/i)?.[1];
  if(!before)return;
  const upper=/^\d{10}$/.test(before)?Number(before)*1000:Date.parse(before.replaceAll('/','-')+'T00:00:00Z');
  if(Number.isFinite(upper)&&upper<=now)
    throw Object.assign(new Error('The follow-up discovery window excludes current sent requests. Use newer_than:7d without a past upper bound; then inspect individual candidate threads and replies.'),{status:400,code:'FLOASSIST_INCOMPLETE_MAIL_WINDOW'});
}
