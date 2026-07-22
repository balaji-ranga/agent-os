/**
 * OpenConnector status + connector facade APIs (entitled CEO/admin).
 */
import { Router } from 'express';
import {
  requireCeoOrAdmin,
  requireRole,
  resolveAuthenticatedCeoUserId,
} from '../middleware/auth.js';
import {
  deleteConnectorConnection,
  executeConnectorAction,
  getConnectedConnectorApps,
  getConnectorActionGuide,
  getConnectorConnectionsForUser,
  getConnectorProvider,
  getOpenConnectorLinkPublic,
  getOpenConnectorStatus,
  listConnectorActions,
  listOAuthClientConfigs,
  provisionOpenConnectorForUser,
  searchConnectorApps,
  startConnectorOAuth,
  upsertConnectorConnection,
  upsertOAuthClientConfig,
  upsertOpenConnectorLink,
} from '../services/openconnector.js';
import {
  createOcConsoleLaunchUrl,
  getOcConsolePublicUrl,
  getOpenConnectorPublicOrigin,
} from '../services/openconnector-console-proxy.js';

const router = Router();

router.get('/console-auth', (req, res) => {
  // Used by nginx auth_request if configured; cookie or admin bearer.
  if (req.authUser?.role === 'admin') return res.status(200).json({ ok: true });
  return res.status(401).json({ error: 'Admin required' });
});

router.post('/console-launch', requireRole('admin'), (req, res) => {
  try {
    const launch = createOcConsoleLaunchUrl(req.authUser, req.sessionToken);
    const secure = String(req.protocol || '').includes('https') || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie',
      `${launch.cookie.name}=${encodeURIComponent(launch.cookie.value)}; Path=/openconnector; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(launch.cookie.maxAgeMs / 1000)}${secure ? '; Secure' : ''}`
    );
    res.json({
      ok: true,
      url: launch.url,
      public_origin: getOpenConnectorPublicOrigin() || null,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Top-level navigation launch (sets cookie via redirect). */
router.get('/console', requireRole('admin'), (req, res) => {
  try {
    const launch = createOcConsoleLaunchUrl(req.authUser, req.sessionToken);
    const secure = String(req.protocol || '').includes('https') || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie',
      `${launch.cookie.name}=${encodeURIComponent(launch.cookie.value)}; Path=/openconnector; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(launch.cookie.maxAgeMs / 1000)}${secure ? '; Secure' : ''}`
    );
    res.redirect(302, launch.url);
  } catch (e) {
    res.status(400).send(e.message);
  }
});

router.use(requireCeoOrAdmin);

router.get('/status', (req, res) => {
  try {
    const status = getOpenConnectorStatus(req.authUser);
    status.public_origin = getOpenConnectorPublicOrigin() || status.env?.origin || null;
    status.console_url = req.authUser?.role === 'admin' ? getOcConsolePublicUrl() : null;
    res.json(status);
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
    const appIds = Array.isArray(req.body?.app_ids)
      ? req.body.app_ids
      : Array.isArray(req.body?.appIds)
        ? req.body.appIds
        : [];
    res.json(
      await provisionOpenConnectorForUser(
        { ...req.authUser, id: ownerUserId },
        { ensureConnections: req.body?.ensure_connections !== false, appIds }
      )
    );
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/connections', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query);
    res.json(await getConnectorConnectionsForUser(ownerUserId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/providers/:appId', async (req, res) => {
  try {
    res.json(await getConnectorProvider(req.params.appId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/connections/:appId/oauth/start', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body);
    res.json(await startConnectorOAuth(ownerUserId, req.params.appId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/connections/:appId', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body);
    res.json(await upsertConnectorConnection(ownerUserId, req.params.appId, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/connections/:appId', async (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query);
    res.json(await deleteConnectorConnection(ownerUserId, req.params.appId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/oauth/configs', requireRole('admin'), async (req, res) => {
  try {
    res.json(await listOAuthClientConfigs());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/oauth/configs/:appId', requireRole('admin'), async (req, res) => {
  try {
    res.json(await upsertOAuthClientConfig(req.params.appId, req.body || {}));
  } catch (e) {
    res.status(400).json({ error: e.message });
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
