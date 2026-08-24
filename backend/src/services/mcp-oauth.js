/**
 * Generic MCP OAuth - platform client config + per-CEO access tokens (vaulted).
 * Used by Connectors -> MCPs tab; any OAuth-capable MCP can register via mcp_oauth_configs.
 */
import { randomBytes, createHash, randomUUID, createCipheriv, createDecipheriv } from 'crypto';
import { getDb } from '../db/schema.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import {
  createUserApiKey,
  getUserApiKeyRow,
  updateUserApiKey,
  resolveUserApiKey,
  tryResolveUserApiKey,
  isUnsetApiKeyRow,
} from './user-api-keys.js';
import { getMcpServer } from './mcp-servers.js';
import { parsePublicHttpsUrl, requestValidatedHttps } from '../lib/ssrf.js';

const STATE_TTL_MS = 15 * 60 * 1000;
const META_GRAPH_DEFAULT_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_read_user_content',
  'pages_manage_engagement',
  'read_insights',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'business_management',
].join(',');

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function isPlatformAdmin(authUser) {
  return authUser?.role === 'admin' && !authUser?.impersonation;
}

function vaultAccessKeyName(serverId) {
  return `mcp-oauth-${String(serverId).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)}-access`;
}

function vaultRefreshKeyName(serverId) {
  return `mcp-oauth-${String(serverId).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)}-refresh`;
}

function hintFor(token) {
  const s = String(token || '');
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

function envOr(value, envName) {
  const v = String(value || '').trim();
  if (v) return v;
  const env = String(envName || '').trim();
  if (!env) return '';
  return String(process.env[env] || '').trim();
}

/** Empty owner_user_id = platform/admin default row in mcp_oauth_configs. */
export const MCP_OAUTH_PLATFORM_OWNER = '';

const CLIENT_SECRET_ENC_PREFIX = 'enc:g1:';

function platformKek() {
  const raw = String(process.env.USER_API_KEYS_KEK || '').trim();
  if (!raw) return null;
  return createHash('sha256').update(raw, 'utf8').digest();
}

/** Encrypt OAuth client secret with USER_API_KEYS_KEK (AES-256-GCM). */
export function encryptOauthClientSecret(plain) {
  const value = String(plain || '').trim();
  if (!value) return '';
  if (value.startsWith(CLIENT_SECRET_ENC_PREFIX)) return value;
  const kek = platformKek();
  if (!kek) {
    console.warn('[mcp-oauth] USER_API_KEYS_KEK not set — client_secret stored unencrypted');
    return value;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return CLIENT_SECRET_ENC_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Decrypt stored client_secret; plaintext legacy values pass through. */
export function decryptOauthClientSecret(stored) {
  const value = String(stored || '');
  if (!value) return '';
  if (!value.startsWith(CLIENT_SECRET_ENC_PREFIX)) return value;
  const kek = platformKek();
  if (!kek) {
    throw Object.assign(
      new Error('USER_API_KEYS_KEK required to decrypt MCP OAuth client secret'),
      { status: 503 }
    );
  }
  const buf = Buffer.from(value.slice(CLIENT_SECRET_ENC_PREFIX.length), 'base64');
  if (buf.length < 28) throw new Error('Invalid encrypted client_secret');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function secretStoredReady(row) {
  if (!row) return false;
  const raw = String(row.client_secret || '').trim();
  if (raw) return true;
  return !!envOr('', row.client_secret_env);
}

function clientIdReady(row) {
  if (!row) return false;
  return !!envOr(row.client_id, row.client_id_env);
}

/**
 * Upsert vault secret by key_name for the CEO (no encryption phrase).
 */
export function upsertVaultSecret(ownerUserId, keyName, secret) {
  const owner = String(ownerUserId || '').trim();
  const name = String(keyName || '').trim();
  const value = String(secret || '').trim();
  if (!owner || !name || !value) throw new Error('owner, keyName and secret are required');
  const existing = getUserApiKeyRow(owner, name);
  if (!existing || isUnsetApiKeyRow(existing)) {
    if (existing && isUnsetApiKeyRow(existing)) {
      return updateUserApiKey(owner, existing.id, { apiKey: value, clearEncryptionPhrase: true });
    }
    try {
      return createUserApiKey(owner, { keyName: name, apiKey: value });
    } catch (e) {
      if (e.status === 409) {
        const row = getUserApiKeyRow(owner, name);
        if (row) return updateUserApiKey(owner, row.id, { apiKey: value, clearEncryptionPhrase: true });
      }
      throw e;
    }
  }
  return updateUserApiKey(owner, existing.id, { apiKey: value, clearEncryptionPhrase: true });
}

export function getOauthCallbackUrl() {
  const override = String(process.env.MCP_OAUTH_CALLBACK_URL || '').trim();
  if (override) return override.replace(/\/$/, '');
  return `${getPublicBaseUrl()}/api/integrations/mcp/oauth/callback`;
}

export function getOauthConfigRow(serverId, ownerUserId = MCP_OAUTH_PLATFORM_OWNER) {
  const sid = String(serverId || '').trim();
  const oid = ownerUserId == null ? MCP_OAUTH_PLATFORM_OWNER : String(ownerUserId).trim();
  return (
    getDb()
      .prepare('SELECT * FROM mcp_oauth_configs WHERE server_id = ? AND owner_user_id = ?')
      .get(sid, oid) || null
  );
}

/**
 * Effective OAuth client config: per-CEO override row when present, else platform/admin default
 * (owner_user_id = ''). Non-credential columns from the override merge over base.
 */
export function resolveOauthConfig(serverId, ownerUserId = null) {
  const sid = String(serverId || '').trim();
  const oid = String(ownerUserId || '').trim();
  const base = getOauthConfigRow(sid, MCP_OAUTH_PLATFORM_OWNER);
  const override = oid ? getOauthConfigRow(sid, oid) : null;
  if (!base && !override) return null;
  if (!override) {
    return base ? { ...base, _credentials_source: 'platform' } : null;
  }
  if (!base) {
    return { ...override, _credentials_source: 'user' };
  }
  // Prefer non-empty override credential / scopes; keep auth URLs from base unless override set them
  const merged = {
    ...base,
    ...Object.fromEntries(
      Object.entries(override).filter(([k, v]) => {
        if (k === 'server_id' || k === 'owner_user_id') return false;
        if (v == null || v === '') return false;
        return true;
      })
    ),
    server_id: sid,
    owner_user_id: oid,
    // empty override fields fall back to base for id/secret/scopes
    client_id: String(override.client_id || '').trim() || base.client_id,
    client_secret: String(override.client_secret || '').trim() || base.client_secret,
    client_id_env: String(override.client_id_env || '').trim() || base.client_id_env,
    client_secret_env: String(override.client_secret_env || '').trim() || base.client_secret_env,
    scopes: String(override.scopes || '').trim() || base.scopes,
    enabled: base.enabled, // inclusion still driven by platform config
    _credentials_source: 'user',
    _has_user_override: true,
  };
  return merged;
}

export function getOauthConfigPublic(serverId, ownerUserId = null) {
  const row = resolveOauthConfig(serverId, ownerUserId);
  if (!row || !row.enabled) return null;
  const clientId = envOr(row.client_id, row.client_id_env);
  const secretOk = secretStoredReady(row);
  return {
    server_id: row.server_id,
    owner_user_id: row.owner_user_id || MCP_OAUTH_PLATFORM_OWNER,
    provider: row.provider,
    display_name: row.display_name || '',
    scopes: row.scopes || '',
    enabled: !!row.enabled,
    client_id_configured: !!clientId,
    client_secret_configured: secretOk,
    client_id_hint: clientId ? hintFor(clientId) : row.client_id_env ? `env:${row.client_id_env}` : '',
    authorization_url: row.authorization_url,
    token_url: row.token_url,
    callback_url: getOauthCallbackUrl(),
    auth_header_name: row.auth_header_name || 'Authorization',
    credentials_source: row._credentials_source || 'platform',
    has_user_override: !!row._has_user_override || (!!ownerUserId && !!getOauthConfigRow(serverId, ownerUserId)),
  };
}

export function listOauthConfigsForAdmin() {
  const rows = getDb()
    .prepare(
      `SELECT c.*, s.name AS server_name, s.status AS server_status, s.url AS server_url
       FROM mcp_oauth_configs c
       LEFT JOIN mcp_servers s ON s.id = c.server_id
       WHERE c.owner_user_id = ''
       ORDER BY c.display_name COLLATE NOCASE ASC, c.server_id ASC`
    )
    .all();
  return rows.map((r) => ({
    server_id: r.server_id,
    server_name: r.server_name || r.server_id,
    server_status: r.server_status,
    provider: r.provider,
    display_name: r.display_name || r.server_name || r.server_id,
    scopes: r.scopes || '',
    enabled: !!r.enabled,
    client_id_hint: r.client_id ? hintFor(r.client_id) : r.client_id_env ? `env:${r.client_id_env}` : '',
    client_secret_set: !!(r.client_secret || r.client_secret_env),
    callback_url: getOauthCallbackUrl(),
    updated_at: r.updated_at,
  }));
}

/**
 * Admin: create/update OAuth client settings for an MCP server.
 */
/**
 * MCP servers from the registry that can be included on Connectors → MCPs.
 * Shows oauth_included when already on the OAuth tab.
 */
export function listOauthCandidateServers(authUser) {
  const db = getDb();
  let rows;
  if (isPlatformAdmin(authUser)) {
    rows = db
      .prepare(
        `SELECT s.id, s.name, s.description, s.url, s.status, s.is_platform, s.owner_role, s.owner_user_id,
                c.provider AS oauth_provider, c.display_name AS oauth_display_name,
                c.enabled AS oauth_enabled, c.client_id, c.client_id_env, c.client_secret, c.client_secret_env
         FROM mcp_servers s
         LEFT JOIN mcp_oauth_configs c ON c.server_id = s.id AND c.owner_user_id = ''
         ORDER BY CASE WHEN c.server_id IS NOT NULL AND c.enabled = 1 THEN 0 ELSE 1 END,
                  s.is_platform DESC, s.name COLLATE NOCASE ASC`
      )
      .all();
  } else {
    const ownerId = String(authUser?.id || '').trim();
    rows = db
      .prepare(
        `SELECT s.id, s.name, s.description, s.url, s.status, s.is_platform, s.owner_role, s.owner_user_id,
                c.provider AS oauth_provider, c.display_name AS oauth_display_name,
                c.enabled AS oauth_enabled, c.client_id, c.client_id_env, c.client_secret, c.client_secret_env
         FROM mcp_servers s
         LEFT JOIN mcp_oauth_configs c ON c.server_id = s.id AND c.owner_user_id = ''
         WHERE (s.is_platform = 1 AND s.owner_role = 'admin')
            OR (s.owner_user_id = ? AND s.owner_role = 'ceo')
         ORDER BY CASE WHEN c.server_id IS NOT NULL AND c.enabled = 1 THEN 0 ELSE 1 END,
                  s.is_platform DESC, s.name COLLATE NOCASE ASC`
      )
      .all(ownerId);
  }
  return rows.map((r) => {
    const hasConfig = r.oauth_provider != null || r.oauth_enabled != null;
    const included = hasConfig && !!r.oauth_enabled;
    const secretOk = secretStoredReady(r);
    return {
      server_id: r.id,
      name: r.name,
      description: r.description || '',
      url: r.url,
      status: r.status,
      is_platform: !!r.is_platform,
      owner_role: r.owner_role,
      oauth_included: included,
      oauth_configured: hasConfig,
      oauth_provider: r.oauth_provider || null,
      oauth_display_name: r.oauth_display_name || r.name,
      oauth_client_ready: included && !!(envOr(r.client_id, r.client_id_env) && secretOk),
    };
  });
}

/** Include (or update) a registry MCP on Connectors → MCPs with OAuth. */
export function includeMcpForOauth(serverId, body = {}, authUser) {
  const id = String(serverId || body.server_id || '').trim();
  if (!id) throw Object.assign(new Error('server_id required'), { status: 400 });
  const row = getDb().prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('MCP server not found in registry — onboard it under Integrations → MCP first'), { status: 404 });
  const provider = String(body.provider || 'oauth2').trim().toLowerCase() || 'oauth2';
  const defaults = providerDefaults(provider);
  return upsertOauthConfig(
    id,
    {
      ...body,
      provider,
      enabled: body.enabled === false || body.enabled === 0 ? false : true,
      display_name: body.display_name || body.displayName || defaults.display_name || row.name,
      authorization_url: body.authorization_url || body.authorizationUrl || undefined,
      token_url: body.token_url || body.tokenUrl || undefined,
      token_request_style: body.token_request_style || defaults.token_request_style || 'form',
      provider_options: body.provider_options || defaults.provider_options || {},
    },
    authUser
  );
}

export function excludeMcpFromOauth(serverId, authUser) {
  // Soft-disable so history/connections remaining; admin can fully delete via deleteOauthConfig
  const id = String(serverId || '').trim();
  const row = getOauthConfigRow(id);
  if (!row) return { ok: true, excluded: false };
  upsertOauthConfig(id, { enabled: false }, authUser);
  console.info('[mcp-oauth] excluded from Connectors MCPs tab', { server_id: id, by: authUser?.id });
  return { ok: true, excluded: true, server_id: id };
}

export function upsertOauthConfig(serverId, body = {}, authUser) {
  const sidPre = String(serverId || body.server_id || '').trim();
  const ownerRow = sidPre
    ? getDb().prepare('SELECT owner_user_id, owner_role, is_platform FROM mcp_servers WHERE id = ?').get(sidPre)
    : null;
  const isAdmin = isPlatformAdmin(authUser);
  const allowOwnMcp =
    authUser?.role === 'ceo' &&
    !authUser?.impersonation &&
    ownerRow &&
    ownerRow.owner_role === 'ceo' &&
    ownerRow.owner_user_id === authUser.id &&
    !ownerRow.is_platform;

  // CEO credential override on any platform-enabled OAuth MCP (App ID/secret/scopes)
  const forceUserOverride =
    body.user_override === true ||
    body.userOverride === true ||
    body.as_user_override === true;

  let configOwner = MCP_OAUTH_PLATFORM_OWNER;
  if (forceUserOverride || (!isAdmin && !allowOwnMcp)) {
    // CEO override path (also when pure CEO saves credentials for a platform server)
    if (!authUser?.id || (isAdmin && !authUser.impersonation && !forceUserOverride && allowOwnMcp)) {
      /* keep platform */
    } else if (!isAdmin || authUser.impersonation || forceUserOverride) {
      configOwner = String(authUser.id).trim();
    }
  }
  if (isAdmin && !authUser?.impersonation && !forceUserOverride) {
    configOwner = MCP_OAUTH_PLATFORM_OWNER;
  }
  if (!isAdmin && !allowOwnMcp && !forceUserOverride) {
    // Default CEO upsert on platform MCP without flag = treated as user override
    const baseEnabled = getOauthConfigRow(sidPre, MCP_OAUTH_PLATFORM_OWNER);
    if (baseEnabled?.enabled) {
      configOwner = String(authUser.id).trim();
    }
  }

  if (!isAdmin && !allowOwnMcp && configOwner === MCP_OAUTH_PLATFORM_OWNER) {
    throw Object.assign(
      new Error(
        'Only platform admin can configure platform MCP OAuth defaults; CEOs may set a personal App ID/secret override on Connectors → MCPs'
      ),
      { status: 403 }
    );
  }
  if (!isAdmin && allowOwnMcp && configOwner === MCP_OAUTH_PLATFORM_OWNER) {
    // CEO configuring their own MCP: still platform-scope row for that server
    configOwner = MCP_OAUTH_PLATFORM_OWNER;
  }

  const id = String(serverId || body.server_id || '').trim();
  if (!id) throw Object.assign(new Error('server_id required'), { status: 400 });
  const server = getDb().prepare('SELECT id FROM mcp_servers WHERE id = ?').get(id);
  if (!server) throw Object.assign(new Error('MCP server not found'), { status: 404 });

  const existing = getOauthConfigRow(id, configOwner);
  const base = getOauthConfigRow(id, MCP_OAUTH_PLATFORM_OWNER);
  const template = existing || base || {};
  const isUserOverride = configOwner !== MCP_OAUTH_PLATFORM_OWNER;

  if (isUserOverride && !base?.enabled) {
    throw Object.assign(
      new Error('OAuth is not enabled for this MCP on the platform (admin must Include first)'),
      { status: 400 }
    );
  }

  const provider = String(
    body.provider || template.provider || base?.provider || 'oauth2'
  )
    .trim()
    .toLowerCase();
  const defaults = providerDefaults(provider);

  const authorization_url = String(
    body.authorization_url ??
      body.authorizationUrl ??
      template.authorization_url ??
      base?.authorization_url ??
      defaults.authorization_url ??
      ''
  ).trim();
  const token_url = String(
    body.token_url ?? body.tokenUrl ?? template.token_url ?? base?.token_url ?? defaults.token_url ?? ''
  ).trim();
  if (!authorization_url || !token_url) {
    throw Object.assign(new Error('authorization_url and token_url are required'), { status: 400 });
  }
  parsePublicHttpsUrl(authorization_url, { httpsOnly: true });
  parsePublicHttpsUrl(token_url, { httpsOnly: true });

  let client_id = template.client_id || '';
  if (body.client_id != null || body.clientId != null) {
    client_id = String(body.client_id ?? body.clientId ?? '').trim();
  }
  let client_secret = template.client_secret || '';
  if (body.client_secret != null || body.clientSecret != null) {
    const next = String(body.client_secret ?? body.clientSecret ?? '').trim();
    if (next) client_secret = encryptOauthClientSecret(next);
  } else if (client_secret && !String(client_secret).startsWith(CLIENT_SECRET_ENC_PREFIX) && platformKek()) {
    // re-encrypt legacy plaintext on rewrite of other fields
    client_secret = encryptOauthClientSecret(decryptOauthClientSecret(client_secret));
  }

  const client_id_env = isUserOverride
    ? String(body.client_id_env ?? body.clientIdEnv ?? template.client_id_env ?? '').trim()
    : String(
        body.client_id_env ?? body.clientIdEnv ?? template.client_id_env ?? defaults.client_id_env ?? ''
      ).trim();
  const client_secret_env = isUserOverride
    ? String(body.client_secret_env ?? body.clientSecretEnv ?? template.client_secret_env ?? '').trim()
    : String(
        body.client_secret_env ??
          body.clientSecretEnv ??
          template.client_secret_env ??
          defaults.client_secret_env ??
          ''
      ).trim();

  const scopes = String(body.scopes ?? template.scopes ?? base?.scopes ?? defaults.scopes ?? '').trim();
  const display_name = String(
    body.display_name ??
      body.displayName ??
      template.display_name ??
      base?.display_name ??
      defaults.display_name ??
      id
  ).trim();
  const enabled = isUserOverride
    ? 1
    : body.enabled === false || body.enabled === 0 || body.enabled === '0'
      ? 0
      : body.enabled === true || body.enabled === 1 || body.enabled === '1'
        ? 1
        : template.enabled != null
          ? template.enabled
            ? 1
            : 0
          : 1;

  const auth_header_name = String(
    body.auth_header_name ??
      body.authHeaderName ??
      template.auth_header_name ??
      base?.auth_header_name ??
      'Authorization'
  ).trim();
  const auth_header_template = String(
    body.auth_header_template ??
      body.authHeaderTemplate ??
      template.auth_header_template ??
      base?.auth_header_template ??
      'Bearer {{access_token}}'
  ).trim();
  const token_request_style = String(
    body.token_request_style ??
      body.tokenRequestStyle ??
      template.token_request_style ??
      base?.token_request_style ??
      defaults.token_request_style ??
      'form'
  ).trim();
  const refresh_enabled =
    body.refresh_enabled === false || body.refreshEnabled === false
      ? 0
      : body.refresh_enabled === true || body.refreshEnabled === true
        ? 1
        : template.refresh_enabled != null
          ? template.refresh_enabled
            ? 1
            : 0
          : 1;

  const extra =
    body.extra_auth_params ?? body.extraAuthParams ?? parseJson(template.extra_auth_params_json, {});
  const provider_options =
    body.provider_options ??
    body.providerOptions ??
    parseJson(template.provider_options_json, defaults.provider_options || {});

  getDb()
    .prepare(
      `INSERT INTO mcp_oauth_configs (
        server_id, owner_user_id, provider, display_name, authorization_url, token_url,
        client_id, client_secret, client_id_env, client_secret_env, scopes,
        auth_header_name, auth_header_template, extra_auth_params_json, token_request_style,
        refresh_enabled, provider_options_json, enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(server_id, owner_user_id) DO UPDATE SET
        provider = excluded.provider,
        display_name = excluded.display_name,
        authorization_url = excluded.authorization_url,
        token_url = excluded.token_url,
        client_id = excluded.client_id,
        client_secret = excluded.client_secret,
        client_id_env = excluded.client_id_env,
        client_secret_env = excluded.client_secret_env,
        scopes = excluded.scopes,
        auth_header_name = excluded.auth_header_name,
        auth_header_template = excluded.auth_header_template,
        extra_auth_params_json = excluded.extra_auth_params_json,
        token_request_style = excluded.token_request_style,
        refresh_enabled = excluded.refresh_enabled,
        provider_options_json = excluded.provider_options_json,
        enabled = excluded.enabled,
        updated_at = datetime('now')`
    )
    .run(
      id,
      configOwner,
      provider,
      display_name,
      authorization_url,
      token_url,
      client_id,
      client_secret,
      client_id_env,
      client_secret_env,
      scopes,
      auth_header_name || 'Authorization',
      auth_header_template || 'Bearer {{access_token}}',
      JSON.stringify(extra && typeof extra === 'object' ? extra : {}),
      token_request_style || 'form',
      refresh_enabled ? 1 : 0,
      JSON.stringify(provider_options && typeof provider_options === 'object' ? provider_options : {}),
      enabled
    );

  console.info('[mcp-oauth] config upserted', {
    server_id: id,
    owner_user_id: configOwner || '(platform)',
    provider,
    enabled: !!enabled,
    by: authUser?.id,
    credentials_source: isUserOverride ? 'user' : 'platform',
  });
  return getOauthConfigPublic(id, isUserOverride ? configOwner : null);
}

function providerDefaults(provider) {
  const p = String(provider || '').toLowerCase().trim();
  if (p === 'facebook' || p === 'meta' || p === 'meta_graph') {
    return {
      display_name: 'Facebook / Meta Graph',
      authorization_url: 'https://www.facebook.com/v21.0/dialog/oauth',
      token_url: 'https://graph.facebook.com/v21.0/oauth/access_token',
      client_id_env: 'FACEBOOK_APP_ID',
      client_secret_env: 'FACEBOOK_APP_SECRET',
      scopes: META_GRAPH_DEFAULT_SCOPES,
      token_request_style: 'form',
      provider_options: { long_lived: true, graph_version: 'v21.0' },
    };
  }
  if (p === 'linkedin' || p === 'linkedin_openid') {
    return {
      display_name: 'LinkedIn',
      authorization_url: 'https://www.linkedin.com/oauth/v2/authorization',
      token_url: 'https://www.linkedin.com/oauth/v2/accessToken',
      client_id_env: 'LINKEDIN_CLIENT_ID',
      client_secret_env: 'LINKEDIN_CLIENT_SECRET',
      scopes: 'openid profile email w_member_social',
      token_request_style: 'form',
      provider_options: { account_label_url: 'https://api.linkedin.com/v2/userinfo' },
    };
  }
  if (p === 'github') {
    return {
      display_name: 'GitHub',
      authorization_url: 'https://github.com/login/oauth/authorize',
      token_url: 'https://github.com/login/oauth/access_token',
      client_id_env: 'GITHUB_CLIENT_ID',
      client_secret_env: 'GITHUB_CLIENT_SECRET',
      scopes: 'repo read:user',
      token_request_style: 'json',
      provider_options: { account_label_url: 'https://api.github.com/user' },
    };
  }
  if (p === 'google' || p === 'google_oauth2') {
    return {
      display_name: 'Google',
      authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
      token_url: 'https://oauth2.googleapis.com/token',
      client_id_env: 'GOOGLE_CLIENT_ID',
      client_secret_env: 'GOOGLE_CLIENT_SECRET',
      scopes: 'openid email profile',
      token_request_style: 'form',
      provider_options: {
        account_label_url: 'https://www.googleapis.com/oauth2/v2/userinfo',
        extra_auth_params: { access_type: 'offline', prompt: 'consent' },
      },
    };
  }
  return {
    display_name: '',
    authorization_url: '',
    token_url: '',
    client_id_env: '',
    client_secret_env: '',
    scopes: '',
    token_request_style: 'form',
    provider_options: {},
  };
}

/** Provider presets for Connectors → MCPs enable form (no secrets). */
export function listOauthProviderPresets() {
  return ['facebook', 'linkedin', 'github', 'google', 'oauth2'].map((id) => {
    const d = providerDefaults(id === 'oauth2' ? '' : id);
    return {
      id: id === 'oauth2' ? 'oauth2' : id,
      label: d.display_name || (id === 'oauth2' ? 'Custom OAuth 2.0' : id),
      authorization_url: d.authorization_url || '',
      token_url: d.token_url || '',
      scopes: d.scopes || '',
      client_id_env: d.client_id_env || '',
      client_secret_env: d.client_secret_env || '',
      token_request_style: d.token_request_style || 'form',
    };
  });
}

/**
 * Resolve client id/secret for token exchange (env fallback).
 */
export function resolveOauthClientCredentials(cfg) {
  const clientId = envOr(cfg.client_id, cfg.client_id_env);
  let clientSecret = '';
  try {
    const stored = String(cfg.client_secret || '').trim();
    clientSecret = stored
      ? decryptOauthClientSecret(stored)
      : envOr('', cfg.client_secret_env);
  } catch (e) {
    throw Object.assign(new Error(e.message || 'Failed to decrypt OAuth client secret'), {
      status: e.status || 503,
    });
  }
  if (!clientId || !clientSecret) {
    throw Object.assign(
      new Error(
        `OAuth client not configured for MCP ${cfg.server_id}. Set client id/secret as platform admin, CEO override on Connectors, or env ${cfg.client_id_env || 'CLIENT_ID'}/${cfg.client_secret_env || 'CLIENT_SECRET'}.`
      ),
      { status: 503 }
    );
  }
  return { clientId, clientSecret };
}

export function getConnection(ownerUserId, serverId) {
  return (
    getDb()
      .prepare(
        `SELECT * FROM mcp_oauth_connections
         WHERE owner_user_id = ? AND server_id = ?`
      )
      .get(String(ownerUserId || '').trim(), String(serverId || '').trim()) || null
  );
}

export function sanitizeConnection(row) {
  if (!row) return null;
  return {
    id: row.id,
    server_id: row.server_id,
    owner_user_id: row.owner_user_id,
    status: row.status,
    access_token_hint: row.access_token_hint || '',
    expires_at: row.expires_at || null,
    scopes: row.scopes || '',
    account_label: row.account_label || '',
    connected_at: row.connected_at,
    updated_at: row.updated_at,
    last_error: row.last_error || null,
    connected: row.status === 'connected' && !!row.access_token_ref,
  };
}

/**
 * CEO view: OAuth-enabled MCPs + connection status.
 */
export function listOauthConnectorsForUser(authUser) {
  const ownerId = String(authUser?.id || '').trim();
  if (!ownerId) return [];

  const configs = getDb()
    .prepare(
      `SELECT c.*, s.name AS server_name, s.description AS server_description,
              s.status AS server_status, s.url AS server_url, s.is_platform
       FROM mcp_oauth_configs c
       INNER JOIN mcp_servers s ON s.id = c.server_id
       WHERE c.enabled = 1
         AND c.owner_user_id = ''
         AND (
           (s.is_platform = 1 AND s.owner_role = 'admin')
           OR (s.owner_user_id = ? AND s.owner_role = 'ceo')
         )
       ORDER BY c.display_name COLLATE NOCASE ASC, s.name ASC`
    )
    .all(ownerId);

  return configs.map((c) => {
    const effective = resolveOauthConfig(c.server_id, ownerId) || c;
    const conn = getConnection(ownerId, c.server_id);
    const clientId = envOr(effective.client_id, effective.client_id_env);
    const overrideRow = getOauthConfigRow(c.server_id, ownerId);
    return {
      server_id: c.server_id,
      name: c.display_name || c.server_name || c.server_id,
      description: c.server_description || '',
      provider: c.provider,
      server_status: c.server_status,
      server_url: c.server_url,
      scopes: effective.scopes || '',
      platform_scopes: c.scopes || '',
      oauth_client_ready: clientIdReady(effective) && secretStoredReady(effective),
      credentials_source: effective._credentials_source || (overrideRow ? 'user' : 'platform'),
      has_user_override: !!overrideRow,
      override_client_id_hint: overrideRow?.client_id ? hintFor(overrideRow.client_id) : '',
      override_secret_set: !!(overrideRow && String(overrideRow.client_secret || '').trim()),
      override_scopes: overrideRow?.scopes || '',
      connection: sanitizeConnection(conn),
      callback_url: getOauthCallbackUrl(),
    };
  });
}

export function startMcpOauth(serverId, authUser) {
  if (isPlatformAdmin(authUser) && !authUser.impersonation) {
    throw Object.assign(
      new Error('Sign in as a CEO to connect your own OAuth session for this MCP.'),
      { status: 403 }
    );
  }
  const ownerId = String(authUser?.id || '').trim();
  const id = String(serverId || '').trim();
  const server = getMcpServer(id, authUser);
  if (!server) throw Object.assign(new Error('MCP server not found'), { status: 404 });

  const cfg = resolveOauthConfig(id, ownerId);
  if (!cfg || !cfg.enabled) {
    throw Object.assign(new Error('OAuth is not enabled for this MCP server'), { status: 400 });
  }
  const { clientId } = resolveOauthClientCredentials(cfg);

  const state = randomBytes(24).toString('hex');
  const codeVerifier = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  // purge stale
  try {
    getDb().prepare(`DELETE FROM mcp_oauth_states WHERE expires_at < datetime('now')`).run();
  } catch (_) {}

  getDb()
    .prepare(
      `INSERT INTO mcp_oauth_states (state, server_id, owner_user_id, code_verifier, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(state, id, ownerId, codeVerifier, expiresAt);

  const redirectUri = getOauthCallbackUrl();
  const url = new URL(cfg.authorization_url);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (cfg.scopes) url.searchParams.set('scope', cfg.scopes.replace(/,/g, ' ').replace(/\s+/g, ' ').trim());

  const extra = parseJson(cfg.extra_auth_params_json, {});
  const optExtra = parseJson(cfg.provider_options_json, {})?.extra_auth_params || {};
  for (const [k, v] of Object.entries({ ...optExtra, ...extra })) {
    if (v != null && String(v).trim()) url.searchParams.set(k, String(v));
  }

  // Facebook Login expects comma-separated scope
  if (cfg.provider === 'facebook' || cfg.provider === 'meta' || cfg.provider === 'meta_graph') {
    if (cfg.scopes) url.searchParams.set('scope', cfg.scopes.replace(/\s+/g, ','));
  }

  console.info('[mcp-oauth] start', { server_id: id, owner: ownerId, provider: cfg.provider });
  return {
    authorization_url: url.toString(),
    state,
    server_id: id,
    callback_url: redirectUri,
  };
}

async function exchangeCodeForTokens(cfg, code) {
  const { clientId, clientSecret } = resolveOauthClientCredentials(cfg);
  const redirectUri = getOauthCallbackUrl();
  const style = String(cfg.token_request_style || 'form').toLowerCase();

  let tokenRes;
  if (style === 'json') {
    tokenRes = await requestValidatedHttps(cfg.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: AbortSignal.timeout(45000),
    });
  } else {
    // Facebook prefers GET for token endpoint
    if (cfg.provider === 'facebook' || cfg.provider === 'meta' || cfg.provider === 'meta_graph') {
      const u = new URL(cfg.token_url);
      u.searchParams.set('client_id', clientId);
      u.searchParams.set('client_secret', clientSecret);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('code', code);
      tokenRes = await requestValidatedHttps(u.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(45000),
      });
    } else {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });
      tokenRes = await requestValidatedHttps(cfg.token_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(45000),
      });
    }
  }

  if (tokenRes.status >= 300 && tokenRes.status < 400) {
    throw new Error('OAuth token endpoint redirects are not allowed');
  }
  const text = await tokenRes.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Token endpoint returned non-JSON (${tokenRes.status}): ${text.slice(0, 200)}`);
  }
  if (!tokenRes.ok || data.error) {
    const msg =
      data.error_description ||
      data.error?.message ||
      data.error ||
      `Token exchange failed HTTP ${tokenRes.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  let accessToken = data.access_token;
  let refreshToken = data.refresh_token || null;
  let expiresIn = Number(data.expires_in) || null;

  const opts = parseJson(cfg.provider_options_json, {});
  if (
    (cfg.provider === 'facebook' || cfg.provider === 'meta' || cfg.provider === 'meta_graph') &&
    opts.long_lived !== false &&
    accessToken
  ) {
    const long = await exchangeFacebookLongLived(clientId, clientSecret, accessToken, opts.graph_version);
    if (long.access_token) {
      accessToken = long.access_token;
      expiresIn = Number(long.expires_in) || expiresIn;
    }
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    scope: data.scope || cfg.scopes || '',
    token_type: data.token_type || 'bearer',
    raw: data,
  };
}

async function exchangeFacebookLongLived(clientId, clientSecret, shortToken, graphVersion = 'v21.0') {
  const ver = String(graphVersion || 'v21.0').replace(/^\//, '');
  const u = new URL(`https://graph.facebook.com/${ver}/oauth/access_token`);
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('client_secret', clientSecret);
  u.searchParams.set('fb_exchange_token', shortToken);
  const res = await fetch(u.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.warn('[mcp-oauth] facebook long-lived non-JSON', { status: res.status });
    return {};
  }
  if (!res.ok || data.error) {
    console.warn('[mcp-oauth] facebook long-lived exchange failed', {
      status: res.status,
      error: data.error?.message || data.error,
    });
    return {};
  }
  return data;
}

async function fetchAccountLabel(cfg, accessToken) {
  try {
    if (cfg.provider === 'facebook' || cfg.provider === 'meta' || cfg.provider === 'meta_graph') {
      const res = await fetch('https://graph.facebook.com/v21.0/me?fields=id,name', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return '';
      const data = await res.json();
      return data.name ? `${data.name} (${data.id})` : data.id || '';
    }
    const opts = parseJson(cfg.provider_options_json, {});
    const labelUrl = String(opts.account_label_url || '').trim();
    if (labelUrl) {
      const res = await requestValidatedHttps(labelUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'Agent-OS-MCP-OAuth',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return '';
      const data = await res.json();
      return (
        data.name ||
        data.email ||
        data.login ||
        [data.given_name, data.family_name].filter(Boolean).join(' ') ||
        data.sub ||
        data.id ||
        ''
      );
    }
  } catch (e) {
    console.warn('[mcp-oauth] account label failed', { error: e.message });
  }
  return '';
}


export async function handleMcpOauthCallback({ code, state, error, error_description } = {}) {
  if (error) {
    const msg = error_description || error;
    console.warn('[mcp-oauth] provider error', { error: msg });
    return {
      status: 400,
      html: oauthResultHtml(false, `OAuth failed: ${msg}`),
    };
  }
  const st = String(state || '').trim();
  const authCode = String(code || '').trim();
  if (!st || !authCode) {
    return { status: 400, html: oauthResultHtml(false, 'Missing code or state') };
  }

  const row = getDb().prepare('SELECT * FROM mcp_oauth_states WHERE state = ?').get(st);
  if (!row) {
    return { status: 400, html: oauthResultHtml(false, 'Invalid or expired OAuth state') };
  }
  getDb().prepare('DELETE FROM mcp_oauth_states WHERE state = ?').run(st);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { status: 400, html: oauthResultHtml(false, 'OAuth state expired - try Connect again') };
  }

  const cfg = resolveOauthConfig(row.server_id, row.owner_user_id);
  if (!cfg) {
    return { status: 400, html: oauthResultHtml(false, 'OAuth config missing for this MCP') };
  }

  try {
    const tokens = await exchangeCodeForTokens(cfg, authCode);
    if (!tokens.access_token) throw new Error('No access_token in token response');

    const accessRef = vaultAccessKeyName(row.server_id);
    const refreshRef = vaultRefreshKeyName(row.server_id);
    upsertVaultSecret(row.owner_user_id, accessRef, tokens.access_token);
    if (tokens.refresh_token) {
      upsertVaultSecret(row.owner_user_id, refreshRef, tokens.refresh_token);
    }

    const accountLabel = await fetchAccountLabel(cfg, tokens.access_token);
    const expiresAt =
      tokens.expires_in != null
        ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
        : null;

    const existing = getConnection(row.owner_user_id, row.server_id);
    const id = existing?.id || randomUUID();
    getDb()
      .prepare(
        `INSERT INTO mcp_oauth_connections (
          id, server_id, owner_user_id, access_token_ref, refresh_token_ref,
          access_token_hint, expires_at, scopes, account_label, metadata_json,
          status, last_error, connected_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', NULL, datetime('now'), datetime('now'))
        ON CONFLICT(owner_user_id, server_id) DO UPDATE SET
          access_token_ref = excluded.access_token_ref,
          refresh_token_ref = excluded.refresh_token_ref,
          access_token_hint = excluded.access_token_hint,
          expires_at = excluded.expires_at,
          scopes = excluded.scopes,
          account_label = excluded.account_label,
          metadata_json = excluded.metadata_json,
          status = 'connected',
          last_error = NULL,
          connected_at = datetime('now'),
          updated_at = datetime('now')`
      )
      .run(
        id,
        row.server_id,
        row.owner_user_id,
        accessRef,
        tokens.refresh_token ? refreshRef : existing?.refresh_token_ref || '',
        hintFor(tokens.access_token),
        expiresAt,
        tokens.scope || cfg.scopes || '',
        accountLabel,
        JSON.stringify({ token_type: tokens.token_type || 'bearer' })
      );

    console.info('[mcp-oauth] connected', {
      server_id: row.server_id,
      owner: row.owner_user_id,
      account: accountLabel || undefined,
    });
    return {
      html: oauthResultHtml(
        true,
        `${cfg.display_name || row.server_id} connected${accountLabel ? ` as ${accountLabel}` : ''}. You can close this window.`
      ),
    };
  } catch (e) {
    console.error('[mcp-oauth] callback failed', {
      server_id: row.server_id,
      owner: row.owner_user_id,
      error: e.message,
    });
    try {
      const existing = getConnection(row.owner_user_id, row.server_id);
      if (existing) {
        getDb()
          .prepare(
            `UPDATE mcp_oauth_connections SET status = 'error', last_error = ?, updated_at = datetime('now')
             WHERE id = ?`
          )
          .run(String(e.message || 'error').slice(0, 500), existing.id);
      }
    } catch (_) {}
    return { status: 500, html: oauthResultHtml(false, e.message || 'Token exchange failed') };
  }
}

function oauthResultHtml(ok, message) {
  const title = ok ? 'Connected' : 'Connection failed';
  const color = ok ? '#16a34a' : '#dc2626';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${title}</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}
  .box{max-width:420px;padding:1.5rem 1.75rem;border:1px solid #e2e8f0;border-radius:12px;background:#fff;text-align:center}
  h1{font-size:1.15rem;margin:0 0 .5rem;color:${color}}
  p{margin:0;color:#475569;font-size:.95rem;line-height:1.45}
</style></head>
<body><div class="box"><h1>${title}</h1><p>${escapeHtml(message)}</p></div>
<script>try{if(window.opener)window.opener.postMessage({type:'mcp-oauth',ok:${ok ? 'true' : 'false'}},'*');}catch(e){}
setTimeout(function(){try{window.close();}catch(e){}},2500);</script>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function disconnectMcpOauth(serverId, authUser) {
  const ownerId = String(authUser?.id || '').trim();
  const id = String(serverId || '').trim();
  const server = getMcpServer(id, authUser);
  if (!server && !isPlatformAdmin(authUser)) {
    throw Object.assign(new Error('MCP server not found'), { status: 404 });
  }
  const conn = getConnection(ownerId, id);
  if (!conn) return { ok: true, disconnected: false };
  getDb().prepare('DELETE FROM mcp_oauth_connections WHERE id = ?').run(conn.id);
  // Leave vault secrets in place (user may delete from API Keys); clear hint only.
  console.info('[mcp-oauth] disconnected', { server_id: id, owner: ownerId });
  return { ok: true, disconnected: true };
}

/**
 * Resolve live access token for owner+server (refresh not yet generic; Facebook long-lived ~60d).
 */
export function resolveMcpOauthAccessToken(ownerUserId, serverId) {
  const conn = getConnection(ownerUserId, serverId);
  if (!conn || conn.status !== 'connected' || !conn.access_token_ref) return null;
  const resolved = tryResolveUserApiKey(ownerUserId, conn.access_token_ref);
  if (!resolved?.value) return null;
  return {
    access_token: resolved.value,
    expires_at: conn.expires_at,
    header_name: null,
    header_value: null,
    connection: conn,
  };
}

/**
 * Build auth headers from CEO OAuth connection for MCP HTTP calls.
 */
export function getMcpOauthAuthHeaders(ownerUserId, serverId) {
  const cfg = resolveOauthConfig(serverId, ownerUserId);
  if (!cfg || !cfg.enabled) return null;
  const tokenInfo = resolveMcpOauthAccessToken(ownerUserId, serverId);
  if (!tokenInfo?.access_token) return null;

  const headerName = String(cfg.auth_header_name || 'Authorization').trim() || 'Authorization';
  const template = String(cfg.auth_header_template || 'Bearer {{access_token}}');
  const value = template.replace(/\{\{\s*access_token\s*\}\}/g, tokenInfo.access_token);
  return { headers: { [headerName]: value } };
}

export function deleteOauthConfig(serverId, authUser) {
  if (!isPlatformAdmin(authUser)) {
    throw Object.assign(new Error('Only platform admin can remove MCP OAuth configs'), { status: 403 });
  }
  getDb()
    .prepare("DELETE FROM mcp_oauth_configs WHERE server_id = ? AND owner_user_id = ''")
    .run(String(serverId || '').trim());
  return { ok: true };
}

/** CEO/admin-impersonating: delete only the CEO override row (falls back to platform). */

/**
 * CEO/personal: set App ID, secret, scopes override for a platform OAuth MCP.
 * Same table as admin (mcp_oauth_configs) with owner_user_id = CEO id.
 */
export function upsertUserOauthClientOverride(serverId, body = {}, authUser) {
  const ownerId = String(authUser?.id || '').trim();
  if (!ownerId || (isPlatformAdmin(authUser) && !authUser?.impersonation)) {
    throw Object.assign(
      new Error('Sign in as a CEO to set a personal App ID / secret override'),
      { status: 403 }
    );
  }
  return upsertOauthConfig(
    serverId,
    {
      ...body,
      user_override: true,
      enabled: true,
    },
    authUser
  );
}

export function deleteUserOauthConfigOverride(serverId, authUser) {
  const ownerId = String(authUser?.id || '').trim();
  if (!ownerId || (isPlatformAdmin(authUser) && !authUser?.impersonation)) {
    throw Object.assign(
      new Error('Sign in as a CEO to clear your App ID/secret override'),
      { status: 403 }
    );
  }
  const id = String(serverId || '').trim();
  getDb()
    .prepare('DELETE FROM mcp_oauth_configs WHERE server_id = ? AND owner_user_id = ?')
    .run(id, ownerId);
  console.info('[mcp-oauth] user override cleared', { server_id: id, owner: ownerId });
  return { ok: true, cleared: true, server_id: id };
}


/** Seed Facebook OAuth defaults for a Meta Graph MCP server id. */
export function ensureFacebookOauthConfig(serverId, authUser, overrides = {}) {
  return upsertOauthConfig(
    serverId,
    {
      provider: 'facebook',
      display_name: overrides.display_name || 'Facebook / Meta Graph',
      ...providerDefaults('facebook'),
      client_id: overrides.client_id || '',
      client_secret: overrides.client_secret || '',
      scopes: overrides.scopes || META_GRAPH_DEFAULT_SCOPES,
      enabled: overrides.enabled !== false,
      ...overrides,
    },
    authUser
  );
}

export { META_GRAPH_DEFAULT_SCOPES };
