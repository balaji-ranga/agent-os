const string={type:'string'};
const identity={app_id:{type:'string',description:'Selected FloAssist app ID, for example gmail or google_calendar.'},account_id:{type:'string',description:'Exact account_id from tracking_list or the connected provider account.'},source_id:{type:'string',description:'Exact provider message/thread/event ID; never invent IDs.'},obligation_key:{type:'string',description:'Reuse the existing obligation_key, otherwise action.'}};
identity.corrects_source_id={type:'string',description:'Only when correcting a previously rejected unverified source ID: the exact rejected ID. source_id must identify the verified actual source, with its full current thread read first. Never infer identity solely from similar wording or a candidate hint.'};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export const floassistSchemas={
 floassist_status:object({}),
 floassist_reminder_list:object({}),
 floassist_reminder_cancel:object({id:string},['id']),
 floassist_reminder_create:object({request_key:string,text:string,due_at:{type:'string',description:'Future ISO datetime WITH timezone offset. Use the owner timezone from floassist_status.'},repeat_minutes:{type:'integer',minimum:60}},['request_key','text','due_at']),
 floassist_control:object({status:{type:'string',enum:['paused','stopped','active']}},['status']),
 floassist_tracking_list:object({after_id:{type:'integer'},limit:{type:'integer',minimum:1,maximum:100}}),
 floassist_tracking_observe:object({...identity,requested_action:{type:'string',description:'Specific outstanding action, not merely sent an email.'},why_now:{type:'string',description:'Why this module should interrupt the user now.'},thread_summary:{type:'string',description:'Brief history and latest state of the whole thread, including whether later replies resolved earlier requests.'},latest_message_id:{type:'string',description:'Exact newest message ID from the complete thread read; required for followups.'},awaiting_reply:{type:'boolean'},urgency:{type:'string',enum:['normal','high']},category:{type:'string',enum:['priority','deadlines','followups']},title:string,evidence:{type:'string',description:'Facts from a successful current source read supporting the obligation; not conversation memory.'},due_at:{type:['string','null'],description:'Actual obligation deadline with timezone offset. Omit if unverified. Never use email sent time or task SLA.'},source_url:string,scheduled_goal_id:string,run_key:string,existing_task_id:{type:'integer'}},['app_id','account_id','source_id','category','title','evidence','requested_action','why_now','thread_summary']),
 floassist_tracking_update:object({task_id:{type:'integer'},action:{type:'string',enum:['acknowledge','snooze','track','stop','clarify','close_orphan']},evidence:string,until:string,source_checked:{type:'boolean'},...identity,source_outcome:{type:'string',enum:['deleted','fulfilled']},source_evidence:string},['task_id','action','evidence']),
};

// A server-written session scope narrows the model's choices. Backend checks
// remain authoritative; ordinary WhatsApp sessions retain their full schema.
export function scopedFloAssistSchema(name,schema,scope){
 const module=scope?.floassist_module;
 if(!['priority','deadlines','followups','briefing','conflicts'].includes(module))return schema;
 if(name==='floassist_tracking_update')return {...schema,properties:{...schema.properties,task_id:{type:'integer',minimum:1,...(scope.floassist_reconciliation_task_ids?.length?{enum:scope.floassist_reconciliation_task_ids}:{})},action:{type:'string',enum:['clarify','close_orphan'],description:'Scheduled source reconciliation only. User tracking preferences cannot be changed by a scan.'}}};
 if(name==='floassist_tracking_observe'&&['priority','deadlines','followups'].includes(module)){
  const required=[...schema.required];
  const properties={...schema.properties,category:{type:'string',enum:[module]}};
  if(module==='deadlines'){
   required.push('due_at');
   properties.due_at={type:'string',description:'Verified obligation deadline as ISO datetime WITH timezone offset. Skip candidates without an explicit deadline; never use message timestamps or task SLA.'};
  }
  if(module==='followups')required.push('latest_message_id','awaiting_reply');
  return {...schema,required:[...new Set(required)],properties};
 }
 return schema;
}
