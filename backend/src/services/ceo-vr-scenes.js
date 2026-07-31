/**
 * CEO Virtual Room scenes: GLB/GLTF environments + optional scene_json (spawns, media slots).
 */
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/schema.js';
import { sanitizeOwnerId } from './ceo-avatars.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALLOWED_EXT = new Set(['.glb', '.gltf']);

function dataRoot() {
  return process.env.AGENT_OS_DATA_DIR || join(__dirname, '../../data');
}

export function vrScenesDir(ownerUserId, sceneId = null) {
  const base = join(dataRoot(), 'vr-scenes', sanitizeOwnerId(ownerUserId));
  if (sceneId) return join(base, String(sceneId).replace(/[^a-zA-Z0-9_.-]/g, '_'));
  return base;
}

export function ensureVrScenesSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ceo_vr_scenes (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT DEFAULT 'model/gltf-binary',
      storage_path TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      scene_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ceo_vr_scenes_owner ON ceo_vr_scenes(owner_user_id, updated_at DESC);
  `);
}

function newSceneId() {
  return `vrs_${randomBytes(10).toString('hex')}`;
}

export function sceneModelApiPath(sceneId) {
  return `/vr-scenes/${encodeURIComponent(sceneId)}/model`;
}

function parseSceneJson(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function rowToScene(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    scene_json: parseSceneJson(row.scene_json),
    model_url: sceneModelApiPath(row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listVrScenes(ownerUserId) {
  ensureVrScenesSchema();
  return getDb()
    .prepare(`SELECT * FROM ceo_vr_scenes WHERE owner_user_id = ? ORDER BY updated_at DESC`)
    .all(String(ownerUserId || '').trim())
    .map(rowToScene);
}

export function getVrSceneForOwner(ownerUserId, sceneId) {
  ensureVrScenesSchema();
  return (
    getDb()
      .prepare(`SELECT * FROM ceo_vr_scenes WHERE id = ? AND owner_user_id = ?`)
      .get(String(sceneId || '').trim(), String(ownerUserId || '').trim()) || null
  );
}

export function createVrSceneFromBuffer(ownerUserId, opts = {}) {
  ensureVrScenesSchema();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });
  const buffer = opts.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error('buffer required'), { status: 400 });
  }
  const filename = basename(String(opts.filename || 'scene.glb'));
  const ext = extname(filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw Object.assign(new Error('Only .glb / .gltf scene files are supported'), { status: 400 });
  }
  const maxMb = Number(process.env.VR_SCENE_MAX_MB || process.env.AVATAR_MODEL_MAX_MB || 80);
  if (buffer.length > maxMb * 1024 * 1024) {
    throw Object.assign(new Error(`Scene exceeds ${maxMb}MB limit`), { status: 413 });
  }
  const id = newSceneId();
  const dir = vrScenesDir(owner, id);
  mkdirSync(dir, { recursive: true });
  const storageName = `scene${ext}`;
  const storagePath = join(dir, storageName);
  writeFileSync(storagePath, buffer);
  const sceneJson = parseSceneJson(opts.sceneJson ?? opts.scene_json ?? {});
  const mime =
    opts.mimeType ||
    (ext === '.gltf' ? 'model/gltf+json' : 'model/gltf-binary');
  getDb()
    .prepare(
      `INSERT INTO ceo_vr_scenes
        (id, owner_user_id, name, filename, mime_type, storage_path, size_bytes, scene_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      owner,
      String(opts.name || filename).slice(0, 120),
      filename,
      mime,
      storagePath,
      buffer.length,
      JSON.stringify(sceneJson)
    );
  console.info('[vr-scenes] created', { id, owner, bytes: buffer.length });
  return rowToScene(getVrSceneForOwner(owner, id));
}

export function updateVrSceneMeta(ownerUserId, sceneId, patch = {}) {
  ensureVrScenesSchema();
  const row = getVrSceneForOwner(ownerUserId, sceneId);
  if (!row) return null;
  const name = patch.name != null ? String(patch.name).slice(0, 120) : row.name;
  let sceneJson = row.scene_json;
  if (Object.prototype.hasOwnProperty.call(patch, 'sceneJson') || Object.prototype.hasOwnProperty.call(patch, 'scene_json')) {
    sceneJson = parseSceneJson(patch.sceneJson ?? patch.scene_json ?? {});
  }
  getDb()
    .prepare(
      `UPDATE ceo_vr_scenes SET name = ?, scene_json = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(name, JSON.stringify(sceneJson), row.id, row.owner_user_id);
  return rowToScene(getVrSceneForOwner(ownerUserId, sceneId));
}

export function deleteVrScene(ownerUserId, sceneId) {
  ensureVrScenesSchema();
  const row = getVrSceneForOwner(ownerUserId, sceneId);
  if (!row) return false;
  try {
    getDb()
      .prepare(
        `UPDATE ceo_vr_rooms SET scene_id = NULL, updated_at = datetime('now') WHERE scene_id = ? AND owner_user_id = ?`
      )
      .run(row.id, row.owner_user_id);
  } catch (_) {
    /* rooms table may not exist yet */
  }
  getDb().prepare(`DELETE FROM ceo_vr_scenes WHERE id = ? AND owner_user_id = ?`).run(row.id, row.owner_user_id);
  try {
    rmSync(vrScenesDir(row.owner_user_id, row.id), { recursive: true, force: true });
  } catch (e) {
    console.warn('[vr-scenes] dir cleanup failed', row.id, e?.message || e);
  }
  return true;
}

export function readVrSceneModelBuffer(ownerUserId, sceneId) {
  const row = getVrSceneForOwner(ownerUserId, sceneId);
  if (!row) return null;
  if (!existsSync(row.storage_path)) {
    throw Object.assign(new Error('Scene file missing on disk'), { status: 404 });
  }
  return { row, buffer: readFileSync(row.storage_path) };
}

export function vrSceneStorageBytes(ownerUserId) {
  ensureVrScenesSchema();
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(COALESCE(size_bytes, 0)), 0) AS b FROM ceo_vr_scenes WHERE owner_user_id = ?`)
    .get(String(ownerUserId || '').trim());
  return Number(row?.b) || 0;
}