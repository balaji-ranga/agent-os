/**
 * CEO agent goal-plan API - list/get durable multi-intent plans.
 * Owner-scoped (CEO entitlements). Complements agent tools agent_goal_*.
 */
import { Router } from 'express';
import { attachAuthUser, requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { listGoalRuns, getGoalRun, summarizeGoalProgress } from '../services/agent-goal-run.js';

const router = Router();
router.use(attachAuthUser, requireAuth, requireCeoOrAdmin);

function ownerOr403(req, res) {
  const ownerUserId = resolveAuthenticatedCeoUserId(req);
  if (!ownerUserId) {
    res.status(403).json({ error: 'CEO session required' });
    return null;
  }
  return ownerUserId;
}

function withProgress(goal) {
  if (!goal) return null;
  return { ...goal, progress: summarizeGoalProgress(goal) };
}

router.get('/', (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const status = req.query.status ? String(req.query.status) : null;
    const scheduledGoalId = req.query.scheduled_goal_id
      ? String(req.query.scheduled_goal_id).trim()
      : null;
    const fromDate = req.query.from || req.query.week_start || null;
    const toDate = req.query.to || req.query.week_end || null;
    const limit = req.query.limit != null ? Number(req.query.limit) : 30;
    const goals = listGoalRuns(ownerUserId, {
      limit,
      status,
      scheduledGoalId,
      fromDate: fromDate ? String(fromDate).slice(0, 10) : null,
      toDate: toDate ? String(toDate).slice(0, 10) : null,
    }).map(withProgress);
    res.json({
      goals,
      count: goals.length,
      from: fromDate ? String(fromDate).slice(0, 10) : null,
      to: toDate ? String(toDate).slice(0, 10) : null,
    });
  } catch (e) {
    console.warn('[agent-goal-runs] list', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const goal = getGoalRun(req.params.id, ownerUserId);
    if (!goal) return res.status(404).json({ error: 'Not found' });
    res.json({ goal: withProgress(goal) });
  } catch (e) {
    console.warn('[agent-goal-runs] get', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
