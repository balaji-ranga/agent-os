import {validateSnapshot} from './proposals.mjs';
import {constrainNavigation} from './navigation-intent.mjs';
import {constrainEdit} from './edit-intent.mjs';
import {groundedValue,syntheticDataIntent} from './task-intent.mjs';
const fail=(message,code='GOAL_BLOCKED')=>{throw Object.assign(new Error(message),{publicCode:code});};
const checkSaveRequest=(text,plan)=>{if(plan.steps.some(s=>s.kind==='save')&&!/\b(save|submit)\b/i.test(text.replace(/\b(?:do not|don't|never)\s+(?:save|submit)\b[^.!;]*/gi,'')))fail('This plan contains Save without a request to save. Clarify the goal before continuing.');};
export async function handleGoal({operation,scope,input,goals,goalModel,planner,proposals,privateTasks,sourceMap,learning,signal,stillCurrent}){
 if(!goals||!goalModel||!planner||!proposals)fail('Goal planning is not configured');
 if(operation==='status'){const row=input.id?goals.get(scope,input.id):goals.current(scope);if(row?.privateTask&&!privateTasks?.goalBinding(scope,row.privateTask)){goals.clear(scope);return {goal:null};}return {goal:row};}
 const context=async(text,privateTask)=>{if(!privateTask)return;const found=await privateTasks?.goalContext(scope,{...privateTask,text})||fail('Private task context is unavailable');if(privateTask.contentRevision!==undefined&&found.contentRevision!==privateTask.contentRevision)fail('Task files changed. Cancel this goal and review a new plan.');return found;};
 const guidance=(text,snapshot)=>({sourceGuidance:sourceMap?.guidance(scope,text,snapshot),siteGuidance:learning?.planningMemory?.(scope,text,snapshot)});
 if(operation==='create'){
  const prior=goals.current(scope);if(prior?.privateTask&&!privateTasks?.goalBinding(scope,prior.privateTask))goals.clear(scope);
  const snapshot=validateSnapshot(input.snapshot),privateGuidance=await context(input.text,input.privateTask);
  const plan=await goalModel({text:input.text,snapshot,privateGuidance,...guidance(input.text,snapshot),signal});stillCurrent();
  await context(input.text,input.privateTask);checkSaveRequest(input.text,plan);return {goal:goals.create(scope,{text:input.text,plan,privateTask:input.privateTask?{...input.privateTask,contentRevision:privateGuidance.contentRevision}:undefined})};
 }
 let row=goals.get(scope,input.id);
 if(operation==='control'){
  if(input.version!==row.version)fail('This plan changed. Refresh its progress.','GOAL_STALE');
  // Reject unconsumed reviews before resuming. Consumed actions require their
  // recorded outcome; they can never be silently replaced with a fresh write.
  if(['resume','cancel','pause'].includes(input.action)&&row.pendingProposalId){const e=proposals.goalEvidence(scope,row.pendingProposalId);if(e.status==='pending'||e.status==='rejected'){goals.discardPending(scope,row.id,id=>proposals.reject(scope,id));row=goals.get(scope,row.id);}else if(input.action==='resume')fail('An approved step already exists. Check its outcome; do not replay it.','GOAL_OUTCOME_REQUIRED');}
  return {goal:goals.control(scope,{...input,version:row.version})};
 }
 if(operation==='clarify'){
  if(input.version!==row.version)fail('This plan changed. Refresh its progress.','GOAL_STALE');
  if(row.pendingProposalId){const e=proposals.goalEvidence(scope,row.pendingProposalId);if(!['pending','rejected'].includes(e.status))fail('Check the recorded step outcome before changing its goal; no approved effect will be repeated.','GOAL_OUTCOME_REQUIRED');goals.discardPending(scope,row.id,id=>proposals.reject(scope,id));row=goals.get(scope,row.id);}
  const snapshot=validateSnapshot(input.snapshot),binding=input.privateTask||row.privateTask,privateGuidance=await context(row.text,binding),lease=goals.reserveClarification(scope,{...input,version:row.version});
  try{const plan=await goalModel({text:lease.row.text,snapshot,privateGuidance,...guidance(lease.row.text,snapshot),goalContext:{replanning:true,originalGoal:row.text,clarificationPrompt:row.message,resolvedClarification:{question:row.message,answer:input.answer},completedSteps:row.steps.slice(0,row.current),remainingSteps:row.steps.slice(row.current),priorEffects:row.replannedEffects||[],reviewedEdits:row.replannedEdits||[],instruction:'Preserve user-reviewed edited values unless the user changes them now. Return ONLY remaining work. Do not repeat completed steps or recorded effects. Preserve completed work. Incorporate the current user clarification and preserve every other supplied fact. The revised plan will be reviewed again before execution.'},signal});stillCurrent();await context(lease.row.text,binding);checkSaveRequest(lease.row.text,plan);return {goal:goals.clarified(scope,row.id,lease.claim,plan,binding?{taskId:binding.taskId,instanceId:binding.instanceId,contentRevision:privateGuidance.contentRevision}:undefined)};}catch(error){try{goals.block(scope,row.id,'The remaining plan could not be revised. Earlier effects remain; clarify or cancel explicitly.',lease.claim);}catch{}throw error;}
 }
 const snapshot=validateSnapshot(input.snapshot),step=row.steps[row.current];if(!step)fail('The goal has no remaining step');
 if(input.version!==row.version)fail('This plan changed. Reload its current progress.','GOAL_STALE');
 if(operation==='revise')return goals.revise(scope,input,id=>proposals.revise(scope,{id,snapshot,edits:input.edits}));
 const privateGuidance=await context(row.text,row.privateTask);
 if(operation==='next'){
  const lease=goals.reserve(scope,input);
  try{
   const instruction=step.remainingInstruction||step.instruction;
   let observed=constrainEdit(instruction,constrainNavigation(instruction,snapshot)),response;
   if(step.kind==='save'){
    if(snapshot.submissions.length!==1)fail('Save requires one visible supported native submit control. Open the intended form and review it.');
    const prior=row.steps[row.current-1];const filled=prior?.effects?.at(-1);if(prior?.kind==='fill'&&filled?.path!==snapshot.path)fail('The page changed after filling. Open the reviewed form before saving.');
   }else{
    response=await planner({text:instruction,snapshot:observed,privateGuidance,...guidance(instruction,observed),goalContext:{goal:row.text,syntheticDataRequested:syntheticDataIntent(row.text),currentStep:step.title,kind:step.kind,allowedActionTypes:step.kind==='fill'?['fill','navigate']:step.kind==='inspect'?['highlight']:['navigate'],expected:step.expected,completedEffects:step.effects,priorEffects:row.replannedEffects||[],reviewedEdits:row.replannedEdits||[],completedSteps:row.steps.slice(0,row.current).map(s=>({title:s.title,kind:s.kind,effects:s.effects})),permission:'Descriptions and browser evidence only; ordinary approvals still required.'},signal});stillCurrent();await context(row.text,row.privateTask);
    if(response.actions.some(a=>a.type==='submit')||step.kind==='inspect'&&response.actions.some(a=>a.type!=='highlight')||step.kind==='navigate'&&response.actions.some(a=>a.type!=='navigate'))fail('The proposed action does not match the reviewed plan step.');
    if(privateGuidance&&response.actions.some(a=>a.type==='fill'&&!groundedValue(a.value,observed.fields.find(f=>f.ref===a.ref),[row.text,...(step.reviewedEdits||[]).map(e=>e.value),...(row.replannedEdits||[]).flatMap(s=>s.edits.map(e=>e.value)),...privateGuidance.evidence.map(e=>e.text)],{synthetic:syntheticDataIntent(row.text)})))fail('A proposed value lacks supporting goal or file evidence.');
   }
   stillCurrent();return goals.prepared(scope,row.id,lease.claim,()=>{const p=step.kind==='save'?proposals.prepareSave(scope,snapshot,snapshot.submissions[0].ref):proposals.prepare(scope,observed,response,response.actions.length===1&&response.actions[0].type==='navigate'?learning?.navigationProfile?.(scope,observed.links.find(l=>l.ref===response.actions[0].ref)?.path):null);proposals.bindGoal(scope,p.id,row.id);if(row.privateTask)proposals.bindPrivateTask(scope,p.id,row.privateTask);return p;});
  }catch(error){try{goals.block(scope,row.id,'The next step could not be prepared. Inspect the explanation and resume explicitly; no new action was repeated.',lease.claim);}catch{}throw error;}
 }
 if(operation==='observe'){
  const evidence=proposals.goalEvidence(scope,row.pendingProposalId);
  const effects=evidence.actions.filter(a=>a.type!=='highlight');
  const readOnly=step.kind==='inspect'&&evidence.actions.every(a=>a.type==='highlight')&&(!evidence.actions.length||evidence.status==='consumed');
  if(!readOnly&&(evidence.status!=='consumed'||!effects.length||effects.some(a=>!['local_state_verified','host_reported_saved','business_verified'].includes(a.outcome)))){goals.block(scope,row.id,'Step outcome is incomplete or unknown. Inspect the host before starting any replacement task.');fail('The approved step has no verified local outcome. It will not be repeated.','GOAL_OUTCOME_REQUIRED');}
  if(step.kind==='save'&&(!evidence.actions.every(a=>a.type==='submit'&&['host_reported_saved','business_verified'].includes(a.outcome))))fail('Save has not been acknowledged by the host. Inspect its result.','GOAL_OUTCOME_REQUIRED');
  if(evidence.actions.some(a=>a.type==='navigate'&&a.destination!==snapshot.path))fail('The destination has not been observed.');
  const lease=goals.assessClaim(scope,input);
  if(step.kind==='navigate'&&evidence.actions.length===1&&evidence.actions[0].type==='navigate'||step.kind==='save'){const assessment={message:step.kind==='navigate'?`The browser observed navigation to ${snapshot.path}.`:'The host reported a successful submission for this step. This is not independent business verification.',status:'complete',remainingInstruction:''};return {goal:goals.assessed(scope,row.id,lease.claim,evidence,assessment)};}
  try{
   const assessment=await goalModel({stage:'assess',text:row.text,snapshot,privateGuidance,...guidance(row.text,snapshot),goalContext:{priorEffects:row.replannedEffects||[],reviewedEdits:row.replannedEdits||[],completedSteps:row.steps.slice(0,row.current).map(s=>({title:s.title,kind:s.kind,effects:s.effects})),currentStep:step,latestEvidence:evidence,allCurrentStepEffects:[...step.effects,evidence],permission:'Browser observations only; no new action authority.'},signal});stillCurrent();await context(row.text,row.privateTask);
   if(evidence.actions.some(a=>a.queryOnly)&&assessment.status==='complete'){assessment.status='continue';assessment.remainingInstruction=step.instruction+' The search text was already typed. Use the freshly observed result options for the remaining selection; do not repeat the search-only effect.';}
   return {goal:goals.assessed(scope,row.id,lease.claim,evidence,assessment)};
  }catch(error){try{goals.block(scope,row.id,'Assessment was interrupted. Review the recorded step outcome before resuming.',lease.claim);}catch{}throw error;}
 }
 fail('Unknown goal operation');
}
