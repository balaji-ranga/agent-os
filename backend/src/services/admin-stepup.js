/**
 * Short-lived admin step-up tokens after TOTP verification.
 * Required for privileged Docker tool onboarding operations.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { getDb } from '../db/schema.js';
import { getUserMfa, ensureMfaTables } from './auth/mfa.js';
import { verifyTotp } from './auth/totp.js';

const TTL_MS = Math.max(60_000, Number(process.env.DOCKER_TOOLS_STEPUP_TTL_MS) || 5 * 60 * 1000);
const PURPOSE = 'docker_tools';

export function ensureAdminStepupTable() {
  ensureMfaTables();
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS admin_stepup_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function hashToken(token) {
  const pepper = process.env.AGENT_OS_INTERNAL_TOKEN || process.env.AGENT_OS_MFA_PEPPER || 'agent-os-stepup';
  return createHash('sha256').update(`${String(token)}:${pepper}`).digest('hex');
}

function purgeExpired() {
  getDb().prepare(`DELETE FROM admin_stepup_tokens WHERE expires_at < datetime('now')`).run();
}

/**
 * Verify admin TOTP and issue a step-up token for privileged ops.
 */
export function issueAdminStepup({ userId, role, impersonation, code, purpose = PURPOSE }) {
  ensureAdminStepupTable();
  if (role !== 'admin' || impersonation) {
    const err = new Error('Platform admin session required (not impersonating)');
    err.status = 403;
    throw err;
  }
  const row = getUserMfa(userId);
  if (!row?.mfa_secret) {
    const err = new Error('Admin TOTP must be enrolled before privileged Docker operations');
    err.status = 403;
    throw err;
  }
  const codeStr = String(code || '').replace(/\s/g, '');
  if (!verifyTotp(row.mfa_secret, codeStr)) {
    const err = new Error('Invalid TOTP code');
    err.status = 401;
    throw err;
  }
  purgeExpired();
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TTL_MS).toISOString();
  getDb()
    .prepare(
      `INSERT INTO admin_stepup_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)`
    )
    .run(hashToken(token), userId, purpose, expires);
  console.info(`[admin-stepup] issued purpose=${purpose} user=${userId} ttlMs=${TTL_MS}`);
  return { stepup_token: token, expires_at: expires, purpose, ttl_ms: TTL_MS };
}

/**
 * Consume/validate step-up token (does not delete — reusable until expiry within the window).
 */
export function requireAdminStepup({ userId, role, impersonation, token, purpose = PURPOSE }) {
  ensureAdminStepupTable();
  if (role !== 'admin' || impersonation) {
    const err = new Error('Platform admin session required (not impersonating)');
    err.status = 403;
    throw err;
  }
  const raw = String(token || '').trim();
  if (!raw) {
    const err = new Error('stepup_token required (POST /api/admin/tool-onboarding/stepup with TOTP first)');
    err.status = 401;
    throw err;
  }
  purgeExpired();
  const row = getDb()
    .prepare(
      `SELECT * FROM admin_stepup_tokens WHERE token_hash = ? AND user_id = ? AND purpose = ?`
    )
    .get(hashToken(raw), userId, purpose);
  if (!row) {
    const err = new Error('Invalid or expired step-up token');
    err.status = 401;
    throw err;
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare(`DELETE FROM admin_stepup_tokens WHERE token_hash = ?`).run(row.token_hash);
    const err = new Error('Step-up token expired — re-verify TOTP');
    err.status = 401;
    throw err;
  }
  return { ok: true, purpose, expires_at: row.expires_at };
}
