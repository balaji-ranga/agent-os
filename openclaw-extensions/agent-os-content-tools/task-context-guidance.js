// Select guidance, never capabilities: tool discovery and authorization remain
// unchanged. A direct source review does not need device/scheduler tutorials.
export function composeTaskGuidance({speechTurn='',statusHint='',timezoneHint='',physicalHint='',physicalDiscoveryHint='',scheduledHint='',speechHint='',recoveryHint='',reviewHint='',skillHint='',budgetHint=''}) {
 const join=parts=>parts.filter(Boolean).join('\n');
 const personalContext=speechTurn|| (statusHint?join([statusHint,timezoneHint]):reviewHint?'':join([physicalDiscoveryHint,scheduledHint]));
 const systemContext=join([timezoneHint,statusHint||reviewHint?'':physicalHint,speechHint,speechTurn||statusHint?'':recoveryHint,skillHint,budgetHint,reviewHint]);
 return {personalContext,systemContext};
}
