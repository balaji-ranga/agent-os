// The gateway contract is byte bounded. Trim advisory context, never task values,
// live refs or a selected published workflow's steps.
import {MODEL_CONTEXT_BYTES} from './model-context-budget.mjs';
export function encodePlannerRequest(body,{maxBytes=MODEL_CONTEXT_BYTES}={}){
 const size=()=>Buffer.byteLength(JSON.stringify(body));
 // Preserve the most recent real conversation turns as well as their bounded
 // structured counterpart used by the checker. Trim older turns first.
 while(size()>maxBytes&&body.messages.length>6)body.messages.splice(1,1);
 const last=body.messages.at(-1),context=JSON.parse(last.content),sync=()=>{last.content=JSON.stringify(context);};
 // Recent dialogue is also carried in the structured review record. Under
 // pressure keep that canonical copy instead of paying twice for identical
 // role/content turns. Never remove the current task or explicit reply.
 if(Array.isArray(context.conversationContext)){
  for(let i=body.messages.length-2;i>0;i--){const turn=body.messages[i];if(context.conversationContext.some(item=>item.role===turn.role&&item.content===turn.content))body.messages.splice(i,1);}
 }
 // Canonical live facts already exist in observed. Under pressure, remove only
 // byte-equivalent metadata copies, before discarding owner guidance/history.
 for(const key of ['targets','controls','fields','links']){
  const duplicate=context.responseContract?.[key],canonical=context.observed?.[key];
  if(Array.isArray(duplicate)&&duplicate.length&&Array.isArray(canonical)&&duplicate.every(item=>{const source=canonical.find(c=>c.ref===item.ref);return source&&Object.entries(item).every(([k,v])=>JSON.stringify(v)===JSON.stringify(source[k]));})){
   delete context.responseContract[key];context.responseContract.liveReferences='Use observed.fields, observed.links, observed.controls and observed.targets as the canonical live refs and metadata. Duplicate contract copies were omitted for the request budget; no observed ref was removed.';sync();
  }
 }
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
 if(size()>maxBytes)throw Object.assign(new Error('The assistant could not produce a valid current-screen proposal. Nothing was changed.'),{publicCode:'COPILOT_CONTEXT_LIMIT',contextBudget:{limitBytes:maxBytes,requiredBytes:size(),sections:Object.fromEntries(Object.entries(context).map(([key,value])=>[key,Buffer.byteLength(JSON.stringify(value))]))}});
 return JSON.stringify(body);
}
