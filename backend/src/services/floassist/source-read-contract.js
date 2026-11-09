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
