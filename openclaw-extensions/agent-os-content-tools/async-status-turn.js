// A status question is observational. It must never become a new action because
// the model misreads old conversation context or invents an operation identifier.
const turns=new Map();
export function isTrackingStatusQuestion(prompt){
 // Dashboard routing metadata describes status tools even for non-status asks.
 // Classify the user text, never those capability/instruction envelopes.
 const text=String(prompt||'')
  .split('\n\n[System — Dashboard chat]')[0]
  .replace(/^\[(?:ceo_user_id|owner_user_id|profile_id):[^\n]*\]\s*$/gm,'')
  .replace(/^Important: You are assisting CEO user id [^\n]*\n/gm,'')
  .replace(/\[chat_attachments\][\s\S]*?\[\/chat_attachments\]/g,'')
  .trim();
 if(/^\s*(?:(?:what(?:'s| is)?(?: the)?|check|any)\s+)?(?:status|progress|update|result)[?!. ]*$/i.test(text))return true;
 if(/^\s*(?:has|is|did)\s+(?:it|that)\s+(?:completed?|finished|done|work(?:ed)?)[?!. ]*$/i.test(text))return true;
 return (/\b(?:what(?:'s| is| was)?|check|show|tell me|any|give me|report|has|have|did|is)\b[\s\S]{0,80}\b(?:status|progress|update|result|completed|finished)\b|\bwhat happened\b|\b(?:status|progress|result)\s+(?:of|for|on)\b/i.test(text))&&
  (/\btrack-[a-f0-9-]+\b/i.test(text)||/\b(?:request|operation|command|task|tool|previous|last|earlier|pending)\b/i.test(text));
}
export function rememberStatusTurn(session,prompt,now=Date.now()){
 if(!session||!String(prompt||'').trim())return;
 for(const [key,value]of turns)if(value.until<=now)turns.delete(key);
 if(turns.size>=5000)turns.delete(turns.keys().next().value);
 turns.set(session,{readOnly:isTrackingStatusQuestion(prompt),until:now+15*60*1000});
}
export function isStatusTurn(session,now=Date.now()){const row=turns.get(session);return !!(row?.readOnly&&row.until>now);}
export function statusTurnBlock(session,toolName,params,now=Date.now()){
 if(!isStatusTurn(session,now))return null;
 const raw=toolName==='tool_call'?params?.id:toolName;
 const target=String(raw||'').replace(/^openclaw:agent-os-content-tools:/,'');
 if(['tool_execution_status','tool_search','tool_describe'].includes(target))return null;
 return 'This turn requests status only. No new action is permitted. Call tool_call with id="openclaw:agent-os-content-tools:tool_execution_status" and args={} to inspect this conversation’s recent requests, or args={trackingId:"the recorded track-ID"}. If there is no matching request, ask for clarification; never invoke the original tool to obtain status.';
}
