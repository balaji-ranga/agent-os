// The gateway contract is byte bounded. Trim advisory context, never task values,
// live refs or a selected published workflow's steps.
export function encodePlannerRequest(body,{maxBytes=30000}={}){
 const size=()=>Buffer.byteLength(JSON.stringify(body));
 while(size()>maxBytes&&body.messages.length>2)body.messages.splice(1,1);
 const last=body.messages.at(-1),context=JSON.parse(last.content),sync=()=>{last.content=JSON.stringify(context);};
 while(size()>maxBytes&&context.conversationContext?.length){context.conversationContext.shift();sync();}
 for(const [container,key] of [[context.sourceGuidance,'matches'],[context.siteGuidance,'observations'],[context.siteGuidance,'ownerDrafts']]){
  while(size()>maxBytes&&container?.[key]?.length){container[key].pop();container.omittedForRequestBudget=true;sync();}
 }
 if(size()>maxBytes)throw new Error('The assistant could not produce a valid current-screen proposal. Nothing was changed.');
 return JSON.stringify(body);
}
