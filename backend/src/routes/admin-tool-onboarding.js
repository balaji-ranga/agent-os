/**
 * Admin Tools Onboarding — Docker-backed content tools.
 * Privileged ops require TOTP step-up. Agents/workflows use /api/tools/invoke only.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { issueAdminStepup, requireAdminStepup } from '../services/admin-stepup.js';
import {
  ensureDockerToolTables,
  dockerToolsStatus,
  listDockerTools,
  getDockerTool,
  declareDockerTool,
  pullDockerTool,
  deployDockerTool,
  stopDockerTool,
  restartDockerTool,
  deleteDockerTool,
  discoverDockerTools,
  healthDockerTool,
} from '../services/docker-tool-onboarding.js';

const router = Router();

function assertPureAdmin(req) {
  if (req.authUser?.role !== 'admin' || req.authUser?.impersonation) {
    const err = new Error('Platform admin session required (exit impersonation first)');
    err.status = 403;
    throw err;
  }
}

function stepupFrom(req) {
  return (
    req.headers['x-agent-os-stepup'] ||
    req.headers['x-stepup-token'] ||
    req.body?.stepup_token ||
    req.query?.stepup_token ||
    ''
  );
}

function requireStepup(req) {
  assertPureAdmin(req);
  requireAdminStepup({
    userId: req.authUser.id,
    role: req.authUser.role,
    impersonation: req.authUser.impersonation,
    token: stepupFrom(req),
  });
}

router.use(requireAuth, requireRole('admin'));

router.get('/status', async (req, res) => {
  try {
    assertPureAdmin(req);
    ensureDockerToolTables();
    res.json(await dockerToolsStatus());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/', (req, res) => {
  try {
    assertPureAdmin(req);
    res.json({ tools: listDockerTools() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/discover', async (req, res) => {
  try {
    assertPureAdmin(req);
    res.json({ containers: await discoverDockerTools() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:name', (req, res) => {
  try {
    assertPureAdmin(req);
    const tool = getDockerTool(req.params.name);
    if (!tool) return res.status(404).json({ error: 'Tool not found' });
    res.json({ tool });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/:name/health', async (req, res) => {
  try {
    assertPureAdmin(req);
    res.json(await healthDockerTool(req.params.name));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/stepup', (req, res) => {
  try {
    assertPureAdmin(req);
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'TOTP code required' });
    const out = issueAdminStepup({
      userId: req.authUser.id,
      role: req.authUser.role,
      impersonation: req.authUser.impersonation,
      code,
    });
    res.json(out);
  } catch (e) {
    console.warn('[tool-onboarding] stepup failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/', (req, res) => {
  try {
    requireStepup(req);
    const tool = declareDockerTool(req.body || {}, { createdBy: req.authUser.id });
    res.status(201).json({ tool });
  } catch (e) {
    console.warn('[tool-onboarding] declare failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/:name/pull', async (req, res) => {
  try {
    requireStepup(req);
    const tool = await pullDockerTool(req.params.name);
    res.json({ tool });
  } catch (e) {
    console.warn('[tool-onboarding] pull failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/:name/deploy', async (req, res) => {
  try {
    requireStepup(req);
    const tool = await deployDockerTool(req.params.name);
    res.json({ tool });
  } catch (e) {
    console.warn('[tool-onboarding] deploy failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/:name/stop', async (req, res) => {
  try {
    requireStepup(req);
    const tool = await stopDockerTool(req.params.name);
    res.json({ tool });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/:name/restart', async (req, res) => {
  try {
    requireStepup(req);
    const tool = await restartDockerTool(req.params.name);
    res.json({ tool });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/:name', async (req, res) => {
  try {
    requireStepup(req);
    const removeContentTool =
      req.query.remove_content_tool === '1' ||
      req.query.remove_content_tool === 'true' ||
      req.body?.remove_content_tool === true;
    const out = await deleteDockerTool(req.params.name, { removeContentTool });
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;