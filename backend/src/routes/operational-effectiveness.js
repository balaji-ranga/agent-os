/**
 * GET /api/operational-effectiveness — owner-scoped OEI score + explain payload.
 * Auth: CEO/admin only; owner from session (never body spoof).
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { buildOperationalEffectiveness } from '../services/operational-effectiveness.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

router.get('/', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    if (!ownerUserId) {
      return res.status(403).json({ error: 'CEO context required' });
    }
    const daysRaw = req.query?.days;
    const days = daysRaw != null ? Number(daysRaw) : undefined;
    const payload = await buildOperationalEffectiveness(ownerUserId, { days });
    res.json(payload);
  } catch (e) {
    console.error('[operational-effectiveness] GET', e?.message || e);
    res.status(e.status || 500).json({ error: e?.message || 'OEI failed' });
  }
});

export default router;