import { Router } from 'express';
import { ingestProductivityEvent } from '../services/event-productivity.js';

const router = Router();
router.post('/:subscriptionId', async (req, res) => {
  try {
    const secret = req.headers['x-flolah-event-secret'] || req.headers['x-webhook-secret'];
    const result = await ingestProductivityEvent(req.params.subscriptionId, secret, req.body || {});
    res.status(result.ignored ? 202 : 200).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || String(error) });
  }
});
export default router;
