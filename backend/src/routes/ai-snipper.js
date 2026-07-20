/**
 * AI Snipper usage dashboard API.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getAiSnipperSummary } from '../services/ai-snipper.js';

const router = Router();

router.use(requireAuth, requireCeoOrAdmin);

/**
 * GET /api/ai-snipper/summary?days=7|14|30
 */
router.get('/summary', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const days = req.query.days != null ? Number(req.query.days) : 7;
    const summary = getAiSnipperSummary(ownerUserId, { days });
    res.json(summary);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
