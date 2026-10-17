import { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { copilotConnector } from '../services/digital-adoption-connector.js';
const router = Router();
router.post('/effect', async (req, res) => {
  const token = process.env.DIGITAL_ADOPTION_BRIDGE_TOKEN;
  if (!token || token.length < 40 || req.headers.origin || !timingSafeEqual(createHash('sha256').update(`Bearer ${token}`).digest(), createHash('sha256').update(req.headers.authorization || '').digest())) return res.status(403).json({
    allowed: false
  });
  try {
    return res.json({
      allowed: await copilotConnector().effect(req.body || {})
    });
  } catch {
    return res.json({
      allowed: false
    });
  }
});
router.use(requireAuth, requirePermission('workflows'));
router.get('/groups', async (req, res) => {
  try {
    res.json(await copilotConnector().discover(req.authUser.id));
  } catch (error) {
    res.status(error.status || 503).json({
      error: 'Copilot discovery unavailable'
    });
  }
});
router.post('/link', async (req, res) => {
  try {
    res.json(await copilotConnector().link(req.authUser.id, req.body || {}));
  } catch (error) {
    res.status(error.status || 403).json({
      error: 'Copilot linking rejected or expired'
    });
  }
});
export default router;
