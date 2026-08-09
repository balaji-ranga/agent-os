/**
 * Owner-scoped external package tokens (workflow desktop, IBKR bridge, browser session).
 * Full secrets never listed — only prefixes / package names for management + revoke.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { revokeDesktopToken } from './agent-workflow-desktop-auth.js';
import {
  listBrowserWorkerTokens,
  revokeBrowserWorkerToken,
} from './browser-worker-auth.js';

export const TOKEN_KINDS = Object.freeze({
  WORKFLOW_DESKTOP: 'workflow_desktop',
  IBKR_BRIDGE: 'ibkr_bridge',
  BROWSER_SESSION: 'browser_session',
});

export const ISSUER_LABELS = Object.freeze({
  [TOKEN_KINDS.WORKFLOW_DESKTOP]: 'Workflow desktop',
  [TOKEN_KINDS.IBKR_BRIDGE]: 'IBKR bridge',
  [TOKEN_KINDS.BROWSER_SESSION]: 'Browser session package',
});

export function ensureExternalTokenTables(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ibkr_bridge_tokens (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      expires_at TEXT,
      revoked_at TEXT,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ibkr_bridge_tokens_owner
      ON ibkr_bridge_tokens(owner_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ibkr_bridge_tokens_hash
      ON ibkr_bridge_tokens(token_hash);
  `);
}

function db() {
  return getDb();
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function statusOf(row) {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at) {
    const exp = Date.parse(row.expires_at);
    if (Number.isFinite(exp) && exp < Date.now()) return 'expired';
  }
  return 'active';
}

function maskPrefix(prefix, kind) {
  const p = String(prefix || '').trim();
  if (!p) return '—';
  if (kind === TOKEN_KINDS.WORKFLOW_DESKTOP) {
    return p.startsWith('dsk_') ? `${p}…` : `dsk_${p}…`;
  }
  if (kind === TOKEN_KINDS.BROWSER_SESSION) {
    return p.startsWith('bwk_') ? `${p}…` : `${p}…`;
  }
  return `${p}…`;
}

export function recordIbkrBridgeToken(ownerUserId, plaintext, { name = '' } = {}) {
  ensureExternalTokenTables();
  const owner = String(ownerUserId || '').trim();
  const token = String(plaintext || '').trim();
  if (!owner || !token) throw new Error('owner and token required');
  const id = randomUUID();
  const prefix = token.slice(0, 8);
  const pkgName = String(name || '').trim() || 'Local IBKR bridge package';
  db()
    .prepare(
      `INSERT INTO ibkr_bridge_tokens
         (id, owner_user_id, name, token_hash, token_prefix)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, owner, pkgName, hashToken(token), prefix);
  console.info(
    '[external-tokens] ibkr bridge token mint owner=%s id=%s prefix=%s',
    owner,
    id,
    prefix
  );
  return { id, token_prefix: prefix, name: pkgName };
}

function listIbkrBridgeTokens(ownerUserId) {
  ensureExternalTokenTables();
  return db()
    .prepare(
      `SELECT id, owner_user_id, name, token_prefix, expires_at, revoked_at, last_used_at, created_at
       FROM ibkr_bridge_tokens
       WHERE owner_user_id = ?
       ORDER BY datetime(created_at) DESC`
    )
    .all(String(ownerUserId || '').trim());
}

export function revokeIbkrBridgeToken(tokenId, ownerUserId) {
  ensureExternalTokenTables();
  const r = db()
    .prepare(
      `UPDATE ibkr_bridge_tokens SET revoked_at = datetime('now')
       WHERE id = ? AND owner_user_id = ? AND revoked_at IS NULL`
    )
    .run(String(tokenId || ''), String(ownerUserId || ''));
  if (r.changes > 0) {
    console.info(
      '[external-tokens] ibkr bridge token revoked owner=%s id=%s',
      ownerUserId,
      tokenId
    );
  }
  return r.changes > 0;
}

function listWorkflowDesktopForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  return db()
    .prepare(
      `SELECT t.id, t.definition_id, t.owner_user_id, t.name, t.token_prefix,
              t.expires_at, t.revoked_at, t.last_used_at, t.created_at,
              d.name AS definition_name
       FROM workflow_desktop_tokens t
       LEFT JOIN agent_workflow_definitions d
         ON d.id = t.definition_id AND d.owner_user_id = t.owner_user_id
       WHERE t.owner_user_id = ?
       ORDER BY datetime(t.created_at) DESC`
    )
    .all(owner);
}

function safeList(label, fn) {
  try {
    return fn() || [];
  } catch (e) {
    console.warn('[external-tokens] list %s failed: %s', label, e.message || e);
    return [];
  }
}

/**
 * Unified list for Settings → Tokens management.
 * @returns {{ tokens: object[], counts: Record<string, number> }}
 */
export function listExternalTokens(ownerUserId) {
  ensureExternalTokenTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });

  const rows = [];

  for (const t of safeList('workflow_desktop', () => listWorkflowDesktopForOwner(owner))) {
    const wfName = t.definition_name || t.definition_id || 'Workflow';
    rows.push({
      id: t.id,
      kind: TOKEN_KINDS.WORKFLOW_DESKTOP,
      kind_label: ISSUER_LABELS[TOKEN_KINDS.WORKFLOW_DESKTOP],
      token_display: maskPrefix(t.token_prefix, TOKEN_KINDS.WORKFLOW_DESKTOP),
      token_prefix: t.token_prefix,
      package_name: t.name || 'Desktop package',
      issuer_name: wfName,
      issuer_kind: 'workflow',
      issuer_ref: t.definition_id || null,
      last_used_at: t.last_used_at || null,
      created_at: t.created_at || null,
      expires_at: t.expires_at || null,
      revoked_at: t.revoked_at || null,
      status: statusOf(t),
      can_revoke: !t.revoked_at,
    });
  }

  for (const t of safeList('ibkr_bridge', () => listIbkrBridgeTokens(owner))) {
    rows.push({
      id: t.id,
      kind: TOKEN_KINDS.IBKR_BRIDGE,
      kind_label: ISSUER_LABELS[TOKEN_KINDS.IBKR_BRIDGE],
      token_display: maskPrefix(t.token_prefix, TOKEN_KINDS.IBKR_BRIDGE),
      token_prefix: t.token_prefix,
      package_name: t.name || 'Local IBKR bridge package',
      issuer_name: 'IBKR bridge',
      issuer_kind: 'ibkr_bridge',
      issuer_ref: null,
      last_used_at: t.last_used_at || null,
      created_at: t.created_at || null,
      expires_at: t.expires_at || null,
      revoked_at: t.revoked_at || null,
      status: statusOf(t),
      can_revoke: !t.revoked_at,
      note: 'Revoke marks inventory only; restart bridge with a new package to cut local use.',
    });
  }

  for (const t of safeList('browser_session', () => listBrowserWorkerTokens(owner))) {
    rows.push({
      id: t.id,
      kind: TOKEN_KINDS.BROWSER_SESSION,
      kind_label: ISSUER_LABELS[TOKEN_KINDS.BROWSER_SESSION],
      token_display: maskPrefix(t.token_prefix, TOKEN_KINDS.BROWSER_SESSION),
      token_prefix: t.token_prefix,
      package_name: t.name || 'Browser Session package',
      issuer_name: 'Browser session package',
      issuer_kind: 'browser_session',
      issuer_ref: null,
      last_used_at: t.last_used_at || null,
      created_at: t.created_at || null,
      expires_at: t.expires_at || null,
      revoked_at: t.revoked_at || null,
      status: statusOf(t),
      can_revoke: !t.revoked_at,
    });
  }

  rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const counts = {
    [TOKEN_KINDS.WORKFLOW_DESKTOP]: 0,
    [TOKEN_KINDS.IBKR_BRIDGE]: 0,
    [TOKEN_KINDS.BROWSER_SESSION]: 0,
  };
  for (const r of rows) counts[r.kind] = (counts[r.kind] || 0) + 1;

  console.info(
    '[external-tokens] list owner=%s total=%s desktop=%s ibkr=%s browser=%s',
    owner,
    rows.length,
    counts[TOKEN_KINDS.WORKFLOW_DESKTOP],
    counts[TOKEN_KINDS.IBKR_BRIDGE],
    counts[TOKEN_KINDS.BROWSER_SESSION]
  );
  return { tokens: rows, counts };
}

export function revokeExternalToken(ownerUserId, { kind, id } = {}) {
  const owner = String(ownerUserId || '').trim();
  const k = String(kind || '').trim();
  const tokenId = String(id || '').trim();
  if (!owner || !k || !tokenId) {
    throw Object.assign(new Error('kind and id required'), { status: 400 });
  }

  let ok = false;
  if (k === TOKEN_KINDS.WORKFLOW_DESKTOP) {
    ok = revokeDesktopToken(tokenId, owner);
  } else if (k === TOKEN_KINDS.BROWSER_SESSION) {
    ok = revokeBrowserWorkerToken(tokenId, owner);
  } else if (k === TOKEN_KINDS.IBKR_BRIDGE) {
    ok = revokeIbkrBridgeToken(tokenId, owner);
  } else {
    throw Object.assign(new Error('Unknown token kind'), { status: 400 });
  }

  if (!ok) {
    throw Object.assign(new Error('Token not found or already revoked'), { status: 404 });
  }
  console.info('[external-tokens] revoked owner=%s kind=%s id=%s', owner, k, tokenId);
  return { ok: true, kind: k, id: tokenId };
}

export function mintIbkrBridgeTokenPlaintext() {
  return randomBytes(24).toString('hex');
}
