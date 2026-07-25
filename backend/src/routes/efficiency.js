/**
 * Efficiency View dashboard API.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getEfficiencySummary } from '../services/efficiency.js';
import {
  getAgentEfficiency,
  listEfficiencyMembers,
  requireEfficiencyMember,
} from '../services/agent-efficiency.js';
import { getMemberBudgetStatus, listAgentBudgets, setAgentBudget } from '../services/agent-budgets.js';

const router = Router();

router.use(requireAuth, requireCeoOrAdmin);

/**
 * GET /api/efficiency/summary?days=7|14|30|90|all
 */
router.get('/summary', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const days = req.query.days != null ? req.query.days : 14;
    const summary = getEfficiencySummary(ownerUserId, { days });
    res.json(summary);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/efficiency/agents — selectable org members with current-month budget state.
 */
router.get('/agents', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const members = listEfficiencyMembers(ownerUserId);
    res.json({ members, budgets: listAgentBudgets(ownerUserId) });
  } catch (e) {
    console.warn('[efficiency] agents list failed:', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/efficiency/agents/:memberKey?days=7|14|30|90|all
 */
router.get('/agents/:memberKey', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const days = req.query.days != null ? req.query.days : 30;
    const member = requireEfficiencyMember(ownerUserId, req.params.memberKey);
    res.json({ member, ...getAgentEfficiency(ownerUserId, member.member_key, { days }) });
  } catch (e) {
    console.warn('[efficiency] agent view failed:', req.params.memberKey, e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * PUT /api/efficiency/agents/:memberKey/budget — set monthly token + error budgets.
 */
router.put('/agents/:memberKey/budget', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    const member = requireEfficiencyMember(ownerUserId, req.params.memberKey);
    const budget = setAgentBudget(ownerUserId, member.member_key, {
      monthly_token_budget: req.body?.monthly_token_budget ?? null,
      error_budget_pct: req.body?.error_budget_pct ?? null,
      warn_token_pct: req.body?.warn_token_pct,
      warn_error_pct: req.body?.warn_error_pct,
    });
    res.json({ budget, status: getMemberBudgetStatus(ownerUserId, member.member_key) });
  } catch (e) {
    console.warn('[efficiency] budget update failed:', req.params.memberKey, e?.message || e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

export default router;
