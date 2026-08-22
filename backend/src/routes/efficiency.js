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
import { getDepartmentEfficiency } from '../services/department-efficiency.js';
import { getUserEfficiency, getUsersEfficiencySummary } from '../services/user-efficiency.js';
import { getMemberBudgetStatus, listAgentBudgets, setAgentBudget } from '../services/agent-budgets.js';
import { resetTokenUsage, monthPeriod } from '../services/token-usage.js';
import { getLlmopsSummary } from '../services/llmops-summary.js';
import {
  getPriceBook,
  saveCeoPriceBook,
  addManualCostLine,
  deleteManualCostLine,
  listManualCostLines,
} from '../services/llmops-cost.js';
import { purgeOwnerRetention, RETENTION_DAY_OPTIONS, normalizeRetentionDays } from '../services/data-retention.js';
import { estimateOwnerStorage } from '../services/owner-storage.js';
import { updateUserProfile, getUserById } from '../services/users.js';

const router = Router();

router.use(requireAuth, requireCeoOrAdmin);

/**
 * GET /api/efficiency/summary?days=7|14|30|90|all
 */
router.get('/summary', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const days = req.query.days != null ? req.query.days : 14;
    const summary = await getEfficiencySummary(ownerUserId, { days });
    res.json(summary);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/efficiency/departments — month-to-date token budget vs used, by department.
 */
router.get('/departments', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    res.json(getDepartmentEfficiency(ownerUserId));
  } catch (e) {
    console.warn('[efficiency] departments failed:', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/users', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    res.json(getUsersEfficiencySummary(ownerUserId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/users/:userId', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const days = req.query.days != null ? req.query.days : 30;
    res.json(getUserEfficiency(ownerUserId, req.params.userId, { days }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/efficiency/llmops?days=7|14|30|90|all
 * Tokens, estimated $, traces, quality. Owner-scoped.
 */
router.get('/llmops', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const days = req.query.days != null ? req.query.days : 30;
    res.json(getLlmopsSummary(ownerUserId, { days }));
  } catch (e) {
    console.warn('[efficiency] llmops failed:', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/price-book', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    res.json(getPriceBook(ownerUserId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/price-book', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    res.json(saveCeoPriceBook(ownerUserId, req.body?.rows || []));
  } catch (e) {
    console.warn('[efficiency] price-book save failed:', e?.message || e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/cost-lines', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const period = req.query.period || monthPeriod();
    res.json({ period, lines: listManualCostLines(ownerUserId, { period }) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/cost-lines', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    const line = addManualCostLine(ownerUserId, {
      amount_usd: req.body?.amount_usd,
      note: req.body?.note,
      period: req.body?.period,
    });
    res.json({ ok: true, ...line });
  } catch (e) {
    console.warn('[efficiency] cost-line add failed:', e?.message || e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete('/cost-lines/:id', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    res.json(deleteManualCostLine(ownerUserId, req.params.id));
  } catch (e) {
    res.status(e.status || 404).json({ error: e.message });
  }
});

/**
 * POST /api/efficiency/usage/reset — zero month-to-date tokens for one member or all.
 * Body: { member_key?: string } — omit member_key to reset every agent for this CEO.
 */
router.post('/usage/reset', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    const rawKey = req.body?.member_key ?? req.body?.memberKey ?? null;
    const key = rawKey != null && String(rawKey).trim() ? String(rawKey).trim() : null;
    if (key) requireEfficiencyMember(ownerUserId, key);
    const period = req.body?.period || monthPeriod();
    const result = resetTokenUsage(ownerUserId, { memberKey: key, period });
    const status = key ? getMemberBudgetStatus(ownerUserId, key) : null;
    console.log(
      `[efficiency] usage reset owner=${ownerUserId} member=${key || '*'} deleted=${result.deleted_rows}`
    );
    res.json({ ...result, status });
  } catch (e) {
    console.warn('[efficiency] usage reset failed:', e?.message || e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

/**
 * GET /api/efficiency/storage — estimate data/storage consumed by this CEO (MB).
 * Includes owner-scoped OpenSearch Master Data RAG index store sizes.
 */
router.get('/storage', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const out = await estimateOwnerStorage(ownerUserId);
    res.json(out);
  } catch (e) {
    console.warn('[efficiency] storage failed:', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/efficiency/retention — current retention days + allowed options.
 */
router.get('/retention', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const user = getUserById(ownerUserId);
    res.json({
      data_retention_days: normalizeRetentionDays(user?.data_retention_days),
      options: RETENTION_DAY_OPTIONS,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * POST /api/efficiency/retention/purge — permanently delete aged chats / standup / workflow runs.
 * Body: { days?: number } — omit to use profile data_retention_days.
 */
router.post('/retention/purge', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    const days = req.body?.days != null ? req.body.days : null;
    const out = purgeOwnerRetention(ownerUserId, { days });
    console.log(`[efficiency] retention purge owner=${ownerUserId} days=${out.retention_days}`);
    res.json({ ok: true, ...out });
  } catch (e) {
    console.warn('[efficiency] retention purge failed:', e?.message || e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

/**
 * PUT /api/efficiency/retention — set data_retention_days on CEO profile.
 * Body: { data_retention_days: 30|60|90|120|365 }
 */
router.put('/retention', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    const days = normalizeRetentionDays(req.body?.data_retention_days ?? req.body?.days);
    const user = updateUserProfile(ownerUserId, { data_retention_days: days });
    res.json({
      ok: true,
      data_retention_days: user.data_retention_days,
      options: RETENTION_DAY_OPTIONS,
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
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
