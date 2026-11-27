// One user utterance can span several provider responses and parallel tool calls.
export function createVoiceTurnContext({uuid=()=>globalThis.crypto.randomUUID(),maxResponses=128}={}){
 let current=null;const responses=new Map();
 const id=e=>e?.response_id||e?.response?.id||e?.call_id;
 const get=e=>{const key=id(e);if(!key)return null;if(!responses.has(key)){current=current||uuid();if(responses.size>=maxResponses)responses.delete(responses.keys().next().value);responses.set(key,{turn:current,calls:new Map(),done:false,resumed:false});}return responses.get(key);};
 const resume=s=>{if(!s||s.resumed||!s.done||!s.calls.size||s.turn!==current||[...s.calls.values()].some(v=>v==='pending'))return false;s.resumed=true;return true;};
 return {
  observe(e){
   if(e?.type==='input_audio_buffer.committed')current=e.item_id||uuid();
   if(e?.type==='conversation.item.created'&&e.item?.role==='user')current=e.item.id||uuid();
   if(e?.type==='response.created')get(e);
   if(e?.type==='response.done'){const s=get(e);if(s)s.done=true;return resume(s);}
   return false;
  },
  forCall(e){return get(e)?.turn||(current=current||uuid());},
  beginCall(e){const s=get(e);if(!s||!e.call_id||s.turn!==current||s.calls.has(e.call_id))return false;s.calls.set(e.call_id,'pending');return true;},
  finishCall(e){const s=responses.get(id(e));if(!s||s.calls.get(e.call_id)!=='pending')return false;s.calls.set(e.call_id,'done');return resume(s);},
  isCurrent(turn){return turn===current;}
 };
}
