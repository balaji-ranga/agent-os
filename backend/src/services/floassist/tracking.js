import {alertDecision,localAlertDay,dueIndicator,dueThisMonth,taskPriority} from './alert-policy.js';
import {createHash} from 'node:crypto';
import {ensureFloAssistRuntime} from './runtime.js';

const categories=['priority','deadlines','followups'];
const terminal=new Set(['completed','closed','done','cancelled','failed']);
const parse=s=>JSON.parse(s||'{}');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function text(value,name,max=500){const s=String(value||'').trim();if(!s||s.length>max)fail(`${name} is required (up to ${max} characters).`);return s;}

export function ensureTracking(db){
  ensureFloAssistRuntime(db);
  const newDays=!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_task_alert_days'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS floassist_task_alert_days(owner_id TEXT NOT NULL,task_id INTEGER NOT NULL,local_day TEXT NOT NULL,first_sent_at INTEGER NOT NULL,PRIMARY KEY(owner_id,task_id,local_day));`);
  if(newDays)for(const n of db.prepare("SELECT n.* FROM floassist_notifications n WHERE n.status='sent' AND n.source_key LIKE n.owner_id||':tracking:%'").all())recordTrackingDelivery(db,n,n.updated_at);

  db.exec(`CREATE TABLE IF NOT EXISTS floassist_task_tracking (
    owner_id TEXT NOT NULL,task_id INTEGER NOT NULL,source_key TEXT NOT NULL,
    app_id TEXT NOT NULL,account_id TEXT NOT NULL,source_id TEXT NOT NULL,obligation_key TEXT NOT NULL,
    categories_json TEXT NOT NULL,source_url TEXT,revision INTEGER NOT NULL DEFAULT 1,
    fingerprint TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'open',snooze_until INTEGER,
    last_seen_at INTEGER NOT NULL,clarification_revision INTEGER,UNIQUE(owner_id,source_key),PRIMARY KEY(owner_id,task_id));
    CREATE TABLE IF NOT EXISTS floassist_tracking_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL,task_id INTEGER NOT NULL,
    decision TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  if(!db.prepare('PRAGMA table_info(floassist_task_tracking)').all().some(c=>c.name==='origin')){
    db.exec("ALTER TABLE floassist_task_tracking ADD COLUMN origin TEXT NOT NULL DEFAULT 'linked'");
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='kanban_tasks'").get())
      db.exec("UPDATE floassist_task_tracking SET origin='floassist_created' WHERE task_id IN (SELECT id FROM kanban_tasks WHERE created_by='floassist-tracking' AND owner_user_id=floassist_task_tracking.owner_id)");
  }
  if(!db.prepare('PRAGMA table_info(floassist_task_tracking)').all().some(c=>c.name==='context_json'))db.exec("ALTER TABLE floassist_task_tracking ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}'");
}
export function recordTrackingDelivery(db,n,now=Date.now()){
 const prefix=`${n.owner_id}:tracking:`;if(!n.source_key.startsWith(prefix))return;
 const id=Number(n.source_key.slice(prefix.length).split(':')[0]);if(!Number.isInteger(id))return;
 const prefs=parse(db.prepare('SELECT preferences_json FROM floassist_profiles WHERE owner_id=?').get(n.owner_id)?.preferences_json);
 db.prepare('INSERT OR IGNORE INTO floassist_task_alert_days VALUES (?,?,?,?)').run(n.owner_id,id,localAlertDay(now,prefs.timezone),now);
}
function deliveredDays(db,r){return db.prepare('SELECT count(*) n FROM floassist_task_alert_days WHERE owner_id=? AND task_id=?').get(r.owner_id,r.task_id).n;}
function profile(db,owner){
  const p=db.prepare('SELECT * FROM floassist_profiles WHERE owner_id=?').get(owner);
  if(!p)fail('FloAssist profile not found.',404);return p;
}
function row(db,owner,id){
  const r=db.prepare(`SELECT f.*,k.title,k.status AS task_status,k.due_at FROM floassist_task_tracking f
    JOIN kanban_tasks k ON k.id=f.task_id AND k.owner_user_id=f.owner_id WHERE f.owner_id=? AND f.task_id=?`).get(owner,id);
  if(!r)fail('Tracked task not found.',404);return r;
}
function audit(db,r,decision,reason,now){db.prepare('INSERT INTO floassist_tracking_audit(owner_id,task_id,decision,reason,created_at) VALUES (?,?,?,?,?)').run(r.owner_id,r.task_id,decision,reason,now);}
function cancelled(db,r){db.prepare("UPDATE floassist_notifications SET status='cancelled',text=NULL WHERE owner_id=? AND source_key LIKE ? AND status='pending'").run(r.owner_id,`${r.owner_id}:tracking:${r.task_id}:%`);}
function view(r){return {...r,...taskPriority(parse(r.context_json)),categories:JSON.parse(r.categories_json),closed:terminal.has(r.task_status),completion_basis:terminal.has(r.task_status)?'Kanban task status; consult task messages for user or provider evidence':null};}
const sourceEnabled=(prefs,r)=>r.origin==='whatsapp_request'||prefs.connectors?.includes(r.app_id);

/** Called only from a verified WhatsApp tool request after canonical task creation. */
export function registerWhatsAppTask(db,owner,taskId,requestRef,now=Date.now()){
  ensureTracking(db);
  const task=db.prepare('SELECT * FROM kanban_tasks WHERE id=? AND owner_user_id=?').get(taskId,owner);
  if(!task||!requestRef)return;
  const source=hash([requestRef,taskId]);
  db.prepare(`INSERT OR IGNORE INTO floassist_task_tracking(owner_id,task_id,source_key,app_id,account_id,source_id,obligation_key,categories_json,fingerprint,last_seen_at,origin)
    VALUES (?,?,?,'whatsapp',?,?,?,'["priority"]',?,?,'whatsapp_request')`).run(owner,taskId,hash(['whatsapp',owner,source]),owner,source,'user_request',hash([task.due_at]),now);
  db.prepare("UPDATE floassist_task_tracking SET context_json=? WHERE owner_id=? AND task_id=? AND context_json='{}'").run(JSON.stringify({thread_summary:'You asked your COO to track this task on WhatsApp.',requested_action:task.title,why_now:'The task is explicitly marked urgent, critical or high priority.'}),owner,taskId);
  audit(db,{owner_id:owner,task_id:taskId},'linked','Verified WhatsApp request created this canonical task',now);
}
export function queueWhatsAppTasks(db,owner,runId,now=Date.now()){
  ensureTracking(db);
  const tasks=db.prepare("SELECT f.task_id,k.title,k.due_at FROM floassist_task_tracking f JOIN kanban_tasks k ON k.id=f.task_id AND k.owner_user_id=f.owner_id WHERE f.owner_id=? AND f.origin='whatsapp_request'").all(owner);
  for(const task of tasks){
    const r=row(db,owner,task.task_id);
    if(terminal.has(r.task_status)||['urgent','high'].includes(parse(r.context_json).priority)||/\b(urgent|critical|high priority)\b/i.test(task.title))queue(db,r,'finding',now,runId);
    else audit(db,r,'suppressed','No explicit urgent/critical/high-priority marker; work ETA alone is not a user deadline',now);
  }
}
export function trackingAlertHeading(db,owner,runId){
  if(!runId)return 'FloAssist';
  const run=db.prepare(`SELECT g.source FROM scheduled_goal_runs r JOIN scheduled_goals g
    ON g.id=r.goal_id AND g.owner_user_id=r.owner_user_id WHERE r.id=? AND r.owner_user_id=?`).get(runId,owner);
  const label={'floassist:priority':'Priority Alerts','floassist:followups':'Follow-up','floassist:deadlines':'Deadline Tracking','floassist:briefing':'Morning Briefing'}[run?.source];
  return label?`FloAssist · ${label}`:'FloAssist';
}
function queue(db,r,kind,now,cycle=null){
  const p=profile(db,r.owner_id),prefs=parse(p.preferences_json);
  if(terminal.has(r.task_status)){cancelled(db,r);audit(db,r,'suppressed','task_closed',now);return 'task_closed';}
  if(p.status!=='active'||!sourceEnabled(prefs,r)||!JSON.parse(r.categories_json).some(c=>prefs.responsibilities?.includes(c)))return 'tracking_disabled';
  if(r.state==='stopped'){audit(db,r,'suppressed','tracking_stopped',now);return 'tracking_stopped';}
  if(r.snooze_until>now){audit(db,r,'suppressed','snoozed',now);return 'snoozed';}
  if((prefs.muted_alert_apps||[]).includes(r.app_id)){audit(db,r,'suppressed','source_alerts_muted',now);return 'source_alerts_muted';}
  if((prefs.task_alert_max_days??5)>0&&deliveredDays(db,r)>=(prefs.task_alert_max_days??5)){audit(db,r,'suppressed','task_alert_day_limit',now);return 'task_alert_day_limit';}
  const prefix=`${r.owner_id}:tracking:${r.task_id}:${r.revision}:`;
  if(cycle){
    const outstanding=db.prepare("SELECT status FROM floassist_notifications WHERE owner_id=? AND source_key LIKE ? AND status IN ('pending','sending','uncertain') LIMIT 1").get(r.owner_id,`${prefix}%`);
    if(outstanding){audit(db,r,'suppressed',`already_${outstanding.status}`,now);return `already_${outstanding.status}`;}
    const last=db.prepare("SELECT source_key,updated_at FROM floassist_notifications WHERE owner_id=? AND source_key LIKE ? AND status='sent' ORDER BY updated_at DESC LIMIT 1").get(r.owner_id,`${r.owner_id}:tracking:${r.task_id}:%`);
    const count=db.prepare("SELECT count(*) n FROM floassist_notifications WHERE owner_id=? AND source_key LIKE ? AND status='sent' AND updated_at>?").get(r.owner_id,`${r.owner_id}:tracking:${r.task_id}:%`,now-86400000).n;
    const decision=alertDecision({preferences:prefs,app:r.app_id,dueAt:r.due_at,lastSent:last?.updated_at,changed:!!last&&!last.source_key.startsWith(prefix),sentInDay:count,alertDays:deliveredDays(db,r),now});
    if(!decision.send){audit(db,r,'suppressed',decision.reason,now);return decision.reason;}
    audit(db,r,'eligible',decision.reason,now);
  }
  const sourceKey=`${prefix}${kind}${cycle?`:${cycle}`:''}`;
  const existing=db.prepare('SELECT status FROM floassist_notifications WHERE source_key=?').get(sourceKey);
  if(existing){audit(db,r,'suppressed',`already_${existing.status}`,now);return `already_${existing.status}`;}
  const due=r.due_at&&r.origin!=='whatsapp_request'?new Intl.DateTimeFormat('en-GB',{timeZone:prefs.timezone||'UTC',dateStyle:'medium',...(parse(r.context_json).due_precision==='day'?{}:{timeStyle:'short'})}).format(new Date(r.due_at)):null;
  const details=parse(r.context_json);
  const body=kind==='clarification'?`*#${r.task_id} · ${r.title}*\nThis open task could not be confirmed from its source. Is it completed, or should I keep tracking it?`:
    `*#${r.task_id} · ${r.title}*${due?`\n${dueIndicator(r.due_at,prefs,now)} *Due:* ${due} (${prefs.timezone||'UTC'})`:''}${details.thread_summary?`\n\n*Context:* ${details.thread_summary}`:''}${details.requested_action?`\n\u{27A1} *Next action:* ${details.requested_action}`:''}${details.priority?`\n*Priority:* ${details.priority} — ${details.priority_reason}`:''}${details.why_now?`\n*Why now:* ${details.why_now}`:''}\n*Source:* ${r.app_id}${r.source_url?` · ${r.source_url}`:''}\n\n*Reply:* #${r.task_id} done, stop tracking, or snooze.`;
  const message=`*${trackingAlertHeading(db,r.owner_id,cycle)}*\n\n${body}`;
  db.prepare('INSERT INTO floassist_notifications(source_key,owner_id,agent_id,text,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(sourceKey,r.owner_id,p.agent_id,message,now,now,now+7*86400000);
  audit(db,r,'queued',kind,now);return 'queued';
}

// Exact provider-verified message aliases reuse the existing task identity.
// This is shared mail normalization, never title-based matching or task merging.
function existingMailSource(db,owner,app,account,source,obligation){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_message_threads'").get())return source;
 if(db.prepare('SELECT 1 FROM floassist_task_tracking WHERE owner_id=? AND app_id=? AND account_id=? AND source_id=? AND obligation_key=?').get(owner,app,account,source,obligation))return source;
 const matches=db.prepare('SELECT DISTINCT f.source_id FROM floassist_task_tracking f JOIN floassist_message_threads m ON m.owner_id=f.owner_id AND m.app_id=f.app_id AND m.message_id=f.source_id WHERE f.owner_id=? AND f.app_id=? AND f.account_id=? AND m.thread_id=? AND f.obligation_key=?').all(owner,app,account,source,obligation);
 if(matches.length>1)fail('Multiple existing source-backed tasks match this conversation. Ask the owner to reconcile them; no task was merged or created.',409);
 return matches[0]?.source_id||source;
}
/** All identities are owner scoped. Obligation identity never includes alert wording or responsibility. */
export function observeTracking(db,owner,input,now=Date.now()){
  ensureTracking(db);
  const p=profile(db,owner),prefs=parse(p.preferences_json);
  const app=text(input.app_id,'app_id',80),account=text(input.account_id,'account_id',200),incomingSource=text(input.source_id,'source_id',300);
  if(!prefs.connectors?.includes(app))fail('Select this app in FloAssist before tracking it.',403);
  const category=text(input.category,'category',30);if(!categories.includes(category))fail('Unsupported tracking category.');
  const obligation=String(input.obligation_key||'action').trim();if(!obligation||obligation.length>150)fail('Invalid obligation key.');
  const source=existingMailSource(db,owner,app,account,incomingSource,obligation);
  const title=text(input.title,'title',300),evidence=text(input.evidence,'evidence',1000);
  const prior=db.prepare('SELECT context_json FROM floassist_task_tracking WHERE owner_id=? AND source_key=?').get(owner,hash([app,account,source,obligation]));
  const assigned=taskPriority({...input,...(parse(prior?.context_json).priority_locked?parse(prior.context_json):{})},prefs,now);
  const contextJson=JSON.stringify({...assigned,due_precision:input.due_precision||'minute',thread_summary:String(input.thread_summary||evidence).slice(0,500),requested_action:String(input.requested_action||title).slice(0,300),why_now:String(input.why_now||'Verified open obligation in this check').slice(0,300)});
  const rawDue=input.due_at==null?null:String(input.due_at);
  if(rawDue&&(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(rawDue)||!Number.isFinite(Date.parse(rawDue))))fail('due_at must include a timezone offset.');
  const due=rawDue?new Date(rawDue).toISOString():null;
  const url=input.source_url?String(input.source_url):null;if(url&&(!url.startsWith('https://')||url.length>2000))fail('Source link must be HTTPS.');
  const key=hash([app,account,source,obligation]);
  let cycle=null;
  if(input.scheduled_goal_id||input.run_key){
    const run=db.prepare(`SELECT r.id FROM scheduled_goal_runs r JOIN scheduled_goals g ON g.id=r.goal_id AND g.owner_user_id=r.owner_user_id
      WHERE r.owner_user_id=? AND r.goal_id=? AND r.run_key=? AND r.status IN ('running','ok') AND g.source IN ('floassist:priority','floassist:deadlines','floassist:followups')`).get(owner,input.scheduled_goal_id||'',input.run_key||'');
    if(!run)fail('A valid owner FloAssist scheduled run is required for repeat alerts.',409);
    cycle=run.id;
  }
  return db.transaction(()=>{
    let existing=db.prepare('SELECT task_id FROM floassist_task_tracking WHERE owner_id=? AND source_key=?').get(owner,key);
    if(existing){
      let r=row(db,owner,existing.task_id);
      const cats=[...new Set([...JSON.parse(r.categories_json),category])];
      if(r.context_json!==contextJson)db.prepare("INSERT INTO task_messages(task_id,role,content) VALUES (?,'assistant',?)").run(r.task_id,`FloAssist thread update: ${JSON.parse(contextJson).thread_summary}\nNext action: ${JSON.parse(contextJson).requested_action}\nWhy now: ${JSON.parse(contextJson).why_now}`);
      db.prepare('UPDATE floassist_task_tracking SET categories_json=?,last_seen_at=?,context_json=? WHERE owner_id=? AND task_id=?').run(JSON.stringify(cats),now,contextJson,owner,r.task_id);
      // Scans cannot reopen a completed task or clear a user acknowledgement.
      if(terminal.has(r.task_status))return {task:view(r),notification:queue(db,r,'finding',now)};
      if(input.due_at!==undefined&&due!==r.due_at){
        db.prepare('UPDATE kanban_tasks SET due_at=?,due_date=?,updated_at=datetime(\'now\') WHERE id=? AND owner_user_id=?').run(due,due?.slice(0,10)||null,r.task_id,owner);
        db.prepare("UPDATE floassist_task_tracking SET revision=revision+1,state=CASE WHEN state='stopped' THEN state ELSE 'open' END,snooze_until=NULL,clarification_revision=NULL,fingerprint=? WHERE owner_id=? AND task_id=?").run(hash([due]),owner,r.task_id);
        cancelled(db,r);audit(db,r,'changed',evidence,now);
        db.prepare("INSERT INTO task_messages(task_id,role,content) VALUES (?,'assistant',?)").run(r.task_id,`FloAssist deadline change: ${evidence}`);
      }
      r=row(db,owner,r.task_id);return {task:view(r),notification:queue(db,r,'finding',now,cycle)};
    }
    let id;
    if(input.existing_task_id){
      const task=db.prepare('SELECT * FROM kanban_tasks WHERE id=? AND owner_user_id=?').get(Number(input.existing_task_id),owner);
      if(!task)fail('Existing task not found.',404);
      if(db.prepare('SELECT 1 FROM floassist_task_tracking WHERE owner_id=? AND task_id=?').get(owner,task.id))fail('Task already has a source link; reuse its existing source identity.',409);
      id=task.id;
    }else{
      id=Number(db.prepare(`INSERT INTO kanban_tasks(title,description,status,created_by,owner_user_id,assigned_user_id,due_at,due_date)
        VALUES (?,?,'open','floassist-tracking',?,?,?,?)`).run(title,`FloAssist ${category}\nSource: ${app} / ${account} / ${source}\nObligation: ${obligation}\n${url||''}\n${evidence}`,owner,owner,due,due?.slice(0,10)||null).lastInsertRowid);
      // The generic AFTER INSERT SLA trigger supplies a work ETA and overwrites
      // due_at. Restore the verified source deadline (including unknown/null)
      // inside this transaction before any alert or observer can read the task.
      // Leave the generic trigger unchanged for all other Kanban workflows.
      db.prepare('UPDATE kanban_tasks SET due_at=?,due_date=? WHERE id=? AND owner_user_id=?').run(due,due?.slice(0,10)||null,id,owner);
    }
    db.prepare(`INSERT INTO floassist_task_tracking(owner_id,task_id,source_key,app_id,account_id,source_id,obligation_key,categories_json,source_url,fingerprint,last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(owner,id,key,app,account,source,obligation,JSON.stringify([category]),url,hash([due]),now);
    const r=row(db,owner,id);audit(db,r,'linked',evidence,now);
    db.prepare('UPDATE floassist_task_tracking SET origin=? WHERE owner_id=? AND task_id=?').run(input.existing_task_id?'linked':'floassist_created',owner,id);
    db.prepare('UPDATE floassist_task_tracking SET context_json=? WHERE owner_id=? AND task_id=?').run(contextJson,owner,id);
    const refreshed=row(db,owner,id);
    return {task:view(refreshed),notification:queue(db,refreshed,'finding',now,cycle)};
  })();
}

export function listTracking(db,owner,{after_id=0,limit=50}={}){
  ensureTracking(db);profile(db,owner);
  const n=Math.max(1,Math.min(100,Number(limit)||50));
  const rows=db.prepare(`SELECT f.*,k.title,k.status AS task_status,k.due_at FROM floassist_task_tracking f
    JOIN kanban_tasks k ON k.id=f.task_id AND k.owner_user_id=f.owner_id WHERE f.owner_id=? AND f.task_id>? ORDER BY f.task_id LIMIT ?`).all(owner,Number(after_id)||0,n+1);
  return {tasks:rows.slice(0,n).map(r=>({...view(r),alert_delivery_days:deliveredDays(db,r),automatic_alerts_quieted:(parse(profile(db,owner).preferences_json).task_alert_max_days??5)>0&&deliveredDays(db,r)>=(parse(profile(db,owner).preferences_json).task_alert_max_days??5)})),next_after_id:rows.length>n?rows[n-1].task_id:null,scope:'All tracked tasks including closed tasks; independent of source scan filters.'};
}

// A completion snapshot, not a claim about which provider reads or deliveries ran.
export function trackingHistorySummary(db,owner){
  ensureTracking(db);
  const tasks=db.prepare(`SELECT k.id,k.status FROM floassist_task_tracking f
    JOIN kanban_tasks k ON k.id=f.task_id AND k.owner_user_id=f.owner_id WHERE f.owner_id=?`).all(owner);
  const open=tasks.filter(t=>!terminal.has(t.status));
  const refs=open.slice(0,10).map(t=>`#${t.id}`).join(', ');
  return `Check completed. Tracking snapshot: ${open.length} open task(s)${refs?` (${refs}${open.length>10?', …':''})`:''}; ${tasks.length-open.length} closed task(s). Fresh findings are coordinated across checks; unchanged tasks respect the reminder interval, stop and snooze settings. Eligible notifications may share one WhatsApp summary. This snapshot does not confirm source coverage or delivery.`;
}

export function updateTracking(db,owner,input,now=Date.now()){
  ensureTracking(db);
  const evidence=text(input.evidence,'evidence',1000);
  return db.transaction(()=>{
    let r=row(db,owner,Number(input.task_id));
    if(terminal.has(r.task_status)){cancelled(db,r);return {task:view(r),notification:'task_closed'};}
    if(input.action==='close_orphan'){
      const creator=db.prepare('SELECT created_by FROM kanban_tasks WHERE id=? AND owner_user_id=?').get(r.task_id,owner);
      if(r.origin!=='floassist_created'||creator?.created_by!=='floassist-tracking')fail('Only tasks created by FloAssist may be closed through source reconciliation.',403);
      if(!['gmail','outlook'].includes(r.app_id)||input.app_id!==r.app_id||input.account_id!==r.account_id||input.source_id!==r.source_id||input.obligation_key!==r.obligation_key)
        fail('Exact stored mail source and obligation identity is required.',409);
      if(input.source_checked!==true||!['deleted','fulfilled'].includes(input.source_outcome))fail('Direct source verification of deletion or fulfilled obligation is required.');
      const receipt=text(input.source_evidence,'source_evidence',2000);
      db.prepare("UPDATE kanban_tasks SET status='completed',updated_at=datetime('now') WHERE id=? AND owner_user_id=?").run(r.task_id,owner);
      db.prepare("UPDATE floassist_task_tracking SET state='closed',snooze_until=NULL WHERE owner_id=? AND task_id=?").run(owner,r.task_id);
      cancelled(db,r);audit(db,r,'orphan_closed',`${input.source_outcome}: ${receipt}`,now);
      db.prepare("INSERT INTO task_messages(task_id,role,content) VALUES (?,'assistant',?)").run(r.task_id,`FloAssist source reconciliation (${input.source_outcome}); ${r.app_id}/${r.account_id}/${r.source_id}/${r.obligation_key}: ${receipt}`);
      return {task:view(row(db,owner,r.task_id)),notification:'task_closed'};
    }
    if(r.state==='stopped'&&input.action==='clarify')return {task:view(r),notification:'tracking_stopped'};
    if(input.action==='clarify'){
      if(input.source_checked!==true)fail('Check the original source directly before requesting clarification.');
      if(r.clarification_revision===r.revision)return {task:view(r),notification:'clarification_already_requested'};
      const outcome=queue(db,r,'clarification',now);
      if(outcome==='queued')db.prepare('UPDATE floassist_task_tracking SET clarification_revision=? WHERE owner_id=? AND task_id=?').run(r.revision,owner,r.task_id);
      audit(db,r,'clarification',evidence,now);return {task:view(r),notification:outcome};
    }
    if(input.action==='set_priority'){
      if(!['urgent','high','normal','low'].includes(input.priority))fail('Choose urgent, high, normal or low.');
      const details={...parse(r.context_json),priority:input.priority,priority_reason:evidence,priority_locked:true};
      db.prepare('UPDATE floassist_task_tracking SET context_json=? WHERE owner_id=? AND task_id=?').run(JSON.stringify(details),owner,r.task_id);
      db.prepare("INSERT INTO task_messages(task_id,role,content) VALUES (?,'user',?)").run(r.task_id,`FloAssist priority ${input.priority}: ${evidence}`);audit(db,r,'priority_assigned',evidence,now);return {task:view(row(db,owner,r.task_id))};
    }
    if(!['acknowledge','snooze','track','stop'].includes(input.action))fail('Use acknowledge, snooze, track, stop, clarify or close_orphan.');
    const until=input.action==='snooze'?Date.parse(input.until):null;
    if(input.action==='snooze'&&(!Number.isFinite(until)||until<=now||!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(String(input.until))))fail('Provide a future snooze time with timezone offset.');
    // Reaffirming an already active task is idempotent. It must not erase an
    // alert queued by observe, or record a routine scan as a user instruction.
    if(input.action==='track'&&r.state==='open'&&r.snooze_until==null){
      audit(db,r,'track_unchanged','Already tracking; pending notifications preserved.',now);
      return {task:view(r),notification:'tracking_unchanged'};
    }
    // Stop, acknowledgement and rescheduling invalidate pending delivery.
    // Resume keeps any valid pending alert; it must not replay sent alerts.
    if(input.action!=='track')cancelled(db,r);
    db.prepare('UPDATE floassist_task_tracking SET state=?,snooze_until=?,clarification_revision=?,revision=revision+? WHERE owner_id=? AND task_id=?')
      .run(input.action==='stop'?'stopped':input.action==='acknowledge'?'acknowledged':'open',until,input.action==='track'?r.revision:r.clarification_revision,input.action==='snooze'?1:0,owner,r.task_id);
    db.prepare("INSERT INTO task_messages(task_id,role,content) VALUES (?,'user',?)").run(r.task_id,`FloAssist ${input.action}: ${evidence}`);
    audit(db,r,input.action,evidence,now);r=row(db,owner,r.task_id);return {task:view(r)};
  })();
}

/** Called immediately before delivery: closing a Kanban card invalidates queued alerts too. */
export function trackingNotificationAllowed(db,notification,now=Date.now()){
  const prefix=`${notification.owner_id}:tracking:`;if(!notification.source_key.startsWith(prefix))return true;
  ensureTracking(db);const [id,revision,kind]=notification.source_key.slice(prefix.length).split(':');
  let r;try{r=row(db,notification.owner_id,Number(id));}catch{return false;}
  const prefs=parse(profile(db,r.owner_id).preferences_json);
  const sentInDay=db.prepare("SELECT count(*) n FROM floassist_notifications WHERE owner_id=? AND source_key LIKE ? AND status='sent' AND updated_at>?").get(r.owner_id,`${r.owner_id}:tracking:${r.task_id}:%`,now-86400000).n;
  if((prefs.task_alert_max_days??5)>0&&deliveredDays(db,r)>=(prefs.task_alert_max_days??5)){audit(db,r,'suppressed','task_alert_day_limit',now);return false;}
  if(sentInDay>=(prefs.task_alert_daily_limit??3)){audit(db,r,'suppressed','task_daily_alert_limit',now);return false;}
  return !terminal.has(r.task_status)&&r.revision===Number(revision)&&!(r.snooze_until>now)&&
    r.state!=='stopped'&&!(prefs.muted_alert_apps||[]).includes(r.app_id)&&sourceEnabled(prefs,r)&&JSON.parse(r.categories_json).some(c=>prefs.responsibilities?.includes(c));
}

export function tickTracking(db,now=Date.now()){
  ensureTracking(db);
  const rows=db.prepare('SELECT f.owner_id,f.task_id FROM floassist_task_tracking f JOIN kanban_tasks k ON k.id=f.task_id AND k.owner_user_id=f.owner_id WHERE snooze_until IS NOT NULL AND snooze_until<=?').all(now);
  for(const x of rows)db.transaction(()=>{const r=row(db,x.owner_id,x.task_id);const result=queue(db,r,'finding',now);if(result==='queued'||result==='task_closed'||result.startsWith('already_'))db.prepare('UPDATE floassist_task_tracking SET snooze_until=NULL WHERE owner_id=? AND task_id=?').run(x.owner_id,x.task_id);})();
}

export const TRACKING_RUN_INSTRUCTIONS=`For deadline evidence, prefer the returned deadline_evidence entries: copy deadline_excerpt (fa-evidence reference) and due_at exactly, then reassess relevance. The backend resolves references to the original current source passage. Never paraphrase an excerpt or fabricate a reference. Use returned fa-ref identifiers verbatim for source_id, latest_message_id and connector ID fields. They resolve to exact provider IDs within this run; never reconstruct long IDs from memory or URLs. Prior task references are not evidence of a fresh source read. Responsibilities are distinct: Priority Alerts is urgent/high-impact action now, due within 24 hours, or due in the current owner-local month when include_due_this_month is enabled; Deadline Tracking is an actual dated commitment: every deadline observation MUST include due_at as an ISO datetime with timezone offset, extracted from the freshly read subject and body (for example 2026-10-27T15:00:00+08:00). A date mentioned only in title/evidence is NOT the due_at field. Skip undated candidates; do not call observe for them or invent a date. If the tool reports FLOASSIST_DEADLINE_REQUIRED, supply the verified due_at field before retrying; Follow-up is an unanswered outgoing request after the configured wait (default 48 hours) or an explicit reply deadline. A calendar appointment is not a mail follow-up/deadline task. For follow-ups read the entire current thread, identify its latest message, and do not alert on earlier sent messages superseded by an incoming reply. A thank-you, acknowledgement or informational sent email does not create an obligation. List recent sent mail within discovery_lookback_days from current preferences (default newer_than:7d); never end the discovery window before today. Provide requested_action, why_now, thread_summary and (for followups) latest_message_id and awaiting_reply. Briefly summarize thread progression and what is actually still outstanding; do not copy raw emails. Use the mailbox account, never the sender, as account_id. Do not re-report completed or stopped tasks. For priority alerts, deadlines and follow-ups, use floassist_tracking_list (paginate all pages) before scanning. Correlate both open and closed Kanban tasks, including tasks outside this run's source filters. Read the selected provider sources freshly in this run before deciding which obligations still match. The tracking list is prior state, not proof of current mailbox contents. For follow-ups, inspect sent requests and subsequent thread replies; a calendar event or submission deadline alone is not an unanswered request. Do not call acknowledge, stop, snooze or track as routine scan bookkeeping: those actions require an explicit user instruction. For each verified obligation call floassist_tracking_observe with stable app_id, account_id, source_id (thread ID when available), obligation_key (reuse the existing key; default action), category, title and concise evidence; include due_at only when verified. Always pass scheduled_goal_id and run_key from this run header on every observation: submit verified open findings for coordination; the delivery layer suppresses unchanged repeats across modules and runs until the reminder interval, deadline escalation or a meaningful change. Use the same task across responsibilities. Link an existing owner task with existing_task_id rather than duplicating it. A new obligation in a thread needs a distinct stable key supported by new evidence; changed wording is not a new obligation. Closed tasks must not be reopened by scans. Reconcile task closure only for open, non-stopped tasks whose categories include the current responsibility; do not close another module�s task. For open tasks missing from the scan, check their original source directly; absence from a filtered result is not completion. For a task with origin floassist_created, directly confirmed deleted email (trash/permanent deletion, not missing search results or authorization failure) can be submitted for backend deletion verification using floassist_tracking_update action close_orphan with exact app_id/account_id/source_id/obligation_key, source_checked:true, source_outcome:deleted and source_evidence containing the direct provider result. The backend independently re-reads the stored source before applying closure. A present source with uncertain external fulfillment becomes a clarification, never automatic completion. Never close linked tasks or title matches this way. Read/archive status or a sent reply alone is not fulfillment. If still uncertain call floassist_tracking_update action clarify with source_checked:true and evidence; it queues at most one clarification per revision. Do not create tasks for empty scans or connector health. These tools queue the user alerts with stable task references; return FLOASSIST_NO_UPDATE after processing, never duplicate their notifications in the scheduled reply. Report coverage failures in the run history, without claiming success.`;

export function queueBriefingTasks(db,owner,runId,now=Date.now()){
 ensureTracking(db);const prefs=parse(profile(db,owner).preferences_json);
 for(const x of db.prepare('SELECT task_id FROM floassist_task_tracking WHERE owner_id=?').all(owner)){
  const r=row(db,owner,x.task_id),details=parse(r.context_json),due=Date.parse(r.due_at);
  const month=(prefs.include_due_this_month??true)&&dueThisMonth(r.due_at,prefs,now);
  const overdue=(prefs.briefing_overdue_high_priority??true)&&due<now&&['urgent','high'].includes(details.priority);
  if(month||overdue)queue(db,r,'finding',now,runId);
 }
}

export const DEADLINE_TRACKING_RUN_INSTRUCTIONS=`Deadline Tracking selects still-outstanding dated commitments from complete current source content. Call floassist_source_read, finish every page, inspect latest thread state, and choose only a returned deadline_evidence.deadline_candidate. Call floassist_tracking_observe with deadline_candidate, why_now and thread_summary. The backend binds the source/account/deadline/evidence and builds the source-backed task; do not construct or copy app/source/date/task-link fields. If no candidate supports the action, skip it or report ambiguity rather than inventing a reference. Existing task text is not fresh evidence. Reuse exact source-backed obligations; closed/stopped tasks remain quiet. A scan never completes or changes tracking preferences. Missing filtered results are not fulfillment; read the exact original task source and use only backend-verified deletion reconciliation or clarification. Never close linked/manual/similarly titled tasks. Tracking tools queue eligible grouped notifications with task IDs; return FLOASSIST_NO_UPDATE after processing instead of duplicating alerts in prose. Report unread/unsupported sources honestly.
`;
