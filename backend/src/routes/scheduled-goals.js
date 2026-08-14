/**
 * CEO scheduled goals API — list/create/update/pause/delete/run-now.
 * All routes require auth and are owner-scoped (CEO entitlements).
 */
import { Router } from 'express';
import { attachAuthUser, requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  listScheduledGoals,
  getScheduledGoal,
  createScheduledGoal,
  updateScheduledGoal,
  pauseScheduledGoal,
  resumeScheduledGoal,
  deleteScheduledGoal,
  runScheduledGoal,
  listRecentRuns,
  previewGoalPlan,
  setScheduledGoalPlan,
  approveScheduledGoalPlan,
} from '../services/scheduled-goals.js';
import { enrichGoalTextWithAi } from '../services/ceo-guardrails.js';
import { getServerTimezone } from '../utils/format-datetime.js';

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

router.get('/', (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const status = req.query.status ? String(req.query.status) : undefined;
    const goals = listScheduledGoals(ownerUserId, { status });
    res.json({
      goals,
      server_timezone: getServerTimezone(),
      count: goals.length,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});


router.post('/enrich', async (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const body = req.body || {};
    const out = await enrichGoalTextWithAi(ownerUserId, body.prompt || body.draft || '', {
      title: body.title || '',
      companyContext: body.company_context || body.companyContext || '',
    });
    res.json(out);
  } catch (e) {
    console.warn('[scheduled-goals] enrich failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});


router.post('/plan-preview', async (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const body = req.body || {};
    const plan = await previewGoalPlan(ownerUserId, {
      prompt: body.prompt || body.draft || '',
      feedback: body.feedback || body.plan_feedback || null,
      previous_plan: body.previous_plan || body.previousPlan || null,
      explicit_steps: body.explicit_steps || body.steps || null,
      agent_id: body.agent_id || body.agentId || null,
    });
    res.json({ plan });
  } catch (e) {
    console.warn('[scheduled-goals] plan-preview failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const goal = getScheduledGoal(ownerUserId, req.params.id);
    if (!goal) return res.status(404).json({ error: 'Not found' });
    const runs = listRecentRuns(ownerUserId, goal.id, 15);
    res.json({ goal, runs, server_timezone: getServerTimezone() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const goal = await createScheduledGoal(ownerUserId, { ...(req.body || {}), source: 'ceo_ui' });
    res.status(201).json({ goal });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const goal = updateScheduledGoal(ownerUserId, req.params.id, req.body || {});
    res.json({ goal });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});


router.post('/:id/plan', async (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const body = req.body || {};
    const goal = await setScheduledGoalPlan(ownerUserId, req.params.id, {
      plan: body.plan || null,
      feedback: body.feedback || body.plan_feedback || null,
      approve: body.approve === true || body.approve_plan === true,
      prompt: body.prompt || null,
    });
    res.json({ goal, message: goal.plan_status === 'approved' ? 'Plan approved — schedule is active.' : 'Draft plan updated. Approve to activate the schedule.' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/:id/plan-approve', async (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const goal = await approveScheduledGoalPlan(ownerUserId, req.params.id);
    res.json({ goal, message: 'Plan approved — goal will run on schedule.' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/:id/pause', (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const goal = pauseScheduledGoal(ownerUserId, req.params.id);
    res.json({ goal, message: 'Paused — will not run until resumed (persists across restarts).' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/:id/resume', (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const goal = resumeScheduledGoal(ownerUserId, req.params.id);
    res.json({ goal, message: 'Resumed — schedule active again.' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/:id/run-now', async (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const out = await runScheduledGoal(ownerUserId, req.params.id, { force: true });
    const goal = getScheduledGoal(ownerUserId, req.params.id);
    res.json({ ...out, goal });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const ownerUserId = ownerOr403(req, res);
    if (!ownerUserId) return;
    const out = deleteScheduledGoal(ownerUserId, req.params.id);
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;