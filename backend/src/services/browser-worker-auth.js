/**
 * Local browser worker auth: hashed bearer tokens + optional IP whitelist (owner-scoped).
 * Empty whitelist = any client IP allowed (token still required). Non-empty = must match.
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
  return assertFeatureIpAllowed(ownerUserId, IP_FEATURES.BROWSER_WORKER, clientIp);
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

/** Create a short-lived one-time code for pairing the Flolah Chrome extension. */
export function createBrowserExtensionPairingCode(ownerUserId, { ttlMs = 10 * 60 * 1000 } = {}) {
  const id = randomUUID();
  // 48 bits of entropy, rendered without ambiguous punctuation for copy/paste.
  const code = randomBytes(6).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + Math.max(60_000, Number(ttlMs) || 600_000)).toISOString();
  db().prepare(
    `INSERT INTO browser_extension_pairing_codes (id, owner_user_id, code_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(id, ownerUserId, hashBrowserWorkerToken(`pair:${code}`), expiresAt);
  return { id, code, expires_at: expiresAt };
}

/** Atomically consume a pairing code and mint an extension worker credential. */
export function consumeBrowserExtensionPairingCode(code, { deviceName = 'Flolah Chrome extension' } = {}) {
  const normalized = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length < 6) return { ok: false, status: 400, error: 'Invalid pairing code' };
  const hash = hashBrowserWorkerToken(`pair:${normalized}`);
  const transaction = db().transaction(() => {
    const row = db().prepare(
      `SELECT * FROM browser_extension_pairing_codes WHERE code_hash = ? AND used_at IS NULL`
    ).get(hash);
    if (!row) return { ok: false, status: 401, error: 'Pairing code is invalid or already used' };
    const expiry = Date.parse(row.expires_at || '');
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      return { ok: false, status: 401, error: 'Pairing code expired' };
    }
    const used = db().prepare(
      `UPDATE browser_extension_pairing_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`
    ).run(row.id);
    if (!used.changes) return { ok: false, status: 409, error: 'Pairing code already used' };
    const minted = createBrowserWorkerToken(row.owner_user_id, { name: String(deviceName || '').slice(0, 120) || 'Flolah Chrome extension' });
    return { ok: true, owner_user_id: row.owner_user_id, ...minted };
  });
  return transaction();
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
    db()
      .prepare(
        `UPDATE browser_executor_nodes SET online = 0, updated_at = datetime('now')
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
  return listOwnerIpWhitelists(ownerUserId, { feature: IP_FEATURES.BROWSER_WORKER }).map((e) => ({
    id: e.id,
    owner_user_id: e.owner_user_id,
    cidr_or_ip: e.cidr_or_ip,
    label: e.label,
    created_at: e.created_at,
    apply_browser_worker: true,
    apply_ibkr_bridge: e.apply_ibkr_bridge,
    apply_workflow_desktop: e.apply_workflow_desktop,
    apply_a2a: e.apply_a2a,
  }));
}

export function addBrowserWorkerIpWhitelistEntry(ownerUserId, { cidrOrIp, label = '' } = {}) {
  const entry = addOwnerIpWhitelistEntry(ownerUserId, {
    cidr_or_ip: cidrOrIp,
    label,
    apply_browser_worker: true,
  });
  console.info(
    '[browser-worker-auth] ip whitelist add owner=%s rule=%s',
    ownerUserId,
    entry.cidr_or_ip
  );
  return {
    id: entry.id,
    owner_user_id: entry.owner_user_id,
    cidr_or_ip: entry.cidr_or_ip,
    label: entry.label,
    created_at: entry.created_at,
  };
}

export function removeBrowserWorkerIpWhitelistEntry(entryId, ownerUserId) {
  return removeOwnerIpWhitelistEntry(entryId, ownerUserId);
}
