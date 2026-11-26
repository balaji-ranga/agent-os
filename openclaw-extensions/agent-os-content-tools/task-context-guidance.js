// Select guidance, never capabilities: tool discovery and authorization remain
// unchanged. A direct source review does not need device/scheduler tutorials.
export const platformDiscoveryGuidance='Capability discovery: choose the capability from the meaning of the current user request and its exact reply context. If the matching tool and current schema are not already known, use tool_search across the authorized platform catalog, then tool_describe for the returned ID before tool_call. connector_search_actions searches external connector actions only; an empty or rejected connector search does not establish that a platform capability is unavailable. Never invent tool/action IDs or select unrelated device, schedule or connector tools as a fallback. Domain instructions below apply only when the current request belongs to that domain. Discovery does not grant access or override a denial.';
export function composeTaskGuidance({speechTurn='',statusHint='',timezoneHint='',physicalHint='',physicalDiscoveryHint='',scheduledHint='',speechHint='',recoveryHint='',reviewHint='',skillHint='',budgetHint='',discoveryHint=''}) {
 const join=parts=>parts.filter(Boolean).join('\n');
 // Domain tutorials are policy, never an appended user assignment. Previously
 // device/schedule hints were prepended to every ordinary user request.
 const personalContext=speechTurn|| (statusHint?join([statusHint,timezoneHint]):'');
 const systemContext=join([timezoneHint,discoveryHint,statusHint||reviewHint?'':join([physicalHint,physicalDiscoveryHint,scheduledHint]),speechHint,speechTurn||statusHint?'':recoveryHint,skillHint,budgetHint,reviewHint]);
 return {personalContext,systemContext};
}
