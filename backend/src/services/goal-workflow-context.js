/**
 * Recover authoritative goal context for workflow tool calls made from an
 * isolated goal-step OpenClaw session. The model may omit goal ids or pass a
 * short workflow trigger phrase; neither is allowed to discard the work order.
 */

export function parseGoalSessionReference(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/(?:^|:)goal-(agr-[a-z0-9]+)-(ags-[a-z0-9]+)(?:$|:)/i);
  if (!match) return null;
  return { goal_run_id: match[1], goal_step_id: match[2] };
}

function clip(value, max = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text;
}

export function buildGoalBoundWorkflowInput({ goal, step, suppliedInput = '' } = {}) {
  if (!goal?.id || !step?.id) return suppliedInput;
  const prior = (Array.isArray(goal.steps) ? goal.steps : [])
    .filter((item) => Number(item.step_index) < Number(step.step_index) && item.status === 'completed')
    .map((item) => ({
      step_id: item.id,
      label: item.label,
      result: item.result ?? null,
    }));
  const assigned = step.spec?.message || step.spec?.description || step.label || '';
  const provided = typeof suppliedInput === 'string'
    ? suppliedInput.trim()
    : JSON.stringify(suppliedInput ?? null, null, 2);

  return [
    '[Authoritative goal-bound workflow input]',
    `[goal_run_id: ${goal.id}]`,
    `[goal_step_id: ${step.id}]`,
    '',
    'Original CEO goal (verbatim):',
    clip(goal.prompt || goal.title || ''),
    '',
    'Assigned deliverable:',
    clip(assigned),
    '',
    'Completed outputs from this goal only:',
    prior.length ? clip(prior, 16000) : 'None.',
    '',
    'Agent-supplied workflow input:',
    provided || '(none)',
    '',
    'Execution boundary:',
    '- Use the original goal, assigned deliverable, and same-goal outputs above as the source of truth.',
    '- A short trigger phrase is routing metadata, not the task brief.',
    '- Do not reuse unrelated chat, memory, workflow-run, or prior storyboard content.',
    '- Return the concrete requested deliverable and preserve the goal/delegation trace.',
  ].join('\n');
}
