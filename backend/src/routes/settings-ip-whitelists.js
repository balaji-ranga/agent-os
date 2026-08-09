/**
 * Central Settings: owner-scoped IP whitelist management.
 * CEO session; admin must impersonate (resolveAuthenticatedCeoUserId).
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { clientIpFromRequest } from '../services/ip-match.js';
import {
  IP_FEATURE_LIST,
  listOwnerIpWhitelists,
  addOwnerIpWhitelistEntry,
  updateOwnerIpWhitelistEntry,
  removeOwnerIpWhitelistEntry,
  getOwnerIpWhitelistEntry,
} from '../services/owner-ip-whitelist.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

function ownerId(req, res) {
  try {
    return resolveAuthenticatedCeoUserId(req, req.body || req.query || {});
  } catch (e) {
    res.status(e.status || 403).json({ error: e.message });
    return null;
  }
}

/** GET /api/settings/ip-whitelists */
router.get('/', (req, res) => {
  try {
    const owner = ownerId(req, res);
    if (!owner) return;
    const feature = req.query.feature ? String(req.query.feature).trim() : null;
    const definitionId =
      req.query.definition_id != null ? String(req.query.definition_id) : undefined;
    const publishId = req.query.publish_id != null ? String(req.query.publish_id) : undefined;
    const entries = listOwnerIpWhitelists(owner, {
      feature: feature || null,
      definitionId,
      publishId,
    });
    res.json({
      entries,
      features: IP_FEATURE_LIST,
      current_ip: clientIpFromRequest(req) || null,
      owner_user_id: owner,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** POST /api/settings/ip-whitelists */
router.post('/', (req, res) => {
  try {
    const owner = ownerId(req, res);
    if (!owner) return;
    const entry = addOwnerIpWhitelistEntry(owner, req.body || {});
    res.status(201).json({ entry, current_ip: clientIpFromRequest(req) || null });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** PUT /api/settings/ip-whitelists/:entryId */
router.put('/:entryId', (req, res) => {
  try {
    const owner = ownerId(req, res);
    if (!owner) return;
    const entry = updateOwnerIpWhitelistEntry(req.params.entryId, owner, req.body || {});
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry, current_ip: clientIpFromRequest(req) || null });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** DELETE /api/settings/ip-whitelists/:entryId */
router.delete('/:entryId', (req, res) => {
  try {
    const owner = ownerId(req, res);
    if (!owner) return;
    const ok = removeOwnerIpWhitelistEntry(req.params.entryId, owner);
    if (!ok) return res.status(404).json({ error: 'Entry not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** GET /api/settings/ip-whitelists/:entryId */
router.get('/:entryId', (req, res) => {
  try {
    const owner = ownerId(req, res);
    if (!owner) return;
    const entry = getOwnerIpWhitelistEntry(req.params.entryId, owner);
    if (!entry) return res.status(404).json({ error: 'Entry not found' });
    res.json({ entry, current_ip: clientIpFromRequest(req) || null });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;