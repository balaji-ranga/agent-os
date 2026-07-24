/**
 * Per-CEO API key vault (Management → API Keys).
 * Optional passphrase encrypts the secret; passphrase itself is wrapped with USER_API_KEYS_KEK.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

export const PLATFORM_BYOK_KEY_NAME = 'Platform_BYOK';
const KEY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function db() {
  return getDb();
}

export function ensureUserApiKeysSchema() {
  const d = db();
  d.exec(`
    CREATE TABLE IF NOT EXISTS user_api_keys (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      key_name TEXT NOT NULL,
      secret_value TEXT NOT NULL,
      is_encrypted INTEGER NOT NULL DEFAULT 0,
      phrase_wrapped TEXT,
      salt_b64 TEXT,
      iv_b64 TEXT,
      tag_b64 TEXT,
      key_hint TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, key_name)
    )
  `);
  d.exec(
    `CREATE INDEX IF NOT EXISTS idx_user_api_keys_owner ON user_api_keys(owner_user_id, key_name)`
  );
}

function platformKek() {
  const raw = String(process.env.USER_API_KEYS_KEK || '').trim();
  if (!raw) return null;
  return createHash('sha256').update(raw, 'utf8').digest();
}

function assertKekIfEncrypting(phrase) {
  if (!phrase) return;
  if (!platformKek()) {
    throw Object.assign(
      new Error(
        'USER_API_KEYS_KEK is not configured on the server — cannot store encrypted API keys. Ask an admin to set it, or save without an encryption phrase.'
      ),
      { status: 503 }
    );
  }
}

function wrapPhrase(phrase) {
  const kek = platformKek();
  if (!kek) throw Object.assign(new Error('USER_API_KEYS_KEK required'), { status: 503 });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const enc = Buffer.concat([cipher.update(String(phrase), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function unwrapPhrase(wrappedB64) {
  const kek = platformKek();
  if (!kek) throw Object.assign(new Error('USER_API_KEYS_KEK required to decrypt'), { status: 503 });
  const buf = Buffer.from(String(wrappedB64 || ''), 'base64');
  if (buf.length < 28) throw new Error('Invalid wrapped phrase');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function encryptSecretWithPhrase(secret, phrase) {
  const salt = randomBytes(16);
  const key = scryptSync(String(phrase), salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    secret_value: enc.toString('base64'),
    salt_b64: salt.toString('base64'),
    iv_b64: iv.toString('base64'),
    tag_b64: tag.toString('base64'),
    phrase_wrapped: wrapPhrase(phrase),
    is_encrypted: 1,
  };
}

function decryptSecretRow(row) {
  if (!row) return null;
  if (!row.is_encrypted) return String(row.secret_value || '');
  const phrase = unwrapPhrase(row.phrase_wrapped);
  const salt = Buffer.from(row.salt_b64, 'base64');
  const iv = Buffer.from(row.iv_b64, 'base64');
  const tag = Buffer.from(row.tag_b64, 'base64');
  const key = scryptSync(phrase, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const data = Buffer.from(row.secret_value, 'base64');
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function hintFor(secret) {
  const s = String(secret || '');
  if (!s) return null;
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

export function normalizeKeyName(name) {
  const n = String(name || '').trim();
  if (!n) throw Object.assign(new Error('key_name is required'), { status: 400 });
  if (!KEY_NAME_RE.test(n)) {
    throw Object.assign(
      new Error('key_name must be 1–64 chars: letters, numbers, . _ - (must start alphanumeric)'),
      { status: 400 }
    );
  }
  return n;
}

export function maskApiKeyRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    key_name: row.key_name,
    key_hint: row.key_hint || null,
    is_encrypted: !!row.is_encrypted,
    has_encryption_phrase: !!row.is_encrypted && !!row.phrase_wrapped,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listUserApiKeys(ownerUserId) {
  ensureUserApiKeysSchema();
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  return db()
    .prepare(
      `SELECT id, owner_user_id, key_name, key_hint, is_encrypted, phrase_wrapped, created_at, updated_at
       FROM user_api_keys WHERE owner_user_id = ? ORDER BY key_name COLLATE NOCASE ASC`
    )
    .all(owner)
    .map(maskApiKeyRow);
}

export function getUserApiKeyRow(ownerUserId, keyName) {
  ensureUserApiKeysSchema();
  const owner = String(ownerUserId || '').trim();
  const name = normalizeKeyName(keyName);
  return (
    db()
      .prepare(`SELECT * FROM user_api_keys WHERE owner_user_id = ? AND key_name = ?`)
      .get(owner, name) || null
  );
}

export function getUserApiKeyById(ownerUserId, id) {
  ensureUserApiKeysSchema();
  return (
    db()
      .prepare(`SELECT * FROM user_api_keys WHERE id = ? AND owner_user_id = ?`)
      .get(String(id || '').trim(), String(ownerUserId || '').trim()) || null
  );
}

/** Resolve plaintext secret for runners. Throws 404 if missing. */
export function resolveUserApiKey(ownerUserId, keyName) {
  const row = getUserApiKeyRow(ownerUserId, keyName);
  if (!row) {
    throw Object.assign(new Error(`API key "${keyName}" not found for this user`), { status: 404 });
  }
  try {
    const value = decryptSecretRow(row);
    if (!value) throw new Error('empty secret');
    return { key_name: row.key_name, value, is_encrypted: !!row.is_encrypted };
  } catch (e) {
    if (e.status) throw e;
    throw Object.assign(
      new Error(`Failed to decrypt API key "${keyName}": ${e.message}`),
      { status: 500 }
    );
  }
}

export function tryResolveUserApiKey(ownerUserId, keyName) {
  try {
    return resolveUserApiKey(ownerUserId, keyName);
  } catch {
    return null;
  }
}

/**
 * Resolve a config value that may be a literal string or { $keyRef: "name" }.
 */
export function resolveSecretOrRef(ownerUserId, value) {
  if (value == null) return '';
  if (typeof value === 'object' && value.$keyRef) {
    return resolveUserApiKey(ownerUserId, value.$keyRef).value;
  }
  const s = String(value);
  // Also support explicit twin fields handled by callers; here only object/$keyRef
  return s;
}

/**
 * Expand header map: string values stay; { $keyRef } resolved.
 */
export function resolveHeadersObject(ownerUserId, headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const name = String(k || '').trim();
    if (!name) continue;
    if (v != null && typeof v === 'object' && !Array.isArray(v) && v.$keyRef) {
      out[name] = resolveUserApiKey(ownerUserId, v.$keyRef).value;
    } else if (v != null && String(v).trim() !== '') {
      out[name] = String(v);
    }
  }
  return out;
}

/** Prefer ref field over literal. */
export function resolveLiteralOrKeyRef(ownerUserId, { literal, keyRef } = {}) {
  const ref = String(keyRef || '').trim();
  if (ref) return resolveUserApiKey(ownerUserId, ref).value;
  return String(literal || '').trim();
}

export function createUserApiKey(ownerUserId, { keyName, apiKey, encryptionPhrase = '' } = {}) {
  ensureUserApiKeysSchema();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 401 });
  const name = normalizeKeyName(keyName);
  const secret = String(apiKey || '').trim();
  if (!secret) throw Object.assign(new Error('api_key is required'), { status: 400 });
  const phrase = String(encryptionPhrase || '').trim();
  assertKekIfEncrypting(phrase);

  let packed;
  if (phrase) {
    packed = encryptSecretWithPhrase(secret, phrase);
  } else {
    packed = {
      secret_value: secret,
      salt_b64: null,
      iv_b64: null,
      tag_b64: null,
      phrase_wrapped: null,
      is_encrypted: 0,
    };
  }

  const id = randomUUID();
  try {
    db()
      .prepare(
        `INSERT INTO user_api_keys
          (id, owner_user_id, key_name, secret_value, is_encrypted, phrase_wrapped, salt_b64, iv_b64, tag_b64, key_hint, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(
        id,
        owner,
        name,
        packed.secret_value,
        packed.is_encrypted,
        packed.phrase_wrapped,
        packed.salt_b64,
        packed.iv_b64,
        packed.tag_b64,
        hintFor(secret)
      );
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) {
      throw Object.assign(new Error(`key_name "${name}" already exists`), { status: 409 });
    }
    throw e;
  }
  return maskApiKeyRow(getUserApiKeyById(owner, id));
}

export function updateUserApiKey(ownerUserId, id, patch = {}) {
  ensureUserApiKeysSchema();
  const row = getUserApiKeyById(ownerUserId, id);
  if (!row) throw Object.assign(new Error('API key not found'), { status: 404 });

  let name = row.key_name;
  if (patch.keyName != null || patch.key_name != null) {
    name = normalizeKeyName(patch.keyName ?? patch.key_name);
  }

  const newSecretRaw = patch.apiKey ?? patch.api_key;
  const clearPhrase = patch.clear_encryption_phrase === true || patch.clearEncryptionPhrase === true;
  const phraseIn =
    patch.encryptionPhrase != null || patch.encryption_phrase != null
      ? String(patch.encryptionPhrase ?? patch.encryption_phrase ?? '').trim()
      : null;

  let secret = null;
  if (newSecretRaw != null && String(newSecretRaw).trim()) {
    secret = String(newSecretRaw).trim();
  } else {
    secret = decryptSecretRow(row);
  }

  let phrase = null;
  if (clearPhrase) {
    phrase = '';
  } else if (phraseIn != null) {
    phrase = phraseIn;
  } else if (row.is_encrypted) {
    phrase = unwrapPhrase(row.phrase_wrapped);
  } else {
    phrase = '';
  }

  assertKekIfEncrypting(phrase);

  let packed;
  if (phrase) {
    packed = encryptSecretWithPhrase(secret, phrase);
  } else {
    packed = {
      secret_value: secret,
      salt_b64: null,
      iv_b64: null,
      tag_b64: null,
      phrase_wrapped: null,
      is_encrypted: 0,
    };
  }

  try {
    db()
      .prepare(
        `UPDATE user_api_keys SET
           key_name = ?, secret_value = ?, is_encrypted = ?, phrase_wrapped = ?,
           salt_b64 = ?, iv_b64 = ?, tag_b64 = ?, key_hint = ?, updated_at = datetime('now')
         WHERE id = ? AND owner_user_id = ?`
      )
      .run(
        name,
        packed.secret_value,
        packed.is_encrypted,
        packed.phrase_wrapped,
        packed.salt_b64,
        packed.iv_b64,
        packed.tag_b64,
        hintFor(secret),
        row.id,
        ownerUserId
      );
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) {
      throw Object.assign(new Error(`key_name "${name}" already exists`), { status: 409 });
    }
    throw e;
  }
  return maskApiKeyRow(getUserApiKeyById(ownerUserId, row.id));
}

export function deleteUserApiKey(ownerUserId, id, { force = false } = {}) {
  ensureUserApiKeysSchema();
  const row = getUserApiKeyById(ownerUserId, id);
  if (!row) throw Object.assign(new Error('API key not found'), { status: 404 });
  const deps = findApiKeyDependencies(ownerUserId, row.key_name);
  if (deps.length && !force) {
    return { deleted: false, requires_confirm: true, key_name: row.key_name, dependencies: deps };
  }
  db().prepare(`DELETE FROM user_api_keys WHERE id = ? AND owner_user_id = ?`).run(row.id, ownerUserId);
  return { deleted: true, key_name: row.key_name, dependencies: deps };
}

function scanJsonForKeyRef(text, keyName) {
  if (!text || !keyName) return false;
  const s = String(text);
  if (s.includes(`"$keyRef":"${keyName}"`) || s.includes(`"$keyRef": "${keyName}"`)) return true;
  if (s.includes(`"apiKeyRef":"${keyName}"`) || s.includes(`"apiKeyRef": "${keyName}"`)) return true;
  if (s.includes(`"bearerTokenRef":"${keyName}"`) || s.includes(`"authBearerRef":"${keyName}"`)) return true;
  if (s.includes(`"apiKeyValueRef":"${keyName}"`) || s.includes(`"basicPasswordRef":"${keyName}"`)) return true;
  if (s.includes(`"smtpPassRef":"${keyName}"`) || s.includes(`"authHeaderRef":"${keyName}"`)) return true;
  if (s.includes(`"runtime_token_ref":"${keyName}"`) || s.includes(`"runtimeTokenRef":"${keyName}"`)) {
    return true;
  }
  // generic
  const re = new RegExp(`"\\$keyRef"\\s*:\\s*"${keyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
  if (re.test(s)) return true;
  const refFields = [
    'apiKeyRef',
    'bearerTokenRef',
    'authBearerRef',
    'apiKeyValueRef',
    'basicPasswordRef',
    'smtpPassRef',
    'authHeaderRef',
    'runtime_token_ref',
  ];
  for (const f of refFields) {
    const fre = new RegExp(`"${f}"\\s*:\\s*"${keyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);
    if (fre.test(s)) return true;
  }
  return false;
}

export function findApiKeyDependencies(ownerUserId, keyName) {
  ensureUserApiKeysSchema();
  const owner = String(ownerUserId || '').trim();
  const name = String(keyName || '').trim();
  const deps = [];
  if (!owner || !name) return deps;

  const workflows = db()
    .prepare(
      `SELECT id, name, draft_graph_json, published_graph_json FROM agent_workflow_definitions
       WHERE owner_user_id = ?`
    )
    .all(owner);
  for (const w of workflows) {
    const hitDraft = scanJsonForKeyRef(w.draft_graph_json, name);
    const hitPub = scanJsonForKeyRef(w.published_graph_json, name);
    if (hitDraft || hitPub) {
      deps.push({
        type: 'workflow',
        id: w.id,
        name: w.name || w.id,
        detail: hitPub && hitDraft ? 'draft+published' : hitPub ? 'published' : 'draft',
      });
    }
  }

  try {
    const mcps = db()
      .prepare(`SELECT id, name, headers_json FROM mcp_servers WHERE owner_user_id = ?`)
      .all(owner);
    for (const m of mcps) {
      if (scanJsonForKeyRef(m.headers_json, name)) {
        deps.push({ type: 'mcp_server', id: m.id, name: m.name || m.id, detail: 'headers' });
      }
    }
  } catch (_) {}

  try {
    const agents = db()
      .prepare(
        `SELECT id, name, auth_header, headers_json FROM external_agents WHERE owner_user_id = ?`
      )
      .all(owner);
    for (const a of agents) {
      if (
        scanJsonForKeyRef(a.headers_json, name) ||
        String(a.auth_header || '').includes(`$keyRef`) && scanJsonForKeyRef(JSON.stringify({ v: a.auth_header }), name) ||
        String(a.auth_header || '') === `keyref:${name}` ||
        /"auth_header_ref"\s*:\s*"/.test('') // placeholder
      ) {
        // check auth_header_ref column if exists
      }
      if (scanJsonForKeyRef(a.headers_json, name)) {
        deps.push({ type: 'external_agent', id: a.id, name: a.name || a.id, detail: 'headers' });
      }
    }
    // auth_header_ref column
    try {
      const withRef = db()
        .prepare(
          `SELECT id, name, auth_header_ref FROM external_agents WHERE owner_user_id = ? AND auth_header_ref = ?`
        )
        .all(owner, name);
      for (const a of withRef) {
        deps.push({ type: 'external_agent', id: a.id, name: a.name || a.id, detail: 'auth_header_ref' });
      }
    } catch (_) {}
  } catch (_) {}

  try {
    const link = db()
      .prepare(`SELECT user_id, runtime_token_ref FROM openconnector_user_links WHERE user_id = ?`)
      .get(owner);
    if (link?.runtime_token_ref === name) {
      deps.push({ type: 'openconnector', id: owner, name: 'OpenConnector link', detail: 'runtime_token_ref' });
    }
  } catch (_) {}

  if (name === PLATFORM_BYOK_KEY_NAME) {
    const u = db()
      .prepare(`SELECT id, llm_provider FROM platform_users WHERE id = ?`)
      .get(owner);
    if (u && (u.llm_provider === 'openai' || u.llm_provider === 'openrouter')) {
      deps.push({
        type: 'byok',
        id: owner,
        name: 'LLM BYOK',
        detail: `provider=${u.llm_provider}`,
      });
    }
  }

  return deps;
}

/** Require Platform_BYOK vault key when provider needs a user API key. */
export function assertPlatformByokPresent(ownerUserId, provider) {
  const p = String(provider || '').trim();
  if (p !== 'openai' && p !== 'openrouter') return { ok: true };
  const row = getUserApiKeyRow(ownerUserId, PLATFORM_BYOK_KEY_NAME);
  if (!row) {
    throw Object.assign(
      new Error(
        `Create API key "${PLATFORM_BYOK_KEY_NAME}" under Management → API Keys before using ${p}. Or switch LLM to Platform default / free models.`
      ),
      { status: 400, code: 'platform_byok_required' }
    );
  }
  // ensure decryptable
  resolveUserApiKey(ownerUserId, PLATFORM_BYOK_KEY_NAME);
  return { ok: true };
}

export function resolvePlatformByokSecret(ownerUserId) {
  return resolveUserApiKey(ownerUserId, PLATFORM_BYOK_KEY_NAME).value;
}
