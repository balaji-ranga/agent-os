export async function assignedSkillContextHint({prompt,sessionKey,baseUrl,brokerSecret,fetchImpl=fetch}){
 const task=String(prompt||'');
 if(!task||!sessionKey||task.includes('[FLOLAH SKILL CONTRACT]'))return '';
 try{
  const response=await fetchImpl(String(baseUrl||'').replace(/\/$/,'')+'/api/tools/native-skill-context',{method:'POST',headers:{'Content-Type':'application/json','x-agent-os-tool-broker':brokerSecret()},body:JSON.stringify({session_key:sessionKey,prompt:task.slice(0,24000)}),signal:AbortSignal.timeout(5000)});
  if(response.ok){const value=(await response.json()).instruction;if(typeof value==='string'&&value.length<=96000)return value;}
 }catch{}
 return 'Current assigned-skill instructions could not be refreshed. Do not claim a skill was loaded or infer additional permissions from cached instructions.';
}
export function stripNativeSkillMarker(event,rewrite){
 const payload=rewrite?.payload||event?.payload;
 if(typeof payload?.text!=='string'||!payload.text.includes('[FLOLAH_SKILLS_USED:'))return rewrite;
 return {...rewrite,payload:{...payload,text:payload.text.replace(/\s*\[FLOLAH_SKILLS_USED:\s*[^\]]+\]\s*/gi,'\n').trim()}};
}
