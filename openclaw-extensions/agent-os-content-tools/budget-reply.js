// Rewrite only the generic no-visible-reply fallback for a verified budget
// refusal on this exact owner/session/run. Failed work remains failed.
export async function rewriteBudgetFailureReply(event,{lookup}={}){
 const text=event?.payload?.text;
 const fallback=typeof text==='string'&&text.match(/^((?:From:[^\n]+\r?\n\s*)?)No (?:reply|response) was generated for this message\./i);
 if(!fallback||!event.sessionKey||!event.runId)return;
 const agent=event.sessionKey.match(/^agent::?(t-[^:]+):/)?.[1];if(!agent)return;
 let reason;try{reason=await lookup({caller_agent_id:agent,session_key:event.sessionKey,run_id:event.runId});}catch{return;}
 if(!reason?.blocked)return;
 const explanations={
  native_monthly_token_budget:'Your assistant stopped because the remaining monthly token allowance is too small for this request. Review the allowance in Flolah → Efficiency → Agent View.',
  native_model_token_budget:'Your assistant stopped at the token limit for this request. Its remaining work is incomplete. Review FloAssist Preferences before continuing.',
  native_model_call_budget:'Your assistant stopped at the model-call limit for this request. Its remaining work is incomplete. Review FloAssist Preferences before continuing.',
  native_test_budget_exhausted:'This controlled test reached its model allowance and stopped. Its remaining work is incomplete.',
  budget_exceeded:'Your assistant stopped at its configured token or error budget. Review the budget and recent failures in Flolah → Efficiency → Agent View.',
  native_budget_unavailable:'Your assistant could not verify its budget, so it stopped before another model call. Please try again later.',
 };
 const replacement=explanations[reason.reason];if(!replacement)return;
 return {payload:{...event.payload,text:(fallback[1]||'')+replacement}};
}
