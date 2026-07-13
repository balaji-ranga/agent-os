import { Router } from 'express';
import { getSessionRow, revokeSession } from '../services/auth/session.js';
import {
  authenticateUser,
  registerCeoUser,
  getUserById,
  listAgentsForUser,
  updateUserProfile,
} from '../services/users.js';
import { resolveCeoDataUserId, getBalaCeoAuthId } from '../services/job-applicant-ceo.js';
import { getCeoDbModeForUser, usesTenantCeoDb } from '../db/ceo-db-config.js';
import { attachAuthUser, requireAuth, logout } from '../middleware/auth.js';
import { provisionCeoOpenClawAgents } from '../services/ceo-openclaw-provision.js';
import {
  ensureMfaTables,
  finishLoginAfterPassword,
  verifyMfaLogin,
  beginMfaSetup,
  confirmMfaSetup,
  mfaSetupChallengeStep,
  disableMfa,
  getUserMfa,
} from '../services/auth/mfa.js';

const router = Router();

router.use(attachAuthUser);

router.post('/register', (req, res) => {
  try {
    const { email, password, name, region, mobile, db_mode, ceo_db_mode } = req.body || {};
    const user = registerCeoUser({ email, password, name, region, mobile, db_mode, ceo_db_mode });
    let openclaw = null;
    try {
      openclaw = provisionCeoOpenClawAgents(user.id);
    } catch (e) {
      console.warn('[auth/register] OpenClaw provision:', e.message);
    }
    // Registration does not auto-issue a long-lived session when MFA is required —
    // finishLoginAfterPassword applies the same MFA gate as login.
    const loginResult = finishLoginAfterPassword(user);
    res.status(201).json({
      ...loginResult,
      openclaw,
      message: 'CEO account created. Standard workspace agents granted and OpenClaw tenants provisioned.',
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/login', (req, res) => {
  try {
    ensureMfaTables();
    const { email, password } = req.body || {};
    const user = authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.role !== 'ceo') return res.status(403).json({ error: 'Use admin login for admin accounts' });
    res.json(finishLoginAfterPassword(user));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/admin/login', (req, res) => {
  try {
    ensureMfaTables();
    const { email, password } = req.body || {};
    const user = authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
    res.json(finishLoginAfterPassword(user));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Complete MFA after password step (login challenge). */
router.post('/mfa/verify', (req, res) => {
  try {
    const { mfa_token, code } = req.body || {};
    if (!mfa_token || !code) return res.status(400).json({ error: 'mfa_token and code required' });
    res.json(verifyMfaLogin({ mfa_token, code }));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** Forced MFA enrollment when AGENT_OS_REQUIRE_MFA is on (no session yet). */
router.post('/mfa/setup-challenge', (req, res) => {
  try {
    const { mfa_token, code } = req.body || {};
    if (!mfa_token) return res.status(400).json({ error: 'mfa_token required' });
    res.json(mfaSetupChallengeStep({ mfa_token, code }));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** Authenticated MFA enrollment. */
router.post('/mfa/setup', requireAuth, (req, res) => {
  try {
    res.json(beginMfaSetup(req.authUser.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/mfa/enable', requireAuth, (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'code required' });
    res.json(confirmMfaSetup(req.authUser.id, code));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/mfa/disable', requireAuth, (req, res) => {
  try {
    const { code } = req.body || {};
    res.json(disableMfa(req.authUser.id, code));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/mfa/status', requireAuth, (req, res) => {
  try {
    const row = getUserMfa(req.authUser.id);
    res.json({ mfa_enabled: Number(row?.mfa_enabled) === 1 });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/logout', requireAuth, (req, res) => {
  logout(req, res);
});

router.post('/exit-impersonation', requireAuth, (req, res) => {
  try {
    const row = getSessionRow(req.sessionToken);
    if (!row?.impersonator_user_id) {
      return res.status(400).json({ error: 'Not viewing as another user' });
    }
    revokeSession(req.sessionToken);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  try {
    const user = getUserById(req.authUser.id);
    const mfa = getUserMfa(req.authUser.id);
    const payload = {
      user: req.authUser.impersonation ? { ...user, impersonation: req.authUser.impersonation } : user,
      agents: req.authUser.role === 'ceo' ? listAgentsForUser(req.authUser.id) : [],
      data_ceo_user_id: req.authUser.role === 'ceo' ? resolveCeoDataUserId(req.authUser.id) : null,
      ceo_db_mode: req.authUser.role === 'ceo' ? getCeoDbModeForUser(req.authUser.id) : null,
      uses_shared_db: req.authUser.role === 'ceo' ? !usesTenantCeoDb(req.authUser.id) : null,
      uses_platform_db: req.authUser.role === 'ceo' && req.authUser.id === getBalaCeoAuthId(),
      mfa_enabled: Number(mfa?.mfa_enabled) === 1,
    };
    if (req.authUser.impersonation) {
      payload.impersonation = req.authUser.impersonation;
    }
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/me', requireAuth, (req, res) => {
  try {
    const { name, email, region, mobile, current_password, new_password } = req.body || {};
    const user = updateUserProfile(req.authUser.id, {
      name,
      email,
      region,
      mobile,
      current_password,
      new_password,
    });
    res.json({ user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
