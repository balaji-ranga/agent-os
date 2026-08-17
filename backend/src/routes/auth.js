import { Router } from 'express';
import { getSessionRow, revokeSession } from '../services/auth/session.js';
import {
  authenticateUser,
  registerCeoUser,
  getUserById,
  updateUserProfile,
  listIndustries,
} from '../services/users.js';
import { listEntitledAgentsForActor, resolveRootOwnerUserId } from '../services/org-permissions.js';
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
  resendEmailOtp,
  getPlatformMfaDefaults,
  resolveUserMfa,
} from '../services/auth/mfa.js';
import {
  requestPasswordResetByEmail,
  consumePasswordResetToken,
  ensurePasswordResetTables,
} from '../services/password-reset.js';
import { getLlmCatalogPublic } from '../services/user-llm-settings.js';
import { getServerTimezone } from '../utils/format-datetime.js';
import { getLegalVersionsPublic } from '../services/legal-terms.js';

const router = Router();

router.use(attachAuthUser);

router.get('/industries', (_req, res) => {
  try {
    res.json({ industries: listIndustries() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Public legal document versions for register UI (and footer deep-links). */
router.get('/legal-versions', (_req, res) => {
  try {
    res.json(getLegalVersionsPublic());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Public LLM provider catalog (endpoints + curated models) for Profile / Register. */
router.get('/llm-catalog', (_req, res) => {
  try {
    res.json(getLlmCatalogPublic());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Public platform MFA defaults for registration UI. */
router.get('/mfa/defaults', (_req, res) => {
  res.json(getPlatformMfaDefaults());
});

router.post('/register', async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      country,
      region,
      mobile,
      db_mode,
      ceo_db_mode,
      mfa_policy,
      mfa_mode,
      llm_provider,
      llm_model,
      llm_api_key,
      industry,
      industry_other,
      business_name,
      accept_terms,
      terms_version,
      privacy_version,
    } = req.body || {};
    const user = await registerCeoUser({
      email,
      password,
      name,
      country,
      region,
      mobile,
      db_mode,
      ceo_db_mode,
      mfa_policy,
      mfa_mode,
      llm_provider,
      llm_model,
      llm_api_key,
      industry,
      industry_other,
      business_name,
      accept_terms,
      terms_version,
      privacy_version,
      require_terms_accept: true,
    });
    let openclaw = null;
    try {
      openclaw = await provisionCeoOpenClawAgents(user.id);
    } catch (e) {
      console.warn('[auth/register] OpenClaw provision:', e.message);
    }
    const loginResult = await finishLoginAfterPassword(user);
    res.status(201).json({
      ...loginResult,
      openclaw,
      message: 'CEO account created. Standard workspace agents granted and AgentSystem tenants provisioned.',
    });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    ensureMfaTables();
    const { email, password } = req.body || {};
    const user = authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.role !== 'ceo' && user.role !== 'org_user') {
      return res.status(403).json({ error: 'Use admin login for admin accounts' });
    }
    res.json(await finishLoginAfterPassword(user));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/admin/login', async (req, res) => {
  try {
    ensureMfaTables();
    const { email, password } = req.body || {};
    const user = authenticateUser(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Admin role required' });
    res.json(await finishLoginAfterPassword(user));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
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

/** Resend email OTP (MFA_MODE=EMAIL only). */
router.post('/mfa/resend', async (req, res) => {
  try {
    const { mfa_token } = req.body || {};
    if (!mfa_token) return res.status(400).json({ error: 'mfa_token required' });
    res.json(await resendEmailOtp({ mfa_token }));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** Forced MFA enrollment when AGENT_OS_REQUIRE_MFA is on (TOTP mode only). */
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
router.post('/mfa/setup', requireAuth, async (req, res) => {
  try {
    res.json(await beginMfaSetup(req.authUser.id));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
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

router.post('/mfa/disable', requireAuth, async (req, res) => {
  try {
    const { code } = req.body || {};
    res.json(await disableMfa(req.authUser.id, code));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/mfa/status', requireAuth, (req, res) => {
  try {
    const row = getUserMfa(req.authUser.id);
    const resolved = resolveUserMfa(row);
    res.json({
      mfa_enabled: resolved.enabled,
      mfa_policy: row?.mfa_policy || 'inherit',
      mfa_mode: row?.mfa_mode || null,
      effective_mfa_mode: resolved.mode,
      ...getPlatformMfaDefaults(),
    });
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
    const mfaRow = getUserMfa(req.authUser.id);
    const resolved = resolveUserMfa(mfaRow);
    const ownerId = resolveRootOwnerUserId(req.authUser) || (req.authUser.role === 'ceo' ? req.authUser.id : null);
    const agents = ownerId ? listEntitledAgentsForActor(req.authUser) : [];
    const payload = {
      user: req.authUser.impersonation ? { ...user, impersonation: req.authUser.impersonation } : user,
      agents,
      data_ceo_user_id: ownerId ? resolveCeoDataUserId(ownerId) : null,
      ceo_db_mode: ownerId ? getCeoDbModeForUser(ownerId) : null,
      uses_shared_db: ownerId ? !usesTenantCeoDb(ownerId) : null,
      uses_platform_db: ownerId && ownerId === getBalaCeoAuthId(),
      /** Platform default (PLATFORM_TIMEZONE); empty user.display_timezone falls back to this for UI. */
      platform_timezone: getServerTimezone(),
      mfa: {
        ...resolved,
        mfa_policy: mfaRow?.mfa_policy || 'inherit',
        mfa_mode: mfaRow?.mfa_mode || null,
      },
      mfa_enabled: resolved.enabled,
      mfa_mode: resolved.mode,
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
    const {
      name,
      email,
      country,
      region,
      mobile,
      role_title,
      display_timezone,
      current_password,
      new_password,
      mfa_policy,
      mfa_mode,
      llm_provider,
      llm_model,
      llm_api_key,
      clear_llm_api_key,
      industry,
      industry_other,
      business_name,
      data_retention_days,
      profile_image,
      clear_profile_image,
    } = req.body || {};
    const user = updateUserProfile(req.authUser.id, {
      name,
      email,
      country,
      region,
      mobile,
      role_title,
      display_timezone,
      current_password,
      new_password,
      mfa_policy,
      mfa_mode,
      llm_provider,
      llm_model,
      llm_api_key,
      clear_llm_api_key,
      industry,
      industry_other,
      business_name,
      data_retention_days,
      profile_image,
      clear_profile_image,
    });
    const mfaRow = getUserMfa(req.authUser.id);
    res.json({ user, mfa: resolveUserMfa(mfaRow), platform_timezone: getServerTimezone() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});



ensurePasswordResetTables();

/** Public: request password reset email (always generic response). */
router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!email) return res.status(400).json({ error: 'email required' });
    res.json(await requestPasswordResetByEmail(email));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Reset request failed' });
  }
});

/** Public: set new password with token from email link. */
router.post('/reset-password', (req, res) => {
  try {
    const token = req.body?.token;
    const password = req.body?.password || req.body?.new_password;
    res.json(consumePasswordResetToken(token, password));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Reset failed' });
  }
});
export default router;
