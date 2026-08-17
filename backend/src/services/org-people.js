/**
 * Company People (employees / sub-users) under a CEO root tenant.
 * Invite creates a login with a password-reset link; no tenant DB and no user_agents grants.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';
import { hashPassword } from './auth/password.js';
import { createAndSendPasswordReset } from './password-reset.js';
import { revokeAllSessions } from './auth/session.js';
import {
  ensureBuiltInRoles,
  newOrgUserId,
  PLATFORM_PERMISSION_KEYS,
  ALWAYS_ON_PERMISSIONS,
} from './org-permissions.js';
import { syncOrgContextForCeo } from './org-context.js';

function db() {
  return getDb();
}

function publicPerson(row, roleRow = null, permKeys = null) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    mobile: row.mobile || '',
    role: row.role,
    enabled: !!row.enabled,
    owner_user_id: row.owner_user_id || null,
    org_role_id: row.org_role_id || null,
    org_role_name: roleRow?.name || null,
    is_ceo_delegate: !!roleRow?.is_ceo_delegate,
    department: row.department || '',
    parent_id: row.parent_id || '',
    last_login_at: row.last_login_at || null,
    created_at: row.created_at,
    permissions: permKeys,
  };
}

export function listOrgPeople(ownerUserId, { includeDisabled = true } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  ensureBuiltInRoles(owner);
  const sql = includeDisabled
    ? `SELECT * FROM platform_users WHERE owner_user_id = ? AND role = 'org_user' ORDER BY name`
    : `SELECT * FROM platform_users WHERE owner_user_id = ? AND role = 'org_user' AND enabled = 1 ORDER BY name`;
  const rows = db().prepare(sql).all(owner);
  const roles = db().prepare('SELECT * FROM org_roles WHERE owner_user_id = ?').all(owner);
  const roleMap = new Map(roles.map((r) => [r.id, r]));
  const permStmt = db().prepare('SELECT permission_key FROM org_role_permissions WHERE role_id = ?');
  return rows.map((row) => {
    const role = roleMap.get(row.org_role_id) || null;
    const extra = row.org_role_id ? permStmt.all(row.org_role_id).map((p) => p.permission_key) : [];
    const keys = role?.is_ceo_delegate
      ? [...PLATFORM_PERMISSION_KEYS]
      : [...new Set([...ALWAYS_ON_PERMISSIONS, ...extra])];
    return publicPerson(row, role, keys);
  });
}

export function getOrgPerson(ownerUserId, userId) {
  const row = db()
    .prepare(`SELECT * FROM platform_users WHERE id = ? AND owner_user_id = ? AND role = 'org_user'`)
    .get(userId, ownerUserId);
  if (!row) return null;
  const role = row.org_role_id
    ? db().prepare('SELECT * FROM org_roles WHERE id = ? AND owner_user_id = ?').get(row.org_role_id, ownerUserId)
    : null;
  const extra = row.org_role_id
    ? db()
        .prepare('SELECT permission_key FROM org_role_permissions WHERE role_id = ?')
        .all(row.org_role_id)
        .map((p) => p.permission_key)
    : [];
  const keys = role?.is_ceo_delegate
    ? [...PLATFORM_PERMISSION_KEYS]
    : [...new Set([...ALWAYS_ON_PERMISSIONS, ...extra])];
  return publicPerson(row, role, keys);
}

export async function inviteOrgPerson(ownerUserId, body = {}, { invitedBy } = {}) {
  const owner = String(ownerUserId || '').trim();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const mobile = String(body.mobile || body.phone || '').trim();
  if (!name) {
    const err = new Error('Employee name is required');
    err.status = 400;
    throw err;
  }
  if (!email || !email.includes('@')) {
    const err = new Error('Valid email is required');
    err.status = 400;
    throw err;
  }
  const existing = db().prepare('SELECT id, role FROM platform_users WHERE lower(email) = ?').get(email);
  if (existing) {
    const err = new Error('That email is already registered');
    err.status = 409;
    throw err;
  }
  const builtins = ensureBuiltInRoles(owner);
  let orgRoleId = String(body.org_role_id || builtins.member).trim();
  const role = db()
    .prepare('SELECT * FROM org_roles WHERE id = ? AND owner_user_id = ?')
    .get(orgRoleId, owner);
  if (!role) {
    orgRoleId = builtins.member;
  }
  const department = String(body.department || '').trim();
  const parentId = String(body.parent_id || '').trim();
  const id = newOrgUserId(email);
  const randomPwd = randomBytes(24).toString('hex');
  db().prepare(
    `INSERT INTO platform_users
      (id, email, password_hash, name, mobile, role, enabled, owner_user_id, org_role_id, department, parent_id)
     VALUES (?, ?, ?, ?, ?, 'org_user', 1, ?, ?, ?, ?)`
  ).run(id, email, hashPassword(randomPwd), name, mobile, owner, orgRoleId, department, parentId);

  console.info('[org-people] invited employee=%s owner=%s by=%s', id, owner, invitedBy || 'ceo');
  let invite = null;
  try {
    invite = await createAndSendPasswordReset(id, {
      createdBy: invitedBy || owner,
      initiatedByInvite: true,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
  } catch (e) {
    console.warn('[org-people] invite email failed user=%s error=%s', id, e?.message || e);
    invite = { ok: false, emailed: false, error: e?.message || String(e) };
  }
  try {
    await syncOrgContextForCeo(owner);
  } catch (e) {
    console.warn('[org-people] org sync after invite failed', e?.message || e);
  }
  return { person: getOrgPerson(owner, id), invite };
}

export function updateOrgPerson(ownerUserId, userId, body = {}) {
  const person = getOrgPerson(ownerUserId, userId);
  if (!person) {
    const err = new Error('Employee not found');
    err.status = 404;
    throw err;
  }
  if (body.org_role_id != null) {
    const role = db()
      .prepare('SELECT id FROM org_roles WHERE id = ? AND owner_user_id = ?')
      .get(String(body.org_role_id), ownerUserId);
    if (!role) {
      const err = new Error('Role not found');
      err.status = 400;
      throw err;
    }
  }
  const fields = [];
  const values = [];
  const map = {
    name: body.name,
    mobile: body.mobile != null ? body.mobile : body.phone,
    org_role_id: body.org_role_id,
    department: body.department,
    parent_id: body.parent_id,
  };
  for (const [col, val] of Object.entries(map)) {
    if (val === undefined) continue;
    fields.push(`${col} = ?`);
    values.push(typeof val === 'string' ? val.trim() : val);
  }
  if (body.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(body.enabled ? 1 : 0);
  }
  if (!fields.length) return getOrgPerson(ownerUserId, userId);
  fields.push("updated_at = datetime('now')");
  values.push(userId, ownerUserId);
  db()
    .prepare(
      `UPDATE platform_users SET ${fields.join(', ')} WHERE id = ? AND owner_user_id = ? AND role = 'org_user'`
    )
    .run(...values);
  if (body.enabled === false) {
    try {
      revokeAllSessions(userId);
    } catch (_) {}
  }
  console.info('[org-people] updated employee=%s owner=%s', userId, ownerUserId);
  return getOrgPerson(ownerUserId, userId);
}

export function listOrgRoles(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  ensureBuiltInRoles(owner);
  const roles = db()
    .prepare('SELECT * FROM org_roles WHERE owner_user_id = ? ORDER BY is_builtin DESC, name')
    .all(owner);
  const permStmt = db().prepare('SELECT permission_key FROM org_role_permissions WHERE role_id = ?');
  return roles.map((r) => ({
    ...r,
    is_ceo_delegate: !!r.is_ceo_delegate,
    is_builtin: !!r.is_builtin,
    permissions: r.is_ceo_delegate
      ? [...PLATFORM_PERMISSION_KEYS]
      : permStmt.all(r.id).map((p) => p.permission_key),
  }));
}

export function createOrgRole(ownerUserId, { name, permissions = [] } = {}) {
  const owner = String(ownerUserId || '').trim();
  const label = String(name || '').trim();
  if (!label) {
    const err = new Error('Role name is required');
    err.status = 400;
    throw err;
  }
  ensureBuiltInRoles(owner);
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'role';
  const id = `orole-${slug}-${randomBytes(3).toString('hex')}`;
  try {
    db()
      .prepare(
        `INSERT INTO org_roles (id, owner_user_id, name, slug, is_ceo_delegate, is_builtin)
         VALUES (?, ?, ?, ?, 0, 0)`
      )
      .run(id, owner, label, slug);
  } catch (e) {
    const err = new Error('Could not create role (name may already exist)');
    err.status = 409;
    throw err;
  }
  setRolePermissions(ownerUserId, id, permissions);
  return listOrgRoles(ownerUserId).find((r) => r.id === id);
}

export function setRolePermissions(ownerUserId, roleId, permissions = []) {
  const role = db()
    .prepare('SELECT * FROM org_roles WHERE id = ? AND owner_user_id = ?')
    .get(roleId, ownerUserId);
  if (!role) {
    const err = new Error('Role not found');
    err.status = 404;
    throw err;
  }
  if (role.is_ceo_delegate) {
    return listOrgRoles(ownerUserId).find((r) => r.id === roleId);
  }
  const allowed = new Set(PLATFORM_PERMISSION_KEYS.filter((k) => k !== 'people.manage'));
  const keys = [...new Set((permissions || []).map(String).filter((k) => allowed.has(k)))];
  const tx = db().transaction(() => {
    db().prepare('DELETE FROM org_role_permissions WHERE role_id = ?').run(roleId);
    const ins = db().prepare('INSERT INTO org_role_permissions (role_id, permission_key) VALUES (?, ?)');
    for (const k of keys) ins.run(roleId, k);
    db().prepare(`UPDATE org_roles SET updated_at = datetime('now') WHERE id = ?`).run(roleId);
  });
  tx();
  return listOrgRoles(ownerUserId).find((r) => r.id === roleId);
}

export function deleteOrgRole(ownerUserId, roleId) {
  const role = db()
    .prepare('SELECT * FROM org_roles WHERE id = ? AND owner_user_id = ?')
    .get(roleId, ownerUserId);
  if (!role) {
    const err = new Error('Role not found');
    err.status = 404;
    throw err;
  }
  if (role.is_builtin) {
    const err = new Error('Built-in roles cannot be deleted');
    err.status = 400;
    throw err;
  }
  const builtins = ensureBuiltInRoles(ownerUserId);
  db()
    .prepare(`UPDATE platform_users SET org_role_id = ? WHERE org_role_id = ? AND owner_user_id = ?`)
    .run(builtins.member, roleId, ownerUserId);
  db().prepare('DELETE FROM org_role_permissions WHERE role_id = ?').run(roleId);
  db().prepare('DELETE FROM org_roles WHERE id = ?').run(roleId);
  return { ok: true };
}

export function disableOrgPeopleForOwner(ownerUserId) {
  const rows = db()
    .prepare(`SELECT id FROM platform_users WHERE owner_user_id = ? AND role = 'org_user'`)
    .all(ownerUserId);
  db()
    .prepare(
      `UPDATE platform_users SET enabled = 0, updated_at = datetime('now') WHERE owner_user_id = ? AND role = 'org_user'`
    )
    .run(ownerUserId);
  for (const r of rows) {
    try {
      revokeAllSessions(r.id);
    } catch (_) {}
  }
  if (rows.length) {
    console.info('[org-people] disabled %s employees for owner=%s', rows.length, ownerUserId);
  }
  return rows.length;
}
