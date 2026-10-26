import {getDb} from '../../db/schema.js';
import {currentFloAssistScope} from './execution-scope.js';
const providers={gmail:'gmail',googlecalendar:'google_calendar',outlook:'outlook',googledrive:'google_drive',one_drive:'onedrive'};
export function ensureSourceReceipts(db){
 db.exec(`CREATE TABLE IF NOT EXISTS floassist_source_receipts(owner_id TEXT,run_id TEXT,app_id TEXT,source_id TEXT,checked_at INTEGER,PRIMARY KEY(owner_id,run_id,app_id,source_id));
 CREATE TABLE IF NOT EXISTS floassist_account_receipts(owner_id TEXT,app_id TEXT,account_id TEXT,checked_at INTEGER,PRIMARY KEY(owner_id,app_id));
 CREATE TABLE IF NOT EXISTS floassist_run_errors(id INTEGER PRIMARY KEY,owner_id TEXT,run_id TEXT,code TEXT,created_at INTEGER);
 CREATE TABLE IF NOT EXISTS floassist_message_threads(owner_id TEXT,app_id TEXT,message_id TEXT,thread_id TEXT,PRIMARY KEY(owner_id,app_id,message_id));
 CREATE TABLE IF NOT EXISTS floassist_thread_receipts(owner_id TEXT,run_id TEXT,app_id TEXT,thread_id TEXT,latest_message_id TEXT,latest_at INTEGER,latest_sent INTEGER,message_count INTEGER,PRIMARY KEY(owner_id,run_id,app_id,thread_id));`);
 const columns=new Set(db.prepare('PRAGMA table_info(floassist_run_errors)').all().map(c=>c.name));
 for(const [name,type] of [['operation_key','TEXT'],['resolved_at','INTEGER']])if(!columns.has(name))db.exec(`ALTER TABLE floassist_run_errors ADD COLUMN ${name} ${type}`);
}
export function recordSourceReceipt(owner,action,result,{db=getDb(),context=currentFloAssistScope(),now=Date.now()}={}){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_profiles'").get()||!db.prepare('SELECT 1 FROM floassist_profiles WHERE owner_id=?').get(owner))return;
 const app=providers[action.split('.')[0]];if(!app)return;
 ensureSourceReceipts(db);
 const data=result?.data?.data||result?.data||result;
 let account=action==='gmail.get_profile'?data?.emailAddress:null;
 if(action==='googlecalendar.list_calendars')account=data?.items?.find(x=>x.primary)?.id;
 if(action==='googledrive.about.get')account=data?.user?.emailAddress;
 if(action==='one_drive.get_drive')account=data?.id;
 if(account)db.prepare('INSERT OR REPLACE INTO floassist_account_receipts VALUES (?,?,?,?)').run(owner,app,String(account),now);
 if(!context?.run||context.owner!==owner)return;
 if(app==='gmail'&&Array.isArray(data?.messages)){
   for(const m of data.messages)if(m.messageId&&m.threadId)db.prepare('INSERT OR REPLACE INTO floassist_message_threads VALUES (?,?,?,?)').run(owner,app,m.messageId,m.threadId);
   if(action==='gmail.fetch_message_by_thread_id'&&data.threadId&&data.messages.length){
     const dated=data.messages.map(m=>({...m,at:/^\d+$/.test(m.messageTimestamp)?Number(m.messageTimestamp):Date.parse(m.messageTimestamp)})).filter(m=>Number.isFinite(m.at)).sort((a,b)=>b.at-a.at);
     const latest=dated[0];
     if(latest)db.prepare('INSERT OR REPLACE INTO floassist_thread_receipts VALUES (?,?,?,?,?,?,?,?)').run(owner,context.run,app,data.threadId,latest.messageId,latest.at,latest.labelIds?.includes('SENT')?1:0,data.messages.length);
   }
 }
 const ids=new Set();let visited=0;
 if(/(?:fetch_emails|fetch_message_by_thread_id|list_events|list_files|search_files|list_messages)/.test(action))ids.add(`@read:${action}`);
 function walk(v,depth=0){
   if(!v||typeof v!=='object'||depth>12||visited++>10000)return;
   if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return;}
   for(const key of ['id','threadId','messageId'])if(typeof v[key]==='string'&&v[key].length<=300)ids.add(v[key]);
   for(const value of Object.values(v))if(value&&typeof value==='object')walk(value,depth+1);
 }
 walk(data);
 const insert=db.prepare('INSERT OR REPLACE INTO floassist_source_receipts VALUES (?,?,?,?,?)');
 db.transaction(()=>{for(const id of ids)insert.run(owner,context.run,app,id,now);})();
 db.prepare('DELETE FROM floassist_source_receipts WHERE checked_at<?').run(now-7*86400000);
}
export function verifiedTrackingInput(db,owner,input,context=currentFloAssistScope()){
 if(!context?.run)return input;
 ensureSourceReceipts(db);
 input={...input};
 input.app_id=providers[input.app_id]||input.app_id;
 const run=db.prepare('SELECT goal_id,run_key FROM scheduled_goal_runs WHERE id=? AND owner_user_id=?').get(context.run,owner);
 if(run){input.scheduled_goal_id=run.goal_id;input.run_key=run.run_key;}
 const module=context.origin?.split(':')[1];
 if(['priority','deadlines','followups'].includes(module))input.category=module;
 const allowed={priority:['gmail','outlook'],followups:['gmail','outlook'],deadlines:['gmail','outlook','google_drive','onedrive']}[module];
 if(allowed&&!allowed.includes(input.app_id))throw Object.assign(new Error('This source is outside this responsibility. Calendar appointments belong in the agenda/conflict check, not automatic mail follow-up or deadline tasks.'),{status:409,code:'FLOASSIST_RESPONSIBILITY_MISMATCH'});
 const thread=db.prepare('SELECT thread_id FROM floassist_message_threads WHERE owner_id=? AND app_id=? AND message_id=?').get(owner,input.app_id||'',input.source_id||'');
 if(thread)input.source_id=thread.thread_id;
 const match=!String(input.source_id||'').startsWith('@')&&db.prepare('SELECT 1 FROM floassist_source_receipts WHERE owner_id=? AND run_id=? AND app_id=? AND source_id=?').get(owner,context.run,input.app_id||'',input.source_id||'');
 if(!match)throw Object.assign(new Error('Read this exact source item successfully in this run before observing it. Tracking memory and a title match are not fresh source evidence.'),{status:409,code:'FLOASSIST_SOURCE_NOT_VERIFIED'});
 if(!input.requested_action?.trim()||!input.why_now?.trim()||!input.thread_summary?.trim())throw Object.assign(new Error('Provide requested_action, why_now and a concise thread_summary from current evidence. A task title and date alone are not an actionable alert.'),{status:400,code:'FLOASSIST_CONTEXT_REQUIRED'});
 const threadState=db.prepare('SELECT * FROM floassist_thread_receipts WHERE owner_id=? AND run_id=? AND app_id=? AND thread_id=?').get(owner,context.run,input.app_id,input.source_id);
 if(input.app_id==='gmail'&&!threadState)throw Object.assign(new Error('Read the full current Gmail thread before creating or repeating an alert. A list result or old sent message may have been superseded by a later reply.'),{status:409,code:'FLOASSIST_THREAD_READ_REQUIRED'});
 if(module==='followups'){
   const latest=threadState;
   const prefs=JSON.parse(db.prepare('SELECT preferences_json FROM floassist_profiles WHERE owner_id=?').get(owner).preferences_json);
   const aged=latest&&Date.now()-latest.latest_at>=(prefs.followup_wait_hours||48)*3600000;
   const overdue=input.due_at&&Date.parse(input.due_at)<=Date.now();
   if(!latest||!latest.latest_sent||input.latest_message_id!==latest.latest_message_id||input.awaiting_reply!==true||(!aged&&!overdue))
     throw Object.assign(new Error('Follow-up requires a freshly read complete mail thread, its exact latest outgoing request still awaiting a reply, and an elapsed follow-up interval or explicit reply deadline. A sent message, later incoming reply, calendar event or submission deadline is not sufficient.'),{status:409,code:'FLOASSIST_NOT_A_FOLLOWUP'});
 }
 if(module==='deadlines'&&!input.due_at)throw Object.assign(new Error('Deadline tracking requires a verified obligation due date.'),{status:400,code:'FLOASSIST_DEADLINE_REQUIRED'});
 if(module==='priority'&&input.urgency!=='high'&&!(input.due_at&&Date.parse(input.due_at)<=Date.now()+86400000))throw Object.assign(new Error('Priority Alerts requires a high-impact action now or an obligation due within 24 hours. Ordinary open tasks belong in their own module or briefing.'),{status:409,code:'FLOASSIST_NOT_PRIORITY'});
 const account=db.prepare('SELECT account_id FROM floassist_account_receipts WHERE owner_id=? AND app_id=?').get(owner,input.app_id);
 if(account)return {...input,account_id:account.account_id};
 return input;
}
export const isTrackingExclusion=error=>['FLOASSIST_NOT_PRIORITY','FLOASSIST_NOT_A_FOLLOWUP'].includes(error?.code);
export function canonicalThreadInput(db,owner,action,input,context=currentFloAssistScope()){
 if(!context?.run||context.owner!==owner||action!=='gmail.fetch_message_by_thread_id'||!input.threadId)return input;
 ensureSourceReceipts(db);
 const mapped=db.prepare('SELECT thread_id FROM floassist_message_threads WHERE owner_id=? AND app_id=? AND message_id=?').get(owner,'gmail',input.threadId);
 return mapped?{...input,threadId:mapped.thread_id}:input;
}
export function assertScheduledTrackingUpdate(input,context=currentFloAssistScope()){
 if(context?.run&&!['clarify','close_orphan'].includes(input.action))throw Object.assign(new Error('A scheduled scan cannot change user tracking preferences. Use floassist_tracking_observe after reading the current full thread; do not resume, stop, snooze or acknowledge tasks without a user request.'),{status:403,code:'FLOASSIST_USER_INSTRUCTION_REQUIRED'});
}
function trackingKey(db,owner,input){
 const app=providers[input.app_id]||input.app_id||'';
 const thread=db.prepare('SELECT thread_id FROM floassist_message_threads WHERE owner_id=? AND app_id=? AND message_id=?').get(owner,app,input.source_id||'');
 return JSON.stringify(['tracking',app,thread?.thread_id||input.source_id||'']);
}
export function resolveTrackingErrors(db,owner,input,context=currentFloAssistScope()){
 if(!context?.run||context.owner!==owner)return;
 ensureSourceReceipts(db);
 db.prepare("UPDATE floassist_run_errors SET resolved_at=? WHERE owner_id=? AND run_id=? AND operation_key=? AND code IN ('FLOASSIST_THREAD_READ_REQUIRED','FLOASSIST_SOURCE_NOT_VERIFIED','FLOASSIST_CONTEXT_REQUIRED','FLOASSIST_DEADLINE_REQUIRED')").run(Date.now(),owner,context.run,trackingKey(db,owner,input));
}
export function canRetryTrackingObservation(db,owner,input,previous,context=currentFloAssistScope()){
 if(!context?.run||context.owner!==owner||!['permanent_error','blocked_prerequisite'].includes(previous?.observation_status)||!['FLOASSIST_THREAD_READ_REQUIRED','FLOASSIST_SOURCE_NOT_VERIFIED'].includes(previous.reason_code))return false;
 try{verifiedTrackingInput(db,owner,input,context);return true;}catch(e){return isTrackingExclusion(e);}
}
export function resolveConnectorSchemaError(owner,action,{db=getDb(),context=currentFloAssistScope()}={}){
 if(!context?.run||context.owner!==owner)return;
 ensureSourceReceipts(db);
 db.prepare('UPDATE floassist_run_errors SET resolved_at=? WHERE owner_id=? AND run_id=? AND operation_key=?').run(Date.now(),owner,context.run,JSON.stringify(['schema',action]));
}
export function recordRunError(error,{db=getDb(),context=currentFloAssistScope(),trackingInput,action}={}){
 if(!context?.run)return;ensureSourceReceipts(db);
 const key=trackingInput?trackingKey(db,context.owner,trackingInput):action&&error?.code==='invalid_input'&&/does not match the action schema/.test(error.message)?JSON.stringify(['schema',action]):null;
 db.prepare('INSERT INTO floassist_run_errors(owner_id,run_id,code,created_at,operation_key) VALUES (?,?,?,?,?)').run(context.owner,context.run,String(error?.code||'tool_failed').slice(0,100),Date.now(),key);
}
export function runEvidenceSummary(db,owner,runId){
 ensureSourceReceipts(db);
 return {errors:db.prepare('SELECT count(*) n FROM floassist_run_errors WHERE owner_id=? AND run_id=? AND resolved_at IS NULL').get(owner,runId).n,sources:db.prepare("SELECT count(*) n FROM floassist_source_receipts WHERE owner_id=? AND run_id=? AND source_id NOT LIKE '@read:%'").get(owner,runId).n,reads:db.prepare("SELECT count(*) n FROM floassist_source_receipts WHERE owner_id=? AND run_id=? AND source_id LIKE '@read:%'").get(owner,runId).n};
}
