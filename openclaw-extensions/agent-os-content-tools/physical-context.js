// Fresh, tenant-scoped context; no cross-session cache or model-supplied owner.
export function physicalDiscoveryTurnHint(context) {
 return context ? 'For this turn, if the request concerns a registered physical device, first read its authorized inventory with physical_entities_list (or tool_call id="physical_entities_list", args={} when native search controls are exposed). A tool-search result or a prior assistant answer is not a device inventory result. Ground device/action selection in fresh discovery, ask for clarification if ambiguous, and do not execute when the user requests explanation only.' : '';
}
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
