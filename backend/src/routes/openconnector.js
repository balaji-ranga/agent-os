/**
 * OpenConnector status + connector facade APIs (entitled CEO/admin).
 */
import { Router } from 'express';
import { requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  executeConnectorAction,
  getConnectedConnectorApps,
  getConnectorActionGuide,
  getOpenConnectorLinkPublic,
  getOpenConnectorStatus,
  listConnectorActions,
  provisionOpenConnectorForUser,
  searchConnectorApps,
  upsertOpenConnectorLink,
} from '../services/openconnector.js';

const router = Router();
router.use(requireCeoOrAdmin);

router.get('/status', (req, res) => {
  try {
    res.json(getOpenConnectorStatus(req.authUser));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/link', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query);
    res.json(getOpenConnectorLinkPublic(ownerUserId));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/link', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body);
    res.json(upsertOpenConnectorLink(ownerUserId, req.body || {}));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/provision', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body);
    if (req.authUser?.role !== 'admin' && req.authUser?.id !== ownerUserId) {
      return res.status(403).json({ error: 'Not allowed to provision another CEO link' });
    }
    res.json(await provisionOpenConnectorForUser({ ...req.authUser, id: ownerUserId }));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/apps', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query);
    res.json(await getConnectedConnectorApps(ownerUserId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/apps/search', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query);
    res.json(await searchConnectorApps(ownerUserId, req.query.q || req.query.query || ''));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/apps/:appId/actions', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query);
    res.json(await listConnectorActions(ownerUserId, req.params.appId, req.query.q || req.query.query || ''));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/actions/:actionId/guide', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query);
    res.json(await getConnectorActionGuide(ownerUserId, req.params.actionId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/actions/:actionId/execute', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body);
    res.json(
      await executeConnectorAction(
        ownerUserId,
        req.params.actionId,
        req.body?.input && typeof req.body.input === 'object' ? req.body.input : {},
        { connectionName: req.body?.connection_name || req.body?.connectionName || '' }
      )
    );
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
