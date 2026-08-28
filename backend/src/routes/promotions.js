import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { eligibleCampaign, getPromotionPreferences, recordPromotionEvent, setPromotionPreferences } from '../services/promotions.js';

const router = express.Router();
router.use(requireAuth);
router.get('/eligible', (req, res) => res.json({ campaign: eligibleCampaign(req.authUser.id) }));
router.get('/preferences', (req,res) => res.json(getPromotionPreferences(req.authUser.id)));
router.put('/preferences', (req,res) => res.json(setPromotionPreferences(req.authUser.id,req.body)));
router.post('/:id/events', (req, res, next) => {
  try { res.json(recordPromotionEvent({ campaignId: req.params.id, userId: req.authUser.id, eventType: req.body?.event_type, channel: req.body?.channel, idempotencyKey: req.body?.idempotency_key, metadata: req.body?.metadata })); } catch (e) { next(e); }
});
export default router;
