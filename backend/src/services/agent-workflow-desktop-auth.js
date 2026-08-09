/**
 * Desktop workflow package auth: hashed bearer tokens + optional IP whitelist.
 * Empty whitelist = no IP restriction. Non-empty = client IP must match an entry
 * (exact IP or CIDR) for the owner (and optional definition_id).
 * IP rules live in owner_ip_whitelists (central Settings source of truth).
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { clientIpFromRequest, ipMatchesCidrOrIp } from './ip-match.js';
import {
  assertFeatureIpAllowed,
  listOwnerIpWhitelists,
  addOwnerIpWhitelistEntry,
  removeOwnerIpWhitelistEntry,
  IP_FEATURES,
} from './owner-ip-whitelist.js';

export { clientIpFromRequest, ipMatchesCidrOrIp };

function db() {
  return getDb();
}

export function hashDesktopToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function mintDesktopTokenPlaintext() {
  return `dsk_${randomBytes(32).toString('base64url')}`;
}

/**
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertDesktopIpAllowed(ownerUserId, definitionId, clientIp) {
  return assertFeatureIpAllowed(ownerUserId, IP_FEATURES.WORKFLOW_DESKTOP, clientIp, {
    definitionId,
  });
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
    .prepare(`SELECT * FROM workflow_desktop_tokens WHERE token_hash = ?`)
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

/** List desktop feature IPs (owner-wide + this workflow). Shape kept for existing UIs. */
export function listIpWhitelist(ownerUserId, definitionId = null) {
  const entries = listOwnerIpWhitelists(ownerUserId, {
    feature: IP_FEATURES.WORKFLOW_DESKTOP,
    definitionId: definitionId || undefined,
  });
  return entries.map((e) => ({
    id: e.id,
    owner_user_id: e.owner_user_id,
    definition_id: e.definition_id,
    cidr_or_ip: e.cidr_or_ip,
    label: e.label,
    created_at: e.created_at,
    apply_workflow_desktop: true,
    apply_ibkr_bridge: e.apply_ibkr_bridge,
    apply_a2a: e.apply_a2a,
    apply_browser_worker: e.apply_browser_worker,
  }));
}

export function addIpWhitelistEntry(ownerUserId, { cidrOrIp, label = '', definitionId = null } = {}) {
  const entry = addOwnerIpWhitelistEntry(ownerUserId, {
    cidr_or_ip: cidrOrIp,
    label,
    apply_workflow_desktop: true,
    definition_id: definitionId || null,
  });
  return {
    id: entry.id,
    owner_user_id: entry.owner_user_id,
    definition_id: entry.definition_id,
    cidr_or_ip: entry.cidr_or_ip,
    label: entry.label,
    created_at: entry.created_at,
  };
}

export function removeIpWhitelistEntry(entryId, ownerUserId) {
  return removeOwnerIpWhitelistEntry(entryId, ownerUserId);
}