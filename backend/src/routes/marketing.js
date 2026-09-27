import { Router } from 'express';
import { requireAuth, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { createMarketingOpenPixel, getMarketingWorkspace, listDueMarketingWatches, prepareMarketingLead, recordMarketingWatchResult, updateMarketingFollowup, upsertMarketingRecord } from '../services/marketing-workspace.js';

const router = Router();

function owner(req, res) {
  const value = resolveAuthenticatedCeoUserId(req);
  if (!value) res.status(403).json({ error: 'Company context required' });
  return value;
}

router.get('/workspace', requireAuth, (req, res) => {
  try {
    const ownerUserId = owner(req, res); if (!ownerUserId) return;
    res.json(getMarketingWorkspace(ownerUserId));
  } catch (error) { res.status(error.status || 500).json({ error: error.message, code: error.code }); }
});

for (const kind of ['campaigns', 'assets', 'channels', 'metrics', 'engagements', 'watches', 'strategies']) {
  router.post(`/${kind}`, requireAuth, (req, res) => {
    try {
      const ownerUserId = owner(req, res); if (!ownerUserId) return;
      const result = upsertMarketingRecord(ownerUserId, kind, req.body || {});
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
  });
}

router.post('/tracking/open-pixel', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.status(201).json(createMarketingOpenPixel(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});
router.get('/watches/due', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.json({ watches: listDueMarketingWatches(ownerUserId) }); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});
router.post('/watches/results', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.json(recordMarketingWatchResult(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});
router.post('/leads/prepare', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.json(prepareMarketingLead(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});
router.post('/engagements/followup', requireAuth, (req, res) => {
  try { const ownerUserId = owner(req, res); if (!ownerUserId) return; res.json(updateMarketingFollowup(ownerUserId, req.body || {})); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

export default router;
