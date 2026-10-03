import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getConnectedConnectorApps, listConnectorActions } from '../services/openconnector.js';
import {
  TOOL_RISK_TIERS,
  TOOL_RISK_TYPES,
  clearToolRiskMappingOverride,
  listToolRiskMappings,
  setToolRiskMappingOverride,
} from '../services/tool-risk-mappings.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

function ownerId(req) {
  return resolveAuthenticatedCeoUserId(req, req.body || req.query || {});
}

/** GET /api/settings/tool-risk-mappings — authoritative tenant catalogue. */
router.get('/', async (req, res) => {
  try {
    const owner = ownerId(req);
    // Hydrate connected-app actions before reading the materialized catalogue.
    // One failed provider must not hide the already known mappings.
    try {
      const connected = await getConnectedConnectorApps(owner);
      for (const app of (connected.apps || []).filter((item) => item.connected)) {
        await listConnectorActions(owner, app.id);
      }
    } catch (_) {}
    const mappings = listToolRiskMappings(owner, {
      type: req.query?.type,
      query: req.query?.q || req.query?.query,
    });
    const counts = Object.fromEntries(TOOL_RISK_TIERS.map((tier) => [tier.id, 0]));
    for (const row of mappings) counts[row.risk_tier] = Number(counts[row.risk_tier] || 0) + 1;
    res.json({ owner_user_id: owner, tiers: TOOL_RISK_TIERS, types: TOOL_RISK_TYPES, counts, mappings });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

/** PUT /api/settings/tool-risk-mappings — save one owner-specific tier override. */
router.put('/', (req, res) => {
  try {
    res.json({ ok: true, mapping: setToolRiskMappingOverride(ownerId(req), req.body || {}) });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

/** POST /api/settings/tool-risk-mappings/reset — return one capability to interpreted default. */
router.post('/reset', (req, res) => {
  try {
    res.json({ ok: true, mapping: clearToolRiskMappingOverride(ownerId(req), req.body || {}) });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
});

export default router;
