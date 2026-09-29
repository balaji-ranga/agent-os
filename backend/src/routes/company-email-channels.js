import { Router } from 'express';
import { requireAuth, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  createCompanyEmailChannel,
  deleteCompanyEmailChannel,
  disableCompanyEmailChannel,
  enableCompanyEmailChannel,
  getCompanyEmailChannel,
  listCompanyEmailChannels,
  syncCompanyEmailChannel,
  testCompanyEmailChannel,
  updateCompanyEmailChannel,
} from '../services/company-email-channels.js';

const router = Router();

function owner(req) {
  const value = resolveAuthenticatedCeoUserId(req, req.body || req.query || {});
  if (!value) throw Object.assign(new Error('Company context required'), { status: 403 });
  return value;
}

router.get('/', requireAuth, async (req, res) => {
  try { res.json(await listCompanyEmailChannels(owner(req), req.query || {})); }
  catch (error) { res.status(error.status || 500).json({ error: error.message, code: error.code }); }
});

router.get('/:id', requireAuth, async (req, res) => {
  try { res.json({ channel: await getCompanyEmailChannel(owner(req), req.params.id) }); }
  catch (error) { res.status(error.status || 500).json({ error: error.message, code: error.code }); }
});

router.post('/', requireAuth, (req, res) => {
  try { res.status(201).json({ channel: createCompanyEmailChannel(owner(req), req.body || {}) }); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

router.patch('/:id', requireAuth, (req, res) => {
  try { res.json({ channel: updateCompanyEmailChannel(owner(req), req.params.id, req.body || {}) }); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

router.delete('/:id', requireAuth, (req, res) => {
  try { res.json(deleteCompanyEmailChannel(owner(req), req.params.id)); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

router.post('/:id/test', requireAuth, async (req, res) => {
  try { res.json(await testCompanyEmailChannel(owner(req), req.params.id)); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

router.post('/:id/enable', requireAuth, async (req, res) => {
  try { res.json({ channel: await enableCompanyEmailChannel(owner(req), req.params.id) }); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

router.post('/:id/disable', requireAuth, async (req, res) => {
  try { res.json({ channel: await disableCompanyEmailChannel(owner(req), req.params.id) }); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

router.post('/:id/sync', requireAuth, async (req, res) => {
  try { res.json(await syncCompanyEmailChannel(owner(req), req.params.id, { force: req.body?.force === true })); }
  catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code }); }
});

export default router;
