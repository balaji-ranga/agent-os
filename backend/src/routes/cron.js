import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { allowInternalOrAuth } from '../middleware/internal-auth.js';
import { runScheduledStandup, runDueStandupSchedules } from '../cron/standup.js';
import { processPendingDelegationTasks } from '../services/delegation-queue.js';
import { runCooStatusChecker } from '../services/coo-status-checker.js';
import { purgeOwnerRetention, purgeRetentionForAllCeos } from '../services/data-retention.js';

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

/**
 * Manual COO status checker for the entitled CEO (standup digest + HTML popup).
 * Email is NOT sent from this endpoint — only the daily batch cron emails.
 * Body: { post_standup?: boolean, all_ceos?: boolean } — all_ceos only for admin/internal (still no email).
 */
router.post('/run-status-checker', async (req, res) => {
  try {
    const body = req.body || {};
    const postStandup = body.post_standup !== false && body.postStandup !== false;
    if (body.all_ceos === true && (req.authUser?.role === 'admin' || req.headers['x-internal-token'])) {
      // Admin ad-hoc for all CEOs: digest + standup only (no email blast).
      const ceos = (await import('../db/schema.js')).getDb()
        .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
        .all();
      const results = [];
      for (const ceo of ceos) {
        try {
          const out = await runCooStatusChecker(ceo.id, { email: false, postStandup });
          results.push({ owner_user_id: ceo.id, ok: true, counts: out.digest.counts, standup_id: out.standup_id });
        } catch (e) {
          results.push({ owner_user_id: ceo.id, ok: false, error: e?.message || String(e) });
        }
      }
      return res.json({ ok: true, count: results.length, results, email: { skipped: true, reason: 'batch_only' } });
    }
    const ownerUserId = resolveAuthenticatedCeoUserId(req, body);
    const out = await runCooStatusChecker(ownerUserId, { email: false, postStandup });
    res.json({
      ok: true,
      owner_user_id: ownerUserId,
      standup_id: out.standup_id,
      counts: out.digest.counts,
      digest: out.digest,
      html: out.html,
      markdown: out.markdown,
      sync_changes: out.digest.sync_changes?.length || 0,
      email: { sent: false, attempted: false, skipped: true, reason: 'batch_only' },
    });
  } catch (e) {
    console.warn('[cron] run-status-checker failed:', e?.message || e);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

/**
 * Manual data retention purge for the entitled CEO (permanent delete of aged history).
 * Body: { days?: number, all_ceos?: boolean } — days overrides profile setting for this run only.
 */
router.post('/run-data-retention', async (req, res) => {
  try {
    const body = req.body || {};
    if (body.all_ceos === true && (req.authUser?.role === 'admin' || req.headers['x-internal-token'])) {
      const out = purgeRetentionForAllCeos();
      return res.json({ ok: true, ...out });
    }
    const ownerUserId = resolveAuthenticatedCeoUserId(req, body);
    const days = body.days != null ? body.days : null;
    const out = purgeOwnerRetention(ownerUserId, { days });
    console.log(`[cron] retention purge owner=${ownerUserId} days=${out.retention_days}`);
    res.json({ ok: true, ...out });
  } catch (e) {
    console.warn('[cron] run-data-retention failed:', e?.message || e);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

export default router;
