/** Bounded, tenant/conversation-scoped review checkpoints; no source bodies. */
export function sourceReviewProgress({clock=Date.now,ttl=900000,maxEntries=512}={}){
 const entries=new Map();
 return (scope,result,request={})=>{
  if(!scope?.owner||!(scope.run||scope.session)||!result?.app_id)return result;
  for(const [k,v]of entries)if(v.until<=clock())entries.delete(k);
  const key=JSON.stringify([scope.owner,scope.run||scope.session,result.app_id]);
  let state=entries.get(key);
  if(result.discovery_only){
   if(!state||!request.cursor&&!request.next_request){
    if(entries.size>=maxEntries)entries.delete(entries.keys().next().value);
    state={items:new Map(),more:false,next:null,until:clock()+ttl,capacityExceeded:false};entries.set(key,state);
   }
   for(const c of result.source_candidates||[])if(!state.items.has(c.source_id)){
    if(state.items.size>=2000){state.capacityExceeded=true;continue;}
    state.items.set(c.source_id,{app_id:c.app_id,source_id:c.source_id});
   }
   state.more=!!result.more_candidates;state.next=result.next_request;
  }else if(state&&result.content_verified&&state.items.has(result.source_id)){
   state.items.set(result.source_id,result.coverage_complete?null:result.next_request||state.items.get(result.source_id));
  }
  if(!state)return result;
  const pending=[...state.items.values()].filter(Boolean);
  return {...result,review_progress:{discovered:state.items.size,reviewed:state.items.size-pending.length,unread:pending.length,capacity_exceeded:state.capacityExceeded,discovery_complete:!state.more&&!state.capacityExceeded,review_complete:!state.more&&!pending.length&&!state.capacityExceeded,
   next_reads:pending.slice(0,10),next_discovery:state.more?state.next:null,
   instruction:'For a whole-period summary, continue next_reads in bounded batches and then next_discovery until review_complete=true. Do not stop at ten items or sample silently. This checkpoint counts full source reads, not merely discovered IDs. If blocked, report these exact unread counts and partial coverage.'}};
 };
}
export const trackSourceReviewProgress=sourceReviewProgress();
