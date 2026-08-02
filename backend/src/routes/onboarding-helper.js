/**
 * Onboarding Helper API - CEO owner-scoped strategic org setup.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  getState,
  saveDraft,
  chatTurn,
  confirmStep,
  goToStep,
  applyProposal,
  resetJourney,
  updateSelectedApply,
} from '../services/onboarding-helper.js';

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

router.get('/', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(getState(owner));
  } catch (e) {
    console.warn('[onboarding-helper] getState failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to load onboarding state' });
  }
});

router.put('/draft', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(saveDraft(owner, req.body || {}));
  } catch (e) {
    console.warn('[onboarding-helper] saveDraft failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to save draft' });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const message = req.body?.message ?? '';
    res.json(await chatTurn(owner, message));
  } catch (e) {
    console.warn('[onboarding-helper] chat failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Chat turn failed' });
  }
});

router.post('/confirm-step', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(confirmStep(owner));
  } catch (e) {
    console.warn('[onboarding-helper] confirm-step failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Confirm failed' });
  }
});

router.post('/go-step', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const stepIndex = req.body?.step_index ?? req.body?.stepIndex ?? 0;
    res.json(goToStep(owner, stepIndex));
  } catch (e) {
    console.warn('[onboarding-helper] go-step failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Go step failed' });
  }
});

router.post('/reset', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    console.info('[onboarding-helper] reset requested owner=', owner);
    res.json(resetJourney(owner));
  } catch (e) {
    console.warn('[onboarding-helper] reset failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Reset failed' });
  }
});

router.put('/selected-apply', (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    res.json(updateSelectedApply(owner, req.body?.selected_apply || req.body?.selected || {}));
  } catch (e) {
    console.warn('[onboarding-helper] selected apply failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Failed to update selection' });
  }
});

router.post('/apply', async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    console.info('[onboarding-helper] apply requested owner=', owner);
    const out = await applyProposal(owner, {
      confirm_override: !!req.body?.confirm_override,
      selected: req.body?.selected,
    });
    res.json(out);
  } catch (e) {
    console.warn('[onboarding-helper] apply failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Apply failed' });
  }
});

export default router;
