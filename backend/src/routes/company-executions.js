import { Router } from 'express';
import { attachAuthUser, requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { listCompanyExecutions } from '../services/company-executions.js';

const router = Router();
router.use(attachAuthUser, requireAuth, requireCeoOrAdmin);
router.get('/', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req);
    if (!owner) return res.status(403).json({ error: 'CEO session required' });
    res.json(listCompanyExecutions(owner, {
      limit: req.query.limit,
      page: req.query.page,
      pageSize: req.query.page_size,
      from: req.query.from,
      to: req.query.to,
    }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Failed to list company executions' });
  }
});
export default router;
