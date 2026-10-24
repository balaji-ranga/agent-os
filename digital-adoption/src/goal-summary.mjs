// Factual, private progress narration. It never produces executable actions.
export function goalRecordedSummary(row){
 const short=(text,max=160)=>String(text||'').length>max?String(text).slice(0,max)+'…':String(text||'');
 const lines=[`Recorded outcomes on ${row.origin||'this website'}:`];
 for(const step of row.steps.filter(s=>s.status==='completed')){
  if(step.manualCompletion)lines.push(`• ${step.title}: the visitor acknowledged completing this step manually. This is not independently verified.`);
  const actions=step.effects.flatMap(e=>e.actions||[]),fills=actions.filter(a=>a.type==='fill'&&a.outcome==='local_state_verified'),saved=actions.some(a=>a.type==='submit'&&['host_reported_saved','business_verified'].includes(a.outcome)),peer=step.effects.findLast(e=>e.peer);
  for(const pending of step.effects.flatMap(e=>e.pendingFields||[]))lines.push(`• ${step.title}: ${short(pending.label)} remains unfilled; ${pending.reason==='not_provided'?'a real value or existing lookup choice is needed':pending.reason}.`);
  if(fills.length)lines.push(`• ${step.title}: ${fills.length} field change(s) verified in the browser. ${fills.slice(0,3).map(a=>`${short(a.label,100)}: ${short(a.value,120)}`).join('; ')}${fills.length>3?' (additional reviewed fields omitted from this summary)':''}`);
  else if(saved)lines.push(`• ${step.title}: the host reported Save success. This is not independent business verification.`);
  else if(peer)lines.push(`• ${step.title}: completed result received from ${peer.to||'the recipient'}. ${short(peer.message,400)}`);
 }
 if(row.interruptions?.length){lines.push('Earlier interruptions (not erased by recovery):');for(const item of row.interruptions)lines.push(`• ${item.code}: ${item.message}`);}
 if(row.clarifications)lines.push(`• This goal required ${row.clarifications} clarification/replanning update(s). Completed effects were preserved.`);
 return lines.join('\n');
}
