/**
 * Admin TLS / Let's Encrypt cert status + refresh jobs.
 * Platform admin only; refresh requires TOTP step-up (purpose tls_certs).
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { issueAdminStepup, requireAdminStepup } from '../services/admin-stepup.js';
import {
  tlsCertsStepupPurpose,
  ensureTlsCertJobsTable,
  getTlsCertStatus,
  listTlsCertJobs,
  getTlsCertJob,
  startTlsCertRefresh,
} from '../services/tls-cert-admin.js';

const router = Router();
const PURPOSE = tlsCertsStepupPurpose();

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
    purpose: PURPOSE,
  });
}

router.use(requireAuth, requireRole('admin'));

router.get('/status', async (req, res) => {
  try {
    assertPureAdmin(req);
    ensureTlsCertJobsTable();
    res.json(await getTlsCertStatus());
  } catch (e) {
    console.warn('[tls-certs] status failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/jobs', (req, res) => {
  try {
    assertPureAdmin(req);
    res.json({ jobs: listTlsCertJobs({ limit: Number(req.query.limit) || 20 }) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/jobs/:id', (req, res) => {
  try {
    assertPureAdmin(req);
    const job = getTlsCertJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/stepup', async (req, res) => {
  try {
    assertPureAdmin(req);
    const { code, mfa_token } = req.body || {};
    if (!code) return res.status(400).json({ error: 'OTP code required' });
    const out = await issueAdminStepup({
      userId: req.authUser.id,
      role: req.authUser.role,
      impersonation: req.authUser.impersonation,
      code,
      mfaToken: mfa_token,
      purpose: PURPOSE,
    });
    res.json(out);
  } catch (e) {
    console.warn('[tls-certs] stepup failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    requireStepup(req);
    const scope = String(req.body?.scope || 'all').toLowerCase();
    const out = await startTlsCertRefresh({
      scope,
      startedBy: req.authUser.id,
    });
    res.status(202).json(out);
  } catch (e) {
    console.warn('[tls-certs] refresh start failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
