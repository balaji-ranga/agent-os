// Durable browser/host evidence only. This view never asks a model or executes.
export function goalOutcomeText(goal,pending){
 const lines=[];
 for(const [index,step] of (goal?.steps||[]).entries()){
  const actions=(step.effects||[]).flatMap(effect=>effect.actions||[]);
  if(step.status!=='completed'&&!actions.length)continue;
  lines.push(`Step ${index+1}: ${step.title} — ${step.status}.`);
  if(step.manualCompletion){lines.push('• Completed manually — acknowledged by the visitor, not independently verified.');for(const action of step.manualCompletion.pendingOutcome?.actions||[])lines.push(`• Earlier ${action.label||action.type}: ${action.outcome}. This was not upgraded to a verified result.`);}
  for(const action of actions){
   const outcome=action.outcome==='local_state_verified'?'verified in the browser':action.outcome==='host_reported_saved'?'host reported Save success':action.outcome==='business_verified'?'verified by host receipt':action.outcome==='read_only_guidance'?'guidance displayed':action.outcome||'no verified outcome';
   lines.push(`• ${action.label||action.type}: ${outcome}${action.destination?' ('+action.destination+')':''}.`);
  }
  for(const pending of (step.effects||[]).flatMap(e=>e.pendingFields||[]))lines.push(`• ${pending.label}: not filled; ${pending.reason==='not_provided'?'a real value or existing lookup choice is needed':pending.reason}.`);
  if(!actions.length&&!step.manualCompletion)lines.push('• '+(step.effects?.some(e=>e.peer)?'Recipient result recorded.':'Read-only observation recorded; no field change or Save recorded.'));
 }
 if(pending)lines.push(`Current step: ${pending.status==='pending'||pending.status==='rejected'?'not executed. Continue / retry this step to prepare a fresh review.':pending.actions?.every(a=>['local_state_verified','host_reported_saved','business_verified','read_only_guidance'].includes(a.outcome))?'approved effect recorded. Continue checks this result before advancing.':'outcome incomplete or unknown. Inspect the website; it will not be replayed automatically.'}`);
 return lines.join('\n')||'No completed step outcome is recorded yet. Nothing has been confirmed as executed.';
}
