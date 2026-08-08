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

async function resolveWorkspaceSchema(workspaceId) {
  // Prefer schema name derived from known nsp; fall back to scanning workspace_* with matching member emails
  const r = await pgQuery(
    `SELECT nspname AS schema
     FROM pg_namespace
     WHERE nspname LIKE 'workspace_%'
     ORDER BY nspname
     LIMIT 20`
  );
  if (!r?.rows?.length) return null;
  if (r.rows.length === 1) return r.rows[0].schema;
  for (const row of r.rows) {
    try {
      const chk = await pgQuery(
        `SELECT 1 FROM ${quoteIdent(row.schema)}."workspaceMember" LIMIT 1`
      );
      if (chk) return row.schema; // first usable schema on single-workspace deploys
    } catch {
      /* next */
    }
  }
  return r.rows[0].schema;
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Resolve real Twenty workspace UUID for this owner (and persist if discovered).
 */
export async function resolveTwentyWorkspaceUuid(ownerUserId) {
  const owner = strip(ownerUserId);
  const profile = getBusinessProfile(owner);
  const bound = strip(profile.twenty.workspace_id);
  if (UUID_RE.test(bound)) return bound;

  const fromEnv = strip(process.env.TWENTY_WORKSPACE_ID);
  if (UUID_RE.test(fromEnv)) {
    setTwentyBind(owner, {
      workspace_id: fromEnv,
      workspace_name:
        profile.twenty.workspace_name || resolveCompanyDisplayNameLocal(owner) || 'Flolah CRM',
      api_key_hint: profile.twenty.api_key_hint || '',
      bind: {
        source: 'env_TWENTY_WORKSPACE_ID',
        updated_at: new Date().toISOString(),
      },
    });
    return fromEnv;
  }

  try {
    const r = await pgQuery(
      `SELECT id, "displayName"
       FROM core.workspace
       WHERE "activationStatus" = 'ACTIVE' AND "deletedAt" IS NULL
       ORDER BY "createdAt" ASC
       LIMIT 1`
    );
    const row = r?.rows?.[0];
    if (row?.id) {
      setTwentyBind(owner, {
        workspace_id: row.id,
        workspace_name:
          profile.twenty.workspace_name ||
          row.displayName ||
          resolveCompanyDisplayNameLocal(owner) ||
          'Flolah CRM',
        api_key_hint: profile.twenty.api_key_hint || '',
        bind: {
          source: 'twenty_db_active_workspace',
          previous_local_id: bound || null,
          updated_at: new Date().toISOString(),
        },
      });
      console.info(
        '[twenty-sso] bound owner=%s to workspace=%s (discovered)',
        owner,
        row.id
      );
      return row.id;
    }
  } catch (e) {
    console.warn('[twenty-sso] resolve workspace failed', e?.message || e);
  }
  return null;
}

/**
 * Ensure Flolah user exists in Twenty + has membership (+ Member role + workspaceMember row).
 */
export async function ensureTwentyUserForEmail({
  email,
  firstName = '',
  lastName = '',
  workspaceId,
}) {
  const mail = strip(email).toLowerCase();
  const ws = strip(workspaceId);
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

    // Member role
    const memberRole = (
      await pgQuery(
        `SELECT id FROM core.role
         WHERE "workspaceId" = $1 AND label = 'Member' LIMIT 1`,
        [ws]
      )
    )?.rows?.[0];
    if (memberRole?.id) {
      const existingRt = (
        await pgQuery(
          `SELECT id FROM core."roleTarget"
           WHERE "workspaceId" = $1 AND "userWorkspaceId" = $2 LIMIT 1`,
          [ws, uw.id]
        )
      )?.rows?.[0];
      if (!existingRt) {
        const app = (
          await pgQuery(
            `SELECT id FROM core.application WHERE name = 'Custom' LIMIT 1`
          )
        )?.rows?.[0];
        if (app?.id) {
          await pgQuery(
            `INSERT INTO core."roleTarget"
              (id, "workspaceId", "roleId", "userWorkspaceId", "universalIdentifier", "applicationId")
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomUUID(), ws, memberRole.id, uw.id, randomUUID(), app.id]
          );
        }
      }
    }

    // workspaceMember row (schema varies)
    const schema = await resolveWorkspaceSchema(ws);
    if (schema) {
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
      }
    }

    return { ok: true, user_id: user.id, user_workspace_id: uw.id };
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
  const base = getTwentyPublicBaseLocal();
  if (!base) {
    return {
      ok: false,
      mode: 'unavailable',
      reason: 'No TWENTY_EMBED_URL / TWENTY_SERVER_URL for browser CRM',
    };
  }

  if (!isTwentySsoEnabled()) {
    return {
      ok: true,
      mode: 'session_isolation_handoff',
      iframe_url: handoffUrl(base, owner, '/'),
      open_url: handoffUrl(base, owner, '/'),
      switch_account_url: handoffUrl(base, `${owner}:switch:${Date.now()}`, '/welcome', {
        wipe: true,
      }),
      sso_note: 'SSO disabled (TWENTY_SSO_ENABLED=0) or TWENTY_APP_SECRET missing',
    };
  }

  const flolahUser = opts.flolahUser || getUserById(owner) || {};
  const email = strip(flolahUser.email || opts.email || '');
  if (!email || !email.includes('@')) {
    return {
      ok: false,
      mode: 'session_isolation_handoff',
      reason: 'Flolah user email required for CRM SSO',
      iframe_url: handoffUrl(base, owner, '/'),
      open_url: handoffUrl(base, owner, '/'),
    };
  }

  const workspaceId = await resolveTwentyWorkspaceUuid(owner);
  if (!workspaceId) {
    return {
      ok: false,
      mode: 'session_isolation_handoff',
      reason:
        'Could not resolve a Twenty workspace UUID. Set TWENTY_WORKSPACE_ID or expose TWENTY_DATABASE_URL.',
      iframe_url: handoffUrl(base, owner, '/'),
      open_url: handoffUrl(base, owner, '/'),
    };
  }

  const { firstName, lastName } = splitName(flolahUser.name);
  const ensured = await ensureTwentyUserForEmail({
    email,
    firstName,
    lastName,
    workspaceId,
  });

  try {
    const loginToken = mintTwentyLoginToken({ email, workspaceId, authProvider: 'SSO' });
    const next = buildVerifyNextPath(loginToken);
    const url = handoffUrl(base, owner, next, { wipe: true });
    console.info(
      '[twenty-sso] mint loginToken owner=%s email=%s workspace=%s ensure=%s',
      owner,
      email.replace(/(.{2}).+(@.+)/, '$1***$2'),
      workspaceId,
      ensured?.ok ? 'ok' : ensured?.reason || 'skip'
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
      ensure: ensured,
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
    };
  }
}

function handoffUrl(base, owner, nextPath, { wipe = false } = {}) {
  const u = new URL('/flolah-handoff/', base.endsWith('/') ? base : `${base}/`);
  // base may be origin only
  const root = strip(base).replace(/\/+$/, '');
  const q = new URLSearchParams();
  q.set('owner', strip(owner));
  q.set('next', nextPath.startsWith('/') ? nextPath : `/${nextPath}`);
  if (wipe) q.set('wipe', '1');
  return `${root}/flolah-handoff/?${q.toString()}`;
}