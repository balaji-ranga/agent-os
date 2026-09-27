import { Router } from 'express';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { resolveToolOwnerUserId } from '../services/tool-owner-scope.js';
import { configureMarketingCampaign, createMarketingOpenPixel, getMarketingWorkspace, listDueMarketingWatches, prepareMarketingCampaignRun, prepareMarketingLead, recordMarketingWatchResult, updateMarketingFollowup, upsertMarketingRecord } from '../services/marketing-workspace.js';

const router = Router();
const owner = (req) => resolveToolOwnerUserId(req, req.body || {}, resolveAuthenticatedCeoUserId);
const run = async (res, fn) => { try { res.json({ ok: true, ...(await fn()) }); } catch (error) { res.status(error.status || 500).json({ ok: false, error: error.message, code: error.code }); } };

router.post('/marketing-workspace-read', (req, res) => run(res, async () => ({ workspace: getMarketingWorkspace(owner(req)) })));
router.post('/marketing-campaign-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'campaigns', req.body || {})));
router.post('/marketing-campaign-configure', (req, res) => run(res, async () => configureMarketingCampaign(owner(req), req.body || {})));
router.post('/marketing-campaign-run-prepare', (req, res) => run(res, async () => ({ readiness: prepareMarketingCampaignRun(owner(req), req.body || {}) })));
router.post('/marketing-asset-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'assets', req.body || {})));
router.post('/marketing-channel-config-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'channels', req.body || {})));
router.post('/marketing-strategy-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'strategies', req.body || {})));
router.post('/marketing-metric-record', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'metrics', req.body || {})));
router.post('/marketing-tracking-pixel-create', (req, res) => run(res, async () => createMarketingOpenPixel(owner(req), req.body || {})));
router.post('/marketing-engagement-record', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'engagements', req.body || {})));
router.post('/marketing-followup-update', (req, res) => run(res, async () => updateMarketingFollowup(owner(req), req.body || {})));
router.post('/marketing-watch-upsert', (req, res) => run(res, async () => upsertMarketingRecord(owner(req), 'watches', req.body || {})));
router.post('/marketing-watches-due', (req, res) => run(res, async () => ({ watches: listDueMarketingWatches(owner(req), req.body || {}) })));
router.post('/marketing-watch-result-record', (req, res) => run(res, async () => recordMarketingWatchResult(owner(req), req.body || {})));
router.post('/marketing-lead-prepare', (req, res) => run(res, async () => prepareMarketingLead(owner(req), req.body || {})));

export default router;
