/** Cards represent this answer's explicit goal, never every goal in a list tool. */
export function collectGoalRunIds({ text = '', toolCalls = [] } = {}) {
  const found = new Set();
  const scan = value => {
    for (const match of String(value || '').matchAll(/\bagr-[a-f0-9]{8,}\b/gi)) found.add(match[0]);
  };
  scan(text);
  for (const call of toolCalls || []) {
    if (call.status !== 'ok' && call.status !== 'success') continue;
    if (call.tool_name === 'agent_goal_create') {
      scan(call.response?.goal_run_id || call.response?.goal?.id || call.response?.id);
    } else if (call.tool_name === 'agent_goal_status') {
      scan(call.request?.goal_run_id || call.request?.id);
    }
  }
  return [...found];
}
