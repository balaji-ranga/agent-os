import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { campaignAnalytics, getCampaign, listCampaigns, saveCampaign } from '../services/promotions.js';

const router = express.Router();
router.use(requireAuth, requireRole('admin'));
router.get('/', (_req, res) => res.json({ campaigns: listCampaigns() }));
router.post('/', (req, res, next) => { try { res.status(201).json({ campaign: saveCampaign(req.body, req.authUser.id) }); } catch (e) { next(e); } });
router.put('/:id', (req, res, next) => { try { if (!getCampaign(req.params.id)) return res.status(404).json({ error: 'Campaign not found' }); res.json({ campaign: saveCampaign(req.body, req.authUser.id, req.params.id) }); } catch (e) { next(e); } });
router.get('/:id/analytics', (req, res) => { const out = campaignAnalytics(req.params.id, { page: req.query.page, pageSize: req.query.page_size }); return out ? res.json(out) : res.status(404).json({ error: 'Campaign not found' }); });
export default router;
