// Narrowly separate direct source analysis from managing automation schedules.
const turns=new Map();
export function isSourceReview(prompt){
 const text=String(prompt||'').split('\n\n[System — Dashboard chat]')[0].replace(/\[chat_attachments\][\s\S]*?\[\/chat_attachments\]/g,'');
 return /\b(?:emails?|gmail|outlook|mailbox|inbox|calendars?)\b/i.test(text)&&/\b(?:summari[sz]e|review|read|look at|focus|prioriti[sz]e|briefing|important|agenda)\b/i.test(text)&&!/\b(?:scheduled goals?|automation|configure|pause|resume|disable|enable|schedule a|run (?:the |my )?(?:scheduled|morning|daily))\b/i.test(text);
}
export function rememberSourceReview(session,prompt,now=Date.now()){
 if(!session)return;
 for(const[k,v]of turns)if(v.until<=now)turns.delete(k);
 if(turns.size>=5000)turns.delete(turns.keys().next().value);
 turns.set(session,{active:isSourceReview(prompt),until:now+900000});
}
export function sourceReviewBlock(session,toolName,params,now=Date.now()){
 const state=turns.get(session);if(!state?.active||state.until<=now)return null;
 const target=String(toolName==='tool_call'?params?.id:toolName).replace(/^openclaw:agent-os-content-tools[:.]/,'').replace(/^functions\./,'');
 if(!['scheduled_goal_list','scheduled_goal_run_now','agent_goal_list'].includes(target))return null;
 return 'This request asks for analysis of actual email/calendar content, not automation schedules. Schedule definitions cannot answer it. Inspect the floassist_source_read schema with tool_describe and read the requested sources; discover messages with connector_search_actions/connector_get_action_guide/connector_execute_action for a broader mailbox review. Follow returned next_call for content pages. If source reads fail, report the exact failure and partial coverage; do not substitute schedule descriptions or generic advice.';
}
