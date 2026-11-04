const placeholder='[Content expired under company retention policy]';
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value[k]!==undefined).map(k=>[k,value[k]]));
/** Keep the native event graph and tool-call pairing, never the expired payload. */
export function redactRetentionEvent(event){
 if(event.flolahRetentionExpired)return null;
 const base={...pick(event,['type','id','parentId','timestamp']),flolahRetentionExpired:true};
 if(event.type==='message'){
  if(!['user','assistant','toolResult','system'].includes(event.message?.role))throw Error('Unsupported expired transcript role');
  const message=pick(event.message,['role','timestamp','toolCallId','toolName','idempotencyKey','api','provider','model','stopReason']);
  message.content=[{type:'text',text:placeholder}];
  if(event.message.role==='assistant')for(const part of Array.isArray(event.message.content)?event.message.content:[]){
   if(part.type==='toolCall')message.content.push({...pick(part,['type','id','name']),arguments:{}});
  }
  return {...base,message};
 }
 if(event.type==='custom')return {...base,...pick(event,['customType']),data:{retentionExpired:true}};
 if(event.type==='compaction')return {...base,...pick(event,['firstKeptEntryId']),summary:placeholder,tokensBefore:0};
 // Structural headers/model selections carry the graph/runtime contract.
 if(['session','model_change','thinking_level_change'].includes(event.type))return null;
 throw Error('Unsupported expired transcript event type');
}
