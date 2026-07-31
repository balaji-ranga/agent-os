/**
 * CEO Virtual Rooms: named rooms with avatar members, scene, layout.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';
import { getAvatarForOwner, ensureAvatarsSchema } from './ceo-avatars.js';
import {
  ensureVrScenesSchema,
  getVrSceneForOwner,
  sceneModelApiPath,
} from './ceo-vr-scenes.js';

export function ensureVrRoomsSchema() {
  ensureAvatarsSchema();
  ensureVrScenesSchema();
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ceo_vr_rooms (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      scene_id TEXT,
      layout_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ceo_vr_rooms_owner ON ceo_vr_rooms(owner_user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ceo_vr_room_members (
      room_id TEXT NOT NULL,
      avatar_id TEXT NOT NULL,
      agent_id TEXT,
      handle TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      PRIMARY KEY (room_id, avatar_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ceo_vr_room_members_room ON ceo_vr_room_members(room_id, sort_order);
  `);
  for (const col of [
    `ALTER TABLE ceo_vr_rooms ADD COLUMN published INTEGER DEFAULT 0`,
    `ALTER TABLE ceo_vr_rooms ADD COLUMN public_slug TEXT`,
    `ALTER TABLE ceo_vr_rooms ADD COLUMN published_at TEXT`,
    `ALTER TABLE ceo_vr_rooms ADD COLUMN publish_title TEXT`,
    `ALTER TABLE ceo_vr_rooms ADD COLUMN public_token TEXT`,
  ]) {
    try {
      db.exec(col);
    } catch (_) {
      /* already migrated */
    }
  }
  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ceo_vr_rooms_slug ON ceo_vr_rooms(public_slug) WHERE public_slug IS NOT NULL`);
  } catch (_) {}
}

function newRoomId() {
  return `vrr_${randomBytes(10).toString('hex')}`;
}

export function slugifyHandle(name) {
  const s = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'member';
}

function parseJson(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function getRoomRow(ownerUserId, roomId) {
  return (
    getDb()
      .prepare(`SELECT * FROM ceo_vr_rooms WHERE id = ? AND owner_user_id = ?`)
      .get(String(roomId || '').trim(), String(ownerUserId || '').trim()) || null
  );
}

function listMembers(roomId) {
  return getDb()
    .prepare(
      `SELECT m.*, a.name AS avatar_name, a.filename AS avatar_filename,
              a.outbound_workflow_id, a.inbound_workflow_id, a.idle_clip,
              a.animation_catalog_json
       FROM ceo_vr_room_members m
       LEFT JOIN ceo_avatars a ON a.id = m.avatar_id
       WHERE m.room_id = ?
       ORDER BY m.sort_order ASC, m.avatar_id ASC`
    )
    .all(String(roomId || '').trim());
}

function uniqueHandle(roomId, base, excludeAvatarId = null) {
  let handle = slugifyHandle(base);
  const taken = new Set(
    listMembers(roomId)
      .filter((m) => !excludeAvatarId || m.avatar_id !== excludeAvatarId)
      .map((m) => String(m.handle || '').toLowerCase())
  );
  if (!taken.has(handle)) return handle;
  let i = 2;
  while (taken.has(`${handle}${i}`) && i < 100) i += 1;
  return `${handle}${i}`;
}

function hydrateRoom(row, { includeScene = true } = {}) {
  if (!row) return null;
  const layout = parseJson(row.layout_json, {});
  const members = listMembers(row.id).map((m) => {
    let catalog = [];
    try {
      catalog = JSON.parse(m.animation_catalog_json || '[]');
    } catch {
      catalog = [];
    }
    const pos = layout?.members?.[m.avatar_id] || layout?.members?.[m.handle] || null;
    return {
      avatar_id: m.avatar_id,
      agent_id: m.agent_id || null,
      handle: m.handle,
      sort_order: m.sort_order,
      name: m.avatar_name || m.handle,
      model_url: `/avatars/${encodeURIComponent(m.avatar_id)}/model`,
      outbound_workflow_id: m.outbound_workflow_id || null,
      inbound_workflow_id: m.inbound_workflow_id || null,
      idle_clip: m.idle_clip || null,
      animation_catalog: Array.isArray(catalog) ? catalog : [],
      position: pos,
    };
  });

  let scene = null;
  if (includeScene && row.scene_id) {
    const s = getVrSceneForOwner(row.owner_user_id, row.scene_id);
    if (s) {
      scene = {
        id: s.id,
        name: s.name,
        filename: s.filename,
        model_url: sceneModelApiPath(s.id),
        scene_json: parseJson(s.scene_json, {}),
      };
    }
  }

  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    scene_id: row.scene_id || null,
    layout_json: layout,
    scene,
    members,
    published: !!Number(row.published || 0),
    public_slug: row.public_slug || null,
    publish_title: row.publish_title || null,
    published_at: row.published_at || null,
    public_url: row.public_slug && Number(row.published || 0) ? `/p/vr/${encodeURIComponent(row.public_slug)}` : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listVrRooms(ownerUserId) {
  ensureVrRoomsSchema();
  return getDb()
    .prepare(`SELECT * FROM ceo_vr_rooms WHERE owner_user_id = ? ORDER BY updated_at DESC`)
    .all(String(ownerUserId || '').trim())
    .map((r) => hydrateRoom(r, { includeScene: true }));
}

export function getVrRoomForOwner(ownerUserId, roomId) {
  ensureVrRoomsSchema();
  const row = getRoomRow(ownerUserId, roomId);
  return hydrateRoom(row);
}

export function createVrRoom(ownerUserId, opts = {}) {
  ensureVrRoomsSchema();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });
  const name = String(opts.name || 'Virtual Room').trim().slice(0, 120) || 'Virtual Room';
  let sceneId = opts.sceneId || opts.scene_id || null;
  if (sceneId) {
    const s = getVrSceneForOwner(owner, sceneId);
    if (!s) throw Object.assign(new Error('Scene not found'), { status: 404 });
  }
  const id = newRoomId();
  getDb()
    .prepare(
      `INSERT INTO ceo_vr_rooms (id, owner_user_id, name, scene_id, layout_json)
       VALUES (?, ?, ?, ?, '{}')`
    )
    .run(id, owner, name, sceneId);
  console.info('[vr-rooms] created', { id, owner, name });
  return getVrRoomForOwner(owner, id);
}

export function updateVrRoom(ownerUserId, roomId, patch = {}) {
  ensureVrRoomsSchema();
  const row = getRoomRow(ownerUserId, roomId);
  if (!row) return null;
  const name = patch.name != null ? String(patch.name).trim().slice(0, 120) : row.name;
  let sceneId = row.scene_id;
  if (Object.prototype.hasOwnProperty.call(patch, 'sceneId') || Object.prototype.hasOwnProperty.call(patch, 'scene_id')) {
    sceneId = patch.sceneId ?? patch.scene_id ?? null;
    if (sceneId) {
      const s = getVrSceneForOwner(ownerUserId, sceneId);
      if (!s) throw Object.assign(new Error('Scene not found'), { status: 404 });
    }
  }
  let layoutJson = row.layout_json;
  if (Object.prototype.hasOwnProperty.call(patch, 'layoutJson') || Object.prototype.hasOwnProperty.call(patch, 'layout_json')) {
    layoutJson = JSON.stringify(parseJson(patch.layoutJson ?? patch.layout_json, {}));
  }
  getDb()
    .prepare(
      `UPDATE ceo_vr_rooms SET name = ?, scene_id = ?, layout_json = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(name, sceneId, typeof layoutJson === 'string' ? layoutJson : JSON.stringify(layoutJson), row.id, row.owner_user_id);
  return getVrRoomForOwner(ownerUserId, roomId);
}

export function deleteVrRoom(ownerUserId, roomId) {
  ensureVrRoomsSchema();
  const row = getRoomRow(ownerUserId, roomId);
  if (!row) return false;
  getDb().prepare(`DELETE FROM ceo_vr_room_members WHERE room_id = ?`).run(row.id);
  getDb().prepare(`DELETE FROM ceo_vr_rooms WHERE id = ? AND owner_user_id = ?`).run(row.id, row.owner_user_id);
  return true;
}

export function addVrRoomMember(ownerUserId, roomId, avatarId) {
  ensureVrRoomsSchema();
  const room = getRoomRow(ownerUserId, roomId);
  if (!room) throw Object.assign(new Error('Room not found'), { status: 404 });
  const avatar = getAvatarForOwner(ownerUserId, avatarId);
  if (!avatar) throw Object.assign(new Error('Avatar not found'), { status: 404 });
  if (!avatar.agent_id) {
    throw Object.assign(new Error('Avatar must be assigned to an agent before joining a room'), { status: 400 });
  }
  const existing = getDb()
    .prepare(`SELECT 1 FROM ceo_vr_room_members WHERE room_id = ? AND avatar_id = ?`)
    .get(room.id, avatar.id);
  if (existing) return getVrRoomForOwner(ownerUserId, roomId);

  const handle = uniqueHandle(room.id, avatar.name || avatar.id);
  const maxSort =
    getDb()
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM ceo_vr_room_members WHERE room_id = ?`)
      .get(room.id)?.m ?? -1;
  getDb()
    .prepare(
      `INSERT INTO ceo_vr_room_members (room_id, avatar_id, agent_id, handle, sort_order)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(room.id, avatar.id, avatar.agent_id, handle, Number(maxSort) + 1);

  // Default spawn offset if no layout yet
  const layout = parseJson(room.layout_json, {});
  if (!layout.members) layout.members = {};
  if (!layout.members[avatar.id]) {
    const n = listMembers(room.id).length;
    layout.members[avatar.id] = { x: (n - 1) * 1.4 - 0.7, y: 0, z: 0 };
    getDb()
      .prepare(`UPDATE ceo_vr_rooms SET layout_json = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(layout), room.id);
  } else {
    getDb()
      .prepare(`UPDATE ceo_vr_rooms SET updated_at = datetime('now') WHERE id = ?`)
      .run(room.id);
  }
  console.info('[vr-rooms] member added', { roomId: room.id, avatarId: avatar.id, handle });
  return getVrRoomForOwner(ownerUserId, roomId);
}

export function removeVrRoomMember(ownerUserId, roomId, avatarId) {
  ensureVrRoomsSchema();
  const room = getRoomRow(ownerUserId, roomId);
  if (!room) return null;
  getDb()
    .prepare(`DELETE FROM ceo_vr_room_members WHERE room_id = ? AND avatar_id = ?`)
    .run(room.id, String(avatarId || '').trim());
  const layout = parseJson(room.layout_json, {});
  if (layout.members && layout.members[avatarId]) {
    delete layout.members[avatarId];
    getDb()
      .prepare(`UPDATE ceo_vr_rooms SET layout_json = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(layout), room.id);
  } else {
    getDb().prepare(`UPDATE ceo_vr_rooms SET updated_at = datetime('now') WHERE id = ?`).run(room.id);
  }
  return getVrRoomForOwner(ownerUserId, roomId);
}

export function patchVrRoomLayout(ownerUserId, roomId, layoutPatch) {
  ensureVrRoomsSchema();
  const room = getRoomRow(ownerUserId, roomId);
  if (!room) return null;
  const current = parseJson(room.layout_json, {});
  const next = {
    ...current,
    ...parseJson(layoutPatch, {}),
    members: {
      ...(current.members || {}),
      ...(parseJson(layoutPatch, {}).members || {}),
    },
  };
  getDb()
    .prepare(`UPDATE ceo_vr_rooms SET layout_json = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`)
    .run(JSON.stringify(next), room.id, room.owner_user_id);
  return getVrRoomForOwner(ownerUserId, roomId);
}

/**
 * Find or create a single-member room for an agent (legacy /agents/:id/virtual-room redirect).
 */
export function ensurePrimaryRoomForAgent(ownerUserId, agentId) {
  ensureVrRoomsSchema();
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  const avatar = getDb()
    .prepare(`SELECT * FROM ceo_avatars WHERE owner_user_id = ? AND agent_id = ? ORDER BY updated_at DESC LIMIT 1`)
    .get(owner, agent);
  if (!avatar) return null;

  const existing = getDb()
    .prepare(
      `SELECT r.* FROM ceo_vr_rooms r
       INNER JOIN ceo_vr_room_members m ON m.room_id = r.id
       WHERE r.owner_user_id = ? AND m.avatar_id = ?
       ORDER BY r.updated_at DESC LIMIT 1`
    )
    .get(owner, avatar.id);
  if (existing) return getVrRoomForOwner(owner, existing.id);

  const room = createVrRoom(owner, { name: `${avatar.name || 'Avatar'} Room` });
  return addVrRoomMember(owner, room.id, avatar.id);
}

function slugifyPublic(name) {
  const base = String(name || 'room')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'room';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export function listPublishedVrRoomsForOwner(ownerUserId) {
  ensureVrRoomsSchema();
  return getDb()
    .prepare(
      `SELECT * FROM ceo_vr_rooms WHERE owner_user_id = ? AND published = 1 ORDER BY published_at DESC, updated_at DESC`
    )
    .all(String(ownerUserId || '').trim())
    .map((r) => hydrateRoom(r));
}

export function publishVrRoom(ownerUserId, roomId, opts = {}) {
  ensureVrRoomsSchema();
  const row = getRoomRow(ownerUserId, roomId);
  if (!row) throw Object.assign(new Error('Room not found'), { status: 404 });
  const members = listMembers(row.id);
  if (!members.length) {
    throw Object.assign(new Error('Add at least one member before publishing'), { status: 400 });
  }
  let slug = row.public_slug;
  if (!slug) {
    slug = slugifyPublic(opts.title || row.name);
    // ensure unique
    while (getDb().prepare(`SELECT 1 FROM ceo_vr_rooms WHERE public_slug = ?`).get(slug)) {
      slug = slugifyPublic(opts.title || row.name);
    }
  }
  const token = row.public_token || randomBytes(24).toString('hex');
  const title = opts.title != null ? String(opts.title).slice(0, 120) : row.publish_title || row.name;
  getDb()
    .prepare(
      `UPDATE ceo_vr_rooms SET published = 1, public_slug = ?, public_token = ?, publish_title = ?,
       published_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(slug, token, title, row.id, row.owner_user_id);
  console.info('[vr-rooms] published', { id: row.id, slug });
  return getVrRoomForOwner(ownerUserId, roomId);
}

export function unpublishVrRoom(ownerUserId, roomId) {
  ensureVrRoomsSchema();
  const row = getRoomRow(ownerUserId, roomId);
  if (!row) throw Object.assign(new Error('Room not found'), { status: 404 });
  getDb()
    .prepare(
      `UPDATE ceo_vr_rooms SET published = 0, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
    )
    .run(row.id, row.owner_user_id);
  console.info('[vr-rooms] unpublished', { id: row.id });
  return getVrRoomForOwner(ownerUserId, roomId);
}

export function getPublishedVrRoomBySlug(slug) {
  ensureVrRoomsSchema();
  const row = getDb()
    .prepare(`SELECT * FROM ceo_vr_rooms WHERE public_slug = ? AND published = 1`)
    .get(String(slug || '').trim());
  if (!row) return null;
  const room = hydrateRoom(row);
  // Guest-safe: rewrite model URLs to public paths
  const token = row.public_token;
  if (room.members) {
    room.members = room.members.map((m) => ({
      ...m,
      model_url: `/public/vr/${encodeURIComponent(row.public_slug)}/avatars/${encodeURIComponent(m.avatar_id)}/model?t=${encodeURIComponent(token)}`,
      outbound_workflow_id: undefined,
      inbound_workflow_id: undefined,
    }));
  }
  if (room.scene?.id) {
    room.scene = {
      ...room.scene,
      model_url: `/public/vr/${encodeURIComponent(row.public_slug)}/scenes/${encodeURIComponent(room.scene.id)}/model?t=${encodeURIComponent(token)}`,
    };
  }
  room.public_token = token;
  delete room.owner_user_id;
  return room;
}

export function getPublishedRoomRowBySlug(slug) {
  ensureVrRoomsSchema();
  return (
    getDb()
      .prepare(`SELECT * FROM ceo_vr_rooms WHERE public_slug = ? AND published = 1`)
      .get(String(slug || '').trim()) || null
  );
}

export function assertPublicToken(slug, token) {
  const row = getPublishedRoomRowBySlug(slug);
  if (!row) return null;
  if (!token || String(token) !== String(row.public_token || '')) return null;
  return row;
}