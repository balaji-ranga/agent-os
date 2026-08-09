/**
 * UI preferences: nav menu visibility (owner-scoped).
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getUiNavHidden, setUiNavHidden, NAV_ALWAYS_VISIBLE } from '../services/ui-nav-prefs.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

router.get('/nav', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    res.json({
      hidden: getUiNavHidden(owner),
      always_visible: [...NAV_ALWAYS_VISIBLE],
      owner_user_id: owner,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/nav', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    const hidden = setUiNavHidden(owner, req.body?.hidden ?? req.body?.ui_nav_hidden);
    res.json({
      ok: true,
      hidden,
      always_visible: [...NAV_ALWAYS_VISIBLE],
      owner_user_id: owner,
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

export default router;
