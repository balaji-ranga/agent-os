/**
 * Durable goal plan (agr-…) for a Business Discovery run.
 * Steps are executed by discover.js; this module only records plan + progress.
 */
import { getDb } from '../../db/schema.js';
import {
  createGoalRun,
  completeGoalStep,
  getGoalRun,
} from '../agent-goal-run.js';
import { goalStepsForModes } from './discover-intent.js';

export function startDiscoveryGoalPlan({
  ownerUserId,
  agentId,
  prompt = '',
  title = '',
  modes = [],
  locality = '',
  businessType = '',
} = {}) {
  const steps = goalStepsForModes(modes, { locality, businessType });
  if (!steps.length) return null;
  const goal = createGoalRun({
    ownerUserId,
    agentId: String(agentId || 'businessdiscovery').trim() || 'businessdiscovery',
    title: String(title || '').trim() || `Business Discovery: ${locality || 'local search'}`.slice(0, 120),
    prompt,
    source: 'business_discover',
    steps,
    context: {
      modes,
      locality,
      business_type: businessType,
      pipeline: 'discover_research_track_act',
    },
  });
  console.info(
    '[social-research] discovery goal_plan=%s modes=%s steps=%s',
    goal?.id,
    (modes || []).join(','),
    goal?.steps?.length || 0
  );
  return goal;
}

export function completeDiscoveryGoalStep(goal, labelOrIndex, result = {}, { failed = false, error = null } = {}) {
  if (!goal?.id) return null;
  const steps = Array.isArray(goal.steps) ? goal.steps : getGoalRun(goal.id)?.steps || [];
  let step = null;
  if (typeof labelOrIndex === 'number') {
    step = steps[labelOrIndex];
  } else {
    const needle = String(labelOrIndex || '').toLowerCase();
    step = steps.find(
      (s) =>
        (s.status === 'pending' || s.status === 'running') &&
        String(s.label || '').toLowerCase().includes(needle)
    );
    if (!step) {
      step = steps.find((s) => String(s.label || '').toLowerCase().includes(needle) && s.status === 'pending');
    }
  }
  if (!step?.id) {
    console.warn('[social-research] goal step not found label=%s', String(labelOrIndex || ''));
    return getGoalRun(goal.id, goal.owner_user_id || null);
  }
  const out = completeGoalStep({
    goalRunId: goal.id,
    stepId: step.id,
    ownerUserId: goal.owner_user_id,
    result,
    failed,
    error,
  });
  return out?.goal || getGoalRun(goal.id, goal.owner_user_id || null);
}

export function failDiscoveryGoal(goal, error) {
  if (!goal?.id) return null;
  const pending = (goal.steps || []).find((s) => s.status === 'pending' || s.status === 'running');
  if (!pending) return getGoalRun(goal.id, goal.owner_user_id || null);
  const out = completeDiscoveryGoalStep(goal, pending.label, { error: String(error || 'failed') }, {
    failed: true,
    error: String(error || 'failed').slice(0, 1000),
  });
  try {
    getDb()
      .prepare(
        `UPDATE agent_goal_steps SET status = 'skipped'
         WHERE goal_run_id = ? AND status = 'pending'`
      )
      .run(goal.id);
  } catch (e) {
    console.warn('[social-research] skip remaining goal steps: %s', e.message || e);
  }
  return getGoalRun(goal.id, goal.owner_user_id || null) || out;
}
