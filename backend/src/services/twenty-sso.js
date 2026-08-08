/**
 * True CRM browser SSO for platform Twenty (self-hosted).
 *
 * Mints Twenty LOGIN JWTs with the same legacy HS256 secret derivation the
 * server verifies (SHA256 of APP_SECRET + workspaceId + "LOGIN"), then routes
 * the browser through /flolah-handoff → /verify?loginToken=… so the Twenty SPA
 * exchanges the token for a session — passwordless for the Flolah user email.
 *
 * Requires TWENTY_APP_SECRET (same value as Twenty APP_SECRET). Optional
 * TWENTY_DATABASE_URL enables JIT provisioning of user + workspace membership.
 * Authorization remains CEO-scoped on Flolah; body workspace ids are never trusted.
 */
import { createHash, createHmac, randomUUID } from 'crypto';
import {
  getBusinessProfile,
  setTwentyBind,
  assertCrmEntitled,
} from './company-business-profile.js';
import { getUserById } from './users.js';

function getTwentyPublicBaseLocal() {
  for (const raw of [
    process.env.TWENTY_EMBED_URL,
    process.env.TWENTY_SERVER_URL,
    process.env.TWENTY_PUBLIC_URL,
  ]) {
    const v = strip(raw);
    if (v && !/twenty-server|erpnext|internal/i.test(v)) return v.replace(/\/+$/, '');
  }
  return '';
}

function resolveCompanyDisplayNameLocal(ownerUserId) {
  try {
    const u = getUserById(ownerUserId);
    if (u?.business_name) return String(u.business_name).trim().slice(0, 120);
    if (u?.name) return String(u.name).trim().slice(0, 120);
  } catch {
    /* optional */
  }
  return '';
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function strip(s) {
  return String(s || '').trim();
}

export function isTwentySsoEnabled() {
  const flag = strip(process.env.TWENTY_SSO_ENABLED || '1').toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off' || flag === 'no') return false;
  return Boolean(twentyAppSecret());
}

function twentyAppSecret() {
  return strip(process.env.TWENTY_APP_SECRET || process.env.TWENTY_JWT_APP_SECRET || '');
}

function twentyDatabaseUrl() {
  return (
    strip(process.env.TWENTY_DATABASE_URL) ||
    strip(process.env.TWENTY_PG_URL) ||
    // docker-compose network default when Business Core runs beside backend
    strip(process.env.TWENTY_DB_URL) ||
    ''
  );
}

function defaultDatabaseUrlFromParts() {
  if (twentyDatabaseUrl()) return twentyDatabaseUrl();
  const user = strip(process.env.TWENTY_DB_USER) || 'twenty';
  const pass = strip(process.env.TWENTY_DB_PASSWORD) || 'twenty';
  const host = strip(process.env.TWENTY_DB_HOST) || 'twenty-db';
  const port = strip(process.env.TWENTY_DB_PORT) || '5432';
  const db = strip(process.env.TWENTY_DB_NAME) || 'twenty';
  // Only when db host reachable (compose)
  if (!strip(process.env.TWENTY_APP_SECRET) && !strip(process.env.TWENTY_API_URL)) return '';
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${db}`;
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Twenty JwtWrapperService.generateAppSecret(type, workspaceId) */
export function generateTwentyAppSecret(type, appSecretBody) {
  const appSecret = twentyAppSecret();
  if (!appSecret) throw Object.assign(new Error('TWENTY_APP_SECRET is not set'), { status: 503 });
  return createHash('sha256').update(`${appSecret}${appSecretBody}${type}`).digest('hex');
}

/**
 * @param {{ email: string, workspaceId: string, authProvider?: string, expiresSec?: number }} p
 */
export function mintTwentyLoginToken({ email, workspaceId, authProvider = 'SSO', expiresSec = 300 }) {
  const sub = strip(email).toLowerCase();
  const ws = strip(workspaceId);
  if (!sub || !ws) {
    throw Object.assign(new Error('email and workspaceId required for Twenty login token'), {
      status: 400,
    });
  }
  if (!UUID_RE.test(ws)) {
    throw Object.assign(new Error('Twenty workspaceId must be a UUID for SSO mint'), {
      status: 400,
    });
  }
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    type: 'LOGIN',
    sub,
    workspaceId: ws,
    authProvider: authProvider || 'SSO',
    iat: now,
    exp: now + Math.max(60, Math.min(3600, Number(expiresSec) || 300)),
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const key = generateTwentyAppSecret('LOGIN', ws);
  const sig = createHmac('sha256', key).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

export function buildVerifyNextPath(loginToken) {
  return `/verify?loginToken=${encodeURIComponent(loginToken)}`;
}

let pgPool = null;
let pgImportFailed = false;

async function getPg() {
  const url = defaultDatabaseUrlFromParts();
  if (!url) return null;
  if (pgImportFailed) return null;
  try {
    if (!pgPool) {
      const mod = await import('pg');
      const { Pool } = mod.default || mod;
      pgPool = new Pool({
        connectionString: url,
        max: 3,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
      });
      pgPool.on('error', (err) => {
        console.warn('[twenty-sso] pg pool error', err?.message || err);
      });
    }
    return pgPool;
  } catch (e) {
    pgImportFailed = true;
    console.warn('[twenty-sso] pg module unavailable; JIT provision disabled', e?.message || e);
    return null;
  }
}

async function pgQuery(sql, params = []) {
  const pool = await getPg();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

/**
 * Map Twenty workspace UUID → data schema (`core.workspace.databaseSchema`).
 * Critical for multi-workspace: inserting workspaceMember into the wrong schema
 * makes getAuthTokensFromLoginToken return "User is not a member of the workspace"
 * even when core.userWorkspace exists.
 */
async function resolveWorkspaceSchema(workspaceId) {
  const ws = strip(workspaceId);
  if (!UUID_RE.test(ws)) return null;
  const bound = await pgQuery(
    `SELECT "databaseSchema" AS schema
     FROM core.workspace
     WHERE id = $1 AND "deletedAt" IS NULL
     LIMIT 1`,
    [ws]
  );
  const schema = strip(bound?.rows?.[0]?.schema);
  if (schema && /^workspace_/.test(schema)) return schema;

  // Legacy single-workspace fallback
  const r = await pgQuery(
    `SELECT nspname AS schema
     FROM pg_namespace
     WHERE nspname LIKE 'workspace_%'
     ORDER BY nspname`
  );
  if (!r?.rows?.length) return null;
  if (r.rows.length === 1) return r.rows[0].schema;
  return null;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Resolve company-scoped Twenty workspace UUID only (no shared default bind).
 * Creates a real remote workspace when bind is missing or local flolah-ws-*.
 */
export async function resolveTwentyWorkspaceUuid(ownerUserId) {
  const { ensureCompanyTwentyWorkspace } = await import('./twenty-workspace.js');
  const ensured = await ensureCompanyTwentyWorkspace(ownerUserId);
  return ensured?.workspace_id || null;
}

/**
 * Ensure Flolah user exists in Twenty + has membership (+ role + workspaceMember row).
 * @param {{ email: string, firstName?: string, lastName?: string, workspaceId: string, roleLabel?: 'Admin'|'Member' }} p
 */
export async function ensureTwentyUserForEmail({
  email,
  firstName = '',
  lastName = '',
  workspaceId,
  roleLabel = 'Member',
}) {
  const mail = strip(email).toLowerCase();
  const ws = strip(workspaceId);
  const wantRole = strip(roleLabel) === 'Admin' ? 'Admin' : 'Member';
  if (!mail || !UUID_RE.test(ws)) {
    return { ok: false, reason: 'invalid_email_or_workspace' };
  }
  const pool = await getPg();
  if (!pool) return { ok: false, reason: 'no_database' };

  try {
    let user = (
      await pgQuery(
        `SELECT id, email FROM core."user" WHERE lower(email) = lower($1) AND "deletedAt" IS NULL LIMIT 1`,
        [mail]
      )
    )?.rows?.[0];

    if (!user) {
      const id = randomUUID();
      await pgQuery(
        `INSERT INTO core."user"
          (id, "firstName", "lastName", email, "isEmailVerified", disabled, "passwordHash",
           "canImpersonate", "canAccessFullAdminPanel", locale)
         VALUES ($1, $2, $3, $4, true, false, NULL, false, false, 'en')`,
        [id, strip(firstName).slice(0, 80), strip(lastName).slice(0, 80), mail]
      );
      user = { id, email: mail };
      console.info('[twenty-sso] created twenty user email=%s', mail.replace(/(.{2}).+(@.+)/, '$1***$2'));
    } else {
      // Prefer email-verified for passwordless SSO path
      await pgQuery(
        `UPDATE core."user" SET "isEmailVerified" = true, "updatedAt" = now()
         WHERE id = $1 AND "isEmailVerified" = false`,
        [user.id]
      );
    }

    let uw = (
      await pgQuery(
        `SELECT id FROM core."userWorkspace"
         WHERE "userId" = $1 AND "workspaceId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        [user.id, ws]
      )
    )?.rows?.[0];

    if (!uw) {
      const uwId = randomUUID();
      await pgQuery(
        `INSERT INTO core."userWorkspace" (id, "userId", "workspaceId", locale)
         VALUES ($1, $2, $3, 'en')`,
        [uwId, user.id, ws]
      );
      uw = { id: uwId };
      console.info('[twenty-sso] joined user to workspace userId=%s workspaceId=%s', user.id, ws);
    }

    // Role: Admin for company owners, Member otherwise. Upgrade Member → Admin when needed.
    let role = (
      await pgQuery(
        `SELECT id, label FROM core.role
         WHERE "workspaceId" = $1 AND label = $2 LIMIT 1`,
        [ws, wantRole]
      )
    )?.rows?.[0];
    if (!role && wantRole === 'Admin') {
      role = (
        await pgQuery(
          `SELECT id, label FROM core.role
           WHERE "workspaceId" = $1 AND label = 'Member' LIMIT 1`,
          [ws]
        )
      )?.rows?.[0];
    }
    if (role?.id) {
      const existingRt = (
        await pgQuery(
          `SELECT id, "roleId" FROM core."roleTarget"
           WHERE "workspaceId" = $1 AND "userWorkspaceId" = $2 LIMIT 1`,
          [ws, uw.id]
        )
      )?.rows?.[0];
      if (!existingRt) {
        const app = (
          await pgQuery(
            `SELECT id FROM core.application
             WHERE "workspaceId" = $1 OR name = 'Custom'
             ORDER BY CASE WHEN "workspaceId" = $1 THEN 0 ELSE 1 END
             LIMIT 1`,
            [ws]
          )
        )?.rows?.[0];
        if (app?.id) {
          await pgQuery(
            `INSERT INTO core."roleTarget"
              (id, "workspaceId", "roleId", "userWorkspaceId", "universalIdentifier", "applicationId")
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomUUID(), ws, role.id, uw.id, randomUUID(), app.id]
          );
        } else {
          console.warn('[twenty-sso] no application for roleTarget workspace=%s', ws);
        }
      } else if (existingRt.roleId !== role.id && wantRole === 'Admin') {
        await pgQuery(`UPDATE core."roleTarget" SET "roleId" = $1 WHERE id = $2`, [
          role.id,
          existingRt.id,
        ]);
      }
    }

    // workspaceMember must live in THIS workspace's databaseSchema (multi-tenant)
    const schema = await resolveWorkspaceSchema(ws);
    if (!schema) {
      console.warn('[twenty-sso] no databaseSchema for workspace=%s — workspaceMember skip', ws);
      return {
        ok: false,
        reason: 'no_workspace_schema',
        user_id: user.id,
        user_workspace_id: uw.id,
      };
    }

    const mem = (
      await pgQuery(
        `SELECT id FROM ${quoteIdent(schema)}."workspaceMember"
         WHERE "userId" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [user.id]
      )
    )?.rows?.[0];
    if (!mem) {
      const pos = (
        await pgQuery(
          `SELECT COALESCE(MAX(position), -1) + 1 AS n FROM ${quoteIdent(schema)}."workspaceMember"
           WHERE "deletedAt" IS NULL`
        )
      )?.rows?.[0]?.n;
      await pgQuery(
        `INSERT INTO ${quoteIdent(schema)}."workspaceMember"
          (id, position, "nameFirstName", "nameLastName", "userEmail", "userId",
           "createdBySource", "createdByName", "updatedBySource", "updatedByName")
         VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', 'Flolah SSO', 'MANUAL', 'Flolah SSO')`,
        [
          randomUUID(),
          Number(pos) || 0,
          strip(firstName).slice(0, 80) || mail.split('@')[0],
          strip(lastName).slice(0, 80),
          mail,
          user.id,
        ]
      );
      console.info(
        '[twenty-sso] workspaceMember schema=%s user=%s workspace=%s',
        schema,
        mail.replace(/(.{2}).+(@.+)/, '$1***$2'),
        ws
      );
    }

    return {
      ok: true,
      user_id: user.id,
      user_workspace_id: uw.id,
      schema,
      role: wantRole,
    };
  } catch (e) {
    console.warn('[twenty-sso] ensure user failed', e?.message || e);
    return { ok: false, reason: e?.message || 'ensure_failed' };
  }
}

function splitName(name) {
  const n = strip(name);
  if (!n) return { firstName: '', lastName: '' };
  const parts = n.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/**
 * Build CRM browser SSO launch URLs for an authenticated Flolah user / owner company.
 * @param {string} ownerUserId - CEO owner (company)
 * @param {{ flolahUser?: { id?: string, email?: string, name?: string } }} opts
 */
export async function buildCrmSsoHandoff(ownerUserId, opts = {}) {
  const owner = strip(ownerUserId);
  assertCrmEntitled(owner);
  // Platform front origin (crm.flolah.cloud); workspace UI is at {sub}.crm.flolah.cloud
  const frontBase = getTwentyPublicBaseLocal();
  if (!frontBase) {
    return {
      ok: false,
      mode: 'unavailable',
      reason: 'No TWENTY_EMBED_URL / TWENTY_SERVER_URL for browser CRM',
    };
  }

  let companyWs = null;
  try {
    const { ensureUserInCompanyWorkspace } = await import('./twenty-workspace.js');
    const flolahUser = opts.flolahUser || getUserById(owner) || {};
    companyWs = await ensureUserInCompanyWorkspace(owner, flolahUser);
  } catch (e) {
    console.warn('[twenty-sso] company workspace ensure failed', e?.message || e);
    return {
      ok: false,
      mode: 'session_isolation_handoff',
      reason: e?.message || 'workspace_ensure_failed',
      iframe_url: handoffUrl(frontBase, owner, '/'),
      open_url: handoffUrl(frontBase, owner, '/'),
    };
  }

  const workspaceId = companyWs.workspace_id;
  // Handoff + verify must run on the company workspace origin (multi-workspace)
  const base = companyWs.public_base || frontBase;
  const email = strip(companyWs.email || opts.flolahUser?.email || '');

  if (!isTwentySsoEnabled()) {
    return {
      ok: true,
      mode: 'session_isolation_handoff',
      iframe_url: handoffUrl(base, owner, '/'),
      open_url: handoffUrl(base, owner, '/'),
      switch_account_url: handoffUrl(base, `${owner}:switch:${Date.now()}`, '/welcome', {
        wipe: true,
      }),
      workspace_id: workspaceId,
      subdomain: companyWs.subdomain,
      sso_note: 'SSO disabled (TWENTY_SSO_ENABLED=0) or TWENTY_APP_SECRET missing',
    };
  }

  if (!email || !email.includes('@')) {
    return {
      ok: false,
      mode: 'session_isolation_handoff',
      reason: 'Flolah user email required for CRM SSO',
      iframe_url: handoffUrl(base, owner, '/'),
      open_url: handoffUrl(base, owner, '/'),
      workspace_id: workspaceId,
    };
  }

  if (companyWs.ensure_user && companyWs.ensure_user.ok === false) {
    console.warn(
      '[twenty-sso] membership not ready owner=%s email=%s reason=%s',
      owner,
      email.replace(/(.{2}).+(@.+)/, '$1***$2'),
      companyWs.ensure_user.reason || 'ensure_failed'
    );
  }

  try {
    const loginToken = mintTwentyLoginToken({ email, workspaceId, authProvider: 'SSO' });
    // Server-side proof: LOGIN JWT must exchange (catches missing workspaceMember).
    try {
      const { exchangeLoginToken } = await import('./twenty-workspace.js');
      await exchangeLoginToken(loginToken, base);
    } catch (exErr) {
      console.warn(
        '[twenty-sso] loginToken exchange preflight failed email=%s ws=%s %s — re-ensure + retry',
        email.replace(/(.{2}).+(@.+)/, '$1***$2'),
        workspaceId,
        exErr?.message || exErr
      );
      const { ensureUserInCompanyWorkspace } = await import('./twenty-workspace.js');
      const flolahUser = opts.flolahUser || getUserById(owner) || {};
      await ensureUserInCompanyWorkspace(owner, flolahUser);
      const retryToken = mintTwentyLoginToken({ email, workspaceId, authProvider: 'SSO' });
      try {
        const { exchangeLoginToken } = await import('./twenty-workspace.js');
        await exchangeLoginToken(retryToken, base);
        const next = buildVerifyNextPath(retryToken);
        const url = handoffUrl(base, owner, next, { wipe: true });
        console.info(
          '[twenty-sso] mint loginToken (after heal) owner=%s email=%s workspace=%s sub=%s',
          owner,
          email.replace(/(.{2}).+(@.+)/, '$1***$2'),
          workspaceId,
          companyWs.subdomain || '?'
        );
        return {
          ok: true,
          mode: 'login_token_sso',
          iframe_url: url,
          open_url: url,
          switch_account_url: handoffUrl(base, `${owner}:switch:${Date.now()}`, '/welcome', {
            wipe: true,
          }),
          workspace_id: workspaceId,
          subdomain: companyWs.subdomain,
          public_base: base,
          ensure: { ok: true, healed: true },
          expires_hint_sec: 300,
        };
      } catch (ex2) {
        return {
          ok: false,
          mode: 'session_isolation_handoff',
          reason: `loginToken_exchange_failed: ${ex2?.message || ex2}`,
          iframe_url: handoffUrl(base, owner, '/', { wipe: true }),
          open_url: handoffUrl(base, owner, '/', { wipe: true }),
          switch_account_url: handoffUrl(base, `${owner}:switch:${Date.now()}`, '/welcome', {
            wipe: true,
          }),
          workspace_id: workspaceId,
          subdomain: companyWs.subdomain,
          public_base: base,
        };
      }
    }

    const next = buildVerifyNextPath(loginToken);
    const url = handoffUrl(base, owner, next, { wipe: true });
    console.info(
      '[twenty-sso] mint loginToken owner=%s email=%s workspace=%s sub=%s ensure=%s',
      owner,
      email.replace(/(.{2}).+(@.+)/, '$1***$2'),
      workspaceId,
      companyWs.subdomain || '?',
      companyWs.ensure_user?.ok ? 'ok' : companyWs.ensure_user?.reason || 'skip'
    );
    return {
      ok: true,
      mode: 'login_token_sso',
      iframe_url: url,
      open_url: url,
      switch_account_url: handoffUrl(base, `${owner}:switch:${Date.now()}`, '/welcome', {
        wipe: true,
      }),
      workspace_id: workspaceId,
      subdomain: companyWs.subdomain,
      public_base: base,
      ensure: companyWs.ensure_user,
      expires_hint_sec: 300,
    };
  } catch (e) {
    console.warn('[twenty-sso] mint failed', e?.message || e);
    return {
      ok: false,
      mode: 'session_isolation_handoff',
      reason: e?.message || 'mint_failed',
      iframe_url: handoffUrl(base, owner, '/'),
      open_url: handoffUrl(base, owner, '/'),
      switch_account_url: handoffUrl(base, `${owner}:switch:${Date.now()}`, '/welcome', {
        wipe: true,
      }),
      workspace_id: workspaceId,
    };
  }
}

function handoffUrl(base, owner, nextPath, { wipe = false, logout = false } = {}) {
  // base may be origin only
  const root = strip(base).replace(/\/+$/, '');
  if (!root) return '';
  const q = new URLSearchParams();
  q.set('owner', strip(owner) || '_logout');
  q.set('next', nextPath.startsWith('/') ? nextPath : `/${nextPath}`);
  if (wipe || logout) q.set('wipe', '1');
  if (logout) q.set('logout', '1');
  return `${root}/flolah-handoff/?${q.toString()}`;
}

/**
 * Build CRM host logout handoff URLs (static /flolah-handoff wipe page).
 * Used when Flolah ends the browser session so Twenty localStorage/cookies do
 * not stay signed-in on *.crm.<apex>.
 * @param {string} [ownerUserId]
 * @returns {string[]}
 */
export function buildCrmSessionLogoutUrls(ownerUserId = '') {
  const urls = new Set();
  const frontBase = getTwentyPublicBaseLocal().replace(/\/+$/, '');
  const addLogout = (base) => {
    const u = handoffUrl(base, '_logout', '/', { wipe: true, logout: true });
    if (u) urls.add(u);
  };

  if (frontBase) addLogout(frontBase);

  const owner = strip(ownerUserId);
  if (owner && frontBase) {
    try {
      const profile = getBusinessProfile(owner);
      const sub =
        strip(profile?.twenty?.subdomain) ||
        strip(profile?.twenty?.bind?.subdomain) ||
        strip(profile?.twenty?.workspace_subdomain);
      if (sub) {
        try {
          const u = new URL(frontBase.endsWith('/') ? frontBase : `${frontBase}/`);
          const labels = u.hostname.split('.').filter(Boolean);
          if (labels[0] === 'crm') {
            u.hostname = [sub, ...labels].join('.');
          } else if (!labels[0]?.startsWith(sub)) {
            u.hostname = [sub, ...labels].join('.');
          }
          addLogout(u.origin);
        } catch {
          /* ignore bad base */
        }
      }
    } catch (e) {
      console.warn('[twenty-sso] buildCrmSessionLogoutUrls profile', e?.message || e);
    }
  }

  return [...urls];
}