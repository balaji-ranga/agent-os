// Capability-derived, channel-independent guidance. Discovery never grants access.
export function connectorRoutingGuidance({canList=false,canSearch=false,canGuide=false,canExecute=false,canRead=false}={}){
 if(!canRead&&!(canSearch&&canGuide&&canExecute))return '';
 const lines=['Connected-service routing: inspect current authorized tools and source descriptions; do not infer a disconnected account from a wrong tool route.'];
 if(canList)lines.push('Use connector_list_apps to identify the owner-connected apps when the source/account is unknown or ambiguous. Ask which account/source if discovery leaves more than one relevant choice.');
 if(canSearch&&canGuide&&canExecute)lines.push('For a connected-service request, use connector_search_actions for the requested source and intent, inspect connector_get_action_guide, then connector_execute_action with the exact returned action_id and schema. Do not guess action names or assume generic email_*/calendar_* productivity bindings point at the connected account.');
 if(canRead)lines.push('Use floassist_source_read to read verified connected email, file and calendar content. For an identified source use its exact returned source reference and follow next_request for content pages. A latest-item read is not a complete mailbox review.');
 lines.push('A wrong-source or route-required result means the original tool did not run against the source. Follow its permitted discovery/route correction using a different appropriate tool. retryable:false forbids repeating that same failed call; it does not forbid an explicitly offered alternative route. Never bypass an authorization/approval denial, guess an ungranted route, replay an uncertain write, or report a summary without source evidence. If no authorized route succeeds, report the specific failure and coverage honestly.');
 return lines.join('\n');
}
