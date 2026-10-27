const string={type:'string'};
const identity={app_id:{type:'string',description:'Selected FloAssist app ID, for example gmail or google_calendar.'},account_id:{type:'string',description:'Exact account_id from tracking_list or the connected provider account.'},source_id:{type:'string',description:'Exact provider message/thread/event ID; never invent IDs.'},obligation_key:{type:'string',description:'Reuse the existing obligation_key, otherwise action.'}};
identity.corrects_source_id={type:'string',description:'Only when correcting a previously rejected unverified source ID: the exact rejected ID. source_id must identify the verified actual source, with its full current thread read first. Never infer identity solely from similar wording or a candidate hint.'};
identity.deadline_excerpt={type:'string',minLength:12,maxLength:1200,description:'Required with due_at: exact source passage stating the outstanding action and its deadline, including year (or today/tomorrow anchored to the original message). Never quote file metadata, a task summary, or sent/created/modified timestamps as a deadline.'};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export const floassistSchemas={
 floassist_source_read:object({kind:{type:'string',enum:['draft'],description:'Latest Gmail draft: pass only app_id gmail and kind draft. Omit source_id, task_id and query.'},app_id:{type:'string',enum:['gmail','outlook','google_drive','onedrive','google_calendar']},source_id:string,task_id:{type:'integer',minimum:1},query:{type:'string',maxLength:1000},offset:{type:'integer',minimum:0},time_min:string,time_max:string}),
 floassist_status:object({}),
 floassist_reminder_list:object({}),
 floassist_reminder_cancel:object({id:string},['id']),
 floassist_reminder_create:object({request_key:string,text:string,due_at:{type:'string',description:'Future ISO datetime WITH timezone offset. Use the owner timezone from floassist_status.'},repeat_minutes:{type:'integer',minimum:60}},['request_key','text','due_at']),
 floassist_control:object({status:{type:'string',enum:['paused','stopped','active']}},['status']),
 floassist_tracking_list:object({after_id:{type:'integer'},limit:{type:'integer',minimum:1,maximum:100}}),
 floassist_tracking_observe:object({...identity,requested_action:{type:'string',description:'Specific outstanding action, not merely sent an email.'},why_now:{type:'string',description:'Why this module should interrupt the user now.'},thread_summary:{type:'string',description:'Brief history and latest state of the whole thread, including whether later replies resolved earlier requests.'},latest_message_id:{type:'string',description:'Exact newest message ID from the complete thread read; required for followups.'},awaiting_reply:{type:'boolean'},urgency:{type:'string',enum:['normal','high']},category:{type:'string',enum:['priority','deadlines','followups']},title:string,evidence:{type:'string',description:'Facts from a successful current source read supporting the obligation; not conversation memory.'},due_at:{type:['string','null'],description:'Actual obligation deadline with timezone offset. Omit if unverified. Never use email sent time or task SLA.'},source_url:string,scheduled_goal_id:string,run_key:string,existing_task_id:{type:'integer'}},['app_id','account_id','source_id','category','title','evidence','requested_action','why_now','thread_summary']),
 floassist_tracking_update:object({task_id:{type:'integer'},action:{type:'string',enum:['acknowledge','snooze','track','stop','clarify','close_orphan','set_priority']},priority:{type:'string',enum:['urgent','high','normal','low']},evidence:string,until:string,source_checked:{type:'boolean'},...identity,source_outcome:{type:'string',enum:['deleted','fulfilled']},source_evidence:string},['task_id','action','evidence']),
};

// A server-written session scope narrows the model's choices. Backend checks
// remain authoritative; ordinary WhatsApp sessions retain their full schema.
export function scopedFloAssistSchema(name,schema,scope){
 const module=scope?.floassist_module;
 if(!['priority','deadlines','followups','briefing','conflicts'].includes(module))return schema;
 if(name==='floassist_source_read'){
  const properties={...schema.properties};delete properties.kind;
  if(scope.floassist_sources?.length)properties.app_id={type:'string',enum:scope.floassist_sources};
  if(module==='conflicts'){
   delete properties.task_id;delete properties.query;delete properties.offset;
   return {...schema,properties,required:['app_id','time_min','time_max']};
  }
  if(scope.floassist_reconciliation_task_ids?.length)properties.task_id={type:'integer',enum:scope.floassist_reconciliation_task_ids,description:'Existing exact task source only. For new discovery use app_id and source_id.'};
  return {...schema,properties};
 }
 if(name==='floassist_tracking_update')return {...schema,required:[...new Set([...schema.required,'source_checked','source_evidence'])],properties:{...schema.properties,source_checked:{type:'boolean',enum:[true],description:'Required only after a direct current source read. Do not update if the source has not been checked.'},source_evidence:{type:'string',minLength:1,description:'Current provider evidence and conclusion. For close_orphan also supply exact stored app/account/source/obligation and source_outcome deleted or fulfilled.'},task_id:{type:'integer',minimum:1,...(scope.floassist_reconciliation_task_ids?.length?{enum:scope.floassist_reconciliation_task_ids}:{})},action:{type:'string',enum:['clarify','close_orphan'],description:'Scheduled source reconciliation only. User tracking preferences cannot be changed by a scan.'}}};
 if(name==='floassist_tracking_observe'&&['priority','deadlines','followups'].includes(module)){
  const required=[...schema.required];
  const properties={...schema.properties,category:{type:'string',enum:[module]}};
  if(module==='deadlines'){
   required.push('due_at','deadline_excerpt');
   properties.due_at={type:'string',description:'Verified obligation deadline as ISO datetime WITH timezone offset. Skip candidates without an explicit deadline; never use message timestamps or task SLA.'};
  }
  if(module==='followups')required.push('latest_message_id','awaiting_reply');
  return {...schema,required:[...new Set(required)],properties};
 }
 return schema;
}
