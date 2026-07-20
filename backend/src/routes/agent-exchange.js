/**
 * AgentExchange — browse all published A2A workflow agents (union across users).
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';
import { listAllPublishedA2AAgents } from '../services/workflow-a2a-publish.js';

const router = Router();

router.use(requireAuth);
router.use(requireCeoOrAdmin);

router.get('/', (req, res) => {
  try {
    const agents = listAllPublishedA2AAgents();
    res.json({ agents, count: agents.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
