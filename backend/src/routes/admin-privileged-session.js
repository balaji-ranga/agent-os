/**
 * Generic admin privileged-session HTTP API (OTP → 30-minute token).
 * Future privileged Admin pages should use these routes + requirePrivilegedSessionMw.
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  PRIVILEGED_PURPOSE,
  privilegedSessionStatus,
  startPrivilegedOtpChallenge,
  issuePrivilegedSession,
  privilegedTokenFromReq,
  normalizePrivilegedPurpose,
} from '../services/admin-privileged-session.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/', (req, res) => {
  try {
    res.json(
      privilegedSessionStatus({
        userId: req.authUser.id,
        role: req.authUser.role,
        impersonation: req.authUser.impersonation,
        token: privilegedTokenFromReq(req),
        purpose: normalizePrivilegedPurpose(req.query?.purpose, PRIVILEGED_PURPOSE.ADMIN),
      })
    );
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/challenge', async (req, res) => {
  try {
    const out = await startPrivilegedOtpChallenge({
      userId: req.authUser.id,
      role: req.authUser.role,
      impersonation: req.authUser.impersonation,
      purpose: req.body?.purpose,
    });
    res.json(out);
  } catch (e) {
    console.warn('[privileged-session] challenge failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { code, mfa_token, purpose } = req.body || {};
    const out = await issuePrivilegedSession({
      userId: req.authUser.id,
      role: req.authUser.role,
      impersonation: req.authUser.impersonation,
      code,
      mfaToken: mfa_token,
      purpose,
    });
    res.json(out);
  } catch (e) {
    console.warn('[privileged-session] verify failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
