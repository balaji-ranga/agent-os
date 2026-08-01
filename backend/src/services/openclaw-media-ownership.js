/**
 * Ownership registry for shared OpenClaw media tree (~/.openclaw/media/...).
 * Generated files stay UUID-named for WhatsApp MEDIA: attach, but HTTP serve
 * is gated to the owning CEO (admins may access all).
 */
import { getDb } from '../db/schema.js';

export function ensureOpenClawMediaOwnershipSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS openclaw_media_ownership (
      relative_path TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      source TEXT,
      bytes INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_openclaw_media_owner
      ON openclaw_media_ownership(owner_user_id, created_at DESC);
  `);
}

export function normalizeOpenClawMediaRelative(rel) {
  return String(rel || '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .replace(/^api\/media\/openclaw\//i, '')
    .replace(/^media\/openclaw\//i, '');
}

export function registerOpenClawMediaOwnership(relativePath, ownerUserId, { source = null, bytes = null } = {}) {
  const rel = normalizeOpenClawMediaRelative(relativePath);
  const owner = String(ownerUserId || '').trim();
  if (!rel || !owner || rel.includes('..')) return null;
  ensureOpenClawMediaOwnershipSchema();
  getDb()
    .prepare(
      `INSERT INTO openclaw_media_ownership (relative_path, owner_user_id, source, bytes, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(relative_path) DO UPDATE SET
         owner_user_id = excluded.owner_user_id,
         source = excluded.source,
         bytes = excluded.bytes`
    )
    .run(rel, owner, source || null, bytes == null ? null : Number(bytes));
  return rel;
}

export function getOpenClawMediaOwner(relativePath) {
  const rel = normalizeOpenClawMediaRelative(relativePath);
  if (!rel) return null;
  ensureOpenClawMediaOwnershipSchema();
  const row = getDb()
    .prepare(`SELECT owner_user_id FROM openclaw_media_ownership WHERE relative_path = ?`)
    .get(rel);
  return row?.owner_user_id || null;
}

/**
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canAccessOpenClawMedia(relativePath, authUser) {
  if (!authUser) return { ok: false, reason: 'auth_required' };
  if (authUser.role === 'admin') return { ok: true };

  const rel = normalizeOpenClawMediaRelative(relativePath);
  if (rel.startsWith('inbound/')) {
    return { ok: false, reason: 'inbound_not_browsable' };
  }

  // Path-encoded owner: generated/{ceo}/file
  if (authUser.role === 'ceo') {
    const ceo = String(authUser.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (ceo && rel.startsWith('generated/' + ceo + '/')) {
      return { ok: true, reason: 'path_owner_match' };
    }
  }

  const owner = getOpenClawMediaOwner(rel);
  if (!owner) {
    if (String(process.env.OPENCLAW_MEDIA_LEGACY_OPEN || '').trim() === '1') {
      return { ok: true, reason: 'legacy_open' };
    }
    return { ok: false, reason: 'unmapped' };
  }
  if (authUser.role === 'ceo' && String(authUser.id) === String(owner)) return { ok: true };
  return { ok: false, reason: 'forbidden' };
}