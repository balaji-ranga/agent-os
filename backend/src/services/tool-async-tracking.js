import {randomUUID} from 'node:crypto';
import {getDb} from '../db/schema.js';
import {parseTenantOpenClawAgentId} from './openclaw-tenant.js';
import {lookupOpenClawSessionActor} from './tool-owner-scope.js';
import {sendPlatformNotifications} from './platform-notifications.js';
import {announceOnAgentChannel} from './agent-channel-announce.js';
import {redactForStorage} from './tool-execution-governor.js';

const terminal=new Set(['completed','failed','uncertain','timed_out','cancelled','denied']);
const stores=new WeakSet();
export function ensureAsyncTracking(db=getDb()){
 if(stores.has(db))return db;
 db.exec(`CREATE TABLE IF NOT EXISTS tool_async_jobs(
 id TEXT PRIMARY KEY,owner_user_id TEXT NOT NULL,agent_id TEXT NOT NULL,session_key TEXT NOT NULL,
 actor_user_id TEXT NOT NULL,tool_name TEXT NOT NULL,action_id TEXT UNIQUE,channel TEXT NOT NULL,target TEXT,
 status TEXT NOT NULL,operation_id TEXT,result_json TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 deadline_ms INTEGER NOT NULL,notification_state TEXT NOT NULL DEFAULT 'pending',notification_attempts INTEGER NOT NULL DEFAULT 0,next_notify_ms INTEGER NOT NULL DEFAULT 0);
 CREATE INDEX IF NOT EXISTS idx_tool_async_scope ON tool_async_jobs(owner_user_id,agent_id,session_key,created_at);
 CREATE INDEX IF NOT EXISTS idx_tool_async_pending ON tool_async_jobs(status,notification_state);`);
 stores.add(db);return db;
}
export function createTrackedTool({owner,agent,session='',tool,actionId,timeoutMs=60000,origin},db=getDb()){
 ensureAsyncTracking(db);
 const old=db.prepare('SELECT * FROM tool_async_jobs WHERE action_id=? AND owner_user_id=?').get(actionId,owner);if(old)return old;
 // Only a trusted native session identity may determine the callback target.
 const native=parseTenantOpenClawAgentId(agent);
 const match=session.match(/^agent::?([^:]+):whatsapp:(?:direct|dm):([+0-9]+(?:@s\.whatsapp\.net)?)$/);
 const runtimeTarget=origin?.channel==='whatsapp'&&/^\+?[0-9]{7,15}(?:@s\.whatsapp\.net)?$/.test(origin?.target||'')?origin.target:null;
 const target=runtimeTarget||(match?.[1]===agent?match[2]:null);
 const wa=!!(native?.ceoUserId===owner&&target);
 const actor=lookupOpenClawSessionActor(session);
 const id='track-'+randomUUID(),now=new Date().toISOString();
 db.prepare(`INSERT INTO tool_async_jobs(id,owner_user_id,agent_id,session_key,actor_user_id,tool_name,action_id,channel,target,status,created_at,updated_at,deadline_ms) VALUES(?,?,?,?,?,?,?,?,?,'running',?,?,?)`).run(id,owner,agent,session,actor?.ownerUserId===owner?actor.actorUserId:owner,tool,actionId,wa?'whatsapp':'web',wa?target:null,now,now,Date.now()+Math.max(timeoutMs,30000)+30000);
 return db.prepare('SELECT * FROM tool_async_jobs WHERE id=?').get(id);
}
export function trackingAck(job){return {ok:true,async:true,trackingId:job.id,status:job.status,notificationChannel:job.channel,notification:job.notification_state,instruction:`Tell the user this request is tracked as ${job.id}. ${['sent','web_fallback'].includes(job.notification_state)?'Its final update has already been reported; do not send another unsolicited update.':'A final update will use the same tracking ID.'} Do not repeat the action. For follow-up questions use tool_execution_status with trackingId ${job.id}, or without an ID to list this conversation's recent requests.`};}
export function dispatchTrackedTool(scope,execute,{db=getDb(),onResult=()=>{}}={}){
 ensureAsyncTracking(db);
 const existing=db.prepare('SELECT * FROM tool_async_jobs WHERE action_id=? AND owner_user_id=?').get(scope.actionId,scope.owner);
 if(existing)return {ack:trackingAck(existing),completion:Promise.resolve(),reused:true};
 const job=createTrackedTool(scope,db);
 const completion=(async()=>{try{const result=await execute(job);settleTrackedTool(job.id,result,db);await onResult(result,job);}catch{settleTrackedTool(job.id,{data:{status:'uncertain',error:'Tool response unavailable; do not repeat a potentially dispatched action.'}},db);}})();
 return {ack:trackingAck(job),completion};
}
export function trackedStatus({owner,agent,session='',trackingId},db=getDb()){
 ensureAsyncTracking(db);
 const rows=trackingId?db.prepare('SELECT * FROM tool_async_jobs WHERE id=? AND owner_user_id=? AND agent_id=? AND session_key=?').all(trackingId,owner,agent,session):db.prepare('SELECT * FROM tool_async_jobs WHERE owner_user_id=? AND agent_id=? AND session_key=? ORDER BY created_at DESC LIMIT 10').all(owner,agent,session);
 if(trackingId&&!rows.length)throw Object.assign(Error('Tracking request not found in this conversation'),{status:404});
 return {requests:rows.map(r=>({trackingId:r.id,tool:r.tool_name,status:r.status,operationId:r.operation_id,createdAt:r.created_at,notification:r.notification_state,result:r.result_json?JSON.parse(r.result_json):null})),instruction:'Read-only status. Never invoke the original action to check status. If several requests match, ask which tracking ID.'};
}
export function attachTrackedOperation(actionId,owner,operationId,db=getDb()){
 ensureAsyncTracking(db);db.prepare("UPDATE tool_async_jobs SET operation_id=?,status='waiting',updated_at=? WHERE action_id=? AND owner_user_id=? AND status IN ('running','waiting')").run(operationId,new Date().toISOString(),actionId,owner);
}
export function settleTrackedTool(id,{httpStatus=200,data={}},db=getDb()){
 ensureAsyncTracking(db);const job=db.prepare('SELECT * FROM tool_async_jobs WHERE id=?').get(id);if(!job||terminal.has(job.status))return;
 const providerPending=httpStatus===202||['queued','pending','dispatched','accepted','running','waiting','awaiting_approval'].includes(data.status);
 const state=httpStatus>=400?'failed':providerPending?'waiting':terminal.has(data.status)?data.status:(data.ok===false||data.error||data.status==='error')?'failed':'completed';
 const result=JSON.stringify(redactForStorage(data)); // Bound stored output; do not truncate JSON mid-value.
 db.prepare('UPDATE tool_async_jobs SET status=?,operation_id=COALESCE(operation_id,?),result_json=?,updated_at=? WHERE id=?').run(state,job.tool_name==='physical_invoke'?data.operationId||data.id||null:null,result.length<=100000?result:JSON.stringify({resultOmitted:true,reason:'Result exceeds notification storage limit; consult tool history'}),new Date().toISOString(),id);
}
export async function advanceTrackedTools({db=getDb(),physical,deliver}={}){
 ensureAsyncTracking(db);
 for(const job of db.prepare("SELECT * FROM tool_async_jobs WHERE status IN ('running','waiting') LIMIT 100").all()){
  if(job.operation_id&&job.tool_name==='physical_invoke'&&physical){
   try{physical.expire();const op=physical.owned('operations',job.owner_user_id,job.operation_id);if(terminal.has(op.status))settleTrackedTool(job.id,{data:{operationId:op.id,status:op.status,evidence:op.evidence,error:op.error,notice:'Delivery evidence does not independently establish physical state.'}},db);}catch{/* Deadline below prevents indefinite tracking. */}
  }
  if(Date.now()>job.deadline_ms)db.prepare("UPDATE tool_async_jobs SET status='uncertain',result_json=?,updated_at=? WHERE id=? AND status IN ('running','waiting')").run(JSON.stringify({error:'No final result before tracking deadline. Do not repeat a potentially dispatched action.'}),new Date().toISOString(),job.id);
 }
 const send=deliver||deliverTrackedNotification;
 for(const job of db.prepare("SELECT * FROM tool_async_jobs WHERE status NOT IN ('running','waiting') AND notification_state='pending' AND next_notify_ms<=? LIMIT 20").all(Date.now())){
  // A persisted claim prevents concurrent workers from duplicating delivery.
  if(!db.prepare("UPDATE tool_async_jobs SET notification_state='sending',notification_attempts=notification_attempts+1,next_notify_ms=? WHERE id=? AND notification_state='pending'").run(Date.now()+120000,job.id).changes)continue;
  try{const outcome=await send(job);db.prepare("UPDATE tool_async_jobs SET notification_state=?,updated_at=? WHERE id=?").run(outcome?.fallback?'web_fallback':'sent',new Date().toISOString(),job.id);}
  catch{db.prepare("UPDATE tool_async_jobs SET notification_state='pending',next_notify_ms=? WHERE id=?").run(Date.now()+60000,job.id);}
 }
 // Uncertain channel delivery is not blindly resent after a crash. Web fallback
 // is durable and deduplicated; channel sends use the stable tracking ID too.
 for(const job of db.prepare("SELECT * FROM tool_async_jobs WHERE notification_state='sending' AND next_notify_ms<?").all(Date.now())){
  sendWeb(job);db.prepare("UPDATE tool_async_jobs SET notification_state='web_fallback' WHERE id=?").run(job.id);
 }
}
function notice(job){const r=job.result_json?JSON.parse(job.result_json):{};return `Tracking ID: ${job.id}\nTool: ${job.tool_name}\nStatus: ${job.status}\n${job.operation_id?'Operation: '+job.operation_id+'\n':''}${typeof r.reply==='string'?r.reply.slice(0,16000):r.error||r.notice||'Result available through tool_execution_status.'}`;}
function sendWeb(job){if(getDb().prepare("SELECT 1 FROM platform_user_notifications WHERE user_id=? AND source='tool_async' AND source_key=?").get(job.actor_user_id,job.id))return;sendPlatformNotifications({userIds:[job.actor_user_id],createdBy:job.owner_user_id,title:`Tool update: ${job.status} (${job.id})`,body:notice(job),linkUrl:'/content-tools',source:'tool_async',sourceKey:job.id});}
async function deliverTrackedNotification(job){
 sendWeb(job);
 if(job.channel==='whatsapp'&&job.target){
  const base=parseTenantOpenClawAgentId(job.agent_id)?.baseOpenClawId||job.agent_id;
  const agent=getDb().prepare('SELECT a.id FROM agents a JOIN user_agents u ON u.agent_id=a.id AND u.user_id=? AND u.enabled=1 WHERE a.id=? OR a.openclaw_agent_id=?').get(job.owner_user_id,base,base);
  if(!agent)return {fallback:true};
  const result=await announceOnAgentChannel({ownerUserId:job.owner_user_id,agentId:agent.id,channel:'whatsapp',authorizedTo:job.target,text:notice(job),idempotencyKey:job.id,includeRecentMedia:false,singleAttempt:true});
  if(!result.ok||result.skipped)return {fallback:true};
 }
}
export function startToolAsyncWorker(){let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{let physical;if(process.env.FLOLAH_PHYSICAL_ENABLED==='1')physical=(await import('./physical/runtime.js')).getPhysicalControlPlane();await advanceTrackedTools({physical});}catch(e){console.warn('[tool-async] maintenance failed:',e.message);}finally{busy=false;}},2000);timer.unref();return ()=>clearInterval(timer);}
export function seedAsyncStatusTool(){const db=ensureAsyncTracking();const cols=db.prepare('PRAGMA table_info(content_tools_meta)').all().map(c=>c.name);for(const c of ['risk_tier','action_family'])if(!cols.includes(c))db.exec('ALTER TABLE content_tools_meta ADD COLUMN '+c+' TEXT');db.prepare("INSERT OR IGNORE INTO content_tools_meta(name,display_name,endpoint,method,purpose,enabled,is_builtin,risk_tier,action_family) VALUES('tool_execution_status','Tool execution status','/api/tools/tool-execution-status','POST','Read tracked tool status by trackingId, or omit it to list recent requests in this conversation. Never repeat an action to check status.',1,1,'R0','read')").run();db.prepare("INSERT OR IGNORE INTO content_tools_meta(name,display_name,endpoint,method,purpose,enabled,is_builtin,risk_tier,action_family) VALUES('tool_result_read','Read stored tool result','/api/tools/tool-result-read','POST','Read exact stored tool output with resultId and offset from _retrieval.next_request. No source action is repeated. Report unread coverage; never infer omitted content.',1,1,'R0','read')").run();}
