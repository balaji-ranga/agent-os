import { Router } from 'express';
import {
  assertMessagingServiceRequest, listResolvedMessageSubscriptions, deliverWorkflowMessage,
} from '../services/workflow-messaging.js';

const router = Router();
router.use((req, res, next) => {
  try { assertMessagingServiceRequest(req); res.setHeader('Cache-Control', 'no-store'); next(); }
  catch (error) { res.status(error.status || 401).json({ ok: false, error: error.message }); }
});
router.get('/subscriptions', (_req, res) => res.json({ ok: true, subscriptions: listResolvedMessageSubscriptions() }));
router.post('/deliver', async (req, res) => {
  try { res.json(await deliverWorkflowMessage(req.body)); }
  catch (error) { res.status(error.status || 400).json({ ok: false, error: error.message }); }
});
export default router;
