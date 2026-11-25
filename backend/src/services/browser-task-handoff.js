import {isReadOnlyBrowserAction} from './action-policy.js';

// Execution instructions and historical tool results are separate contracts.
// Old failures and unrelated capability inventories must not become a new goal.
function userContext(text) {
  return String(text || '').split(/\n(?:Backend browser results for the referenced work only|\[Registered physical device capabilities|\[User-selected assigned skills)/)[0].trim();
}
export function browserTaskHandoff(payload, context, input={}) {
  if (!context) return {input};
  const original=userContext(context.original_request);
  const resolved=userContext(context.resolved_user_request || context.resolved_request);
  const operation=original.match(/\binput\.operation\s*=\s*["']([a-z_]+)["']/i)?.[1];
  const next={...input,work_unit_id:context.work_unit_id||null};
  if (!next.operation && operation && isReadOnlyBrowserAction('browse_task_start',{input:{operation}}))next.operation=operation;
  return {input:next,goal:[
    'Original user request (preserve its outcomes and constraints):',original,
    'Resolved user request:',resolved,
    'Browser-specific assignment:',payload.goal||payload.goal_text||'',
    'Perform only browser work relevant to this assignment. Do not execute unrelated actions from the broader request.',
  ].join('\n')};
}
