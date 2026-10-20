const kinds=['navigate','fill','save','inspect','peer'];
// Application facts supplied to both models; these do not authorize any action.
export const goalExecutionContract={reviewPlanBeforeStart:true,reviewEveryFieldChange:true,reviewNavigation:true,confirmEverySaveSeparately:true,recipientReviewsDelegatedGoal:true,goalCannotUploadFiles:true,peerStepWaitsForActualOutcome:true,completedEffectsAreNotReplayed:true,failuresStopWithoutAutomaticReplay:true};
export const goalOperationSemantics={
 navigate:'Open an observed destination after normal review.',
 fill:'Prepare compatible form field changes together; pause for review before applying.',
 save:'Propose the requested Save; the application always pauses for separate confirmation, even if the instruction does not repeat that guarantee.',
 inspect:'Read-only website inspection, explanation, or summary of recorded local effects and returned peer outcomes. Summary is represented by inspect; there is no summary kind. Never use this kind just to ask for approval or wait.',
 peer:'mode inspect returns recipient form structure; mode goal delegates its complete task and waits for its actual recorded outcome. Do not add a separate waiting step.'
};
export function goalResponseSchema(stage='plan',peers=[]){
 const string=maxLength=>({type:'string',maxLength});
 if(stage==='assess')return {type:'object',properties:{message:string(2000),status:{type:'string',enum:['complete','continue','clarify']},remainingInstruction:string(1600)},required:['message','status','remainingInstruction'],additionalProperties:false};
 const properties={title:string(120),kind:{type:'string',enum:['navigate','fill','save','inspect']},instruction:string(1600),expected:string(240)};
 const local={type:'object',properties,required:Object.keys(properties),additionalProperties:false};
 const ids=peers.map(p=>p.instanceId).filter(id=>typeof id==='string'&&id.length<=100),variants=[local];
 if(ids.length){const remote={...properties,kind:{type:'string',enum:['peer']},recipient:{type:'string',enum:[...new Set(ids)]},mode:{type:'string',enum:['inspect','goal']}};variants.push({type:'object',properties:remote,required:Object.keys(remote),additionalProperties:false});}
 return {type:'object',properties:{message:string(2000),steps:{type:'array',maxItems:12,items:variants.length===1?local:{anyOf:variants}}},required:['message','steps'],additionalProperties:false};
}
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
export function parseGoalResponse(content,stage='plan'){
 let value;try{value=JSON.parse(content);}catch{throw new Error('invalid_goal_json');}
 if(!value||Array.isArray(value)||!text(value.message,2000))throw new Error('invalid_goal_response');
 if(stage==='assess'){
  if(Object.keys(value).some(k=>!['message','status','remainingInstruction'].includes(k))||!['complete','continue','clarify'].includes(value.status)||typeof value.remainingInstruction!=='string'||value.remainingInstruction.length>1600||value.status==='continue'&&!value.remainingInstruction.trim())throw new Error('invalid_goal_assessment');
 }else{
  if(Object.keys(value).some(k=>!['message','steps'].includes(k))||!Array.isArray(value.steps)||value.steps.length>12||value.steps.some(s=>!s||Object.keys(s).some(k=>!['title','kind','instruction','expected','recipient','mode'].includes(k))||!kinds.includes(s.kind)||(s.kind==='peer'?(!text(s.recipient,100)||!['inspect','goal'].includes(s.mode)):(s.recipient!==undefined||s.mode!==undefined))||!text(s.title,120)||!text(s.instruction,1600)||!text(s.expected,240))||JSON.stringify(value.steps).length>12000){const issues=[];if(Array.isArray(value.steps))value.steps.slice(0,12).forEach((s,n)=>{if(!s||typeof s!=='object'){issues.push(`step ${n}: object required`);return;}for(const [key,max]of [['title',120],['instruction',1600],['expected',240]])if(!text(s[key],max))issues.push(`step ${n}: ${key} must be a nonempty string of at most ${max} characters`);if(!kinds.includes(s.kind))issues.push(`step ${n}: choose one allowed kind`);if(s.kind==='peer'){if(!text(s.recipient,100))issues.push(`step ${n}: peer recipient is required`);if(!['inspect','goal'].includes(s.mode))issues.push(`step ${n}: peer mode must be inspect or goal`);}else if(s.recipient!==undefined||s.mode!==undefined)issues.push(`step ${n}: omit recipient and mode on local steps`);if(Object.keys(s).some(k=>!['title','kind','instruction','expected','recipient','mode'].includes(k)))issues.push(`step ${n}: unexpected properties`);});throw Object.assign(new Error('invalid_goal_plan'),{contractIssues:issues.slice(0,8)});}
 }
 if(stage==='plan'){
  // A contiguous assignment to one recipient is one reviewed private task.
  // This is structural normalization, not intent inference: retain the order,
  // every instruction and its expected outcome, and never merge across a
  // different recipient, an inspection or a local operation. Oversized work
  // remains unchanged for model review; no transaction facts are truncated.
  const combined=[];
  for(const step of value.steps){
   const prior=combined.at(-1);
   if(prior?.kind==='peer'&&prior.mode==='goal'&&step.kind==='peer'&&step.mode==='goal'&&prior.recipient===step.recipient){
    const instruction=prior.instruction+'\nExpected: '+prior.expected+'\nThen: '+step.instruction+'\nExpected: '+step.expected;
    if(instruction.length<=1600){combined[combined.length-1]={...prior,instruction,expected:'All delegated instructions return their recorded recipient outcomes.'};continue;}
   }
   combined.push(step);
  }
  if(JSON.stringify(combined).length<=12000)value.steps=combined;
 }
 return value;
}
export const goalContract={plan:{message:'Explain the bounded plan or ask one clarification',steps:[{title:'Short visible step',kind:'fill',instruction:'Self-contained next task with supplied business values; no executable refs',expected:'Observable success condition'}]},assess:{message:'Explain browser-reported evidence honestly',status:'complete | continue | clarify',remainingInstruction:'For continue only, a self-contained remaining task preserving supplied facts; otherwise empty string'}};

export const peerStepContract={title:'Short paired task',kind:'peer',recipient:'Exact available peerGuidance instanceId',mode:'goal',instruction:'Self-contained recipient task, retaining normal reviews',expected:'Returned inspection or recorded recipient goal outcome'};
export const peerInspectStepContract={title:'Inspect the paired form',kind:'peer',recipient:'Exact available peerGuidance instanceId',mode:'inspect',instruction:'Return current supported form structure only, no values or writes',expected:'The other browser returns its supported fields and navigation'};
