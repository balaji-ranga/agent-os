/**
 * CEO common guardrails / policy — applied to all agents (POLICY.md) and Brain nodes.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  getCeoGuardrails,
  upsertCeoGuardrails,
  enrichPolicyTextWithAi,
} from '../services/ceo-guardrails.js';
import {
  createActionApprovalGrant,
  deleteActionPolicyOverride,
  getActionFamilyPolicies,
  listActionPolicyOverrides,
  upsertActionPolicyOverride,
  upsertActionFamilyPolicies,
} from '../services/action-policy.js';
import { syncOrgContextForCeo } from '../services/org-context.js';
import { getUserById } from '../services/users.js';
import { getExceptionPolicy, upsertExceptionPolicy } from '../services/exception-policy.js';

const router = Router();

router.get('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    res.json({
      guardrails: getCeoGuardrails(ceoUserId),
      action_control: getActionFamilyPolicies(ceoUserId),
      action_overrides: listActionPolicyOverrides(ceoUserId),
      exception_policy: getExceptionPolicy(ceoUserId),
    });
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

router.put('/exception-policy', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    res.json({ exception_policy: upsertExceptionPolicy(ceoUserId, req.body || {}) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
});

router.post('/enrich', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    const body = req.body || {};
    const draft = body.policy_text ?? body.policyText ?? body.draft ?? '';
    const companyContext = body.company_context || body.companyContext || '';
    const out = await enrichPolicyTextWithAi(ceoUserId, draft, { companyContext });
    res.json(out);
  } catch (e) {
    console.warn('[ceo-guardrails] enrich failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
});

router.put('/action-control', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    const policies = req.body?.policies || req.body?.action_control || [];
    const action_control = upsertActionFamilyPolicies(ceoUserId, policies);
    res.json({ action_control });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
});

router.post('/action-approval-grants', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    res.status(201).json({ approval_grant: createActionApprovalGrant(ceoUserId, req.body || {}) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
});

router.get('/action-overrides', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    res.json({ action_overrides: listActionPolicyOverrides(ceoUserId) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
});

router.put('/action-overrides', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    res.json({ action_override: upsertActionPolicyOverride(ceoUserId, req.body || {}) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
  }
});

router.delete('/action-overrides/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ceoUserId = resolveAuthenticatedCeoUserId(req);
    if (!ceoUserId) return res.status(403).json({ error: 'CEO context required' });
    const deleted = deleteActionPolicyOverride(ceoUserId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Override not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || String(e) });
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
      action_control: getActionFamilyPolicies(ceoUserId),
    });
  } catch (e) {
    const status = /too long|required/i.test(e.message || '') ? 400 : 500;
    res.status(status).json({ error: e.message || String(e) });
  }
});

export default router;
