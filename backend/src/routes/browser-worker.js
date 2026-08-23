/**
 * Browser worker: CEO package/tokens/IP + worker v1 pull/register APIs.
 */
import { Router } from 'express';
import { requireCeoOrAdmin } from '../middleware/auth.js';
import { buildLocalBrowserWorkerPackageZip } from '../services/local-browser-worker-package.js';
import { buildFlolahChromeExtensionZip } from '../services/flolah-chrome-extension-package.js';
import {
  authenticateBrowserWorkerToken,
  clientIpFromRequest,
  listBrowserWorkerTokens,
  revokeBrowserWorkerToken,
  listBrowserWorkerIpWhitelist,
  addBrowserWorkerIpWhitelistEntry,
  removeBrowserWorkerIpWhitelistEntry,
  createBrowserExtensionPairingCode,
  consumeBrowserExtensionPairingCode,
} from '../services/browser-worker-auth.js';
import {
  touchBrowserWorkerNode,
  getBrowserWorkerNodeStatus,
  markBrowserWorkerOffline,
  pullBrowserWorkerJob,
  completeBrowserWorkerJob,
  listBrowserExecutorNodes,
} from '../services/browser-worker-dispatch.js';

const ceoRouter = Router();
const workerRouter = Router();
const extensionEnabled = () => process.env.BROWSER_EXTENSION_ENABLED !== '0';
const pairingAttempts = new Map();

function pairingRateLimitOk(ip, limit = 10, windowMs = 60_000) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const row = pairingAttempts.get(key);
  if (!row || now - row.startedAt >= windowMs) {
    pairingAttempts.set(key, { startedAt: now, count: 1 });
    return true;
  }
  row.count += 1;
  return row.count <= limit;
}

/** CEO session owner; admin must impersonate (header or query) for package scope. */
function ownerForCeoRoutes(req, res) {
  if (req.authUser?.role === 'ceo') return req.authUser.id;
  if (req.authUser?.role === 'admin') {
    const imp =
      req.headers?.['x-impersonate-ceo'] ||
      req.query?.ceo_user_id ||
      req.body?.ceo_user_id;
    if (imp) return String(imp).trim();
    res.status(403).json({
      error: 'Admin must impersonate a CEO (x-impersonate-ceo) to manage browser worker packages',
    });
    return null;
  }
  res.status(401).json({ error: 'Authentication required' });
  return null;
}

function requireWorkerAuth(req, res, next) {
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  const token = m ? m[1] : String(req.headers['x-browser-worker-token'] || '').trim();
  const ip = clientIpFromRequest(req);
  const result = authenticateBrowserWorkerToken(token, ip);
  if (!result.ok) {
    return res.status(result.status || 401).json({ error: result.error || 'Unauthorized' });
  }
  req.browserWorker = {
    tokenRow: result.tokenRow,
    ownerUserId: result.tokenRow.owner_user_id,
    clientIp: ip,
  };
  next();
}

// ── CEO / admin (session) ─────────────────────────────────────────────

ceoRouter.use(requireCeoOrAdmin);

ceoRouter.get('/package', async (req, res) => {
  try {
    const ownerUserId = ownerForCeoRoutes(req, res);
    if (!ownerUserId) return;

    const includeRuntimeRaw = String(req.query.include_runtime ?? req.query.with_runtime ?? '1').toLowerCase();
    const includeRuntime = !['0', 'false', 'no', 'lite'].includes(includeRuntimeRaw);

    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const fromReq = host ? `${proto}://${host}` : null;

    const { zip, filename, token_prefix, token_id } = await buildLocalBrowserWorkerPackageZip({
      ownerUserId,
      includeRuntime,
      baseUrlOverride: fromReq,
    });

    console.info(
      '[browser-worker] package download owner=%s prefix=%s runtime=%s bytes=%s',
      ownerUserId,
      token_prefix,
      includeRuntime ? '1' : '0',
      zip.length
    );

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Browser-Worker-Token-Prefix', token_prefix);
    res.setHeader('X-Browser-Worker-Token-Id', token_id);
    res.setHeader('X-Browser-Worker-Include-Runtime', includeRuntime ? '1' : '0');
    res.send(zip);
  } catch (e) {
    console.warn('[browser-worker] package failed: %s', e.message || e);
    res.status(400).json({ error: e.message || 'Failed to build package' });
  }
});

ceoRouter.get('/extension/package', async (req, res) => {
  try {
    if (!extensionEnabled()) return res.status(404).json({ error: 'Flolah Chrome extension is disabled' });
    const ownerUserId = ownerForCeoRoutes(req, res);
    if (!ownerUserId) return;
    const { zip, filename } = await buildFlolahChromeExtensionZip();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(zip);
  } catch (e) {
    res.status(400).json({ error: e.message || 'Failed to build extension package' });
  }
});

ceoRouter.get('/status', (req, res) => {
  try {
    const ownerUserId = ownerForCeoRoutes(req, res);
    if (!ownerUserId) return;
    const node = getBrowserWorkerNodeStatus(ownerUserId);
    res.json({
      ok: true,
      worker: node,
      nodes: listBrowserExecutorNodes(ownerUserId),
      tokens: listBrowserWorkerTokens(ownerUserId),
      ip_whitelist: listBrowserWorkerIpWhitelist(ownerUserId),
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'status failed' });
  }
});

ceoRouter.post('/extension/pairing-code', (req, res) => {
  try {
    if (!extensionEnabled()) return res.status(404).json({ error: 'Flolah Chrome extension is disabled' });
    const ownerUserId = ownerForCeoRoutes(req, res);
    if (!ownerUserId) return;
    res.status(201).json(createBrowserExtensionPairingCode(ownerUserId));
  } catch (e) {
    res.status(400).json({ error: e.message || 'pairing code failed' });
  }
});

ceoRouter.get('/tokens', (req, res) => {
  try {
    const ownerUserId = ownerForCeoRoutes(req, res);
    if (!ownerUserId) return;
    res.json({ tokens: listBrowserWorkerTokens(ownerUserId) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

ceoRouter.delete('/tokens/:tokenId', (req, res) => {
  try {
    const ownerUserId = ownerForCeoRoutes(req, res);
    if (!ownerUserId) return;
    const ok = revokeBrowserWorkerToken(req.params.tokenId, ownerUserId);
    if (!ok) return res.status(404).json({ error: 'Token not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

ceoRouter.get('/ip-whitelist', (req, res) => {
  try {
    const ownerUserId = ownerForCeoRoutes(req, res);
    if (!ownerUserId) return;
    res.json({ entries: listBrowserWorkerIpWhitelist(ownerUserId) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

ceoRouter.post('/ip-whitelist', (req, res) => {
  try {
    const ownerUserId = ownerForCeoRoutes(req, res);
    if (!ownerUserId) return;
    const entry = addBrowserWorkerIpWhitelistEntry(ownerUserId, {
      cidrOrIp: req.body?.cidr_or_ip || req.body?.cidrOrIp || req.body?.ip,
      label: req.body?.label,
    });
    res.status(201).json({ entry });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

ceoRouter.delete('/ip-whitelist/:entryId', (req, res) => {
  try {
    const ownerUserId = ownerForCeoRoutes(req, res);
    if (!ownerUserId) return;
    const ok = removeBrowserWorkerIpWhitelistEntry(req.params.entryId, ownerUserId);
    if (!ok) return res.status(404).json({ error: 'Entry not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Worker client (token) ─────────────────────────────────────────────

/** Public one-time exchange. Owner is derived only from the hashed pairing row. */
workerRouter.post('/pair', (req, res) => {
  try {
    if (!extensionEnabled()) return res.status(404).json({ error: 'Flolah Chrome extension is disabled' });
    if (!pairingRateLimitOk(clientIpFromRequest(req))) {
      res.setHeader('Retry-After', '60');
      return res.status(429).json({ error: 'Too many pairing attempts; retry in one minute' });
    }
    const out = consumeBrowserExtensionPairingCode(req.body?.code, {
      deviceName: req.body?.device_name || req.body?.deviceName,
    });
    if (!out.ok) return res.status(out.status || 400).json({ error: out.error });
    res.status(201).json({
      ok: true,
      token: out.token,
      token_id: out.id,
      token_prefix: out.token_prefix,
      expires_at: out.expires_at,
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'pairing failed' });
  }
});

workerRouter.use(requireWorkerAuth);

workerRouter.post('/register', (req, res) => {
  try {
    const { ownerUserId, tokenRow, clientIp } = req.browserWorker;
    const node = touchBrowserWorkerNode(ownerUserId, {
      nodeId: req.body?.node_id || req.body?.nodeId,
      tokenId: tokenRow.id,
      deviceName: req.body?.device_name || req.body?.deviceName,
      workerVersion: req.body?.worker_version || req.body?.workerVersion,
      browserVersion: req.body?.browser_version || req.body?.browserVersion,
      driverMode: req.body?.driver_mode || req.body?.driverMode || 'playwright',
      protocolVersion: req.body?.protocol_version || req.body?.protocolVersion || 1,
      capabilities: req.body?.capabilities || {},
      clientIp,
    });
    console.info(
      '[browser-worker] register owner=%s ip=%s version=%s',
      ownerUserId,
      clientIp || 'n/a',
      node.worker_version || ''
    );
    res.json({ ok: true, worker: node });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

workerRouter.post('/heartbeat', (req, res) => {
  try {
    const { ownerUserId, tokenRow, clientIp } = req.browserWorker;
    const node = touchBrowserWorkerNode(ownerUserId, {
      nodeId: req.body?.node_id || req.body?.nodeId,
      tokenId: tokenRow.id,
      deviceName: req.body?.device_name || req.body?.deviceName,
      workerVersion: req.body?.worker_version || req.body?.workerVersion,
      browserVersion: req.body?.browser_version || req.body?.browserVersion,
      driverMode: req.body?.driver_mode || req.body?.driverMode || 'playwright',
      protocolVersion: req.body?.protocol_version || req.body?.protocolVersion || 1,
      capabilities: req.body?.capabilities,
      clientIp,
    });
    res.json({ ok: true, worker: node });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

workerRouter.post('/offline', (req, res) => {
  try {
    const { ownerUserId } = req.browserWorker;
    markBrowserWorkerOffline(ownerUserId, req.body?.node_id || req.body?.nodeId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

workerRouter.get('/jobs', async (req, res) => {
  try {
    const { ownerUserId } = req.browserWorker;
    // refresh heartbeat on poll
    touchBrowserWorkerNode(ownerUserId, {
      nodeId: req.query.node_id || req.query.nodeId,
      tokenId: req.browserWorker.tokenRow.id,
      clientIp: req.browserWorker.clientIp,
      workerVersion: req.query.worker_version,
      driverMode: req.query.driver_mode || 'playwright',
      protocolVersion: req.query.protocol_version || 1,
    });
    const waitMs = Math.min(55_000, Math.max(0, Number(req.query.wait_ms || req.query.waitMs) || 0));
    const nodeId = req.query.node_id || req.query.nodeId || `legacy-${ownerUserId}`;
    const job = await pullBrowserWorkerJob(ownerUserId, nodeId, waitMs);
    res.json({ ok: true, job });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

workerRouter.post('/jobs/:jobId/result', (req, res) => {
  try {
    const { ownerUserId } = req.browserWorker;
    const ok = req.body?.ok !== false && !req.body?.error;
    const nodeId = req.body?.node_id || req.body?.nodeId || `legacy-${ownerUserId}`;
    const out = completeBrowserWorkerJob(ownerUserId, nodeId, req.params.jobId, {
      ok,
      result: req.body?.result,
      error: req.body?.error || (!ok ? 'failed' : null),
      failureCode: req.body?.failure_code || req.body?.failureCode,
      resultState: req.body?.result_state || req.body?.resultState,
    });
    if (!out.ok) return res.status(404).json(out);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export { ceoRouter as browserWorkerCeoRoutes, workerRouter as browserWorkerV1Routes };
export default ceoRouter;
