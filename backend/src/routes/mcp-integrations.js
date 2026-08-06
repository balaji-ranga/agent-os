/**
 * MCP integration registry API + generic MCP OAuth routes.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';
import {
  listVisibleMcpServers,
  getMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  connectMcpServer,
  callMcpServerTool,
  listMcpCallLogs,
  listMcpServersForWorkflow,
} from '../services/mcp-servers.js';
import {
  listOauthConnectorsForUser,
  listOauthConfigsForAdmin,
  listOauthCandidateServers,
  listOauthProviderPresets,
  includeMcpForOauth,
  excludeMcpFromOauth,
  upsertOauthConfig,
  getOauthConfigPublic,
  startMcpOauth,
  disconnectMcpOauth,
  deleteOauthConfig,
  getOauthCallbackUrl,
  handleMcpOauthCallback,
} from '../services/mcp-oauth.js';

const router = Router();

/** Public OAuth callback (no session) — must stay before requireAuth. */
export async function mcpOauthCallbackHandler(req, res) {
  try {
    const result = await handleMcpOauthCallback({
      code: req.query.code,
      state: req.query.state,
      error: req.query.error,
      error_description: req.query.error_description,
    });
    res.status(result.status || 200).type('html').send(result.html);
  } catch (e) {
    console.error('[mcp-oauth] callback handler error', { error: e.message });
    res.status(500).type('html').send(`<p>OAuth error: ${String(e.message || 'failed')}</p>`);
  }
}

router.use(requireAuth);
router.use(requireCeoOrAdmin);

/** List OAuth-enabled MCPs + CEO connection status (Connectors → MCPs). */
router.get('/oauth/connectors', (req, res) => {
  try {
    const isPureAdmin = req.authUser?.role === 'admin' && !req.authUser?.impersonation;
    const candidates = listOauthCandidateServers(req.authUser);
    const presets = listOauthProviderPresets();
    if (isPureAdmin) {
      return res.json({
        // Admins manage inclusion; no personal Connect sessions unless impersonating CEO
        connectors: listOauthConnectorsForUser(req.authUser),
        configs: listOauthConfigsForAdmin(),
        candidates,
        provider_presets: presets,
        callback_url: getOauthCallbackUrl(),
        admin: true,
      });
    }
    res.json({
      connectors: listOauthConnectorsForUser(req.authUser),
      // CEOs can include OAuth for their own registry MCPs
      candidates: candidates.filter((c) => !c.is_platform || c.oauth_included || c.oauth_configured),
      provider_presets: presets,
      callback_url: getOauthCallbackUrl(),
      admin: false,
      can_include_own: true,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/oauth/configs', (req, res) => {
  try {
    if (req.authUser?.role !== 'admin' || req.authUser?.impersonation) {
      return res.status(403).json({ error: 'Admin only' });
    }
    res.json({
      configs: listOauthConfigsForAdmin(),
      candidates: listOauthCandidateServers(req.authUser),
      provider_presets: listOauthProviderPresets(),
      callback_url: getOauthCallbackUrl(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Include a registry MCP onto Connectors → MCPs (enables OAuth for that server_id). */
router.post('/oauth/include', (req, res) => {
  try {
    const body = req.body || {};
    const serverId = body.server_id || body.serverId;
    const cfg = includeMcpForOauth(serverId, body, req.authUser);
    console.info('[mcp-oauth] include', { server_id: serverId, by: req.authUser?.id, role: req.authUser?.role });
    res.json({ config: cfg, callback_url: getOauthCallbackUrl() });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** Soft-remove MCP from Connectors → MCPs tab (disables OAuth config). */
router.post('/oauth/exclude', (req, res) => {
  try {
    const serverId = req.body?.server_id || req.body?.serverId;
    res.json(excludeMcpFromOauth(serverId, req.authUser));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.put('/:id/oauth/config', (req, res) => {
  try {
    const cfg = upsertOauthConfig(req.params.id, req.body || {}, req.authUser);
    res.json({ config: cfg, callback_url: getOauthCallbackUrl() });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/:id/oauth/config', (req, res) => {
  try {
    const cfg = getOauthConfigPublic(req.params.id);
    if (!cfg) return res.status(404).json({ error: 'OAuth not configured for this MCP' });
    res.json({ config: cfg, callback_url: getOauthCallbackUrl() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/oauth/config', (req, res) => {
  try {
    res.json(deleteOauthConfig(req.params.id, req.authUser));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/:id/oauth/start', (req, res) => {
  try {
    const out = startMcpOauth(req.params.id, req.authUser);
    res.json(out);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete('/:id/oauth/connection', (req, res) => {
  try {
    res.json(disconnectMcpOauth(req.params.id, req.authUser));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/', (req, res) => {
  try {
    const forWorkflow = req.query.for_workflow === '1' || req.query.for_workflow === 'true';
    const servers = forWorkflow
      ? listMcpServersForWorkflow(req.authUser)
      : listVisibleMcpServers(req.authUser);
    res.json({ servers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', (req, res) => {
  try {
    const server = createMcpServer(req.authUser, req.body || {});
    res.status(201).json(server);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const server = getMcpServer(req.params.id, req.authUser);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });
    res.json(server);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const server = updateMcpServer(req.params.id, req.authUser, req.body || {});
    res.json(server);
  } catch (e) {
    res.status(e.message.includes('Not allowed') ? 403 : 400).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = deleteMcpServer(req.params.id, req.authUser);
    res.json(result);
  } catch (e) {
    res.status(e.message.includes('Not allowed') ? 403 : 400).json({ error: e.message });
  }
});

router.post('/:id/connect', async (req, res) => {
  try {
    const auth = req.body?.auth || null;
    const result = await connectMcpServer(req.params.id, req.authUser, auth);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/tools/:toolName/call', async (req, res) => {
  try {
    const auth = req.body?.auth || null;
    const result = await callMcpServerTool(
      req.params.id,
      req.params.toolName,
      req.body?.arguments || req.body?.args || {},
      req.authUser,
      auth
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id/logs', (req, res) => {
  try {
    const logs = listMcpCallLogs(req.params.id, req.authUser, Number(req.query.limit) || 20);
    res.json({ logs });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
