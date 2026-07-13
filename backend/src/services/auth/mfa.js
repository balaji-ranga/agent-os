/**
 * MFA challenge + enrollment for CEO/admin accounts.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../../db/schema.js';
import { generateTotpSecret, verifyTotp, totpOtpauthUrl } from './totp.js';
import { createSession } from './session.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

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
}

function purgeExpired() {
  getDb()
    .prepare(`DELETE FROM mfa_challenges WHERE expires_at < datetime('now')`)
    .run();
}

export function createMfaChallenge(userId, purpose = 'login') {
  ensureMfaTables();
  purgeExpired();
  const token = randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  getDb()
    .prepare(
      `INSERT INTO mfa_challenges (token, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)`
    )
    .run(token, userId, purpose, expires);
  return { mfa_token: token, expires_at: expires };
}

export function consumeMfaChallenge(token, purpose = null) {
  ensureMfaTables();
  purgeExpired();
  const row = getDb().prepare(`SELECT * FROM mfa_challenges WHERE token = ?`).get(token);
  if (!row) return null;
  if (purpose && row.purpose !== purpose) return null;
  getDb().prepare(`DELETE FROM mfa_challenges WHERE token = ?`).run(token);
  return row;
}

export function getUserMfa(userId) {
  ensureMfaTables();
  return getDb()
    .prepare(`SELECT id, email, role, mfa_enabled, mfa_secret, mfa_pending_secret FROM platform_users WHERE id = ?`)
    .get(userId);
}

export function requireMfaEnv() {
  return process.env.AGENT_OS_REQUIRE_MFA === '1' || process.env.AGENT_OS_REQUIRE_MFA === 'true';
}

/**
 * After password success: either issue session, or MFA challenge / setup gate.
 */
export function finishLoginAfterPassword(user) {
  ensureMfaTables();
  const row = getUserMfa(user.id);
  const mfaOn = Number(row?.mfa_enabled) === 1 && row?.mfa_secret;

  if (mfaOn) {
    const challenge = createMfaChallenge(user.id, 'login');
    return {
      mfa_required: true,
      mfa_token: challenge.mfa_token,
      expires_at: challenge.expires_at,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
    };
  }

  if (requireMfaEnv()) {
    const challenge = createMfaChallenge(user.id, 'setup');
    return {
      mfa_setup_required: true,
      mfa_token: challenge.mfa_token,
      expires_at: challenge.expires_at,
      user: { id: user.id, email: user.email, role: user.role, name: user.name },
      message: 'MFA enrollment required before session can be issued',
    };
  }

  const session = createSession(user.id);
  return { user, session };
}

export function verifyMfaLogin({ mfa_token, code }) {
  const challenge = consumeMfaChallenge(mfa_token, 'login');
  if (!challenge) {
    const err = new Error('Invalid or expired MFA challenge');
    err.status = 401;
    throw err;
  }
  const row = getUserMfa(challenge.user_id);
  if (!row?.mfa_secret || !verifyTotp(row.mfa_secret, code)) {
    const err = new Error('Invalid MFA code');
    err.status = 401;
    throw err;
  }
  const session = createSession(row.id);
  const user = getDb()
    .prepare(
      `SELECT id, email, name, role, region, mobile, created_at FROM platform_users WHERE id = ?`
    )
    .get(row.id);
  return { user, session };
}

export function beginMfaSetup(userId) {
  ensureMfaTables();
  const secret = generateTotpSecret();
  getDb()
    .prepare(`UPDATE platform_users SET mfa_pending_secret = ? WHERE id = ?`)
    .run(secret, userId);
  const user = getUserMfa(userId);
  return {
    secret,
    otpauth_url: totpOtpauthUrl({ secret, email: user?.email || userId }),
  };
}

export function confirmMfaSetup(userId, code) {
  ensureMfaTables();
  const row = getUserMfa(userId);
  const secret = row?.mfa_pending_secret || row?.mfa_secret;
  if (!secret) {
    const err = new Error('Call MFA setup first');
    err.status = 400;
    throw err;
  }
  if (!verifyTotp(secret, code)) {
    const err = new Error('Invalid MFA code');
    err.status = 401;
    throw err;
  }
  getDb()
    .prepare(
      `UPDATE platform_users SET mfa_secret = ?, mfa_pending_secret = NULL, mfa_enabled = 1 WHERE id = ?`
    )
    .run(secret, userId);
  return { ok: true, mfa_enabled: true };
}

function finishAfterSetup(userId) {
  const session = createSession(userId);
  const user = getDb()
    .prepare(
      `SELECT id, email, name, role, region, mobile, created_at FROM platform_users WHERE id = ?`
    )
    .get(userId);
  return { user, session, mfa_enabled: true };
}

/**
 * Setup-with-challenge: if pending secret missing, create one and return QR (no enable yet).
 * If code provided and valid, enable + session.
 */
export function mfaSetupChallengeStep({ mfa_token, code }) {
  ensureMfaTables();
  const row = getDb().prepare(`SELECT * FROM mfa_challenges WHERE token = ?`).get(mfa_token);
  if (!row || row.purpose !== 'setup') {
    const err = new Error('Invalid or expired MFA setup challenge');
    err.status = 401;
    throw err;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare(`DELETE FROM mfa_challenges WHERE token = ?`).run(mfa_token);
    const err = new Error('MFA setup challenge expired');
    err.status = 401;
    throw err;
  }

  let user = getUserMfa(row.user_id);
  if (!user?.mfa_pending_secret) {
    const started = beginMfaSetup(row.user_id);
    if (!code) {
      return {
        mfa_setup_required: true,
        mfa_token,
        ...started,
        message: 'Scan otpauth_url / enter secret in authenticator, then POST code',
      };
    }
    user = getUserMfa(row.user_id);
  }

  if (!code) {
    return {
      mfa_setup_required: true,
      mfa_token,
      secret: user.mfa_pending_secret,
      otpauth_url: totpOtpauthUrl({ secret: user.mfa_pending_secret, email: user.email }),
    };
  }

  if (!verifyTotp(user.mfa_pending_secret, code)) {
    const err = new Error('Invalid MFA code');
    err.status = 401;
    throw err;
  }

  getDb()
    .prepare(
      `UPDATE platform_users SET mfa_secret = ?, mfa_pending_secret = NULL, mfa_enabled = 1 WHERE id = ?`
    )
    .run(user.mfa_pending_secret, row.user_id);
  getDb().prepare(`DELETE FROM mfa_challenges WHERE token = ?`).run(mfa_token);
  return finishAfterSetup(row.user_id);
}

export function disableMfa(userId, code) {
  ensureMfaTables();
  const row = getUserMfa(userId);
  if (Number(row?.mfa_enabled) === 1 && row.mfa_secret) {
    if (!verifyTotp(row.mfa_secret, code)) {
      const err = new Error('Invalid MFA code');
      err.status = 401;
      throw err;
    }
  }
  getDb()
    .prepare(
      `UPDATE platform_users SET mfa_enabled = 0, mfa_secret = NULL, mfa_pending_secret = NULL WHERE id = ?`
    )
    .run(userId);
  return { ok: true, mfa_enabled: false };
}
