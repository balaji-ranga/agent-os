/**
 * MFA — EMAIL OTP (default) or TOTP authenticator (MFA_MODE=TOTP).
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { getDb } from '../../db/schema.js';
import { generateTotpSecret, verifyTotp, totpOtpauthUrl } from './totp.js';
import { createSession } from './session.js';
import { sendSmtpMail, smtpFromEnv } from '../agent-workflow-tasks.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function getMfaMode() {
  const raw = String(process.env.MFA_MODE || process.env.AGENT_OS_MFA_MODE || 'EMAIL')
    .trim()
    .toUpperCase();
  return raw === 'TOTP' ? 'TOTP' : 'EMAIL';
}

export function requireMfaEnv() {
  if (process.env.AGENT_OS_DISABLE_MFA === '1' || process.env.AGENT_OS_DISABLE_MFA === 'true') {
    return false;
  }
  const v = String(process.env.AGENT_OS_REQUIRE_MFA ?? '').trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'on') return true;
  // Unset: EMAIL OTP on by default; TOTP stays opt-in at platform level
  return getMfaMode() === 'EMAIL';
}

export function normalizeMfaPolicy(raw) {
  const v = String(raw ?? 'inherit').trim().toLowerCase();
  if (v === 'on' || v === '1' || v === 'true' || v === 'enabled') return 'on';
  if (v === 'off' || v === '0' || v === 'false' || v === 'disabled') return 'off';
  return 'inherit';
}

export function normalizeMfaMode(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  if (v === 'EMAIL' || v === 'TOTP') return v;
  return null; // inherit platform
}

/** Platform defaults from .env (for registration / profile UI). */
export function getPlatformMfaDefaults() {
  return {
    platform_require_mfa: requireMfaEnv(),
    platform_mfa_mode: getMfaMode(),
    disable_mfa: process.env.AGENT_OS_DISABLE_MFA === '1' || process.env.AGENT_OS_DISABLE_MFA === 'true',
  };
}

/**
 * Resolve effective MFA for a user.
 * - mfa_policy: inherit | on | off (overrides AGENT_OS_REQUIRE_MFA when not inherit)
 * - mfa_mode: EMAIL | TOTP | null (null/empty inherits MFA_MODE env)
 */
export function resolveUserMfa(row) {
  const platform = getPlatformMfaDefaults();
  if (platform.disable_mfa) {
    return {
      enabled: false,
      mode: platform.platform_mfa_mode,
      policy: 'off',
      ...platform,
    };
  }
  const policy = normalizeMfaPolicy(row?.mfa_policy);
  let enabled;
  if (policy === 'on') enabled = true;
  else if (policy === 'off') enabled = false;
  else enabled = platform.platform_require_mfa;

  const mode = normalizeMfaMode(row?.mfa_mode) || platform.platform_mfa_mode;
  return {
    enabled,
    mode,
    policy,
    user_mfa_mode: normalizeMfaMode(row?.mfa_mode),
    ...platform,
  };
}

function userNeedsMfa(row) {
  const resolved = resolveUserMfa(row);
  if (!resolved.enabled) return false;
  if (resolved.mode === 'TOTP') {
    // TOTP needs enrolled secret unless we're about to force setup
    return true;
  }
  return true;
}


export function ensureMfaTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mfa_challenges (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  try {
    db.exec(`ALTER TABLE platform_users ADD COLUMN mfa_enabled INTEGER DEFAULT 0`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE platform_users ADD COLUMN mfa_secret TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE platform_users ADD COLUMN mfa_pending_secret TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE mfa_challenges ADD COLUMN code_hash TEXT`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE platform_users ADD COLUMN mfa_policy TEXT DEFAULT 'inherit'`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE platform_users ADD COLUMN mfa_mode TEXT`);
  } catch (_) {}
  try {
    // Backfill: previously opted-in users
    db.prepare(
      `UPDATE platform_users SET mfa_policy = 'on' WHERE COALESCE(mfa_enabled, 0) = 1 AND (mfa_policy IS NULL OR mfa_policy = '' OR mfa_policy = 'inherit')`
    ).run();
  } catch (_) {}
}

function purgeExpired() {
  getDb()
    .prepare(`DELETE FROM mfa_challenges WHERE expires_at < datetime('now')`)
    .run();
}

function hashOtp(code) {
  const pepper = process.env.AGENT_OS_INTERNAL_TOKEN || process.env.AGENT_OS_MFA_PEPPER || 'agent-os-mfa';
  return createHash('sha256').update(`${String(code)}:${pepper}`).digest('hex');
}

function safeEqualHex(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

function generateEmailOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 1) return '***';
  return `${s[0]}***${s.slice(at)}`;
}

export function createMfaChallenge(userId, purpose = 'login', { codeHash = null } = {}) {
  ensureMfaTables();
  purgeExpired();
  const token = randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  getDb()
    .prepare(
      `INSERT INTO mfa_challenges (token, user_id, purpose, expires_at, code_hash) VALUES (?, ?, ?, ?, ?)`
    )
    .run(token, userId, purpose, expires, codeHash);
  return { mfa_token: token, expires_at: expires };
}

export function peekMfaChallenge(token, purpose = null) {
  ensureMfaTables();
  purgeExpired();
  const row = getDb().prepare(`SELECT * FROM mfa_challenges WHERE token = ?`).get(token);
  if (!row) return null;
  if (purpose && row.purpose !== purpose) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare(`DELETE FROM mfa_challenges WHERE token = ?`).run(token);
    return null;
  }
  return row;
}

export function consumeMfaChallenge(token, purpose = null) {
  const row = peekMfaChallenge(token, purpose);
  if (!row) return null;
  getDb().prepare(`DELETE FROM mfa_challenges WHERE token = ?`).run(token);
  return row;
}

export function getUserMfa(userId) {
  ensureMfaTables();
  return getDb()
    .prepare(
      `SELECT id, email, role, name, mfa_enabled, mfa_secret, mfa_pending_secret, mfa_policy, mfa_mode
       FROM platform_users WHERE id = ?`
    )
    .get(userId);
}

/** Persist user MFA policy/mode; keeps mfa_enabled in sync for legacy readers. */
export function updateUserMfaSettings(userId, { mfa_policy, mfa_mode } = {}) {
  ensureMfaTables();
  const row = getUserMfa(userId);
  if (!row) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const policy =
    mfa_policy !== undefined ? normalizeMfaPolicy(mfa_policy) : normalizeMfaPolicy(row.mfa_policy);
  let modeCol = row.mfa_mode;
  if (mfa_mode !== undefined) {
    const normalized = String(mfa_mode).trim().toLowerCase();
    modeCol =
      normalized === '' || normalized === 'inherit' || normalized === 'platform'
        ? null
        : normalizeMfaMode(mfa_mode);
    if (normalized && normalized !== 'inherit' && normalized !== 'platform' && !modeCol) {
      const err = new Error('mfa_mode must be EMAIL, TOTP, or inherit');
      err.status = 400;
      throw err;
    }
  }
  const enabledFlag = policy === 'on' ? 1 : 0;
  getDb()
    .prepare(
      `UPDATE platform_users
       SET mfa_policy = ?, mfa_mode = ?, mfa_enabled = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(policy, modeCol, enabledFlag, userId);
  const updated = getUserMfa(userId);
  return {
    ...resolveUserMfa(updated),
    mfa_policy: policy,
    mfa_mode: modeCol,
    mfa_enabled: enabledFlag === 1,
  };
}

export function maskUserEmail(email) {
  return maskEmail(email);
}

export function newEmailOtp() {
  const code = generateEmailOtp();
  return { code, codeHash: hashOtp(code) };
}

export function emailOtpMatches(code, codeHash) {
  const codeStr = String(code || '').replace(/\s/g, '');
  if (!codeHash || !codeStr) return false;
  return safeEqualHex(codeHash, hashOtp(codeStr));
}

/**
 * Send a 6-digit OTP email (login or privileged admin actions).
 * Does not log the code.
 */
export async function sendUserOtpEmail(user, code, { subject, intro, expiresMinutes = 5 } = {}) {
  const smtp = smtpFromEnv();
  const subj = subject || 'Your Agent OS login code';
  const lead = intro || 'Your Agent OS verification code is';
  const mins = Math.max(1, Number(expiresMinutes) || 5);
  const body =
    `${lead}: ${code}\n\n` +
    `It expires in ${mins} minute${mins === 1 ? '' : 's'}. If you did not request this, ignore this email.\n`;
  const result = await sendSmtpMail({
    ...smtp,
    to: user.email,
    subject: subj,
    body,
  });
  if (!result.sent) {
    const err = new Error(result.error || 'Failed to send MFA email (check WORKFLOW_SMTP_* settings)');
    err.status = 503;
    throw err;
  }
  return result;
}

async function sendLoginOtpEmail(user, code) {
  return sendUserOtpEmail(user, code, {
    subject: 'Your Agent OS login code',
    intro: 'Your Agent OS verification code is',
    expiresMinutes: 5,
  });
}

/**
 * After password success: issue session, or MFA challenge (email OTP / TOTP).
 */
export async function finishLoginAfterPassword(user) {
  ensureMfaTables();
  const row = getUserMfa(user.id);
  const resolved = resolveUserMfa(row);
  const mode = resolved.mode;

  if (!resolved.enabled) {
    const session = createSession(user.id);
    return { user, session, mfa_mode: mode, mfa: resolved };
  }

  if (mode === 'TOTP') {
    const mfaOn = !!row?.mfa_secret;
    if (mfaOn) {
      const challenge = createMfaChallenge(user.id, 'login');
      return {
        mfa_required: true,
        mfa_mode: 'TOTP',
        mfa_token: challenge.mfa_token,
        expires_at: challenge.expires_at,
        user: { id: user.id, email: user.email, role: user.role, name: user.name },
        mfa: resolved,
      };
    }
    const { secret, otpauth_url } = ensureTotpPendingSecret(row || user);
    const challenge = createMfaChallenge(user.id, 'setup');
    console.info('[mfa] TOTP first-login enrollment required user_id=%s', user.id);
    return {
      mfa_setup_required: true,
      mfa_mode: 'TOTP',
      mfa_token: challenge.mfa_token,
      expires_at: challenge.expires_at,
      secret,
      otpauth_url,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
      message: 'Scan the QR code or enter the security key in your authenticator, then enter the 6-digit code',
      mfa: resolved,
    };
  }

  // EMAIL mode
  const code = generateEmailOtp();
  const challenge = createMfaChallenge(user.id, 'login', { codeHash: hashOtp(code) });
  await sendLoginOtpEmail(user, code);
  return {
    mfa_required: true,
    mfa_mode: 'EMAIL',
    mfa_token: challenge.mfa_token,
    expires_at: challenge.expires_at,
    email_hint: maskEmail(user.email),
    user: { id: user.id, email: user.email, role: user.role, name: user.name },
    message: `Enter the 6-digit code sent to ${maskEmail(user.email)}`,
    mfa: resolved,
  };
}

export async function resendEmailOtp({ mfa_token }) {
  const challenge = peekMfaChallenge(mfa_token, 'login');
  if (!challenge) {
    const err = new Error('Invalid or expired MFA challenge');
    err.status = 401;
    throw err;
  }
  const user = getUserMfa(challenge.user_id);
  const resolved = resolveUserMfa(user);
  if (resolved.mode !== 'EMAIL') {
    const err = new Error('Email OTP resend only applies when effective MFA mode is EMAIL');
    err.status = 400;
    throw err;
  }
  if (!user?.email) {
    const err = new Error('User email missing');
    err.status = 400;
    throw err;
  }
  const code = generateEmailOtp();
  getDb()
    .prepare(`UPDATE mfa_challenges SET code_hash = ?, expires_at = ? WHERE token = ?`)
    .run(hashOtp(code), new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(), mfa_token);
  await sendLoginOtpEmail(user, code);
  return {
    ok: true,
    mfa_mode: 'EMAIL',
    mfa_token,
    email_hint: maskEmail(user.email),
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  };
}

export function verifyMfaLogin({ mfa_token, code }) {
  const challenge = consumeMfaChallenge(mfa_token, 'login');
  if (!challenge) {
    const err = new Error('Invalid or expired MFA challenge');
    err.status = 401;
    throw err;
  }
  const row = getUserMfa(challenge.user_id);
  const resolved = resolveUserMfa(row);
  const mode = resolved.mode;
  const codeStr = String(code || '').replace(/\s/g, '');

  if (mode === 'EMAIL') {
    if (!challenge.code_hash || !safeEqualHex(challenge.code_hash, hashOtp(codeStr))) {
      const err = new Error('Invalid MFA code');
      err.status = 401;
      throw err;
    }
  } else {
    if (!row?.mfa_secret || !verifyTotp(row.mfa_secret, codeStr)) {
      const err = new Error('Invalid MFA code');
      err.status = 401;
      throw err;
    }
  }

  const session = createSession(row.id);
  const user = getDb()
    .prepare(
      `SELECT id, email, name, role, region, mobile, created_at FROM platform_users WHERE id = ?`
    )
    .get(row.id);
  return { user, session, mfa_mode: mode, mfa: resolved };
}

/** Opt-in enrollment while authenticated. */
export async function beginMfaSetup(userId) {
  ensureMfaTables();
  const user = getUserMfa(userId);
  const mode = resolveUserMfa(user).mode;

  if (mode === 'EMAIL') {
    const code = generateEmailOtp();
    getDb()
      .prepare(`UPDATE platform_users SET mfa_pending_secret = ? WHERE id = ?`)
      .run(hashOtp(code), userId);
    await sendLoginOtpEmail(user, code);
    return {
      mfa_mode: 'EMAIL',
      email_hint: maskEmail(user.email),
      message: `Confirmation code sent to ${maskEmail(user.email)}. POST /auth/mfa/enable with that code.`,
    };
  }

  const secret = generateTotpSecret();
  getDb()
    .prepare(`UPDATE platform_users SET mfa_pending_secret = ? WHERE id = ?`)
    .run(secret, userId);
  return {
    mfa_mode: 'TOTP',
    secret,
    otpauth_url: totpOtpauthUrl({ secret, email: user?.email || userId }),
  };
}

export function confirmMfaSetup(userId, code) {
  ensureMfaTables();
  const row = getUserMfa(userId);
  const mode = resolveUserMfa(row).mode;
  const pending = row?.mfa_pending_secret;
  if (!pending) {
    const err = new Error('Call MFA setup first');
    err.status = 400;
    throw err;
  }
  const codeStr = String(code || '').replace(/\s/g, '');

  if (mode === 'EMAIL') {
    if (!safeEqualHex(pending, hashOtp(codeStr))) {
      const err = new Error('Invalid MFA code');
      err.status = 401;
      throw err;
    }
    getDb()
      .prepare(
        `UPDATE platform_users
         SET mfa_secret = NULL, mfa_pending_secret = NULL, mfa_enabled = 1, mfa_policy = 'on',
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(userId);
    return { ok: true, mfa_enabled: true, mfa_mode: 'EMAIL', mfa_policy: 'on' };
  }

  if (!verifyTotp(pending, codeStr)) {
    const err = new Error('Invalid MFA code');
    err.status = 401;
    throw err;
  }
  getDb()
    .prepare(
      `UPDATE platform_users
       SET mfa_secret = ?, mfa_pending_secret = NULL, mfa_enabled = 1, mfa_policy = 'on',
           mfa_mode = 'TOTP', updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(pending, userId);
  return { ok: true, mfa_enabled: true, mfa_mode: 'TOTP', mfa_policy: 'on' };
}

/** Persist a pending TOTP secret (reuse if already issued) and return enrollment fields. Never log the secret. */
function ensureTotpPendingSecret(user) {
  let secret = user?.mfa_pending_secret;
  if (!secret) {
    secret = generateTotpSecret();
    getDb()
      .prepare(`UPDATE platform_users SET mfa_pending_secret = ? WHERE id = ?`)
      .run(secret, user.id);
  }
  return {
    secret,
    otpauth_url: totpOtpauthUrl({ secret, email: user?.email || user.id }),
  };
}

function finishAfterSetup(userId) {
  const session = createSession(userId);
  const user = getDb()
    .prepare(
      `SELECT id, email, name, role, region, mobile, created_at FROM platform_users WHERE id = ?`
    )
    .get(userId);
  const resolved = resolveUserMfa(getUserMfa(userId));
  return { user, session, mfa_enabled: true, mfa_mode: resolved.mode, mfa: resolved };
}

/** Forced TOTP enrollment when effective mode is TOTP and secret missing. */
export function mfaSetupChallengeStep({ mfa_token, code }) {
  ensureMfaTables();
  const challengeRow = getDb().prepare(`SELECT * FROM mfa_challenges WHERE token = ?`).get(mfa_token);
  if (!challengeRow || challengeRow.purpose !== 'setup') {
    const err = new Error('Invalid or expired MFA setup challenge');
    err.status = 401;
    throw err;
  }
  if (new Date(challengeRow.expires_at).getTime() < Date.now()) {
    getDb().prepare(`DELETE FROM mfa_challenges WHERE token = ?`).run(mfa_token);
    const err = new Error('MFA setup challenge expired');
    err.status = 401;
    throw err;
  }

  let user = getUserMfa(challengeRow.user_id);
  if (resolveUserMfa(user).mode === 'EMAIL') {
    const err = new Error('EMAIL mode does not use setup-challenge; complete login OTP instead');
    err.status = 400;
    throw err;
  }

  if (!user?.mfa_pending_secret) {
    const enrolled = ensureTotpPendingSecret({ ...user, id: challengeRow.user_id });
    if (!code) {
      return {
        mfa_setup_required: true,
        mfa_mode: 'TOTP',
        mfa_token,
        secret: enrolled.secret,
        otpauth_url: enrolled.otpauth_url,
        message: 'Scan the QR code or enter the security key in your authenticator, then POST code',
      };
    }
    user = getUserMfa(challengeRow.user_id);
  }

  if (!code) {
    const enrolled = ensureTotpPendingSecret(user);
    return {
      mfa_setup_required: true,
      mfa_mode: 'TOTP',
      mfa_token,
      secret: enrolled.secret,
      otpauth_url: enrolled.otpauth_url,
      message: 'Scan the QR code or enter the security key in your authenticator, then POST code',
    };
  }

  if (!verifyTotp(user.mfa_pending_secret, code)) {
    const err = new Error('Invalid MFA code');
    err.status = 401;
    throw err;
  }

  getDb()
    .prepare(
      `UPDATE platform_users
       SET mfa_secret = ?, mfa_pending_secret = NULL, mfa_enabled = 1, mfa_policy = 'on',
           mfa_mode = COALESCE(mfa_mode, 'TOTP'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(user.mfa_pending_secret, challengeRow.user_id);
  getDb().prepare(`DELETE FROM mfa_challenges WHERE token = ?`).run(mfa_token);
  return finishAfterSetup(challengeRow.user_id);
}

export async function disableMfa(userId, code) {
  ensureMfaTables();
  const row = getUserMfa(userId);
  const resolved = resolveUserMfa(row);
  if (!resolved.enabled && normalizeMfaPolicy(row?.mfa_policy) === 'off') {
    return { ok: true, mfa_enabled: false, mfa_policy: 'off', mfa_mode: resolved.mode };
  }

  if (resolved.mode === 'TOTP' && row.mfa_secret) {
    if (!code || !verifyTotp(row.mfa_secret, code)) {
      const err = new Error('Invalid MFA code');
      err.status = 401;
      throw err;
    }
  } else if (code && row.mfa_pending_secret) {
    if (!safeEqualHex(row.mfa_pending_secret, hashOtp(code))) {
      const err = new Error('Invalid MFA code');
      err.status = 401;
      throw err;
    }
  }

  getDb()
    .prepare(
      `UPDATE platform_users
       SET mfa_enabled = 0, mfa_policy = 'off', mfa_secret = NULL, mfa_pending_secret = NULL,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(userId);
  return { ok: true, mfa_enabled: false, mfa_policy: 'off', mfa_mode: resolved.mode };
}
