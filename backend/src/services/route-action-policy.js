import { previewActionPolicy } from './action-policy.js';

function capabilityNames(route = {}) {
  const names = route?.executor_evidence?.capability_names;
  return [...new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || '').trim())
    .filter(Boolean))];
}

/**
 * Fail closed before creating a delegation for capabilities whose effective
 * company policy is prohibited. This consumes no grants/overrides; concrete
 * tool endpoints remain the mandatory execution boundary.
 */
export function preflightRoutedCapabilities({ ownerUserId, route, requestText = '' } = {}) {
  const targetAgentId = String(route?.target_agent_id || '').trim();
  const decisions = capabilityNames(route).map((toolName) => ({
    tool_name: toolName,
    ...previewActionPolicy({
      ownerUserId,
      toolName,
      body: { request: String(requestText || '') },
      context: { agentId: targetAgentId },
    }),
  }));
  const blocked = decisions.find((decision) => decision.mode === 'prohibited' || decision.constraints_ok === false) || null;
  return { ok: !blocked, blocked, decisions };
}

export function prohibitedRouteReply(decision = {}) {
  const family = decision.action_family === 'financial_destructive'
    ? 'Financial / destructive'
    : String(decision.action_family || 'This action');
  return `${family} actions are prohibited by your company Action Control policy. ` +
    'I did not delegate the request, create an execution task, or call the tool.';
}
