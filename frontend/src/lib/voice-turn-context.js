// Provider responses can continue one user utterance through several tool calls.
// Transport item IDs, not message wording, define its execution/duplicate scope.
export function createVoiceTurnContext({uuid=()=>globalThis.crypto.randomUUID(),maxResponses=128}={}){
 let current=null;const responses=new Map();
 const remember=(id,turn)=>{if(id){if(responses.size>=maxResponses&&!responses.has(id))responses.delete(responses.keys().next().value);responses.set(id,turn);}};
 return {
  observe(event){
   if(event?.type==='input_audio_buffer.committed')current=event.item_id||uuid();
   if(event?.type==='conversation.item.created'&&event.item?.role==='user')current=event.item.id||uuid();
   if(event?.type==='response.created'){current=current||uuid();remember(event.response?.id,current);}
  },
  forCall(event){const id=event?.response_id;if(id&&responses.has(id))return responses.get(id);current=current||uuid();remember(id,current);return current;},
  isCurrent(turn){return turn===current;}
 };
}
