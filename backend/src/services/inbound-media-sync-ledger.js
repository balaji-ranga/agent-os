/**
 * Durable ledger for OpenClaw -> workspace inbound mirrors.
 *
 * Content Explorer delete only removes tenants/.../inbound/attachments copies.
 * OpenClaw still keeps ~/.openclaw/media/inbound/<uuid>.ext — without this ledger,
 * backend restart remirrors those files and deleted uploads "come back".
 */
import { basename } from 'path';
import { getDb } from '../db/schema.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS inbound_openclaw_sync (
    openclaw_basename TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    size INTEGER,
    mirrored_filename TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (owner_user_id, openclaw_basename)
  );
  CREATE INDEX IF NOT EXISTS idx_inbound_openclaw_sync_status
    ON inbound_openclaw_sync (status);
`;

let ready = false;

function sanitizeOwner(value) {
  return String(value || '').trim();
}

function sanitizeBasename(value) {
  return basename(String(value || '').trim());
}

export function ensureInboundOpenclawSyncSchema() {
  if (ready) return;
  getDb().exec(SCHEMA);
  ready = true;
}

/**
 * Normalize to OpenClaw staging basename (uuid.ext), stripping wa- / wa-<ts>- prefixes.
 */
export function normalizeOpenclawBasename(filename) {
  const n = sanitizeBasename(filename);
  if (!n) return '';
  const m = n.match(/^wa-(?:\d+-)?(.+)$/i);
  return (m ? m[1] : n).toLowerCase();
}

export function recordInboundOpenclawMirrored(ownerUserId, openclawFilename, { size = null, mirroredFilename = null } = {}) {
  ensureInboundOpenclawSyncSchema();
  const owner = sanitizeOwner(ownerUserId);
  const key = normalizeOpenclawBasename(openclawFilename);
  if (!owner || !key) return;
  getDb()
    .prepare(
      `INSERT INTO inbound_openclaw_sync (openclaw_basename, owner_user_id, status, size, mirrored_filename, updated_at)
       VALUES (?, ?, 'mirrored', ?, ?, datetime('now'))
       ON CONFLICT(owner_user_id, openclaw_basename) DO UPDATE SET
         status = CASE
           WHEN inbound_openclaw_sync.status = 'suppressed' THEN 'suppressed'
           ELSE 'mirrored'
         END,
         size = excluded.size,
         mirrored_filename = COALESCE(excluded.mirrored_filename, inbound_openclaw_sync.mirrored_filename),
         updated_at = datetime('now')`
    )
    .run(key, owner, size == null ? null : Number(size), mirroredFilename || null);
}

/**
 * Mark OpenClaw source as suppressed so restart/poll will not remirror after CE delete.
 */
export function suppressInboundOpenclawMirror(ownerUserId, filenameOrBasename) {
  ensureInboundOpenclawSyncSchema();
  const owner = sanitizeOwner(ownerUserId);
  const key = normalizeOpenclawBasename(filenameOrBasename);
  if (!owner || !key) return false;
  getDb()
    .prepare(
      `INSERT INTO inbound_openclaw_sync (openclaw_basename, owner_user_id, status, updated_at)
       VALUES (?, ?, 'suppressed', datetime('now'))
       ON CONFLICT(owner_user_id, openclaw_basename) DO UPDATE SET
         status = 'suppressed',
         updated_at = datetime('now')`
    )
    .run(key, owner);
  console.info('[inbound-openclaw-sync] suppressed remirror', {
    owner,
    openclaw_basename: key,
  });
  return true;
}

export function suppressInboundOpenclawMirrors(ownerUserId, filenames = []) {
  let n = 0;
  for (const f of filenames || []) {
    if (suppressInboundOpenclawMirror(ownerUserId, f)) n += 1;
  }
  return n;
}

/**
 * True when this OpenClaw staging file must not be (re)mirrored for the owner.
 * Any prior ledger row (mirrored or suppressed) blocks remirror — delete sets suppressed;
 * mirrored means we already handled it once (disk may still have the copy).
 */
export function shouldSkipOpenclawInboundRemirror(ownerUserId, openclawFilename) {
  ensureInboundOpenclawSyncSchema();
  const owner = sanitizeOwner(ownerUserId);
  const key = normalizeOpenclawBasename(openclawFilename);
  if (!owner || !key) return false;
  const row = getDb()
    .prepare(
      `SELECT status FROM inbound_openclaw_sync
       WHERE owner_user_id = ? AND openclaw_basename = ?`
    )
    .get(owner, key);
  return !!row;
}

export function seedMirroredFromExistingInbound(ownerUserId, filename, size = null) {
  if (!/^wa-/i.test(String(filename || ''))) return;
  const key = normalizeOpenclawBasename(filename);
  if (!key) return;
  recordInboundOpenclawMirrored(ownerUserId, key, { size, mirroredFilename: filename });
}
