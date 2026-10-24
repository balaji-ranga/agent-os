// The gateway contract is byte bounded. Trim advisory context, never task values,
// live refs or a selected published workflow's steps.
export function encodePlannerRequest(body,{maxBytes=30000}={}){
 const size=()=>Buffer.byteLength(JSON.stringify(body));
 // Preserve the most recent real conversation turns as well as their bounded
 // structured counterpart used by the checker. Trim older turns first.
 while(size()>maxBytes&&body.messages.length>6)body.messages.splice(1,1);
 const last=body.messages.at(-1),context=JSON.parse(last.content),sync=()=>{last.content=JSON.stringify(context);};
 // Recent turns and an explicit reply carry the referent of a follow-up. Do
 // not discard them before trimming duplicated, advisory page excerpts.
 while(size()>maxBytes&&context.conversationContext?.length>4){context.conversationContext.shift();sync();}
 for(const [container,key] of [[context.sourceGuidance,'matches'],[context.siteGuidance,'observations'],[context.siteGuidance,'ownerDrafts']]){
  while(size()>maxBytes&&container?.[key]?.length){container[key].pop();container.omittedForRequestBudget=true;sync();}
 }
 // Read-only page evidence is advisory. Trim explicitly, preserving executable
 // refs and the user's values; never present the remaining outline as complete.
 for(const evidence of context.pageEvidence||[])while(size()>maxBytes&&evidence.text.length>512){evidence.text=evidence.text.slice(0,-256);evidence.truncated=true;sync();}
 while(size()>maxBytes&&context.observed?.pageContext?.text){context.observed.pageContext.text=context.observed.pageContext.text.slice(0,-256);context.observed.pageContext.truncated=true;sync();}
 while(size()>maxBytes&&context.observed?.pageContext?.headings?.length){context.observed.pageContext.headings.pop();context.observed.pageContext.truncated=true;sync();}
 for(const collection of context.observed?.pageContext?.collections||[])while(size()>maxBytes&&collection.labels.length){collection.labels.pop();collection.labelsTruncated=true;sync();}
 while(size()>maxBytes&&context.observed?.pageContext?.structure?.length){context.observed.pageContext.structure.pop();context.observed.pageContext.structureTruncated=true;sync();}
 if(size()>maxBytes)throw new Error('The assistant could not produce a valid current-screen proposal. Nothing was changed.');
 return JSON.stringify(body);
}
