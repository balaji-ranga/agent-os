/**
 * Efficiency View dashboard API.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getEfficiencySummary } from '../services/efficiency.js';

const router = Router();

router.use(requireAuth, requireCeoOrAdmin);

/**
 * GET /api/efficiency/summary?days=7|14|30|90|all
 */
router.get('/summary', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const days = req.query.days != null ? req.query.days : 14;
    const summary = getEfficiencySummary(ownerUserId, { days });
    res.json(summary);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
