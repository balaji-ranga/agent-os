/**
 * Per-CEO media artifact store (audio / video / model / json).
 * Files under {AGENT_OS_DATA_DIR}/media/{ceo}/{artifactId}/
 */
import { createHash, randomBytes } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const KIND_SET = new Set(['audio', 'video', 'model', 'json', 'other']);

export function sanitizeOwnerId(ownerUserId) {
  return String(ownerUserId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_') || 'unknown';
}

function dataRoot() {
  return process.env.AGENT_OS_DATA_DIR || join(__dirname, '../../data');
}

export function mediaArtifactsDir(ownerUserId, artifactId = null) {
  const safeCeo = sanitizeOwnerId(ownerUserId);
  const base = join(dataRoot(), 'media', safeCeo);
  if (artifactId) return join(base, String(artifactId).replace(/[^a-zA-Z0-9_.-]/g, '_'));
  return base;
}

export function ensureMediaArtifactsSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ceo_media_artifacts (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'other',
      mime_type TEXT DEFAULT 'application/octet-stream',
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      duration_ms INTEGER,
      meta_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ceo_media_owner ON ceo_media_artifacts(owner_user_id, created_at DESC);
  `);
}

function newId() {
  return `mda_${randomBytes(10).toString('hex')}`;
}

function safeFilename(name, fallbackExt = 'bin') {
  const base = basename(String(name || 'file'))
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 180);
  if (base && base !== '.' && base !== '..') return base;
  return `file.${fallbackExt}`;
}

function guessKind(mimeType, filename) {
  const mime = String(mimeType || '').toLowerCase();
  const ext = extname(filename || '').toLowerCase();
  if (mime.startsWith('audio/') || ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.webm'].includes(ext)) return 'audio';
  if (mime.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) return 'video';
  if (mime.includes('gltf') || mime.includes('glb') || ['.glb', '.gltf'].includes(ext)) return 'model';
  if (mime.includes('json') || ext === '.json') return 'json';
  return 'other';
}

/** Public API path for authenticated download (relative to /api). */
export function mediaArtifactApiPath(artifactId) {
  return `/media/artifacts/${encodeURIComponent(artifactId)}/download`;
}

export function toMediaRef(row) {
  if (!row) return null;
  return {
    kind: row.kind,
    artifactId: row.id,
    url: mediaArtifactApiPath(row.id),
    mimeType: row.mime_type,
    filename: row.filename,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
  };
}

export function isMediaRef(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Boolean(value.artifactId && (value.url || value.kind));
}

/** Parse binding value that may be a media ref object or JSON string. */
export function parseMediaRef(value) {
  if (isMediaRef(value)) return value;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    if (s.startsWith('{')) {
      try {
        const o = JSON.parse(s);
        if (isMediaRef(o)) return o;
      } catch (_) {}
    }
  }
  return null;
}

/**
 * @param {string} ownerUserId
 * @param {{ buffer: Buffer, filename?: string, mimeType?: string, kind?: string, durationMs?: number, meta?: object }} opts
 */
export function createMediaArtifact(ownerUserId, opts = {}) {
  ensureMediaArtifactsSchema();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  const buffer = opts.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw Object.assign(new Error('buffer required'), { status: 400 });
  }
  const id = newId();
  const filename = safeFilename(opts.filename || `artifact.bin`);
  const mimeType = String(opts.mimeType || 'application/octet-stream').slice(0, 200);
  let kind = String(opts.kind || guessKind(mimeType, filename)).toLowerCase();
  if (!KIND_SET.has(kind)) kind = 'other';

  const dir = mediaArtifactsDir(owner, id);
  mkdirSync(dir, { recursive: true });
  const storagePath = join(dir, filename);
  writeFileSync(storagePath, buffer);

  const db = getDb();
  db.prepare(
    `INSERT INTO ceo_media_artifacts
      (id, owner_user_id, kind, mime_type, filename, storage_path, size_bytes, duration_ms, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    owner,
    kind,
    mimeType,
    filename,
    storagePath,
    buffer.length,
    opts.durationMs != null ? Number(opts.durationMs) : null,
    JSON.stringify(opts.meta || {})
  );

  const row = db.prepare(`SELECT * FROM ceo_media_artifacts WHERE id = ? AND owner_user_id = ?`).get(id, owner);
  console.info('[media] artifact created', { id, owner, kind, size: buffer.length, mimeType });
  return { row, ref: toMediaRef(row) };
}

export function getMediaArtifact(ownerUserId, artifactId) {
  ensureMediaArtifactsSchema();
  return (
    getDb()
      .prepare(`SELECT * FROM ceo_media_artifacts WHERE id = ? AND owner_user_id = ?`)
      .get(String(artifactId || '').trim(), String(ownerUserId || '').trim()) || null
  );
}

export function readMediaArtifactBuffer(ownerUserId, artifactId) {
  const row = getMediaArtifact(ownerUserId, artifactId);
  if (!row) return null;
  if (!existsSync(row.storage_path)) {
    throw Object.assign(new Error('Artifact file missing on disk'), { status: 404 });
  }
  return { row, buffer: readFileSync(row.storage_path) };
}

export function listMediaArtifacts(ownerUserId, { kind, limit = 50 } = {}) {
  ensureMediaArtifactsSchema();
  const owner = String(ownerUserId || '').trim();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  if (kind) {
    return getDb()
      .prepare(
        `SELECT * FROM ceo_media_artifacts WHERE owner_user_id = ? AND kind = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(owner, String(kind), lim)
      .map(toMediaRef);
  }
  return getDb()
    .prepare(
      `SELECT * FROM ceo_media_artifacts WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(owner, lim)
    .map(toMediaRef);
}

export function deleteMediaArtifact(ownerUserId, artifactId) {
  ensureMediaArtifactsSchema();
  const row = getMediaArtifact(ownerUserId, artifactId);
  if (!row) return false;
  getDb().prepare(`DELETE FROM ceo_media_artifacts WHERE id = ? AND owner_user_id = ?`).run(row.id, row.owner_user_id);
  try {
    rmSync(mediaArtifactsDir(row.owner_user_id, row.id), { recursive: true, force: true });
  } catch (e) {
    console.warn('[media] failed to remove artifact dir', row.id, e?.message || e);
  }
  return true;
}

export function deleteAllMediaForOwner(ownerUserId) {
  ensureMediaArtifactsSchema();
  const owner = String(ownerUserId || '').trim();
  getDb().prepare(`DELETE FROM ceo_media_artifacts WHERE owner_user_id = ?`).run(owner);
  const dir = mediaArtifactsDir(owner);
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.warn('[media] failed to remove owner media dir', owner, e?.message || e);
  }
}

export function mediaStorageBytes(ownerUserId) {
  ensureMediaArtifactsSchema();
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(size_bytes, 0)), 0) AS b FROM ceo_media_artifacts WHERE owner_user_id = ?`
    )
    .get(String(ownerUserId || '').trim());
  return Number(row?.b) || 0;
}

export function contentHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Resolve absolute file path for an artifact owned by CEO (for STT multipart etc.). */
export function resolveOwnedArtifactPath(ownerUserId, mediaOrId) {
  const ref = typeof mediaOrId === 'string' ? { artifactId: mediaOrId } : parseMediaRef(mediaOrId) || mediaOrId;
  const id = ref?.artifactId || (typeof mediaOrId === 'string' ? mediaOrId : '');
  const row = getMediaArtifact(ownerUserId, id);
  if (!row) return null;
  if (!existsSync(row.storage_path)) return null;
  return row;
}
