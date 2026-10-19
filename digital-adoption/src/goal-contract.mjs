const kinds=['navigate','fill','save','inspect'];
const text=(value,max)=>typeof value==='string'&&value.trim()&&value.length<=max;
export function parseGoalResponse(content,stage='plan'){
 let value;try{value=JSON.parse(content);}catch{throw new Error('invalid_goal_json');}
 if(!value||Array.isArray(value)||!text(value.message,2000))throw new Error('invalid_goal_response');
 if(stage==='assess'){
  if(Object.keys(value).some(k=>!['message','status','remainingInstruction'].includes(k))||!['complete','continue','clarify'].includes(value.status)||typeof value.remainingInstruction!=='string'||value.remainingInstruction.length>1600||value.status==='continue'&&!value.remainingInstruction.trim())throw new Error('invalid_goal_assessment');
 }else{
  if(Object.keys(value).some(k=>!['message','steps'].includes(k))||!Array.isArray(value.steps)||value.steps.length>12||value.steps.some(s=>!s||Object.keys(s).some(k=>!['title','kind','instruction','expected'].includes(k))||!kinds.includes(s.kind)||!text(s.title,120)||!text(s.instruction,1600)||!text(s.expected,240))||JSON.stringify(value.steps).length>12000)throw new Error('invalid_goal_plan');
 }
 return value;
}
export const goalContract={plan:{message:'Explain the bounded plan or ask one clarification',steps:[{title:'Short visible step',kind:'navigate | fill | save | inspect',instruction:'Self-contained next task with supplied business values; no executable refs',expected:'Observable success condition'}]},assess:{message:'Explain browser-reported evidence honestly',status:'complete | continue | clarify',remainingInstruction:'For continue only, a self-contained remaining task preserving supplied facts; otherwise empty string'}};
