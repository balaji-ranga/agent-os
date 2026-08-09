/**
 * Settings → Tokens management: list/revoke external package tokens (owner-scoped).
 * Covers workflow desktop, IBKR bridge, and Browser Session package tokens.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  listExternalTokens,
  revokeExternalToken,
  TOKEN_KINDS,
  ISSUER_LABELS,
} from '../services/external-tokens.js';

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

/** GET /api/settings/external-tokens */
router.get('/', (req, res) => {
  try {
    const owner = ownerId(req, res);
    if (!owner) return;
    const { tokens, counts } = listExternalTokens(owner);
    res.json({
      tokens,
      counts,
      kinds: Object.values(TOKEN_KINDS),
      kind_labels: ISSUER_LABELS,
      owner_user_id: owner,
    });
  } catch (e) {
    console.warn('[external-tokens] list failed: %s', e.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * DELETE /api/settings/external-tokens/:kind/:id
 * kind: workflow_desktop | ibkr_bridge | browser_session
 */
router.delete('/:kind/:id', (req, res) => {
  try {
    const owner = ownerId(req, res);
    if (!owner) return;
    const result = revokeExternalToken(owner, {
      kind: req.params.kind,
      id: req.params.id,
    });
    res.json(result);
  } catch (e) {
    console.warn('[external-tokens] revoke failed: %s', e.message || e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

export default router;
