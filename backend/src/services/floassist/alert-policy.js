export const ALERT_DEFAULTS={overdue_realert_hours:24,deadline_warning_hours:0,task_alert_daily_limit:3,source_realert_hours:{},muted_alert_apps:[]};
export function validateAlertPreferences(p,apps){
 for(const [key,min,max]of [['overdue_realert_hours',1,720],['deadline_warning_hours',0,168],['task_alert_daily_limit',1,20]])if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)throw Object.assign(new Error(`${key} must be an integer between ${min} and ${max}.`),{status:400,code:'alert_preferences'});
 if(!p.source_realert_hours||typeof p.source_realert_hours!=='object'||Array.isArray(p.source_realert_hours)||Object.entries(p.source_realert_hours).some(([app,h])=>!apps.includes(app)||!Number.isInteger(h)||h<0||h>720))throw Object.assign(new Error('Per-app reminder intervals must use supported apps and 0–720 hours.'),{status:400,code:'alert_preferences'});
 if(!Array.isArray(p.muted_alert_apps)||p.muted_alert_apps.some(a=>!apps.includes(a)))throw Object.assign(new Error('Choose supported apps for task-alert muting.'),{status:400,code:'alert_preferences'});
}
export function alertDecision({preferences,app,dueAt,lastSent,changed=false,sentInDay=0,now=Date.now()}){
 const p={...ALERT_DEFAULTS,task_realert_hours:24,...preferences};
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
