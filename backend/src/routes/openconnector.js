/**
 * OpenConnector status API (entitled CEO/admin).
 */
import { Router } from 'express';
import { requireCeoOrAdmin } from '../middleware/auth.js';
import { getOpenConnectorStatus } from '../services/openconnector.js';

const router = Router();
router.use(requireCeoOrAdmin);

router.get('/status', (req, res) => {
  try {
    res.json(getOpenConnectorStatus(req.authUser));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
