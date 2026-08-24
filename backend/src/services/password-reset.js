/**
 * Password reset tokens + email link delivery (CEO self-serve + Admin-initiated).
 */
import { createHash, randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { hashPassword } from './auth/password.js';
import { sendSmtpMail, smtpFromEnv } from './agent-workflow-tasks.js';
import { revokeAllSessions } from './auth/session.js';
import { assertStrongPassword } from './password-policy.js';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function ensurePasswordResetTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_by TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id, created_at DESC);
  `);
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function newRawToken() {
  return randomBytes(32).toString('base64url');
}

function getUserRow(emailOrId) {
  const db = getDb();
  const s = String(emailOrId || '').trim();
  if (!s) return null;
  if (s.includes('@')) {
    return db.prepare('SELECT * FROM platform_users WHERE lower(email) = lower(?)').get(s) || null;
  }
  return db.prepare('SELECT * FROM platform_users WHERE id = ?').get(s) || null;
}

function buildResetUrl(rawToken) {
  const base = String(getPublicBaseUrl() || '').replace(/\/$/, '') || 'http://127.0.0.1:5173';
  return `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

async function sendResetEmail(user, resetUrl, { initiatedByAdmin = false, initiatedByInvite = false } = {}) {
  const smtp = smtpFromEnv();
  if (!smtp.host) {
    const err = new Error('SMTP not configured (set WORKFLOW_SMTP_HOST)');
    err.status = 503;
    throw err;
  }
  const subject = initiatedByInvite
    ? 'Set your Flolah password — you were added to a company'
    : initiatedByAdmin
      ? 'Your Agent OS password reset link'
      : 'Reset your Agent OS password';
  const body = initiatedByInvite
    ? `Hello ${user.name || 'there'},\n\n` +
      'Your CEO added you as an employee on Flolah (AI Company OS).\n\n' +
      `Open this link within 7 days to set your password and sign in:\n${resetUrl}\n\n` +
      `If you did not expect this, you can ignore this email.\n`
    : `Hello ${user.name || 'there'},\n\n` +
      (initiatedByAdmin
        ? 'An administrator generated a password reset link for your Agent OS account.\n\n'
        : 'We received a request to reset your Agent OS password.\n\n') +
      `Open this link within 1 hour to set a new password:\n${resetUrl}\n\n` +
      `If you did not request this, you can ignore this email.\n`;
  const result = await sendSmtpMail({
    ...smtp,
    to: user.email,
    subject,
    body,
  });
  if (result?.error) {
    const err = new Error(result.error);
    err.status = 502;
    throw err;
  }
  return result;
}

/**
 * Create reset token for a user and email the link.
 * @returns {{ ok: true, emailed: boolean, expires_at: string, reset_url?: string }}
 */
export async function createAndSendPasswordReset(userIdOrEmail, opts = {}) {
  ensurePasswordResetTables();
  const user = getUserRow(userIdOrEmail);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  if (!user.enabled) {
    const err = new Error('User is disabled');
    err.status = 400;
    throw err;
  }
  const ttl = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : TOKEN_TTL_MS;
  const raw = newRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const db = getDb();
  db.prepare(
    `INSERT INTO password_reset_tokens (token_hash, user_id, created_by, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(tokenHash, user.id, opts.createdBy || null, expiresAt);

  const resetUrl = buildResetUrl(raw);
  await sendResetEmail(user, resetUrl, {
    initiatedByAdmin: !!opts.initiatedByAdmin,
    initiatedByInvite: !!opts.initiatedByInvite,
  });
  console.info('[password-reset] emailed link', {
    userId: user.id,
    by: opts.createdBy || 'self',
    admin: !!opts.initiatedByAdmin,
    invite: !!opts.initiatedByInvite,
  });
  const out = { ok: true, emailed: true, expires_at: expiresAt, email: user.email };
  if (opts.includeUrl) out.reset_url = resetUrl;
  return out;
}

/**
 * Public forgot-password: always returns ok (do not leak whether email exists).
 */
export async function requestPasswordResetByEmail(email) {
  ensurePasswordResetTables();
  const user = getUserRow(email);
  if (!user || !user.enabled || String(user.role).toLowerCase() === 'admin') {
    console.info('[password-reset] forgot ignored (no eligible user)');
    return { ok: true, message: 'If that email is registered, a reset link was sent.' };
  }
  try {
    await createAndSendPasswordReset(user.id, { createdBy: 'self' });
  } catch (e) {
    console.warn('[password-reset] send failed', { error: e?.message || String(e) });
    // Still return generic ok to avoid enumeration; surface SMTP only in logs.
  }
  return { ok: true, message: 'If that email is registered, a reset link was sent.' };
}

export function consumePasswordResetToken(rawToken, newPassword) {
  ensurePasswordResetTables();
  const token = String(rawToken || '').trim();
  const pwd = String(newPassword || '');
  if (!token) {
    const err = new Error('token required');
    err.status = 400;
    throw err;
  }
  assertStrongPassword(pwd);
  const db = getDb();
  const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?').get(hashToken(token));
  if (!row) {
    const err = new Error('Invalid or expired reset link');
    err.status = 400;
    throw err;
  }
  if (row.used_at) {
    const err = new Error('Reset link already used');
    err.status = 400;
    throw err;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    const err = new Error('Reset link expired');
    err.status = 400;
    throw err;
  }
  const user = db.prepare('SELECT * FROM platform_users WHERE id = ?').get(row.user_id);
  if (!user || !user.enabled) {
    const err = new Error('User not found or disabled');
    err.status = 400;
    throw err;
  }
  const password_hash = hashPassword(pwd);
  db.prepare(
    `UPDATE platform_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(password_hash, user.id);
  db.prepare(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token_hash = ?`).run(
    row.token_hash
  );
  try {
    revokeAllSessions(user.id);
  } catch (_) {}
  console.info('[password-reset] password updated', { userId: user.id });
  return { ok: true, email: user.email };
}
