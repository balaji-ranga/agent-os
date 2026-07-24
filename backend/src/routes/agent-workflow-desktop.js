/**
 * Desktop client API (token + IP whitelist) — mounted before CEO session middleware.
 */
import { Router } from 'express';
import {
  authenticateDesktopToken,
  clientIpFromRequest,
} from '../services/agent-workflow-desktop-auth.js';
import {
  startDesktopOrchestratedRun,
  reportDesktopStep,
  executeDesktopRemoteNode,
  completeDesktopRun,
} from '../services/agent-workflow-desktop-runtime.js';
import * as store from '../services/agent-workflow-store.js';

const router = Router();

function bearerFromReq(req) {
  const h = req.headers?.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h));
  if (m) return m[1].trim();
  return String(req.headers?.['x-desktop-token'] || '').trim() || null;
}

function requireDesktopAuth(req, res, next) {
  const token = bearerFromReq(req);
  const ip = clientIpFromRequest(req);
  const auth = authenticateDesktopToken(token, ip);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ ok: false, error: auth.error || 'Unauthorized' });
  }
  req.desktopAuth = auth.tokenRow;
  req.desktopClientIp = ip;
  req.authUser = {
    id: auth.tokenRow.owner_user_id,
    role: 'ceo',
    name: 'Desktop package',
  };
  next();
}

router.use(requireDesktopAuth);

router.post('/runs', async (req, res) => {
  try {
    const definitionId = req.desktopAuth.definition_id;
    const ownerUserId = req.desktopAuth.owner_user_id;
    const input = req.body?.input ?? req.body?.initial_input ?? '';
    const result = await startDesktopOrchestratedRun(definitionId, ownerUserId, {
      input,
      actor: { id: ownerUserId, name: 'Desktop', type: 'desktop' },
    });
    res.json({
      ok: true,
      run: result.run,
      trigger_node_id: result.trigger_node_id,
      context: result.context,
      client_ip: req.desktopClientIp,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/runs/:runId', (req, res) => {
  try {
    const run = store.getRun(Number(req.params.runId), req.desktopAuth.owner_user_id);
    if (!run || run.definition_id !== req.desktopAuth.definition_id) {
      return res.status(404).json({ ok: false, error: 'Run not found' });
    }
    res.json({ ok: true, run });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/runs/:runId/steps', (req, res) => {
  try {
    const runId = Number(req.params.runId);
    const run = store.getRun(runId, req.desktopAuth.owner_user_id);
    if (!run || run.definition_id !== req.desktopAuth.definition_id) {
      return res.status(404).json({ ok: false, error: 'Run not found' });
    }
    const result = reportDesktopStep(runId, req.desktopAuth.owner_user_id, req.body || {});
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/runs/:runId/execute-node', async (req, res) => {
  try {
    const runId = Number(req.params.runId);
    const run = store.getRun(runId, req.desktopAuth.owner_user_id);
    if (!run || run.definition_id !== req.desktopAuth.definition_id) {
      return res.status(404).json({ ok: false, error: 'Run not found' });
    }
    const nodeId = req.body?.node_id || req.body?.nodeId;
    if (!nodeId) return res.status(400).json({ ok: false, error: 'node_id required' });
    const result = await executeDesktopRemoteNode(runId, req.desktopAuth.owner_user_id, nodeId, {
      context_patch: req.body?.context_patch || null,
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/runs/:runId/complete', (req, res) => {
  try {
    const runId = Number(req.params.runId);
    const run = store.getRun(runId, req.desktopAuth.owner_user_id);
    if (!run || run.definition_id !== req.desktopAuth.definition_id) {
      return res.status(404).json({ ok: false, error: 'Run not found' });
    }
    const updated = completeDesktopRun(runId, req.desktopAuth.owner_user_id, {
      status: req.body?.status || 'completed',
      error_message: req.body?.error_message || null,
    });
    res.json({ ok: true, run: updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

export default router;
