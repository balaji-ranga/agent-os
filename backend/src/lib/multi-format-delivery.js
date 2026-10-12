/** Attach only clean, owner-private receipts recorded for this turn; never agent-invented URLs. */
export function appendMultiFormatAttachments(reply,toolCalls,ownerUserId){
 let text=String(reply||'');const seen=new Set();
 const prefix='/api/media/openclaw/downloads/'+encodeURIComponent(String(ownerUserId||''))+'/';
 if(!ownerUserId)return text;
 for(const call of toolCalls||[]){
  if(call.tool_name!=='multi-format-content-tool'||!['ok','success'].includes(call.status)||call.response?.ok!==true)continue;
  for(const file of (call.response?.files||[]).slice(0,20)){
   const url=file.relative_url,line=file.paste_exactly;
   if(file.security_scan?.status!=='clean'||file.security_scan?.persisted!==true||typeof url!=='string'||!url.startsWith(prefix)||!/^[A-Za-z0-9._-]+$/.test(url.slice(prefix.length)))continue;
   if(typeof line!=='string'||!/^MEDIA:(?:\/|[A-Za-z]:[\\/])[^\s<>"']+$/.test(line)||!line.replaceAll('\\','/').endsWith('/'+url.slice(prefix.length)))continue;
   if(seen.has(url))continue;seen.add(url);
   if(!text.includes(line)&&!text.includes(url))text+='\n\n'+line;
  }
 }
 return text;
}
