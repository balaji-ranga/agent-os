// Fresh, tenant-scoped context; no cross-session cache or model-supplied owner.
export async function physicalContextHint({allowed,sessionKey,baseUrl,brokerSecret,fetchImpl=fetch}) {
 if(!allowed||!sessionKey||!baseUrl)return '';
 try {
  const response=await fetchImpl(baseUrl.replace(/\/$/,'')+'/api/tools/native-model-budget/physical-context',{
   method:'POST',headers:{'Content-Type':'application/json','x-agent-os-tool-broker':brokerSecret()},
   body:JSON.stringify({session_key:sessionKey}),signal:AbortSignal.timeout(3000)
  });
  if(response.ok){const data=await response.json();if(typeof data.instructions==='string'&&data.instructions.length<=32000)return data.instructions;}
 }catch{}
 return 'Registered physical-device context is temporarily unavailable. For physical device requests use physical_entities_list to discover authorized devices and supported actions. Do not substitute browser control, invent device identifiers, or claim an action succeeded. If discovery fails, give a concise failure response; do not silently retry a power toggle.';
}
