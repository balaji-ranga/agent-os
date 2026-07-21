import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';
import { allowInternalOrAuth } from '../middleware/internal-auth.js';
import { runScheduledStandup, runDueStandupSchedules } from '../cron/standup.js';
import { processPendingDelegationTasks } from '../services/delegation-queue.js';

const router = Router();

router.use(allowInternalOrAuth);
router.use(requireCeoOrAdmin);

/** Manual trigger for standup flow (collect from agents + run COO). */
router.post('/run-standup', async (req, res) => {
  try {
    const { standup, error } = await runScheduledStandup();
    if (error) {
      return res.status(502).json({ ok: false, error, standup: standup || null });
    }
    res.json({ ok: true, standup });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Manual trigger for user-created standup schedules due this minute. */
router.post('/run-due-standups', async (req, res) => {
  try {
    const out = await runDueStandupSchedules();
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Process pending COO→agent delegations and post response callbacks to standup. (Also runs on schedule.) */
router.post('/process-delegations', async (req, res) => {
  try {
    await processPendingDelegationTasks();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
