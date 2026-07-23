/**
 * Sync per-CEO BYOK credentials into OpenClaw agent auth stores.
 *
 * OpenClaw 2026+ resolves custom providers (byok-*) via per-agent auth profiles
 * (SQLite auth_profile_store), not models.providers[].apiKey alone.
 *
 * On switch / switchback we also remove legacy leftovers: auth-profiles.json,
 * auth.json, stale :default/:manual ids, and openclaw.json auth.profiles keys.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { getOpenClawDir } from '../config/openclaw-paths.js';

function sanitizeIdPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function byokProviderId(userId) {
  return `byok-${sanitizeIdPart(userId)}`;
}

function profileIdForProvider(providerKey) {
  return `${providerKey}:manual`;
}

function agentAuthDir(openclawAgentId) {
  return join(getOpenClawDir(), 'agents', String(openclawAgentId), 'agent');
}

function agentSqlitePath(openclawAgentId) {
  return join(agentAuthDir(openclawAgentId), 'openclaw-agent.sqlite');
}

function ensureAuthTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_profile_store (
      store_key TEXT NOT NULL PRIMARY KEY,
      store_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_profile_state (
      state_key TEXT NOT NULL PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function readStoreJson(db) {
  const row = db.prepare(`SELECT store_json FROM auth_profile_store WHERE store_key = 'primary'`).get();
  if (!row?.store_json) return { version: 1, profiles: {} };
  try {
    const parsed = JSON.parse(row.store_json);
    if (!parsed || typeof parsed !== 'object') return { version: 1, profiles: {} };
    if (!parsed.profiles || typeof parsed.profiles !== 'object') parsed.profiles = {};
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch {
    return { version: 1, profiles: {} };
  }
}

function writeStoreJson(db, store) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO auth_profile_store (store_key, store_json, updated_at)
     VALUES ('primary', ?, ?)
     ON CONFLICT(store_key) DO UPDATE SET store_json = excluded.store_json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(store), now);
}

function readStateJson(db) {
  const row = db.prepare(`SELECT state_json FROM auth_profile_state WHERE state_key = 'primary'`).get();
  if (!row?.state_json) return { version: 1, lastGood: {}, usageStats: {} };
  try {
    const parsed = JSON.parse(row.state_json);
    if (!parsed || typeof parsed !== 'object') return { version: 1, lastGood: {}, usageStats: {} };
    if (!parsed.lastGood || typeof parsed.lastGood !== 'object') parsed.lastGood = {};
    if (!parsed.usageStats || typeof parsed.usageStats !== 'object') parsed.usageStats = {};
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch {
    return { version: 1, lastGood: {}, usageStats: {} };
  }
}

function writeStateJson(db, state) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO auth_profile_state (state_key, state_json, updated_at)
     VALUES ('primary', ?, ?)
     ON CONFLICT(state_key) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(state), now);
}

/** True if profile id or profile.provider belongs to this BYOK provider. */
function isByokProfileKey(profileId, profile, providerKey) {
  const id = String(profileId || '');
  const prov = String(profile?.provider || '');
  return (
    id === providerKey ||
    id.startsWith(`${providerKey}:`) ||
    prov === providerKey ||
    prov.startsWith(`${providerKey}`)
  );
}

function stripByokFromStore(store, providerKey) {
  let removed = 0;
  for (const [pid, profile] of Object.entries(store.profiles || {})) {
    if (isByokProfileKey(pid, profile, providerKey)) {
      delete store.profiles[pid];
      removed += 1;
    }
  }
  return removed;
}

function stripByokFromState(state, providerKey) {
  let removed = 0;
  if (state.lastGood?.[providerKey]) {
    delete state.lastGood[providerKey];
    removed += 1;
  }
  for (const key of Object.keys(state.usageStats || {})) {
    if (key === providerKey || key.startsWith(`${providerKey}:`)) {
      delete state.usageStats[key];
      removed += 1;
    }
  }
  return removed;
}

/** Delete legacy JSON auth files so switchback cannot revive stale keys. */
function deleteLegacyAuthJsonFiles(openclawAgentId) {
  const dir = agentAuthDir(openclawAgentId);
  const removed = [];
  for (const name of ['auth-profiles.json', 'auth.json']) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    try {
      unlinkSync(path);
      removed.push(name);
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/**
 * Remove all byok-{ceo} entries from openclaw.json auth.profiles (any :manual/:default).
 * Mutates config in place.
 */
export function scrubOpenClawAuthProfileMetadata(config, providerKey) {
  const cfg = config || {};
  if (!cfg.auth?.profiles || typeof cfg.auth.profiles !== 'object') {
    return { removed: [] };
  }
  const removed = [];
  for (const key of Object.keys(cfg.auth.profiles)) {
    const entry = cfg.auth.profiles[key];
    if (
      key === providerKey ||
      key.startsWith(`${providerKey}:`) ||
      entry?.provider === providerKey
    ) {
      delete cfg.auth.profiles[key];
      removed.push(key);
    }
  }
  return { removed };
}

/**
 * Full clear of BYOK auth for one agent: SQLite profiles/state + delete legacy JSON files.
 */
export function clearAgentByokAuthProfile(openclawAgentId, providerKey) {
  const agentId = String(openclawAgentId || '').trim();
  const provider = String(providerKey || '').trim();
  if (!agentId || !provider) return { ok: false, reason: 'missing_args' };

  let sqliteCleared = 0;
  const sqlitePath = agentSqlitePath(agentId);

  if (existsSync(sqlitePath)) {
    const db = new Database(sqlitePath);
    try {
      ensureAuthTables(db);
      const store = readStoreJson(db);
      sqliteCleared += stripByokFromStore(store, provider);
      writeStoreJson(db, store);

      const state = readStateJson(db);
      sqliteCleared += stripByokFromState(state, provider);
      writeStateJson(db, state);
    } finally {
      db.close();
    }
  }

  const legacyRemoved = deleteLegacyAuthJsonFiles(agentId);

  return {
    ok: true,
    agentId,
    cleared: sqliteCleared > 0 || legacyRemoved.length > 0,
    sqliteCleared,
    legacyRemoved,
  };
}

/**
 * Upsert current BYOK profile; first strip any stale byok keys for this CEO
 * (e.g. :default from old paste) so switch never leaves dual profiles.
 */
export function upsertAgentByokAuthProfile(openclawAgentId, providerKey, apiKey) {
  const agentId = String(openclawAgentId || '').trim();
  const provider = String(providerKey || '').trim();
  const key = String(apiKey || '').trim();
  if (!agentId || !provider || !key) return { ok: false, reason: 'missing_args' };

  const dir = agentAuthDir(agentId);
  mkdirSync(dir, { recursive: true });

  const profileId = profileIdForProvider(provider);
  const profile = { type: 'api_key', provider, key };

  const sqlitePath = agentSqlitePath(agentId);
  const db = new Database(sqlitePath);
  try {
    ensureAuthTables(db);
    const store = readStoreJson(db);
    stripByokFromStore(store, provider);
    store.profiles[profileId] = profile;
    writeStoreJson(db, store);

    const state = readStateJson(db);
    stripByokFromState(state, provider);
    writeStateJson(db, state);
  } finally {
    db.close();
  }

  // Replace legacy mirrors entirely (no stale :default / empty leftover files).
  deleteLegacyAuthJsonFiles(agentId);
  writeFileSync(
    join(dir, 'auth-profiles.json'),
    JSON.stringify({ version: 1, profiles: { [profileId]: profile } }, null, 2),
    'utf8'
  );

  return { ok: true, agentId, profileId };
}

function listTenantAgentIds(ceoUserId, configAgentIds = []) {
  const prefix = `t-${sanitizeIdPart(ceoUserId)}--`;
  const ids = new Set();
  for (const id of configAgentIds) {
    if (String(id || '').toLowerCase().startsWith(prefix)) ids.add(String(id));
  }
  const agentsRoot = join(getOpenClawDir(), 'agents');
  if (existsSync(agentsRoot)) {
    try {
      for (const name of readdirSync(agentsRoot)) {
        if (String(name).toLowerCase().startsWith(prefix)) ids.add(name);
      }
    } catch {
      /* ignore */
    }
  }
  return [...ids];
}

/**
 * Apply or clear BYOK auth for all tenant agents of a CEO.
 * Mutates `config.auth.profiles` metadata (no secrets).
 *
 * clear=true (switchback to platform): scrub metadata + SQLite + delete auth-profiles.json/auth.json
 * clear=false (switch / set BYOK): scrub stale keys then write current :manual profile only
 */
export function syncByokAuthProfiles(ceoUserId, { config, apiKey, clear = false } = {}) {
  const id = String(ceoUserId || '').trim();
  if (!id) return { ok: false, error: 'missing_user' };

  const providerKey = byokProviderId(id);
  const profileId = profileIdForProvider(providerKey);
  const cfg = config || {};
  if (!cfg.auth) cfg.auth = {};
  if (!cfg.auth.profiles || typeof cfg.auth.profiles !== 'object') cfg.auth.profiles = {};

  const configAgentIds = (cfg.agents?.list || []).map((a) => a.id);
  const agentIds = listTenantAgentIds(id, configAgentIds);
  const agentResults = [];

  // Always scrub all byok-{ceo}* metadata first (covers :manual, :default, orphans).
  const meta = scrubOpenClawAuthProfileMetadata(cfg, providerKey);

  if (clear) {
    for (const agentId of agentIds) {
      agentResults.push(clearAgentByokAuthProfile(agentId, providerKey));
    }
    return {
      ok: true,
      cleared: true,
      providerKey,
      agents: agentIds,
      metaRemoved: meta.removed,
      agentResults,
    };
  }

  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, error: 'missing_api_key', providerKey };

  cfg.auth.profiles[profileId] = { provider: providerKey, mode: 'api_key' };

  for (const agentId of agentIds) {
    agentResults.push(upsertAgentByokAuthProfile(agentId, providerKey, key));
  }

  return {
    ok: true,
    cleared: false,
    providerKey,
    profileId,
    agents: agentIds,
    metaRemoved: meta.removed,
    agentResults,
  };
}

/** Ensure one newly provisioned tenant agent gets the CEO's BYOK auth profile. */
export function ensureAgentByokAuthFromUser(openclawAgentId, ceoUserId, apiKey) {
  const providerKey = byokProviderId(ceoUserId);
  const key = String(apiKey || '').trim();
  if (!key) return { ok: false, reason: 'missing_api_key' };
  return upsertAgentByokAuthProfile(openclawAgentId, providerKey, key);
}
