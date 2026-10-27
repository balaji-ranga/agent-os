export const ALERT_DEFAULTS={overdue_realert_hours:24,deadline_warning_hours:0,task_alert_daily_limit:3,source_realert_hours:{},muted_alert_apps:[],task_alert_max_days:5,due_soon_hours:72,include_due_this_month:true,briefing_overdue_high_priority:true,discovery_lookback_days:7,tool_call_budget:80};
export function validateAlertPreferences(p,apps){
 for(const [key,min,max]of [['overdue_realert_hours',1,720],['deadline_warning_hours',0,168],['task_alert_daily_limit',1,20],['task_alert_max_days',0,365],['due_soon_hours',1,744],['discovery_lookback_days',1,90],['tool_call_budget',10,256]])if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)throw Object.assign(new Error(`${key} must be an integer between ${min} and ${max}.`),{status:400,code:'alert_preferences'});
 for(const key of ['include_due_this_month','briefing_overdue_high_priority'])if(typeof p[key]!=='boolean')throw Object.assign(new Error(`${key} must be boolean.`),{status:400,code:'alert_preferences'});
 if(!p.source_realert_hours||typeof p.source_realert_hours!=='object'||Array.isArray(p.source_realert_hours)||Object.entries(p.source_realert_hours).some(([app,h])=>!apps.includes(app)||!Number.isInteger(h)||h<0||h>720))throw Object.assign(new Error('Per-app reminder intervals must use supported apps and 0–720 hours.'),{status:400,code:'alert_preferences'});
 if(!Array.isArray(p.muted_alert_apps)||p.muted_alert_apps.some(a=>!apps.includes(a)))throw Object.assign(new Error('Choose supported apps for task-alert muting.'),{status:400,code:'alert_preferences'});
}
export function alertDecision({preferences,app,dueAt,lastSent,changed=false,sentInDay=0,alertDays=0,now=Date.now()}){
 const p={...ALERT_DEFAULTS,task_realert_hours:24,...preferences};
 if(p.task_alert_max_days>0&&alertDays>=p.task_alert_max_days)return {send:false,reason:'task_alert_day_limit'};
 if(p.muted_alert_apps.includes(app))return {send:false,reason:'source_alerts_muted'};
 if(sentInDay>=p.task_alert_daily_limit)return {send:false,reason:'task_daily_alert_limit'};
 if(!lastSent)return {send:true,reason:'new_finding'};
 const due=Date.parse(dueAt),overdue=Number.isFinite(due)&&due<=now;
 if(changed)return {send:true,reason:'verified_deadline_changed'};
 if(Number.isFinite(due)&&lastSent<due&&due<=now)return {send:true,reason:'deadline_crossed'};
 const warning=due-p.deadline_warning_hours*3600000;
 if(p.deadline_warning_hours>0&&lastSent<warning&&warning<=now&&now<due)return {send:true,reason:'deadline_approaching'};
 const hours=overdue?p.overdue_realert_hours:(p.source_realert_hours[app]??p.task_realert_hours);
 return now-lastSent>=hours*3600000?{send:true,reason:overdue?'overdue_reminder':'reminder_interval_elapsed'}:{send:false,reason:'reminder_interval'};
}
export function localAlertDay(at,timezone='UTC'){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(at));
 return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
export function dueThisMonth(dueAt,preferences={},now=Date.now()){
 const due=Date.parse(dueAt);return Number.isFinite(due)&&localAlertDay(due,preferences.timezone).slice(0,7)===localAlertDay(now,preferences.timezone).slice(0,7);
}
export function dueIndicator(dueAt,preferences={},now=Date.now()){
 const due=Date.parse(dueAt);if(!Number.isFinite(due))return '';
 return due<=now?'🔴':due-now<=(preferences.due_soon_hours??72)*3600000?'🟠':'🟢';
}
export function taskPriority(input,preferences={},now=Date.now()){
 if(input.priority_locked)return {priority:input.priority||'normal',priority_reason:input.priority_reason||'User assigned',priority_locked:true};
 if(input.urgency==='high'||['high','urgent'].includes(input.priority))return {priority:input.priority==='urgent'?'urgent':'high',priority_reason:String(input.priority_reason||input.why_now||'High-impact action supported by source evidence').slice(0,300),priority_locked:false};
 const due=Date.parse(input.due_at);
 if(due>now&&due-now<=(preferences.due_soon_hours??72)*3600000)return {priority:'high',priority_reason:'Verified deadline is approaching',priority_locked:false};
 return {priority:input.priority==='low'?'low':'normal',priority_reason:'Open obligation without verified urgent impact',priority_locked:false};
}
