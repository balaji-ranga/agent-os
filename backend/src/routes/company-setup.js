/**
 * Company setup funnel API (Phase C).
 * CEO owner-scoped post-login gate + blueprint apply.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  getSetupGate,
  skipCompanySetup,
  beginCreateCompany,
  saveFunnelDraft,
  getFunnelState,
  applyCompanySetup,
  designCompanyOrg,
  searchSetupConnectors,
} from '../services/company-setup.js';

const router = Router();
router.use(requireAuth);
router.use(requireCeoOrAdmin);

function ownerOr403(req, res) {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || req.query || {});
    if (!owner) {
      res.status(403).json({ error: 'CEO context required' });
      return null;
    }
    return owner;
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message || 'CEO context required' });
    return null;
  }
}

/** Gate status for App post-login redirect. */
router.get('/gate', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(getSetupGate(owner));
  } catch (e) {
    console.warn('[company-setup] gate failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to load setup gate' });
  }
});

router.post('/skip', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(skipCompanySetup(owner));
  } catch (e) {
    console.warn('[company-setup] skip failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to skip company setup' });
  }
});

router.post('/begin', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(beginCreateCompany(owner));
  } catch (e) {
    console.warn('[company-setup] begin failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to begin company setup' });
  }
});

router.get('/funnel', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(getFunnelState(owner));
  } catch (e) {
    console.warn('[company-setup] funnel get failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to load funnel' });
  }
});

router.put('/funnel', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(saveFunnelDraft(owner, req.body || {}));
  } catch (e) {
    console.warn('[company-setup] funnel put failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to save funnel' });
  }
});


router.post('/design', async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(await designCompanyOrg(owner));
  } catch (e) {
    console.warn('[company-setup] design failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to design company org' });
  }
});

router.get('/connectors/search', async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(await searchSetupConnectors(owner, req.query.q || req.query.query || ''));
  } catch (e) {
    console.warn('[company-setup] connectors search failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Connector search failed' });
  }
});

router.post('/apply', async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const result = await applyCompanySetup(owner, {
      confirm_override: req.body?.confirm_override !== false,
      selected: req.body?.selected,
    });
    res.json(result);
  } catch (e) {
    console.warn('[company-setup] apply failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to apply company setup' });
  }
});

export default router;