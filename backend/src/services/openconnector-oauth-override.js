/**
 * Per-CEO OpenConnector OAuth app credentials (BYOA).
 * Stored in Agent OS; passed to OC POST /api/oauth/authorizations as connection-scoped
 * clientId/clientSecret (requires OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH on the OC runtime).
 * Platform default remains PUT /api/oauth/configs/:app (admin).
 */
import { getDb } from '../db/schema.js';
import {
  decryptOauthClientSecret,
  encryptOauthClientSecret,
} from './mcp-oauth.js';

function db() {
  return getDb();
}

function maskClientId(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (s.length <= 8) return `${s.slice(0, 2)}…`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function parseExtra(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const o = JSON.parse(String(raw));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

function parseScopes(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return s
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function getOpenConnectorOauthOverrideRow(appId, ownerUserId) {
  const app = String(appId || '').trim().toLowerCase();
  if (!app) return null;
  const owner = ownerUserId == null ? '' : String(ownerUserId).trim();
  return (
    db()
      .prepare(
        `SELECT app_id, owner_user_id, client_id, client_secret, scopes, extra_json, enabled, created_at, updated_at
         FROM openconnector_oauth_client_overrides
         WHERE app_id = ? AND owner_user_id = ?`
      )
      .get(app, owner) || null
  );
}

/** Public/safe view for Connectors UI (no secret plaintext). */
export function getOpenConnectorOauthOverridePublic(appId, ownerUserId) {
  const row = getOpenConnectorOauthOverrideRow(appId, ownerUserId);
  if (!row || !row.enabled) {
    return {
      app_id: String(appId || '').trim().toLowerCase() || null,
      has_user_override: false,
      client_id_hint: null,
      secret_set: false,
      scopes: '',
      credentials_source: 'platform',
    };
  }
  return {
    app_id: row.app_id,
    has_user_override: true,
    client_id_hint: maskClientId(row.client_id),
    secret_set: !!String(row.client_secret || '').trim(),
    scopes: String(row.scopes || '').trim(),
    credentials_source: 'user',
  };
}

export function listOpenConnectorOauthOverridesForUser(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const rows = db()
    .prepare(
      `SELECT app_id, client_id, client_secret, scopes, enabled, updated_at
       FROM openconnector_oauth_client_overrides
       WHERE owner_user_id = ? AND enabled = 1
       ORDER BY app_id`
    )
    .all(owner);
  return rows.map((r) => ({
    app_id: r.app_id,
    has_user_override: true,
    client_id_hint: maskClientId(r.client_id),
    secret_set: !!String(r.client_secret || '').trim(),
    scopes: String(r.scopes || '').trim(),
    updated_at: r.updated_at || null,
  }));
}

/**
 * Resolve credentials to pass on OC authorization start.
 * Returns null when no CEO override (caller uses OC global config).
 */
export function resolveOpenConnectorOauthClientForAuthorize(appId, ownerUserId) {
  const row = getOpenConnectorOauthOverrideRow(appId, ownerUserId);
  if (!row || !row.enabled) return null;
  const clientId = String(row.client_id || '').trim();
  let clientSecret = '';
  try {
    clientSecret = decryptOauthClientSecret(row.client_secret);
  } catch (e) {
    console.warn('[oc-oauth-override] decrypt failed', {
      app_id: String(appId || '').trim(),
      owner: String(ownerUserId || '').trim() || '(platform)',
      error: e.message,
    });
    throw Object.assign(new Error('Could not decrypt stored OpenConnector OAuth client secret'), {
      status: e.status || 503,
    });
  }
  clientSecret = String(clientSecret || '').trim();
  if (!clientId || !clientSecret) {
    if (ownerUserId === '' || ownerUserId == null) return null;
    throw Object.assign(
      new Error(
        'OpenConnector App ID/secret override is incomplete — save both Client ID and Client secret, or clear the override'
      ),
      { status: 400 }
    );
  }
  const scopes = parseScopes(row.scopes);
  const extra = parseExtra(row.extra_json);
  return {
    clientId,
    clientSecret,
    ...(scopes.length ? { requestedScopes: scopes } : {}),
    ...(Object.keys(extra).length ? { extra } : {}),
    _credentials_source: ownerUserId ? 'user' : 'platform',
  };
}

/** Cache platform (admin) OC OAuth client in Flolah for seed-restore after CEO BYOA. */
export function upsertOpenConnectorPlatformOauthClient(appId, body = {}) {
  const app = String(appId || '').trim().toLowerCase();
  if (!app) throw Object.assign(new Error('app_id required'), { status: 400 });
  const clientId = String(body.clientId || body.client_id || '').trim();
  const clientSecretRaw = String(body.clientSecret || body.client_secret || '').trim();
  if (!clientId || !clientSecretRaw) {
    throw Object.assign(new Error('clientId and clientSecret required'), { status: 400 });
  }
  const clientSecret = encryptOauthClientSecret(clientSecretRaw);
  let scopes = '';
  if (body.scopes != null) {
    scopes = Array.isArray(body.scopes)
      ? body.scopes.map((x) => String(x).trim()).filter(Boolean).join(',')
      : String(body.scopes || '').trim();
  }
  let extraJson = '{}';
  if (body.extra && typeof body.extra === 'object') extraJson = JSON.stringify(body.extra);
  db()
    .prepare(
      `INSERT INTO openconnector_oauth_client_overrides
         (app_id, owner_user_id, client_id, client_secret, scopes, extra_json, enabled, updated_at)
       VALUES (?, '', ?, ?, ?, ?, 1, datetime('now'))
       ON CONFLICT(app_id, owner_user_id) DO UPDATE SET
         client_id = excluded.client_id,
         client_secret = excluded.client_secret,
         scopes = excluded.scopes,
         extra_json = excluded.extra_json,
         enabled = 1,
         updated_at = datetime('now')`
    )
    .run(app, clientId, clientSecret, scopes, extraJson);
  console.info('[oc-oauth-override] platform client cached', {
    app_id: app,
    client_id_hint: maskClientId(clientId),
  });
  return { app_id: app, platform_cached: true, client_id_hint: maskClientId(clientId) };
}

export function upsertOpenConnectorOauthOverride(appId, ownerUserId, body = {}) {
  const app = String(appId || '').trim().toLowerCase();
  const owner = String(ownerUserId || '').trim();
  if (!app) throw Object.assign(new Error('app_id required'), { status: 400 });
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });

  const existing = getOpenConnectorOauthOverrideRow(app, owner);
  const clientIdIn =
    body.client_id != null || body.clientId != null
      ? String(body.client_id ?? body.clientId ?? '').trim()
      : null;
  const secretIn =
    body.client_secret != null || body.clientSecret != null
      ? String(body.client_secret ?? body.clientSecret ?? '').trim()
      : null;

  let clientId = existing?.client_id || '';
  if (clientIdIn != null) {
    if (clientIdIn) clientId = clientIdIn;
  }
  if (!clientId) {
    throw Object.assign(new Error('client_id / Client ID required'), { status: 400 });
  }

  let clientSecret = existing?.client_secret || '';
  if (secretIn != null) {
    if (secretIn) clientSecret = encryptOauthClientSecret(secretIn);
  }
  if (!clientSecret) {
    throw Object.assign(
      new Error('client_secret / Client secret required (leave blank only when updating other fields on an existing override)'),
      { status: 400 }
    );
  }

  let scopes = existing?.scopes || '';
  if (body.scopes != null) {
    if (Array.isArray(body.scopes)) {
      scopes = body.scopes.map((x) => String(x).trim()).filter(Boolean).join(',');
    } else {
      scopes = String(body.scopes || '').trim();
    }
  }

  let extraJson = existing?.extra_json || '{}';
  if (body.extra != null && typeof body.extra === 'object') {
    extraJson = JSON.stringify(body.extra);
  } else if (body.extra_json != null) {
    extraJson = typeof body.extra_json === 'string' ? body.extra_json : JSON.stringify(body.extra_json || {});
  }

  db()
    .prepare(
      `INSERT INTO openconnector_oauth_client_overrides
         (app_id, owner_user_id, client_id, client_secret, scopes, extra_json, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
       ON CONFLICT(app_id, owner_user_id) DO UPDATE SET
         client_id = excluded.client_id,
         client_secret = excluded.client_secret,
         scopes = excluded.scopes,
         extra_json = excluded.extra_json,
         enabled = 1,
         updated_at = datetime('now')`
    )
    .run(app, owner, clientId, clientSecret, scopes, extraJson);

  console.info('[oc-oauth-override] upserted', {
    app_id: app,
    owner,
    client_id_hint: maskClientId(clientId),
    secret_set: true,
    scopes: scopes || null,
  });
  return getOpenConnectorOauthOverridePublic(app, owner);
}

export function deleteOpenConnectorOauthOverride(appId, ownerUserId) {
  const app = String(appId || '').trim().toLowerCase();
  const owner = String(ownerUserId || '').trim();
  if (!app || !owner) throw Object.assign(new Error('app_id and owner required'), { status: 400 });
  const r = db()
    .prepare(
      `DELETE FROM openconnector_oauth_client_overrides WHERE app_id = ? AND owner_user_id = ?`
    )
    .run(app, owner);
  console.info('[oc-oauth-override] cleared', { app_id: app, owner, changes: r.changes });
  return { ok: true, cleared: true, app_id: app };
}

/** Whether Flolah expects OC custom OAuth (env mirror for status/UI). */
export function isOpenConnectorCustomOauthEnabledInEnv() {
  const v = String(
    process.env.OPENCONNECTOR_ALLOWED_CUSTOM_OAUTH ||
      process.env.OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH ||
      ''
  ).trim();
  return !!v;
}
