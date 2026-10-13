// Navigation prepares a draft only. Voice starts only after the explicit call button.
export function copilotAgentHandoff(action, agents) {
  if (!['agent_chat','agent_call'].includes(action.type) || !agents.some(agent=>agent.id===action.agent)) throw new Error('This agent is no longer available.');
  if (action.type==='agent_chat' && typeof action.message!=='string') throw new Error('The chat draft is missing. Ask Copilot to prepare it again.');
  return {route:`/agents/${encodeURIComponent(action.agent)}/chat`,state:{prefill:action.message||'',autosend:false,copilotCall:action.type==='agent_call'}};
}
