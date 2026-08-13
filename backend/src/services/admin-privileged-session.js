/**
 * Generic admin privileged-session manager.
 *
 * After a successful OTP (authenticator TOTP or email OTP), issues a short-lived
 * token. Mutations that need extra proof of presence call requirePrivilegedSession.
 * Default TTL is 30 minutes; after expiry a new OTP is required.
 *
 * Purpose is an allowlisted string so future admin surfaces (TLS, Docker tools,
 * AgentSystem recovery, …) share this module instead of inventing new tokens.
 */
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';
import {
  getUserMfa,
  ensureMfaTables,
  resolveUserMfa,
  createMfaChallenge,
  consumeMfaChallenge,
  sendUserOtpEmail,
  newEmailOtp,
  emailOtpMatches,
  maskUserEmail,
} from './auth/mfa.js';
import { verifyTotp } from './auth/totp.js';

export const PRIVILEGED_PURPOSE = Object.freeze({
  ADMIN: 'admin_privileged',
  DOCKER_TOOLS: 'docker_tools',
  TLS_CERTS: 'tls_certs',
  OPENCLAW_RECOVERY: 'openclaw_recovery',
});

const PURPOSE_SET = new Set(Object.values(PRIVILEGED_PURPOSE));
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const OTP_CHALLENGE_TTL_MIN = 5;
const SHARED_PURPOSE = PRIVILEGED_PURPOSE.ADMIN;

export function privilegedSessionTtlMs() {
  const primary = Number(process.env.ADMIN_PRIVILEGED_SESSION_TTL_MS);
  if (Number.isFinite(primary) && primary >= 60_000) return primary;
  const legacy = Number(process.env.DOCKER_TOOLS_STEPUP_TTL_MS);
  if (Number.isFinite(legacy) && legacy >= 60_000) return legacy;
  return DEFAULT_TTL_MS;
}

export function normalizePrivilegedPurpose(raw, fallback = SHARED_PURPOSE) {
  const p = String(raw || '').trim();
  if (PURPOSE_SET.has(p)) return p;
  return fallback;
}

export function ensurePrivilegedSessionTable() {
  ensureMfaTables();
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS admin_stepup_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_admin_stepup_user_purpose
      ON admin_stepup_tokens(user_id, purpose);
    CREATE TABLE IF NOT EXISTS admin_privileged_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_admin_privileged_audit_created
      ON admin_privileged_audit(created_at DESC);
  `);
}

function hashToken(token) {
  const pepper = process.env.AGENT_OS_INTERNAL_TOKEN || process.env.AGENT_OS_MFA_PEPPER || 'agent-os-stepup';
  return createHash('sha256').update(`${String(token)}:${pepper}`).digest('hex');
}

function purgeExpired() {
  getDb().prepare(`DELETE FROM admin_stepup_tokens WHERE expires_at < datetime('now')`).run();
}

export function assertPureAdmin({ role, impersonation } = {}) {
  if (role !== 'admin' || impersonation) {
    const err = new Error('Platform admin session required (not impersonating)');
    err.status = 403;
    throw err;
  }
}

export function privilegedTokenFromReq(req) {
  return (
    req?.headers?.['x-agent-os-privileged-session'] ||
    req?.headers?.['x-agent-os-stepup'] ||
    req?.headers?.['x-stepup-token'] ||
    req?.body?.privileged_session_token ||
    req?.body?.stepup_token ||
    req?.query?.privileged_session_token ||
    req?.query?.stepup_token ||
    ''
  );
}

function challengePurpose(purpose) {
  return `privileged:${normalizePrivilegedPurpose(purpose)}`;
}

function describeOtpMode(userId) {
  const row = getUserMfa(userId);
  if (!row) {
    const err = new Error('Admin user not found');
    err.status = 404;
    throw err;
  }
  const resolved = resolveUserMfa(row);
  const totpReady = !!row.mfa_secret;
  // Prefer authenticator when enrolled; otherwise email OTP. Privileged actions always need OTP.
  const otpMode = totpReady ? 'TOTP' : 'EMAIL';
  return { row, resolved, otpMode, totpReady, emailHint: maskUserEmail(row.email) };
}

/**
 * How the admin must prove presence (no side effects besides reading MFA).
 */
export function privilegedSessionStatus({ userId, role, impersonation, token, purpose = SHARED_PURPOSE }) {
  assertPureAdmin({ role, impersonation });
  ensurePrivilegedSessionTable();
  const want = normalizePrivilegedPurpose(purpose);
  const { otpMode, emailHint, totpReady } = describeOtpMode(userId);
  const ttl_ms = privilegedSessionTtlMs();
  const raw = String(token || '').trim();
  if (raw) {
    try {
      const ok = requirePrivilegedSession({
        userId,
        role,
        impersonation,
        token: raw,
        purpose: want,
        acceptShared: true,
      });
      return {
        unlocked: true,
        purpose: ok.purpose,
        expires_at: ok.expires_at,
        ttl_ms,
        mfa_mode: otpMode,
        email_hint: otpMode === 'EMAIL' ? emailHint : undefined,
        totp_enrolled: totpReady,
      };
    } catch {
      /* expired / wrong purpose — fall through */
    }
  }
  return {
    unlocked: false,
    purpose: want,
    ttl_ms,
    mfa_mode: otpMode,
    email_hint: otpMode === 'EMAIL' ? emailHint : undefined,
    totp_enrolled: totpReady,
  };
}

/**
 * Start an email OTP challenge. TOTP admins do not need this — they verify directly.
 */
export async function startPrivilegedOtpChallenge({ userId, role, impersonation, purpose = SHARED_PURPOSE }) {
  assertPureAdmin({ role, impersonation });
  ensurePrivilegedSessionTable();
  const want = normalizePrivilegedPurpose(purpose);
  const { row, otpMode, emailHint } = describeOtpMode(userId);
  if (otpMode === 'TOTP') {
    return {
      ok: true,
      mfa_mode: 'TOTP',
      purpose: want,
      ttl_ms: privilegedSessionTtlMs(),
      message: 'Enter the 6-digit code from your authenticator app',
    };
  }
  if (!row?.email) {
    const err = new Error('Admin email missing — cannot send OTP');
    err.status = 400;
    throw err;
  }
  const { code, codeHash } = newEmailOtp();
  const challenge = createMfaChallenge(userId, challengePurpose(want), { codeHash });
  await sendUserOtpEmail(row, code, {
    subject: 'Your Flolah admin privileged-action code',
    intro: 'Your Flolah admin verification code is',
    expiresMinutes: OTP_CHALLENGE_TTL_MIN,
  });
  console.info('[admin-privileged] email OTP sent user=%s purpose=%s', userId, want);
  return {
    ok: true,
    mfa_mode: 'EMAIL',
    purpose: want,
    mfa_token: challenge.mfa_token,
    expires_at: challenge.expires_at,
    email_hint: emailHint,
    ttl_ms: privilegedSessionTtlMs(),
    message: `Enter the 6-digit code sent to ${emailHint}`,
  };
}

function persistSession({ userId, purpose, ttlMs }) {
  purgeExpired();
  const ttl = Math.max(60_000, Number(ttlMs) || privilegedSessionTtlMs());
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + ttl).toISOString();
  const db = getDb();
  db.prepare(`DELETE FROM admin_stepup_tokens WHERE user_id = ? AND purpose = ?`).run(userId, purpose);
  db.prepare(
    `INSERT INTO admin_stepup_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)`
  ).run(hashToken(token), userId, purpose, expires);
  return { token, expires_at: expires, ttl_ms: ttl, purpose };
}

/**
 * Verify OTP and issue a privileged session token (reusable until expiry).
 */
export async function issuePrivilegedSession({
  userId,
  role,
  impersonation,
  code,
  mfaToken,
  purpose = SHARED_PURPOSE,
}) {
  assertPureAdmin({ role, impersonation });
  ensurePrivilegedSessionTable();
  const want = normalizePrivilegedPurpose(purpose);
  const { row, otpMode } = describeOtpMode(userId);
  const codeStr = String(code || '').replace(/\s/g, '');
  if (!codeStr) {
    const err = new Error('OTP code required');
    err.status = 400;
    throw err;
  }

  if (otpMode === 'TOTP') {
    if (!row?.mfa_secret || !verifyTotp(row.mfa_secret, codeStr)) {
      const err = new Error('Invalid OTP code');
      err.status = 401;
      throw err;
    }
  } else {
    const challenge = consumeMfaChallenge(String(mfaToken || '').trim(), challengePurpose(want));
    if (!challenge) {
      const err = new Error('Invalid or expired OTP challenge — request a new code');
      err.status = 401;
      throw err;
    }
    if (!emailOtpMatches(codeStr, challenge.code_hash)) {
      const err = new Error('Invalid OTP code');
      err.status = 401;
      throw err;
    }
  }

  const issued = persistSession({ userId, purpose: want, ttlMs: privilegedSessionTtlMs() });
  console.info(
    '[admin-privileged] issued purpose=%s user=%s ttlMs=%s',
    want,
    userId,
    issued.ttl_ms
  );
  return {
    privileged_session_token: issued.token,
    stepup_token: issued.token,
    expires_at: issued.expires_at,
    purpose: want,
    ttl_ms: issued.ttl_ms,
  };
}

/**
 * Validate a privileged session. Does not consume the token (reusable until expiry).
 * @param {{ acceptShared?: boolean }} opts acceptShared (default true) also accepts admin_privileged.
 */
export function requirePrivilegedSession({
  userId,
  role,
  impersonation,
  token,
  purpose = SHARED_PURPOSE,
  acceptShared = true,
}) {
  assertPureAdmin({ role, impersonation });
  ensurePrivilegedSessionTable();
  const want = normalizePrivilegedPurpose(purpose);
  const raw = String(token || '').trim();
  if (!raw) {
    const err = new Error('Privileged session required — verify OTP first');
    err.status = 401;
    err.code = 'privileged_session_required';
    throw err;
  }
  purgeExpired();
  const purposes = acceptShared && want !== SHARED_PURPOSE ? [want, SHARED_PURPOSE] : [want];
  const placeholders = purposes.map(() => '?').join(',');
  const row = getDb()
    .prepare(
      `SELECT * FROM admin_stepup_tokens
       WHERE token_hash = ? AND user_id = ? AND purpose IN (${placeholders})`
    )
    .get(hashToken(raw), userId, ...purposes);
  if (!row) {
    const err = new Error('Invalid or expired privileged session — verify OTP again');
    err.status = 401;
    err.code = 'privileged_session_invalid';
    throw err;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare(`DELETE FROM admin_stepup_tokens WHERE token_hash = ?`).run(row.token_hash);
    const err = new Error('Privileged session expired — verify OTP again');
    err.status = 401;
    err.code = 'privileged_session_expired';
    throw err;
  }
  return { ok: true, purpose: row.purpose, expires_at: row.expires_at };
}

export function requirePrivilegedSessionFromReq(req, { purpose = SHARED_PURPOSE, acceptShared = true } = {}) {
  return requirePrivilegedSession({
    userId: req.authUser.id,
    role: req.authUser.role,
    impersonation: req.authUser.impersonation,
    token: privilegedTokenFromReq(req),
    purpose,
    acceptShared,
  });
}

export function logPrivilegedAction({ userId, purpose, action, detail }) {
  try {
    ensurePrivilegedSessionTable();
    const text =
      detail == null
        ? null
        : typeof detail === 'string'
          ? detail.slice(0, 2000)
          : JSON.stringify(detail).slice(0, 2000);
    getDb()
      .prepare(
        `INSERT INTO admin_privileged_audit (user_id, purpose, action, detail) VALUES (?, ?, ?, ?)`
      )
      .run(userId, normalizePrivilegedPurpose(purpose), String(action || '').slice(0, 120), text);
  } catch (e) {
    console.warn('[admin-privileged] audit write failed:', e?.message || e);
  }
}

/** Express middleware: platform admin + valid privileged session for purpose. */
export function requirePrivilegedSessionMw(opts = {}) {
  const purpose = normalizePrivilegedPurpose(opts.purpose, SHARED_PURPOSE);
  const acceptShared = opts.acceptShared !== false;
  return (req, res, next) => {
    try {
      if (req.authUser?.role !== 'admin' || req.authUser?.impersonation) {
        return res.status(403).json({ error: 'Platform admin session required (not impersonating)' });
      }
      requirePrivilegedSessionFromReq(req, { purpose, acceptShared });
      next();
    } catch (e) {
      res.status(e.status || 401).json({ error: e.message, code: e.code || 'privileged_session_required' });
    }
  };
}
