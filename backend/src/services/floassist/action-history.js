import {tenantOpenClawAgentId} from '../openclaw-tenant.js';
import {getDb} from '../../db/schema.js';
import {classifyConnectorAction} from '../connector-action-grants.js';
import {ensureFloAssistRuntime} from './runtime.js';

function parse(raw){try{return JSON.parse(raw||'{}');}catch{return {};}}
function exists(db,name){return !!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);}
function ensure(db){db.exec(`CREATE TABLE IF NOT EXISTS floassist_action_context (
 action_id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,context_json TEXT NOT NULL);`);}
export function linkActionContext(actionId,owner,context={},db=getDb()){
  ensure(db);const refs={};
  for(const key of ['goal_run_id','goal_step_id','scheduled_goal_run_id','delegation_task_id','work_unit_id','client_turn_id'])if(context?.[key])refs[key]=String(context[key]);
  db.prepare('INSERT OR IGNORE INTO floassist_action_context VALUES (?,?,?)').run(actionId,owner,JSON.stringify(refs));
}
function project(row){
  const request=parse(row.request_payload),input=request.input||request;
  const action=request.action_id||request.actionId||row.tool_name;
  const connector=row.tool_name==='connector_execute_action';
  const mutating=connector?classifyConnectorAction({id:action}).action_family!=='read':/(?:create|update|delete|send|publish|cancel|move|submit|purchase|book)/i.test(row.tool_name);
  const resources={};
  for(const key of ['eventId','event_id','calendarId','calendar_id','messageId','threadId','itemId','fileId','id','task_id'])if(typeof input[key]==='string'||typeof input[key]==='number')resources[key]=String(input[key]).slice(0,200);
  return {evidence_id:row.id,agent_id:row.agent_id,action,mutating,status:row.observation_status,reason_code:row.reason_code,
    created_at:row.created_at,completed_at:row.completed_at,resources,
    submitted_fields:Object.keys(input).filter(k=>!/(token|password|secret|credential|authorization)/i.test(k)).slice(0,40),
    context:parse(row.context_json),execution_key:row.execution_key,
    verification:'Tool execution result only; inspect provider receipt or read-back before claiming verified completion.'};
}
export function listActionHistory({ownerUserId,agentId,days=7,limit=50,database=getDb()}={}){
  if(!ownerUserId||!agentId)throw new Error('Owner and agent are required');
  const db=database;if(!exists(db,'tool_execution_actions'))return [];
  ensure(db);
  return db.prepare(`SELECT a.*,c.context_json FROM tool_execution_actions a LEFT JOIN floassist_action_context c ON c.action_id=a.id AND c.owner_id=a.owner_user_id
    WHERE a.owner_user_id=? AND (a.agent_id=? OR a.agent_id=?) AND a.created_at>=datetime('now',?)
    ORDER BY a.created_at DESC,a.id DESC LIMIT ?`).all(ownerUserId,agentId,tenantOpenClawAgentId(ownerUserId,exists(db,'agents')?(db.prepare('SELECT openclaw_agent_id FROM agents WHERE id=?').get(agentId)?.openclaw_agent_id||agentId):agentId),`-${Math.max(1,Math.min(365,Number(days)||7))} days`,Math.max(1,Math.min(200,Number(limit)||50))).map(project);
}
export function notifyActionOutcome(actionId,db=getDb()){
  if(!exists(db,'floassist_profiles'))return;
  const row=db.prepare('SELECT * FROM tool_execution_actions WHERE id=?').get(actionId);if(!row)return;
  const p=db.prepare("SELECT p.* FROM floassist_profiles p JOIN platform_users u ON u.id=p.owner_id WHERE p.owner_id=? AND p.status='active' AND u.enabled=1").get(row.owner_user_id);if(!p)return;
  const item=project(row);if(!item.mutating||['running','duplicate_blocked','empty'].includes(item.status))return;
  // Reminders already have their conversational confirmation; do not double-notify.
  if(row.tool_name.startsWith('floassist_'))return;
  ensureFloAssistRuntime(db);const now=Date.now();
  const outcome=item.status==='success'?'reported success':item.status==='awaiting_approval'?'requires approval':`did not complete (${item.status})`;
  const target=Object.entries(item.resources).map(([k,v])=>`${k}: ${v}`).join(', ');
  const text=`FloAssist activity: ${item.action} ${outcome}.${target?`\n${target}`:''}\nAsk me for the action history or details. Reference: ${item.evidence_id}`;
  db.prepare('INSERT OR IGNORE INTO floassist_notifications(source_key,owner_id,agent_id,text,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(`${p.owner_id}:action-outcome:${actionId}`,p.owner_id,p.agent_id,text,now,now,now+86400000);
}
