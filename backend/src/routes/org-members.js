/**
 * Org leaf members API — place external / published-A2A agents in the CEO org chart.
 * CEO-scoped: every read and write is filtered by the signed-in CEO's owner id.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  deleteOrgAgentMember,
  getOrgAgentMember,
  listOrgAgentMembers,
  upsertOrgAgentMember,
} from '../services/org-agent-members.js';
import { setAgentBudget } from '../services/agent-budgets.js';
import { syncOrgContextForCeo } from '../services/org-context.js';

const router = Router();

router.use(requireAuth, requireCeoOrAdmin);

/** GET /api/org-members — all leaf members for this CEO. */
router.get('/', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    res.json({ members: listOrgAgentMembers(ownerUserId) });
  } catch (e) {
    console.warn('[org-members] list failed:', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** POST /api/org-members — add / update an external or A2A agent as a leaf org member. */
router.post('/', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    const member = upsertOrgAgentMember(ownerUserId, req.body || {});
    if (req.body?.monthly_token_budget != null || req.body?.error_budget_pct != null) {
      try {
        setAgentBudget(ownerUserId, member.id, {
          monthly_token_budget: req.body.monthly_token_budget,
          error_budget_pct: req.body.error_budget_pct,
        });
      } catch (budgetErr) {
        console.warn('[org-members] budget setup failed', member.id, budgetErr?.message || budgetErr);
      }
    }
    try {
      await syncOrgContextForCeo(ownerUserId);
    } catch (syncErr) {
      console.warn('[org-members] org sync failed:', syncErr?.message || syncErr);
    }
    res.status(201).json({ member });
  } catch (e) {
    console.warn('[org-members] upsert failed:', e?.message || e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** DELETE /api/org-members/:id — remove a leaf member from the org chart. */
router.delete('/:id', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const existing = getOrgAgentMember(ownerUserId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Org member not found' });
    const out = deleteOrgAgentMember(ownerUserId, req.params.id);
    try {
      await syncOrgContextForCeo(ownerUserId);
    } catch (syncErr) {
      console.warn('[org-members] org sync failed:', syncErr?.message || syncErr);
    }
    res.json(out);
  } catch (e) {
    console.warn('[org-members] delete failed:', e?.message || e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

export default router;
