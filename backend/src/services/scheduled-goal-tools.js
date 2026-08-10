/**
 * COO scheduled-goal content tools (owner-scoped).
 */
import {
  listScheduledGoals,
  createScheduledGoal,
  updateScheduledGoal,
  pauseScheduledGoal,
  resumeScheduledGoal,
  deleteScheduledGoal,
  runScheduledGoal,
  getScheduledGoal,
  findGoalForOwner,
} from '../services/scheduled-goals.js';

function requireCoo(caller) {
  if (!caller || !caller.is_coo) {
    const err = new Error('Only COO can manage scheduled goals');
    err.status = 403;
    throw err;
  }
}

function resolveGoalId(ownerUserId, body) {
  const id = String(body.goal_id || body.id || '').trim();
  if (id) return id;
  const q = String(body.query || body.title || body.name || '').trim();
  if (!q) return null;
  const found = findGoalForOwner(ownerUserId, q);
  if (!found) return null;
  if (found.matches) {
    const err = new Error(
      `Multiple goals match "${q}". Pass goal_id. Matches: ${found.matches.map((g) => `${g.id} (${g.title})`).join('; ')}`
    );
    err.status = 400;
    throw err;
  }
  return found.id;
}

export async function executeScheduledGoalCreate(ownerUserId, body = {}) {
  return createScheduledGoal(ownerUserId, { ...body, source: body.source || 'coo_tool', approve_plan: body.approve_plan !== false });
}

export function executeScheduledGoalList(ownerUserId, body = {}) {
  const status = body.status ? String(body.status) : undefined;
  const goals = listScheduledGoals(ownerUserId, { status });
  return {
    ok: true,
    count: goals.length,
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      prompt: g.prompt,
      agent_id: g.agent_id,
      agent_name: g.agent_name,
      schedule: g.schedule_label,
      ends: g.ends_label,
      is_perpetual: g.is_perpetual,
      status: g.status,
      last_run_status: g.last_run_status,
      last_run_at: g.last_run_at,
      run_count: g.run_count,
    })),
    tip: 'CEO can also open Scheduled goals in the app menu.',
  };
}

export function executeScheduledGoalUpdate(ownerUserId, body = {}) {
  const id = resolveGoalId(ownerUserId, body);
  if (!id) {
    const err = new Error('goal_id or query (title) required');
    err.status = 400;
    throw err;
  }
  const statusRaw = body.status != null ? String(body.status).toLowerCase() : '';
  if (statusRaw === 'paused' || body.pause === true) {
    return pauseScheduledGoal(ownerUserId, id);
  }
  if (statusRaw === 'active' || body.resume === true) {
    return resumeScheduledGoal(ownerUserId, id);
  }
  const patch = { ...body };
  delete patch.goal_id;
  delete patch.id;
  delete patch.query;
  delete patch.title_match;
  return updateScheduledGoal(ownerUserId, id, patch);
}

export function executeScheduledGoalDelete(ownerUserId, body = {}) {
  const id = resolveGoalId(ownerUserId, body);
  if (!id) {
    const err = new Error('goal_id or query (title) required');
    err.status = 400;
    throw err;
  }
  return deleteScheduledGoal(ownerUserId, id);
}

export async function executeScheduledGoalRunNow(ownerUserId, body = {}) {
  const id = resolveGoalId(ownerUserId, body);
  if (!id) {
    const err = new Error('goal_id or query (title) required');
    err.status = 400;
    throw err;
  }
  const out = await runScheduledGoal(ownerUserId, id, { force: true });
  const goal = getScheduledGoal(ownerUserId, id);
  return { ...out, goal };
}

export { requireCoo };