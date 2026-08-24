import { Router } from 'express';
import { attachAuthUser, requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { buildRuntimeCapabilityRegistry, resolveRuntimeCapability } from '../services/runtime-capability-registry.js';

const router = Router();
router.use(attachAuthUser, requireAuth, requireCeoOrAdmin);
router.get('/', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req);
    if (!owner) return res.status(403).json({ error: 'CEO session required' });
    const query = String(req.query.q || '').trim();
    res.json(query ? resolveRuntimeCapability(owner, query) : { capabilities: buildRuntimeCapabilityRegistry(owner) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Capability registry failed' });
  }
});
export default router;
