/**
 * Per-app mutex + temporary OC global OAuth client seed.
 * Used when OpenConnector ignores connection-scoped clientId (e.g. image 1.3.5)
 * but docs describe OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH. Seeds CEO app credentials
 * for authorize/callback/refresh windows, then restores platform client from Flolah cache.
 */
import {
  getOpenConnectorOauthOverrideRow,
  resolveOpenConnectorOauthClientForAuthorize,
} from './openconnector-oauth-override.js';

const locks = new Map(); // app_id -> { queue, holder, restoreTimer }
const DEFAULT_HOLD_MS = Math.max(
  60_000,
  Number(process.env.OPENCONNECTOR_OAUTH_SEED_HOLD_MS || 12 * 60 * 1000) || 12 * 60 * 1000
);

function appKey(appId) {
  return String(appId || '').trim().toLowerCase();
}

async function openConnectorAdminFetch(path, { method = 'GET', body } = {}) {
  const base = String(process.env.OPENCONNECTOR_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('OPENCONNECTOR_URL required');
  const token = String(process.env.OPENCONNECTOR_ADMIN_TOKEN || '').trim();
  if (!token) throw new Error('OPENCONNECTOR_ADMIN_TOKEN required');
  const res = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : data.message || data.error?.message || JSON.stringify(data.error || data);
    throw new Error(msg || `OpenConnector ${method} ${path} failed (${res.status})`);
  }
  return data;
}

export async function putOpenConnectorOauthClientConfig(appId, client) {
  const app = appKey(appId);
  const clientId = String(client.clientId || client.client_id || '').trim();
  const clientSecret = String(client.clientSecret || client.client_secret || '').trim();
  if (!app || !clientId || !clientSecret) throw new Error('app, clientId, clientSecret required');
  const body = {
    clientId,
    clientSecret,
    ...(client.requestedScopes?.length ? { requestedScopes: client.requestedScopes } : {}),
    ...(client.extra && typeof client.extra === 'object' ? { extra: client.extra } : {}),
  };
  return openConnectorAdminFetch(`/api/oauth/configs/${encodeURIComponent(app)}`, {
    method: 'PUT',
    body,
  });
}

function platformClientOrNull(appId) {
  try {
    return resolveOpenConnectorOauthClientForAuthorize(appId, '');
  } catch {
    return null;
  }
}

function getLock(app) {
  if (!locks.has(app)) {
    locks.set(app, { chain: Promise.resolve(), holder: null, restoreTimer: null });
  }
  return locks.get(app);
}

/**
 * Run fn while OC global OAuth client for app is seeded to `client`.
 * Restores platform Flolah-cached client afterward (best-effort).
 */
export async function withOpenConnectorOauthClientSeed(appId, client, fn, { holdMs = 0 } = {}) {
  const app = appKey(appId);
  if (!app || !client?.clientId || !client?.clientSecret) {
    return fn({ mode: 'none' });
  }
  const lock = getLock(app);
  let releaseOuter;
  const gate = new Promise((resolve) => {
    releaseOuter = resolve;
  });
  const run = lock.chain.then(async () => {
    lock.holder = { clientId: client.clientId, at: Date.now() };
    if (lock.restoreTimer) {
      clearTimeout(lock.restoreTimer);
      lock.restoreTimer = null;
    }
    const platform = platformClientOrNull(app);
    console.info('[oc-oauth-seed] seeding global OC client', {
      app,
      client_id_hint: `${String(client.clientId).slice(0, 4)}…`,
      has_platform_restore: !!(platform?.clientId && platform?.clientSecret),
    });
    await putOpenConnectorOauthClientConfig(app, client);
    try {
      const result = await fn({ mode: 'seed', platform });
      if (holdMs > 0) {
        await new Promise((r) => {
          lock.restoreTimer = setTimeout(r, holdMs);
        });
      }
      return result;
    } finally {
      if (lock.restoreTimer) {
        clearTimeout(lock.restoreTimer);
        lock.restoreTimer = null;
      }
      try {
        if (platform?.clientId && platform?.clientSecret) {
          await putOpenConnectorOauthClientConfig(app, platform);
          console.info('[oc-oauth-seed] restored platform OC client', { app });
        } else {
          console.warn('[oc-oauth-seed] no platform client cached in Flolah — left CEO client on OC', {
            app,
          });
        }
      } catch (e) {
        console.warn('[oc-oauth-seed] restore failed', { app, error: e.message });
      }
      lock.holder = null;
      releaseOuter();
    }
  });
  lock.chain = gate.catch(() => {});
  return run;
}

/**
 * Seed CEO client and keep it for holdMs (authorize + callback window), then restore.
 * Does not block the caller for the full hold — schedules restore in background after start returns.
 */
export async function seedOpenConnectorOauthClientForAuthorize(appId, client, { holdMs = DEFAULT_HOLD_MS } = {}) {
  const app = appKey(appId);
  const lock = getLock(app);
  // Wait for any prior lease
  await lock.chain.catch(() => {});
  const platform = platformClientOrNull(app);
  if (lock.restoreTimer) {
    clearTimeout(lock.restoreTimer);
    lock.restoreTimer = null;
  }
  await putOpenConnectorOauthClientConfig(app, client);
  lock.holder = { clientId: client.clientId, at: Date.now(), platform };
  console.info('[oc-oauth-seed] authorize lease started', {
    app,
    hold_ms: holdMs,
    has_platform_restore: !!(platform?.clientId && platform?.clientSecret),
  });
  lock.restoreTimer = setTimeout(() => {
    restoreSeedLease(app).catch((e) =>
      console.warn('[oc-oauth-seed] delayed restore failed', { app, error: e.message })
    );
  }, holdMs);
  // Keep chain busy until restore so concurrent seeds serialize
  let release;
  lock.chain = new Promise((r) => {
    release = r;
  });
  lock._release = release;
  return { mode: 'seed', hold_ms: holdMs };
}

export async function restoreSeedLease(appId) {
  const app = appKey(appId);
  const lock = getLock(app);
  if (lock.restoreTimer) {
    clearTimeout(lock.restoreTimer);
    lock.restoreTimer = null;
  }
  const platform = lock.holder?.platform || platformClientOrNull(app);
  try {
    if (platform?.clientId && platform?.clientSecret) {
      await putOpenConnectorOauthClientConfig(app, platform);
      console.info('[oc-oauth-seed] lease restored platform', { app });
    }
  } finally {
    lock.holder = null;
    if (typeof lock._release === 'function') {
      lock._release();
      lock._release = null;
    }
  }
}

export function authorizationUrlUsesClientId(authorizationUrl, clientId) {
  const url = String(authorizationUrl || '');
  const id = String(clientId || '').trim();
  if (!url || !id) return false;
  try {
    const u = new URL(url);
    if (u.searchParams.get('client_id') === id) return true;
  } catch {
    /* fall through */
  }
  return url.includes(id) || url.includes(encodeURIComponent(id));
}

export function getOpenConnectorOauthSeedHoldMs() {
  return DEFAULT_HOLD_MS;
}

export function hasPlatformOauthClientCached(appId) {
  const row = getOpenConnectorOauthOverrideRow(appId, '');
  return !!(row && String(row.client_id || '').trim() && String(row.client_secret || '').trim());
}
