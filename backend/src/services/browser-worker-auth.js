/**
 * Local browser worker auth: hashed bearer tokens + optional IP whitelist (owner-scoped).
 * Empty whitelist = any client IP allowed (token still required). Non-empty = must match.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import {
  clientIpFromRequest,
  ipMatchesCidrOrIp,
} from './agent-workflow-desktop-auth.js';

export { clientIpFromRequest, ipMatchesCidrOrIp };

function db() {
  return getDb();
}

export function hashBrowserWorkerToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function mintBrowserWorkerTokenPlaintext() {
  return `bwk_${randomBytes(32).toString('base64url')}`;
}

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertBrowserWorkerIpAllowed(ownerUserId, clientIp) {
  const rows = db()
    .prepare(
      `SELECT cidr_or_ip FROM browser_worker_ip_whitelist WHERE owner_user_id = ?`
    )
    .all(ownerUserId);
  if (!rows.length) return { ok: true };
  const ip = String(clientIp || '').trim();
  if (!ip) return { ok: false, reason: 'Client IP could not be determined' };
  const hit = rows.some((row) => ipMatchesCidrOrIp(ip, row.cidr_or_ip));
  if (!hit) {
    return {
      ok: false,
      reason: `Client IP ${ip} is not on the browser worker whitelist`,
    };
  }
  return { ok: true };
}

export function createBrowserWorkerToken(ownerUserId, { name = '', expiresAt = null } = {}) {
  const id = randomUUID();
  const plaintext = mintBrowserWorkerTokenPlaintext();
  const prefix = plaintext.slice(0, 12);
  db()
    .prepare(
      `INSERT INTO browser_worker_tokens
       (id, owner_user_id, name, token_hash, token_prefix, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      ownerUserId,
      String(name || '').trim() || 'Browser Session package',
      hashBrowserWorkerToken(plaintext),
      prefix,
      expiresAt || null
    );
  console.info(
    '[browser-worker-auth] token minted owner=%s id=%s prefix=%s',
    ownerUserId,
    id,
    prefix
  );
  return { id, token: plaintext, token_prefix: prefix, expires_at: expiresAt || null };
}

export function listBrowserWorkerTokens(ownerUserId) {
  return db()
    .prepare(
      `SELECT id, owner_user_id, name, token_prefix, expires_at, revoked_at, last_used_at, created_at
       FROM browser_worker_tokens
       WHERE owner_user_id = ?
       ORDER BY created_at DESC`
    )
    .all(ownerUserId);
}

export function revokeBrowserWorkerToken(tokenId, ownerUserId) {
  const r = db()
    .prepare(
      `UPDATE browser_worker_tokens SET revoked_at = datetime('now')
       WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL`
    )
    .run(tokenId, ownerUserId);
  if (r.changes > 0) {
    console.info(
      '[browser-worker-auth] token revoked owner=%s id=%s',
      ownerUserId,
      tokenId
    );
    // Force offline for nodes using this token.
    db()
      .prepare(
        `UPDATE browser_worker_nodes SET online = 0, updated_at = datetime('now')
         WHERE owner_user_id = ? AND token_id = ?`
      )
      .run(ownerUserId, tokenId);
  }
  return r.changes > 0;
}

/**
 * Validate worker bearer + IP. Returns token row + owner on success.
 */
export function authenticateBrowserWorkerToken(plaintext, clientIp) {
  const raw = String(plaintext || '').trim();
  if (!raw || !raw.startsWith('bwk_')) {
    return { ok: false, status: 401, error: 'Invalid browser worker token' };
  }
  const row = db()
    .prepare(`SELECT * FROM browser_worker_tokens WHERE token_hash = ?`)
    .get(hashBrowserWorkerToken(raw));
  if (!row) return { ok: false, status: 401, error: 'Invalid browser worker token' };
  if (row.revoked_at) return { ok: false, status: 401, error: 'Browser worker token revoked' };
  if (row.expires_at) {
    const exp = Date.parse(row.expires_at);
    if (Number.isFinite(exp) && exp < Date.now()) {
      return { ok: false, status: 401, error: 'Browser worker token expired' };
    }
  }
  const ipCheck = assertBrowserWorkerIpAllowed(row.owner_user_id, clientIp);
  if (!ipCheck.ok) return { ok: false, status: 403, error: ipCheck.reason };
  db()
    .prepare(`UPDATE browser_worker_tokens SET last_used_at = datetime('now') WHERE id = ?`)
    .run(row.id);
  return { ok: true, tokenRow: row };
}

export function listBrowserWorkerIpWhitelist(ownerUserId) {
  return db()
    .prepare(
      `SELECT id, owner_user_id, cidr_or_ip, label, created_at
       FROM browser_worker_ip_whitelist
       WHERE owner_user_id = ?
       ORDER BY created_at DESC`
    )
    .all(ownerUserId);
}

export function addBrowserWorkerIpWhitelistEntry(ownerUserId, { cidrOrIp, label = '' } = {}) {
  const rule = String(cidrOrIp || '').trim();
  if (!rule) throw new Error('cidr_or_ip is required');
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO browser_worker_ip_whitelist (id, owner_user_id, cidr_or_ip, label)
       VALUES (?, ?, ?, ?)`
    )
    .run(id, ownerUserId, rule, String(label || '').trim());
  console.info(
    '[browser-worker-auth] ip whitelist add owner=%s rule=%s',
    ownerUserId,
    rule
  );
  return db().prepare(`SELECT * FROM browser_worker_ip_whitelist WHERE id = ?`).get(id);
}

export function removeBrowserWorkerIpWhitelistEntry(entryId, ownerUserId) {
  const r = db()
    .prepare(`DELETE FROM browser_worker_ip_whitelist WHERE id = ? AND owner_user_id = ?`)
    .run(entryId, ownerUserId);
  return r.changes > 0;
}
