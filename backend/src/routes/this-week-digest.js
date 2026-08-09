/**
 * GET /api/this-week-digest - owner-scoped This Week Digest payload.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { buildThisWeekDigest } from '../services/this-week-digest.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

router.get('/', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req);
    if (!ownerUserId) {
      return res.status(403).json({ error: 'CEO context required' });
    }
    const weekStart = req.query.from || req.query.week_start || null;
    const weekEnd = req.query.to || req.query.week_end || null;
    const offsetWeeks = req.query.offset != null ? Number(req.query.offset) : 0;
    const digest = await buildThisWeekDigest(ownerUserId, {
      weekStart,
      weekEnd,
      offsetWeeks: Number.isFinite(offsetWeeks) ? offsetWeeks : 0,
    });
    res.json(digest);
  } catch (e) {
    console.error('[this-week-digest] GET', e?.message || e);
    res.status(e?.status || 500).json({ error: e?.message || 'Digest failed' });
  }
});

export default router;
