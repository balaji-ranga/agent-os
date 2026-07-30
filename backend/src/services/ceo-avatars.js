/**
 * CEO 3D avatars: GLB/GLTF storage, agent mapping, workflow template provisioning.
 */
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/schema.js';
import { createDefinition, updateDraft, publishDefinition } from './agent-workflow-store.js';
import {
  buildAvatarInboundGraph,
  buildAvatarOutboundGraph,
  AVATAR_INBOUND_TEMPLATE_ID,
  AVATAR_OUTBOUND_TEMPLATE_ID,
} from './agent-workflow-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALLOWED_EXT = new Set(['.glb', '.gltf']);

export function sanitizeOwnerId(ownerUserId) {
  return String(ownerUserId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_') || 'unknown';
}

function dataRoot() {
  return process.env.AGENT_OS_DATA_DIR || join(__dirname, '../../data');
}

export function avatarsDir(ownerUserId, avatarId = null) {
  const base = join(dataRoot(), 'models', sanitizeOwnerId(ownerUserId));
  if (avatarId) return join(base, String(avatarId).replace(/[^a-zA-Z0-9_.-]/g, '_'));
  return base;
}

export function ensureAvatarsSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ceo_avatars (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT DEFAULT 'model/gltf-binary',
      storage_path TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      source TEXT DEFAULT 'upload',
      animation_catalog_json TEXT DEFAULT '[]',
      agent_id TEXT,
      inbound_workflow_id TEXT,
      outbound_workflow_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ceo_avatars_owner ON ceo_avatars(owner_user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ceo_avatars_agent ON ceo_avatars(owner_user_id, agent_id);
  `);
  try {
    getDb().prepare(`ALTER TABLE ceo_avatars ADD COLUMN idle_clip TEXT`).run();
  } catch (_) {
    /* already migrated */
  }
}

function newId() {
  return `avr_${randomBytes(10).toString('hex')}`;
}

export function avatarModelApiPath(avatarId) {
  return `/avatars/${encodeURIComponent(avatarId)}/model`;
}

/**
 * Lightweight GLB animation name extraction (JSON chunk scan).
 * Returns string[] of animation clip names when present.
 */
export function extractGlbAnimationNames(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 20) return [];
    const magic = buffer.toString('utf8', 0, 4);
    if (magic !== 'glTF') {
      // glTF JSON
      const text = buffer.toString('utf8');
      if (text.trim().startsWith('{')) {
        const doc = JSON.parse(text);
        return (doc.animations || []).map((a) => a.name || 'Animation').filter(Boolean);
      }
      return [];
    }
    const jsonChunkLength = buffer.readUInt32LE(12);
    const jsonChunkType = buffer.readUInt32LE(16);
    if (jsonChunkType !== 0x4e4f534a) return []; // JSON
    const jsonStart = 20;
    const jsonEnd = jsonStart + jsonChunkLength;
    const jsonText = buffer.slice(jsonStart, jsonEnd).toString('utf8').replace(/\0+$/, '');
    const doc = JSON.parse(jsonText);
    return (doc.animations || []).map((a, i) => a.name || `Animation_${i}`).filter(Boolean);
  } catch (e) {
    console.warn('[avatars] GLB animation parse failed', e?.message || e);
    return [];
  }
}

function rowToAvatar(row) {
  if (!row) return null;
  let catalog = [];
  try {
    catalog = JSON.parse(row.animation_catalog_json || '[]');
  } catch {
    catalog = [];
  }
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    source: row.source,
    animation_catalog: catalog,
    idle_clip: row.idle_clip || null,
    agent_id: row.agent_id || null,
    inbound_workflow_id: row.inbound_workflow_id || null,
    outbound_workflow_id: row.outbound_workflow_id || null,
    model_url: avatarModelApiPath(row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getAvatarForOwner(ownerUserId, avatarId) {
  ensureAvatarsSchema();
  return (
    getDb()
      .prepare(`SELECT * FROM ceo_avatars WHERE id = ? AND owner_user_id = ?`)
      .get(String(avatarId || '').trim(), String(ownerUserId || '').trim()) || null
  );
}

export function getAvatarByAgent(ownerUserId, agentId) {
  ensureAvatarsSchema();
  return (
    getDb()
      .prepare(
        `SELECT * FROM ceo_avatars WHERE owner_user_id = ? AND agent_id = ? ORDER BY updated_at DESC LIMIT 1`
      )
      .get(String(ownerUserId || '').trim(), String(agentId || '').trim()) || null
  );
}

export function listAvatars(ownerUserId) {
  ensureAvatarsSchema();
  return getDb()
    .prepare(`SELECT * FROM ceo_avatars WHERE owner_user_id = ? ORDER BY updated_at DESC`)
    .all(String(ownerUserId || '').trim())
    .map(rowToAvatar);
}

/**
 * @param {string} ownerUserId
 * @param {{ buffer: Buffer, filename: string, name?: string, source?: string, mimeType?: string }} opts
 */
export function createAvatarFromBuffer(ownerUserId, opts = {}) {
  ensureAvatarsSchema();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });
  const buffer = opts.buffer;
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error('buffer required'), { status: 400 });
  }
  const filename = basename(String(opts.filename || 'model.glb'));
  const ext = extname(filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw Object.assign(new Error('Only .glb / .gltf files are supported in V1'), { status: 400 });
  }
  const maxMb = Number(process.env.AVATAR_MODEL_MAX_MB || 80);
  if (buffer.length > maxMb * 1024 * 1024) {
    throw Object.assign(new Error(`Model exceeds ${maxMb}MB limit`), { status: 413 });
  }

  const id = newId();
  const dir = avatarsDir(owner, id);
  mkdirSync(dir, { recursive: true });
  const storageName = ext === '.gltf' ? 'model.gltf' : 'model.glb';
  const storagePath = join(dir, storageName);
  writeFileSync(storagePath, buffer);

  const catalog = extractGlbAnimationNames(buffer);
  const mime =
    opts.mimeType ||
    (ext === '.gltf' ? 'model/gltf+json' : 'model/gltf-binary');
  const name = String(opts.name || filename.replace(/\.(glb|gltf)$/i, '') || id).slice(0, 120);

  getDb()
    .prepare(
      `INSERT INTO ceo_avatars
        (id, owner_user_id, name, filename, mime_type, storage_path, size_bytes, source, animation_catalog_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      owner,
      name,
      storageName,
      mime,
      storagePath,
      buffer.length,
      String(opts.source || 'upload'),
      JSON.stringify(catalog)
    );

  console.info('[avatars] created', { id, owner, source: opts.source || 'upload', clips: catalog.length });
  return rowToAvatar(getAvatarForOwner(owner, id));
}

export function updateAvatarMeta(ownerUserId, avatarId, patch = {}) {
  ensureAvatarsSchema();
  const row = getAvatarForOwner(ownerUserId, avatarId);
  if (!row) return null;
  const name = patch.name != null ? String(patch.name).slice(0, 120) : row.name;
  let idleClip = row.idle_clip || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'idleClip') || Object.prototype.hasOwnProperty.call(patch, 'idle_clip')) {
    const raw = patch.idleClip != null ? patch.idleClip : patch.idle_clip;
    const next = raw == null || raw === '' ? null : String(raw).trim();
    if (next) {
      let catalog = [];
      try {
        catalog = JSON.parse(row.animation_catalog_json || '[]');
      } catch {
        catalog = [];
      }
      const names = catalog.map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
      if (!names.includes(next)) {
        throw Object.assign(new Error(`idleClip must be one of: ${names.join(', ') || '(none)'}`), { status: 400 });
      }
      idleClip = next;
    } else {
      idleClip = null;
    }
  }
  getDb()
    .prepare(
      `UPDATE ceo_avatars SET name = ?, idle_clip = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
    )
    .run(name, idleClip, row.id, row.owner_user_id);
  console.info('[avatars] meta updated', { id: row.id, idle_clip: idleClip });
  const updated = rowToAvatar(getAvatarForOwner(ownerUserId, avatarId));
  // idle change refresh — rebuild speak graphs so Brain prefers the new idle
  if (updated?.agent_id && (patch.idleClip != null || patch.idle_clip != null)) {
    try {
      assignAvatarAgent(ownerUserId, updated.id, updated.agent_id, { id: ownerUserId, name: 'idle-refresh' });
      return rowToAvatar(getAvatarForOwner(ownerUserId, avatarId));
    } catch (e) {
      console.warn('[avatars] idle workflow refresh failed', e?.message || e);
    }
  }
  return updated;
}

export function deleteAvatar(ownerUserId, avatarId) {
  ensureAvatarsSchema();
  const row = getAvatarForOwner(ownerUserId, avatarId);
  if (!row) return false;
  getDb().prepare(`DELETE FROM ceo_avatars WHERE id = ? AND owner_user_id = ?`).run(row.id, row.owner_user_id);
  try {
    rmSync(avatarsDir(row.owner_user_id, row.id), { recursive: true, force: true });
  } catch (e) {
    console.warn('[avatars] dir cleanup failed', row.id, e?.message || e);
  }
  return true;
}

export function readAvatarModelBuffer(ownerUserId, avatarId) {
  const row = getAvatarForOwner(ownerUserId, avatarId);
  if (!row) return null;
  if (!existsSync(row.storage_path)) {
    throw Object.assign(new Error('Model file missing'), { status: 404 });
  }
  return { row, buffer: readFileSync(row.storage_path) };
}

function pauseWorkflow(definitionId, ownerUserId, actor) {
  try {
    const def = getDefinition(definitionId);
    if (!def || def.owner_user_id !== ownerUserId) return;
    getDb()
      .prepare(`UPDATE agent_workflow_definitions SET paused = 1, updated_at = datetime('now') WHERE id = ?`)
      .run(definitionId);
    console.info('[avatars] paused workflow', definitionId);
  } catch (e) {
    console.warn('[avatars] pause workflow failed', definitionId, e?.message || e);
  }
}

/**
 * Map avatar ↔ agent and ensure inbound/outbound workflows from templates.
 */
export function assignAvatarAgent(ownerUserId, avatarId, agentId, actor = null) {
  ensureAvatarsSchema();
  const owner = String(ownerUserId || '').trim();
  const avatar = getAvatarForOwner(owner, avatarId);
  if (!avatar) throw Object.assign(new Error('Avatar not found'), { status: 404 });
  const agent = String(agentId || '').trim();
  if (!agent) throw Object.assign(new Error('agentId required'), { status: 400 });

  // Clear other avatars pointing at same agent (one primary per agent)
  getDb()
    .prepare(
      `UPDATE ceo_avatars SET agent_id = NULL, updated_at = datetime('now')
       WHERE owner_user_id = ? AND agent_id = ? AND id != ?`
    )
    .run(owner, agent, avatar.id);

  const agentRow = getDb().prepare(`SELECT id, name FROM agents WHERE id = ?`).get(agent);
  const agentName = agentRow?.name || agent;

  let inboundId = avatar.inbound_workflow_id;
  let outboundId = avatar.outbound_workflow_id;

  const variables = {
    avatar_id: avatar.id,
    agent_id: agent,
  };

  const actorObj = actor || { id: owner, name: 'CEO' };

  const animationCatalog = (() => {
    try {
      return JSON.parse(avatar.animation_catalog_json || '[]');
    } catch {
      return [];
    }
  })();

  const outboundGraph = buildAvatarOutboundGraph({
    agentId: agent,
    agentName,
    avatarId: avatar.id,
    animationCatalog,
    idleClip: avatar.idle_clip || null,
  });

  if (!outboundId) {
    const created = createDefinition({
      id: `avatar-out-${avatar.id}`,
      name: `Avatar outbound - ${avatar.name}`,
      description: `Auto template ${AVATAR_OUTBOUND_TEMPLATE_ID} for avatar ${avatar.id}`,
      ownerUserId: owner,
      graph: outboundGraph,
      trigger_modes: ['manual', 'event', 'chat'],
      chat_trigger_phrase: `avatar speak ${avatar.id}`,
      variables,
      actor: actorObj,
    });
    publishDefinition(created.id, owner, actorObj);
    outboundId = created.id;
  } else {
    // Always refresh from latest fast template so latency defaults stay current.
    updateDraft(outboundId, owner, { graph: outboundGraph, variables }, actorObj);
    publishDefinition(outboundId, owner, actorObj);
    getDb()
      .prepare(`UPDATE agent_workflow_definitions SET paused = 0 WHERE id = ?`)
      .run(outboundId);
  }

  const inboundGraph = buildAvatarInboundGraph({
    agentId: agent,
    agentName,
    avatarId: avatar.id,
    outboundWorkflowId: outboundId,
    animationCatalog,
    idleClip: avatar.idle_clip || null,
  });

  if (!inboundId) {
    const created = createDefinition({
      id: `avatar-in-${avatar.id}`,
      name: `Avatar inbound - ${avatar.name}`,
      description: `Auto template ${AVATAR_INBOUND_TEMPLATE_ID} for avatar ${avatar.id}`,
      ownerUserId: owner,
      graph: inboundGraph,
      trigger_modes: ['manual', 'event'],
      variables: { ...variables, outbound_workflow_id: outboundId },
      actor: actorObj,
    });
    publishDefinition(created.id, owner, actorObj);
    inboundId = created.id;
  } else {
    updateDraft(
      inboundId,
      owner,
      { graph: inboundGraph, variables: { ...variables, outbound_workflow_id: outboundId } },
      actorObj
    );
    publishDefinition(inboundId, owner, actorObj);
    getDb()
      .prepare(`UPDATE agent_workflow_definitions SET paused = 0 WHERE id = ?`)
      .run(inboundId);
  }

  getDb()
    .prepare(
      `UPDATE ceo_avatars
       SET agent_id = ?, inbound_workflow_id = ?, outbound_workflow_id = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(agent, inboundId, outboundId, avatar.id, owner);

  console.info('[avatars] assigned agent', { avatarId: avatar.id, agent, inboundId, outboundId });
  return rowToAvatar(getAvatarForOwner(owner, avatar.id));
}

export function unassignAvatarAgent(ownerUserId, avatarId, actor = null) {
  ensureAvatarsSchema();
  const avatar = getAvatarForOwner(ownerUserId, avatarId);
  if (!avatar) throw Object.assign(new Error('Avatar not found'), { status: 404 });
  if (avatar.inbound_workflow_id) pauseWorkflow(avatar.inbound_workflow_id, ownerUserId, actor);
  if (avatar.outbound_workflow_id) pauseWorkflow(avatar.outbound_workflow_id, ownerUserId, actor);
  getDb()
    .prepare(
      `UPDATE ceo_avatars SET agent_id = NULL, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
    )
    .run(avatar.id, avatar.owner_user_id);
  return rowToAvatar(getAvatarForOwner(ownerUserId, avatarId));
}

export function deleteAllAvatarsForOwner(ownerUserId) {
  ensureAvatarsSchema();
  const owner = String(ownerUserId || '').trim();
  getDb().prepare(`DELETE FROM ceo_avatars WHERE owner_user_id = ?`).run(owner);
  try {
    rmSync(avatarsDir(owner), { recursive: true, force: true });
  } catch (_) {}
}

export function avatarStorageBytes(ownerUserId) {
  ensureAvatarsSchema();
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(size_bytes, 0)), 0) AS b FROM ceo_avatars WHERE owner_user_id = ?`
    )
    .get(String(ownerUserId || '').trim());
  return Number(row?.b) || 0;
}
