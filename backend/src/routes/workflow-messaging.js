import { Router } from 'express';
import { requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  listMessagingConnections, getMessagingConnection, saveMessagingConnection,
  deleteMessagingConnection, testMessagingConnection,
} from '../services/workflow-messaging.js';

const router = Router();
router.use(requireCeoOrAdmin);

router.get('/', (req, res) => {
  try { res.json({ ok: true, connections: listMessagingConnections(resolveAuthenticatedCeoUserId(req)) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, error: error.message }); }
});
router.get('/:id', (req, res) => {
  try {
    const connection = getMessagingConnection(resolveAuthenticatedCeoUserId(req), req.params.id);
    if (!connection) return res.status(404).json({ ok: false, error: 'Messaging connection not found' });
    res.json({ ok: true, connection });
  } catch (error) { res.status(error.status || 400).json({ ok: false, error: error.message }); }
});
router.post('/', (req, res) => {
  try { res.status(201).json({ ok: true, connection: saveMessagingConnection(resolveAuthenticatedCeoUserId(req), req.body) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, error: error.message }); }
});
router.put('/:id', (req, res) => {
  try { res.json({ ok: true, connection: saveMessagingConnection(resolveAuthenticatedCeoUserId(req), req.body, req.params.id) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, error: error.message }); }
});
router.delete('/:id', (req, res) => {
  try { res.json({ ok: true, ...deleteMessagingConnection(resolveAuthenticatedCeoUserId(req), req.params.id) }); }
  catch (error) { res.status(error.status || 400).json({ ok: false, error: error.message }); }
});
router.post('/:id/test', async (req, res) => {
  try { res.json(await testMessagingConnection(resolveAuthenticatedCeoUserId(req), req.params.id)); }
  catch (error) { res.status(error.status || 400).json({ ok: false, error: error.message }); }
});

export default router;
