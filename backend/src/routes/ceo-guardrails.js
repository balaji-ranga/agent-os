/**
 * CEO common guardrails / policy — applied to all agents (POLICY.md) and Brain nodes.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getCeoGuardrails, upsertCeoGuardrails } from '../services/ceo-guardrails.js';
import { syncOrgContextForCeo } from '../services/org-context.js';
import { getUserById } from '../services/users.js';

const router = Router();

router.get('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    const guardrails = getCeoGuardrails(ceoUserId);
    res.json({ guardrails });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.put('/', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    const body = req.body || {};
    const policyText = body.policy_text ?? body.policyText ?? '';
    const enabled = body.enabled;
    const guardrails = upsertCeoGuardrails(ceoUserId, { policyText, enabled });
    let workspaces_synced = 0;
    try {
      workspaces_synced = await syncOrgContextForCeo(ceoUserId);
    } catch (e) {
      console.warn('[ceo-guardrails] org sync after save failed:', e?.message || e);
    }
    const ceo = getUserById(ceoUserId);
    res.json({
      guardrails,
      workspaces_synced,
      ceo_name: ceo?.name || null,
    });
  } catch (e) {
    const status = /too long|required/i.test(e.message || '') ? 400 : 500;
    res.status(status).json({ error: e.message || String(e) });
  }
});

export default router;
