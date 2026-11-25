// Added after owner-scoped source references are translated; no execution or grants.
const call=args=>({tool:'tool_call',arguments:{id:'floassist_source_read',args}});
export function sourceReadContract(result,request={}){
 if(!result||typeof result!=='object')return result;
 const out={...result};
 if(result.next_request)out.next_call=call({...result.next_request});
 if(Array.isArray(result.source_candidates))out.source_candidates=result.source_candidates.map(c=>({...c,read_call:c.app_id&&c.source_id?call({app_id:c.app_id,source_id:c.source_id,...(request.time_min&&request.time_max?{time_min:request.time_min,time_max:request.time_max}:{})}):undefined}));
 out.review_guidance='This result is source evidence, not a connection-health test. Follow next_call for remaining pages. discovery_only means select a returned source and read it; it is not a failure. coverage_complete applies only to this source snapshot, not every message or account. Do not repeat the starting call or substitute automation schedules for source content. Report any unreviewed coverage explicitly.';
 return out;
}

export function assertMailboxSourceId(input){
 if(input.kind==='draft'&&input.app_id==='gmail'&&['latest','most_recent','@latest'].includes(input.source_id))return;
 if(input.cursor||input.next_request||input.task_id||!['gmail','outlook'].includes(input.app_id)||input.source_id==null)return;
 if(typeof input.source_id==='string'&&input.source_id.trim()&&!/[@\s]/.test(input.source_id))return;
 const request={app_id:input.app_id};
 for(const key of ['query','time_min','time_max','relative_day'])if(input[key]!=null)request[key]=input[key];
 throw Object.assign(Error('No email was read: source_id must be a returned message/thread ID, not a mailbox address or label. Discover the authenticated owner mailbox first.'),{status:422,code:'FLOASSIST_SOURCE_ID_INVALID',next_action:{tool:'floassist_source_read',input:request},next_call:call(request)});
}
export function sourceDuplicateRecovery(observation){
 const previous=observation?.previous_observation;
 const result=previous?.result;
 if(!result||!['permanent_error','invalid_input','error'].includes(previous.status)&&!['invalid_input','FLOASSIST_SOURCE_ID_INVALID'].includes(previous.reason_code))return {};
 return {error:'No new email read occurred. The original source read failed: '+String(result.error||result.message||previous.reason_code||'invalid source request'),...(result.code?{code:result.code}:{}),...(result.next_action?{next_action:result.next_action}:{}),...(result.next_call?{next_call:result.next_call}:{})};
}
