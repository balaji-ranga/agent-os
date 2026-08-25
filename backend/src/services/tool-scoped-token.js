import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDb } from '../db/schema.js';
import { tenantOpenClawAgentId } from './openclaw-tenant.js';

function credentialsPath() {
  return process.env.OPENCLAW_TOOL_CREDENTIALS_PATH ||
    join(process.env.OPENCLAW_DIR || join(process.env.HOME || '', '.openclaw'), 'agent-os-tool-credentials.json');
}

function tokenHash(token) {
  return createHash('sha256').update(String(token || '')).digest();
}

function ensureTable() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS tool_service_credentials (
    owner_user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    last_used_at TEXT,
    revoked_at TEXT,
    PRIMARY KEY (owner_user_id, agent_id)
  )`);
}

function readCredentialFile() {
  const path = credentialsPath();
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value?.version === 1 && value.credentials && typeof value.credentials === 'object'
      ? value
      : { version: 1, credentials: {} };
  } catch {
    return { version: 1, credentials: {} };
  }
}

function writeCredentialFile(value) {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
  try { chmodSync(path, 0o600); } catch {}
}

function validStoredToken(token, hashHex) {
  if (!token || !hashHex) return false;
  const actual = tokenHash(token);
  const expected = Buffer.from(hashHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function credentialAgentIds(ownerUserId, agentId) {
  const owner = String(ownerUserId || '').trim();
  const id = String(agentId || '').trim();
  if (!owner || !id) throw new Error('Tool credential owner and agent are required');
  const row = getDb().prepare('SELECT id, openclaw_agent_id FROM agents WHERE id = ?').get(id);
  if (!row) throw new Error('Agent not found');
  const base = String(row.openclaw_agent_id || row.id).trim();
  return [...new Set([base, row.id, tenantOpenClawAgentId(owner, base)].filter(Boolean))];
}

export function ensureToolServiceCredential(ownerUserId, agentId) {
  ensureTable();
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  if (!owner || !agent) throw new Error('Tool credential owner and agent are required');
  const file = readCredentialFile();
  const stored = file.credentials?.[owner]?.[agent] || '';
  const row = getDb().prepare(`SELECT token_hash FROM tool_service_credentials
    WHERE owner_user_id = ? AND agent_id = ? AND revoked_at IS NULL`).get(owner, agent);
  if (row && validStoredToken(stored, row.token_hash)) return stored;

  const token = `ftc_${randomBytes(32).toString('base64url')}`;
  getDb().prepare(`INSERT INTO tool_service_credentials
    (owner_user_id, agent_id, token_hash, token_prefix, created_at, revoked_at)
    VALUES (?, ?, ?, ?, datetime('now'), NULL)
    ON CONFLICT(owner_user_id, agent_id) DO UPDATE SET
      token_hash = excluded.token_hash, token_prefix = excluded.token_prefix,
      created_at = datetime('now'), last_used_at = NULL, revoked_at = NULL`)
    .run(owner, agent, tokenHash(token).toString('hex'), token.slice(0, 12));
  file.credentials[owner] ||= {};
  file.credentials[owner][agent] = token;
  writeCredentialFile(file);
  return token;
}

/** Immediately provision or revoke every credential alias for one user-agent grant. */
export function syncToolServiceCredentialsForGrant(ownerUserId, agentId, enabled) {
  ensureTable();
  const owner = String(ownerUserId || '').trim();
  const aliases = credentialAgentIds(owner, agentId);
  if (enabled) {
    for (const alias of aliases) ensureToolServiceCredential(owner, alias);
    return { owner_user_id: owner, agent_id: String(agentId), enabled: true, aliases };
  }

  const db = getDb();
  const revoke = db.prepare(`UPDATE tool_service_credentials SET revoked_at = datetime('now')
    WHERE owner_user_id = ? AND agent_id = ? AND revoked_at IS NULL`);
  const file = readCredentialFile();
  let fileChanged = false;
  for (const alias of aliases) {
    revoke.run(owner, alias);
    if (file.credentials?.[owner]?.[alias]) {
      delete file.credentials[owner][alias];
      fileChanged = true;
    }
  }
  if (file.credentials?.[owner] && !Object.keys(file.credentials[owner]).length) {
    delete file.credentials[owner];
    fileChanged = true;
  }
  if (fileChanged) writeCredentialFile(file);
  return { owner_user_id: owner, agent_id: String(agentId), enabled: false, aliases };
}

export function ensureAllToolServiceCredentials() {
  ensureTable();
  const rows = getDb().prepare(`SELECT ua.user_id AS owner_user_id, a.id, a.openclaw_agent_id
    FROM user_agents ua JOIN agents a ON a.id = ua.agent_id
    JOIN platform_users u ON u.id = ua.user_id
    WHERE ua.enabled = 1 AND u.enabled = 1`).all();
  let count = 0;
  const active = new Set();
  for (const row of rows) {
    const base = String(row.openclaw_agent_id || row.id).trim();
    for (const agent of new Set([base, row.id, tenantOpenClawAgentId(row.owner_user_id, base)])) {
      if (!agent) continue;
      active.add(`${row.owner_user_id}\u0000${agent}`);
      ensureToolServiceCredential(row.owner_user_id, agent);
      count += 1;
    }
  }
  const db = getDb();
  const existing = db.prepare(`SELECT owner_user_id, agent_id FROM tool_service_credentials
    WHERE revoked_at IS NULL`).all();
  const revoke = db.prepare(`UPDATE tool_service_credentials SET revoked_at = datetime('now')
    WHERE owner_user_id = ? AND agent_id = ?`);
  const file = readCredentialFile();
  let fileChanged = false;
  for (const row of existing) {
    if (active.has(`${row.owner_user_id}\u0000${row.agent_id}`)) continue;
    revoke.run(row.owner_user_id, row.agent_id);
    if (file.credentials?.[row.owner_user_id]?.[row.agent_id]) {
      delete file.credentials[row.owner_user_id][row.agent_id];
      if (!Object.keys(file.credentials[row.owner_user_id]).length) delete file.credentials[row.owner_user_id];
      fileChanged = true;
    }
  }
  if (fileChanged) writeCredentialFile(file);
  return count;
}

export function verifyToolScopedToken(token) {
  ensureTable();
  const raw = String(token || '').trim();
  if (!raw.startsWith('ftc_')) return null;
  const hash = tokenHash(raw);
  const row = getDb().prepare(`SELECT owner_user_id, agent_id, token_hash FROM tool_service_credentials
    WHERE token_hash = ? AND revoked_at IS NULL`).get(hash.toString('hex'));
  if (!row) return null;
  const activeRows = getDb().prepare(`SELECT a.id, a.openclaw_agent_id FROM user_agents ua
    JOIN agents a ON a.id = ua.agent_id JOIN platform_users u ON u.id = ua.user_id
    WHERE ua.user_id = ? AND ua.enabled = 1 AND u.enabled = 1`).all(row.owner_user_id);
  const remainsAuthorized = activeRows.some((agentRow) => {
    const base = String(agentRow.openclaw_agent_id || agentRow.id).trim();
    return new Set([base, agentRow.id, tenantOpenClawAgentId(row.owner_user_id, base)]).has(row.agent_id);
  });
  if (!remainsAuthorized) {
    getDb().prepare(`UPDATE tool_service_credentials SET revoked_at = datetime('now')
      WHERE owner_user_id = ? AND agent_id = ?`).run(row.owner_user_id, row.agent_id);
    return null;
  }
  const expected = Buffer.from(row.token_hash, 'hex');
  if (hash.length !== expected.length || !timingSafeEqual(hash, expected)) return null;
  getDb().prepare(`UPDATE tool_service_credentials SET last_used_at = datetime('now')
    WHERE owner_user_id = ? AND agent_id = ?`).run(row.owner_user_id, row.agent_id);
  return { ownerUserId: row.owner_user_id, agentId: row.agent_id };
}
