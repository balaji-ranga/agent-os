/**
 * Central owner-scoped IP whitelist (single source of truth).
 *
 * Feature enforcement:
 * - workflow_desktop / browser_worker / ibkr_bridge: empty list = allow any IP
 *   (tokens/secrets still required). Non-empty = must match.
 * - a2a: used only when publication access_policy is "whitelist" (empty = deny).
 *
 * Federated UIs (AgentExchange, Desktop package, Browser worker, IBKR) only write
 * this table; they do not store separate IP tables.
 */
import { randomUUID } from 'crypto';
import { isIP } from 'net';
import { getDb } from '../db/schema.js';
import {
  clientIpFromRequest,
  ipMatchesCidrOrIp,
  normalizeClientIp,
} from './ip-match.js';

export { clientIpFromRequest, ipMatchesCidrOrIp };

/** @typedef {'ibkr_bridge'|'workflow_desktop'|'a2a'|'browser_worker'} IpFeature */

export const IP_FEATURES = Object.freeze({
  IBKR_BRIDGE: 'ibkr_bridge',
  WORKFLOW_DESKTOP: 'workflow_desktop',
  A2A: 'a2a',
  BROWSER_WORKER: 'browser_worker',
});

export const IP_FEATURE_LIST = Object.freeze([
  IP_FEATURES.IBKR_BRIDGE,
  IP_FEATURES.WORKFLOW_DESKTOP,
  IP_FEATURES.A2A,
  IP_FEATURES.BROWSER_WORKER,
]);

const FEATURE_COLUMN = Object.freeze({
  [IP_FEATURES.IBKR_BRIDGE]: 'apply_ibkr_bridge',
  [IP_FEATURES.WORKFLOW_DESKTOP]: 'apply_workflow_desktop',
  [IP_FEATURES.A2A]: 'apply_a2a',
  [IP_FEATURES.BROWSER_WORKER]: 'apply_browser_worker',
});

function db() {
  return getDb();
}



/**
 * Strict IP/CIDR validation (IPv4 CIDR + exact IPv6).
 * Shared by central Settings and federated UIs.
 */
export function validateIpOrCidr(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('cidr_or_ip is required');
  if (!value.includes('/')) {
    if (!isIP(value)) throw new Error('cidr_or_ip must be a valid IPv4 or IPv6 address');
    return value;
  }
  const parts = value.split('/');
  if (parts.length !== 2 || !isIP(parts[0])) {
    throw new Error('cidr_or_ip must be a valid IP/CIDR');
  }
  const family = isIP(parts[0]);
  const prefix = Number(parts[1]);
  const max = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
    throw new Error(`CIDR prefix must be between 0 and ${max}`);
  }
  if (family === 6 && prefix !== 128) {
    throw new Error('IPv6 CIDR ranges are not supported yet; use an exact IPv6 address');
  }
  return family === 6 ? parts[0] : `${parts[0]}/${prefix}`;
}

function bool01(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  return 0;
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    cidr_or_ip: row.cidr_or_ip,
    label: row.label || '',
    apply_ibkr_bridge: !!row.apply_ibkr_bridge,
    apply_workflow_desktop: !!row.apply_workflow_desktop,
    apply_a2a: !!row.apply_a2a,
    apply_browser_worker: !!row.apply_browser_worker,
    definition_id: row.definition_id || null,
    publish_id: row.publish_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function applyFlagsFromBody(body = {}) {
  const explicit =
    body.apply ||
    body.applies_to ||
    (body.apply_ibkr_bridge != null ||
    body.apply_workflow_desktop != null ||
    body.apply_a2a != null ||
    body.apply_browser_worker != null
      ? body
      : null);

  if (!explicit) {
    return {
      apply_ibkr_bridge: 0,
      apply_workflow_desktop: 0,
      apply_a2a: 0,
      apply_browser_worker: 0,
    };
  }

  if (Array.isArray(explicit) || Array.isArray(body.features) || Array.isArray(body.apply_to)) {
    const list = Array.isArray(explicit)
      ? explicit
      : Array.isArray(body.features)
        ? body.features
        : body.apply_to;
    const set = new Set(list.map((x) => String(x).trim().toLowerCase()));
    return {
      apply_ibkr_bridge: set.has(IP_FEATURES.IBKR_BRIDGE) ? 1 : 0,
      apply_workflow_desktop: set.has(IP_FEATURES.WORKFLOW_DESKTOP) ? 1 : 0,
      apply_a2a: set.has(IP_FEATURES.A2A) ? 1 : 0,
      apply_browser_worker: set.has(IP_FEATURES.BROWSER_WORKER) ? 1 : 0,
    };
  }

  return {
    apply_ibkr_bridge: bool01(
      body.apply_ibkr_bridge ?? body.apply?.ibkr_bridge ?? explicit.ibkr_bridge
    ),
    apply_workflow_desktop: bool01(
      body.apply_workflow_desktop ??
        body.apply?.workflow_desktop ??
        explicit.workflow_desktop
    ),
    apply_a2a: bool01(body.apply_a2a ?? body.apply?.a2a ?? explicit.a2a),
    apply_browser_worker: bool01(
      body.apply_browser_worker ?? body.apply?.browser_worker ?? explicit.browser_worker
    ),
  };
}

function ensureAtLeastOneApply(flags) {
  if (
    !flags.apply_ibkr_bridge &&
    !flags.apply_workflow_desktop &&
    !flags.apply_a2a &&
    !flags.apply_browser_worker
  ) {
    throw new Error(
      'Select at least one target: IBKR bridge, Workflow download, A2A, or Browser Session package'
    );
  }
}

/**
 * Create central table + one-time migrate from legacy per-feature tables.
 * Safe to call from schema init.
 */
export function ensureOwnerIpWhitelistTables() {
  const d = db();
  d.exec(`
    CREATE TABLE IF NOT EXISTS owner_ip_whitelists (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      cidr_or_ip TEXT NOT NULL,
      label TEXT DEFAULT '',
      apply_ibkr_bridge INTEGER NOT NULL DEFAULT 0,
      apply_workflow_desktop INTEGER NOT NULL DEFAULT 0,
      apply_a2a INTEGER NOT NULL DEFAULT 0,
      apply_browser_worker INTEGER NOT NULL DEFAULT 0,
      definition_id TEXT,
      publish_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (owner_user_id) REFERENCES platform_users(id) ON DELETE CASCADE
    )
  `);
  d.exec(
    `CREATE INDEX IF NOT EXISTS idx_owner_ip_wl_owner
     ON owner_ip_whitelists(owner_user_id, created_at DESC)`
  );
  d.exec(
    `CREATE INDEX IF NOT EXISTS idx_owner_ip_wl_desktop
     ON owner_ip_whitelists(owner_user_id, apply_workflow_desktop, definition_id)`
  );
  d.exec(
    `CREATE INDEX IF NOT EXISTS idx_owner_ip_wl_a2a
     ON owner_ip_whitelists(owner_user_id, apply_a2a, publish_id)`
  );

  d.exec(`
    CREATE TABLE IF NOT EXISTS owner_ip_whitelist_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  const migrated = d
    .prepare(`SELECT value FROM owner_ip_whitelist_meta WHERE key = 'central_v1'`)
    .get();
  if (migrated?.value === '1') return;

  try {
    migrateLegacyIntoCentral(d);
    d.prepare(
      `INSERT INTO owner_ip_whitelist_meta (key, value, updated_at)
       VALUES ('central_v1', '1', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    ).run();
    console.info('[owner-ip-whitelist] migrated legacy IP whitelist rows into owner_ip_whitelists');
  } catch (e) {
    console.warn('[owner-ip-whitelist] migration skipped/failed: %s', e.message || e);
  }
}

function migrateLegacyIntoCentral(d) {
  const insert = d.prepare(
    `INSERT INTO owner_ip_whitelists
     (id, owner_user_id, cidr_or_ip, label, apply_ibkr_bridge, apply_workflow_desktop,
      apply_a2a, apply_browser_worker, definition_id, publish_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))`
  );

  const tableExists = (name) =>
    !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);

  if (tableExists('workflow_desktop_ip_whitelist')) {
    const rows = d
      .prepare(
        `SELECT id, owner_user_id, definition_id, cidr_or_ip, label, created_at
         FROM workflow_desktop_ip_whitelist`
      )
      .all();
    for (const r of rows) {
      try {
        insert.run(
          r.id || randomUUID(),
          r.owner_user_id,
          String(r.cidr_or_ip || '').trim(),
          r.label || '',
          0,
          1,
          0,
          0,
          r.definition_id || null,
          null,
          r.created_at || null
        );
      } catch (_) {
        /* dup id */
      }
    }
  }

  if (tableExists('browser_worker_ip_whitelist')) {
    const rows = d
      .prepare(
        `SELECT id, owner_user_id, cidr_or_ip, label, created_at FROM browser_worker_ip_whitelist`
      )
      .all();
    for (const r of rows) {
      try {
        insert.run(
          r.id || randomUUID(),
          r.owner_user_id,
          String(r.cidr_or_ip || '').trim(),
          r.label || '',
          0,
          0,
          0,
          1,
          null,
          null,
          r.created_at || null
        );
      } catch (_) {}
    }
  }

  if (tableExists('workflow_a2a_ip_whitelist')) {
    const rows = d
      .prepare(
        `SELECT id, publish_id, owner_user_id, cidr_or_ip, label, created_at
         FROM workflow_a2a_ip_whitelist`
      )
      .all();
    for (const r of rows) {
      try {
        insert.run(
          r.id || randomUUID(),
          r.owner_user_id,
          String(r.cidr_or_ip || '').trim(),
          r.label || '',
          0,
          0,
          1,
          0,
          null,
          r.publish_id || null,
          r.created_at || null
        );
      } catch (_) {}
    }
  }
}

/**
 * List entries for an owner (optionally filter by feature/scope).
 */
export function listOwnerIpWhitelists(
  ownerUserId,
  { feature = null, definitionId = undefined, publishId = undefined } = {}
) {
  ensureOwnerIpWhitelistTables();
  let rows = db()
    .prepare(
      `SELECT * FROM owner_ip_whitelists
       WHERE owner_user_id = ?
       ORDER BY created_at DESC`
    )
    .all(ownerUserId);

  if (feature) {
    const col = FEATURE_COLUMN[feature];
    if (!col) throw new Error(`Unknown feature: ${feature}`);
    rows = rows.filter((r) => r[col]);
  }

  if (feature === IP_FEATURES.WORKFLOW_DESKTOP && definitionId !== undefined) {
    const defId = definitionId || null;
    rows = rows.filter(
      (r) => r.definition_id == null || r.definition_id === '' || r.definition_id === defId
    );
  }

  if (feature === IP_FEATURES.A2A && publishId !== undefined) {
    const pub = publishId || null;
    rows = rows.filter(
      (r) => r.publish_id == null || r.publish_id === '' || r.publish_id === pub
    );
  }

  return rows.map(rowToEntry);
}

export function getOwnerIpWhitelistEntry(entryId, ownerUserId) {
  ensureOwnerIpWhitelistTables();
  const row = db()
    .prepare(`SELECT * FROM owner_ip_whitelists WHERE id = ? AND owner_user_id = ?`)
    .get(entryId, ownerUserId);
  return rowToEntry(row);
}

/**
 * Add or merge: same owner+cidr (+same scope keys) ORs apply flags.
 */
export function addOwnerIpWhitelistEntry(ownerUserId, body = {}) {
  ensureOwnerIpWhitelistTables();
  const rule = validateIpOrCidr(body.cidr_or_ip ?? body.cidrOrIp ?? body.ip);
  const label = String(body.label || '').trim();
  let flags = applyFlagsFromBody(body);

  // Federated convenience defaults
  if (
    !flags.apply_ibkr_bridge &&
    !flags.apply_workflow_desktop &&
    !flags.apply_a2a &&
    !flags.apply_browser_worker
  ) {
    if (body.feature) {
      const f = String(body.feature).trim().toLowerCase();
      if (f === IP_FEATURES.IBKR_BRIDGE) flags.apply_ibkr_bridge = 1;
      else if (f === IP_FEATURES.WORKFLOW_DESKTOP) flags.apply_workflow_desktop = 1;
      else if (f === IP_FEATURES.A2A) flags.apply_a2a = 1;
      else if (f === IP_FEATURES.BROWSER_WORKER) flags.apply_browser_worker = 1;
    }
  }
  ensureAtLeastOneApply(flags);

  const definitionId =
    body.definition_id != null || body.definitionId != null
      ? String(body.definition_id ?? body.definitionId ?? '').trim() || null
      : null;
  const publishId =
    body.publish_id != null || body.publishId != null
      ? String(body.publish_id ?? body.publishId ?? '').trim() || null
      : null;

  // Merge if identical scope key exists for this owner+cidr
  const existing = db()
    .prepare(
      `SELECT * FROM owner_ip_whitelists
       WHERE owner_user_id = ? AND cidr_or_ip = ?
         AND IFNULL(definition_id,'') = IFNULL(?, '')
         AND IFNULL(publish_id,'') = IFNULL(?, '')`
    )
    .get(ownerUserId, rule, definitionId, publishId);

  if (existing) {
    const next = {
      apply_ibkr_bridge: existing.apply_ibkr_bridge || flags.apply_ibkr_bridge ? 1 : 0,
      apply_workflow_desktop:
        existing.apply_workflow_desktop || flags.apply_workflow_desktop ? 1 : 0,
      apply_a2a: existing.apply_a2a || flags.apply_a2a ? 1 : 0,
      apply_browser_worker:
        existing.apply_browser_worker || flags.apply_browser_worker ? 1 : 0,
    };
    db()
      .prepare(
        `UPDATE owner_ip_whitelists
         SET label = CASE WHEN ? != '' THEN ? ELSE label END,
             apply_ibkr_bridge = ?,
             apply_workflow_desktop = ?,
             apply_a2a = ?,
             apply_browser_worker = ?,
             updated_at = datetime('now')
         WHERE id = ? AND owner_user_id = ?`
      )
      .run(
        label,
        label,
        next.apply_ibkr_bridge,
        next.apply_workflow_desktop,
        next.apply_a2a,
        next.apply_browser_worker,
        existing.id,
        ownerUserId
      );
    console.info(
      '[owner-ip-whitelist] merge owner=%s id=%s rule=%s',
      ownerUserId,
      existing.id,
      rule
    );
    return getOwnerIpWhitelistEntry(existing.id, ownerUserId);
  }

  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO owner_ip_whitelists
       (id, owner_user_id, cidr_or_ip, label, apply_ibkr_bridge, apply_workflow_desktop,
        apply_a2a, apply_browser_worker, definition_id, publish_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      ownerUserId,
      rule,
      label,
      flags.apply_ibkr_bridge,
      flags.apply_workflow_desktop,
      flags.apply_a2a,
      flags.apply_browser_worker,
      definitionId,
      publishId
    );
  console.info(
    '[owner-ip-whitelist] add owner=%s id=%s rule=%s desktop=%s a2a=%s browser=%s ibkr=%s',
    ownerUserId,
    id,
    rule,
    flags.apply_workflow_desktop,
    flags.apply_a2a,
    flags.apply_browser_worker,
    flags.apply_ibkr_bridge
  );
  return getOwnerIpWhitelistEntry(id, ownerUserId);
}

export function updateOwnerIpWhitelistEntry(entryId, ownerUserId, body = {}) {
  ensureOwnerIpWhitelistTables();
  const cur = getOwnerIpWhitelistEntry(entryId, ownerUserId);
  if (!cur) return null;

  let rule = cur.cidr_or_ip;
  if (body.cidr_or_ip != null || body.cidrOrIp != null) {
    rule = validateIpOrCidr(body.cidr_or_ip ?? body.cidrOrIp);
  }
  const label = body.label != null ? String(body.label).trim() : cur.label;

  const flags = {
    apply_ibkr_bridge:
      body.apply_ibkr_bridge != null || body.apply?.ibkr_bridge != null
        ? bool01(body.apply_ibkr_bridge ?? body.apply?.ibkr_bridge)
        : cur.apply_ibkr_bridge
          ? 1
          : 0,
    apply_workflow_desktop:
      body.apply_workflow_desktop != null || body.apply?.workflow_desktop != null
        ? bool01(body.apply_workflow_desktop ?? body.apply?.workflow_desktop)
        : cur.apply_workflow_desktop
          ? 1
          : 0,
    apply_a2a:
      body.apply_a2a != null || body.apply?.a2a != null
        ? bool01(body.apply_a2a ?? body.apply?.a2a)
        : cur.apply_a2a
          ? 1
          : 0,
    apply_browser_worker:
      body.apply_browser_worker != null || body.apply?.browser_worker != null
        ? bool01(body.apply_browser_worker ?? body.apply?.browser_worker)
        : cur.apply_browser_worker
          ? 1
          : 0,
  };
  ensureAtLeastOneApply(flags);

  let definitionId = cur.definition_id;
  if (body.definition_id !== undefined || body.definitionId !== undefined) {
    definitionId =
      String(body.definition_id ?? body.definitionId ?? '').trim() || null;
  }
  let publishId = cur.publish_id;
  if (body.publish_id !== undefined || body.publishId !== undefined) {
    publishId = String(body.publish_id ?? body.publishId ?? '').trim() || null;
  }

  db()
    .prepare(
      `UPDATE owner_ip_whitelists
       SET cidr_or_ip = ?, label = ?,
           apply_ibkr_bridge = ?, apply_workflow_desktop = ?,
           apply_a2a = ?, apply_browser_worker = ?,
           definition_id = ?, publish_id = ?,
           updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(
      rule,
      label,
      flags.apply_ibkr_bridge,
      flags.apply_workflow_desktop,
      flags.apply_a2a,
      flags.apply_browser_worker,
      definitionId,
      publishId,
      entryId,
      ownerUserId
    );
  console.info('[owner-ip-whitelist] update owner=%s id=%s rule=%s', ownerUserId, entryId, rule);
  return getOwnerIpWhitelistEntry(entryId, ownerUserId);
}

export function removeOwnerIpWhitelistEntry(entryId, ownerUserId) {
  ensureOwnerIpWhitelistTables();
  const r = db()
    .prepare(`DELETE FROM owner_ip_whitelists WHERE id = ? AND owner_user_id = ?`)
    .run(entryId, ownerUserId);
  if (r.changes > 0) {
    console.info('[owner-ip-whitelist] remove owner=%s id=%s', ownerUserId, entryId);
  }
  return r.changes > 0;
}

/** Clear A2A-scoped rows for a publication (on unpublish). Keeps owner-wide A2A rows. */
export function removeA2AScopedWhitelistEntries(publishId, ownerUserId = null) {
  ensureOwnerIpWhitelistTables();
  if (ownerUserId) {
    return (
      db()
        .prepare(
          `DELETE FROM owner_ip_whitelists
           WHERE publish_id = ? AND owner_user_id = ? AND apply_a2a = 1`
        )
        .run(publishId, ownerUserId).changes > 0
    );
  }
  return (
    db()
      .prepare(`DELETE FROM owner_ip_whitelists WHERE publish_id = ? AND apply_a2a = 1`)
      .run(publishId).changes > 0
  );
}

/**
 * Optional-whitelist semantics (desktop / browser / ibkr):
 * no matching feature rows 뿯↽ allow; non-empty 뿯↽ must match IP.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertFeatureIpAllowed(
  ownerUserId,
  feature,
  clientIp,
  { definitionId = null, publishId = null } = {}
) {
  ensureOwnerIpWhitelistTables();
  const col = FEATURE_COLUMN[feature];
  if (!col) return { ok: false, reason: `Unknown IP feature: ${feature}` };

  let sql = `SELECT cidr_or_ip, definition_id, publish_id FROM owner_ip_whitelists
             WHERE owner_user_id = ? AND ${col} = 1`;
  const params = [ownerUserId];

  if (feature === IP_FEATURES.WORKFLOW_DESKTOP) {
    sql += ` AND (definition_id IS NULL OR definition_id = ? OR definition_id = '')`;
    params.push(definitionId || '');
  }
  if (feature === IP_FEATURES.A2A) {
    sql += ` AND (publish_id IS NULL OR publish_id = ? OR publish_id = '')`;
    params.push(publishId || '');
  }

  const rows = db().prepare(sql).all(...params);
  if (!rows.length) {
    // Empty optional whitelist = allow (A2A empty deny is handled by checkA2AClientIp).
    if (feature === IP_FEATURES.A2A) {
      return { ok: false, reason: 'This A2A agent whitelist is empty' };
    }
    return { ok: true };
  }

  const ip = normalizeClientIp(clientIp);
  if (!ip) return { ok: false, reason: 'Client IP could not be determined' };
  const hit = rows.some((row) => ipMatchesCidrOrIp(ip, row.cidr_or_ip));
  if (!hit) {
    const labels = {
      [IP_FEATURES.IBKR_BRIDGE]: 'IBKR bridge',
      [IP_FEATURES.WORKFLOW_DESKTOP]: 'desktop',
      [IP_FEATURES.A2A]: 'A2A agent',
      [IP_FEATURES.BROWSER_WORKER]: 'browser worker',
    };
    return {
      ok: false,
      reason: `Client IP ${ip} is not on the ${labels[feature] || feature} whitelist`,
    };
  }
  return { ok: true };
}

/**
 * CIDR strings only for a feature (A2A policy check helper).
 */
export function listFeatureCidrs(
  ownerUserId,
  feature,
  { definitionId = null, publishId = null } = {}
) {
  return listOwnerIpWhitelists(ownerUserId, {
    feature,
    definitionId: feature === IP_FEATURES.WORKFLOW_DESKTOP ? definitionId : undefined,
    publishId: feature === IP_FEATURES.A2A ? publishId : undefined,
  }).map((e) => e.cidr_or_ip);
}
