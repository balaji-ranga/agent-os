/**
 * Desktop workflow package auth: hashed bearer tokens + optional IP whitelist.
 * Empty whitelist = no IP restriction. Non-empty = client IP must match an entry
 * (exact IP or CIDR) for the owner (and optional definition_id).
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

function db() {
  return getDb();
}

export function hashDesktopToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function mintDesktopTokenPlaintext() {
  return `dsk_${randomBytes(32).toString('base64url')}`;
}

function normalizeIp(raw) {
  let ip = String(raw || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

/** First public-ish client IP from Express request (honors X-Forwarded-For). */
export function clientIpFromRequest(req) {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return normalizeIp(xf.split(',')[0]);
  }
  if (Array.isArray(xf) && xf[0]) return normalizeIp(String(xf[0]).split(',')[0]);
  return normalizeIp(req.socket?.remoteAddress || req.ip || '');
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function ipMatchesCidrOrIp(clientIp, rule) {
  const ip = normalizeIp(clientIp);
  const r = String(rule || '').trim();
  if (!ip || !r) return false;
  if (!r.includes('/')) return ip === normalizeIp(r);
  const [base, bitsStr] = r.split('/');
  const bits = Number(bitsStr);
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt == null || baseInt == null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return ip === normalizeIp(base);
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertDesktopIpAllowed(ownerUserId, definitionId, clientIp) {
  const rows = db()
    .prepare(
      `SELECT cidr_or_ip, definition_id FROM workflow_desktop_ip_whitelist
       WHERE owner_user_id = ?
         AND (definition_id IS NULL OR definition_id = ?)`
    )
    .all(ownerUserId, definitionId);
  if (!rows.length) return { ok: true };
  const ip = normalizeIp(clientIp);
  if (!ip) return { ok: false, reason: 'Client IP could not be determined' };
  const hit = rows.some((row) => ipMatchesCidrOrIp(ip, row.cidr_or_ip));
  if (!hit) {
    return { ok: false, reason: `Client IP ${ip} is not on the desktop whitelist` };
  }
  return { ok: true };
}

export function createDesktopToken(definitionId, ownerUserId, { name = '', expiresAt = null } = {}) {
  const plaintext = mintDesktopTokenPlaintext();
  const id = randomUUID();
  const prefix = plaintext.slice(0, 12);
  db()
    .prepare(
      `INSERT INTO workflow_desktop_tokens
       (id, definition_id, owner_user_id, name, token_hash, token_prefix, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      definitionId,
      ownerUserId,
      String(name || '').trim() || 'Desktop package',
      hashDesktopToken(plaintext),
      prefix,
      expiresAt || null
    );
  return { id, token: plaintext, token_prefix: prefix, expires_at: expiresAt || null };
}

export function listDesktopTokens(definitionId, ownerUserId) {
  return db()
    .prepare(
      `SELECT id, definition_id, owner_user_id, name, token_prefix, expires_at, revoked_at, last_used_at, created_at
       FROM workflow_desktop_tokens
       WHERE definition_id = ? AND owner_user_id = ?
       ORDER BY created_at DESC`
    )
    .all(definitionId, ownerUserId);
}

export function revokeDesktopToken(tokenId, ownerUserId) {
  const r = db()
    .prepare(
      `UPDATE workflow_desktop_tokens SET revoked_at = datetime('now')
       WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL`
    )
    .run(tokenId, ownerUserId);
  return r.changes > 0;
}

/**
 * Validate bearer token + IP. Returns token row + owner on success.
 */
export function authenticateDesktopToken(plaintext, clientIp) {
  if (!plaintext || !String(plaintext).startsWith('dsk_')) {
    return { ok: false, status: 401, error: 'Invalid desktop token' };
  }
  const row = db()
    .prepare(
      `SELECT * FROM workflow_desktop_tokens WHERE token_hash = ?`
    )
    .get(hashDesktopToken(plaintext));
  if (!row) return { ok: false, status: 401, error: 'Invalid desktop token' };
  if (row.revoked_at) return { ok: false, status: 401, error: 'Desktop token revoked' };
  if (row.expires_at) {
    const exp = Date.parse(row.expires_at);
    if (Number.isFinite(exp) && exp < Date.now()) {
      return { ok: false, status: 401, error: 'Desktop token expired' };
    }
  }
  const ipCheck = assertDesktopIpAllowed(row.owner_user_id, row.definition_id, clientIp);
  if (!ipCheck.ok) return { ok: false, status: 403, error: ipCheck.reason };
  db()
    .prepare(`UPDATE workflow_desktop_tokens SET last_used_at = datetime('now') WHERE id = ?`)
    .run(row.id);
  return { ok: true, tokenRow: row };
}

export function listIpWhitelist(ownerUserId, definitionId = null) {
  if (definitionId) {
    return db()
      .prepare(
        `SELECT * FROM workflow_desktop_ip_whitelist
         WHERE owner_user_id = ? AND (definition_id IS NULL OR definition_id = ?)
         ORDER BY created_at DESC`
      )
      .all(ownerUserId, definitionId);
  }
  return db()
    .prepare(
      `SELECT * FROM workflow_desktop_ip_whitelist WHERE owner_user_id = ? ORDER BY created_at DESC`
    )
    .all(ownerUserId);
}

export function addIpWhitelistEntry(ownerUserId, { cidrOrIp, label = '', definitionId = null } = {}) {
  const rule = String(cidrOrIp || '').trim();
  if (!rule) throw new Error('cidr_or_ip is required');
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO workflow_desktop_ip_whitelist (id, owner_user_id, definition_id, cidr_or_ip, label)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, ownerUserId, definitionId || null, rule, String(label || '').trim());
  return db().prepare(`SELECT * FROM workflow_desktop_ip_whitelist WHERE id = ?`).get(id);
}

export function removeIpWhitelistEntry(entryId, ownerUserId) {
  const r = db()
    .prepare(`DELETE FROM workflow_desktop_ip_whitelist WHERE id = ? AND owner_user_id = ?`)
    .run(entryId, ownerUserId);
  return r.changes > 0;
}
