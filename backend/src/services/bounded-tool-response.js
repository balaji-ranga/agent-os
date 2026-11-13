/** Bound the HTTP body as it arrives; a result-page limit alone is too late. */
export async function boundedResponseJson(response,{maxBytes=8*1024*1024}={}){
 const tooLarge=()=>Object.assign(Error('Tool response exceeds the bounded transport size. The action may already have completed; do not repeat a mutation. Narrow future read requests.'),{status:413,code:'TOOL_RESPONSE_TOO_LARGE'});
 const length=Number(response.headers?.get('content-length'));
 if(Number.isFinite(length)&&length>maxBytes){await response.body?.cancel();throw tooLarge();}
 if(!response.body)return {};
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes){await reader.cancel();throw tooLarge();}chunks.push(Buffer.from(value));}
 }finally{reader.releaseLock();}
 try{return JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));}catch{return {};}
}
