/**
 * One Flolah company (CEO owner) -> one real Twenty workspace (UUID + subdomain).
 * CRM click uses this bind for loginToken SSO (workspace origin = subdomain.crm.*).
 */
import {
  getBusinessProfile,
  setTwentyBind,
  assertCrmEntitled,
  isTwentyWorkspaceBoundToOtherOwner,
} from './company-business-profile.js';
import {
  isTwentyUuid,
  strip,
  getTwentyFrontOrigin,
  getTwentyWorkspacePublicBase,
  subdomainForOwner,
} from './twenty-public.js';
import { mintTwentyLoginToken, ensureTwentyUserForEmail } from './twenty-sso.js';
import { getUserById } from './users.js';

function resolveDisplayName(owner) {
  try {
    const u = getUserById(owner);
    if (u?.business_name) return String(u.business_name).trim().slice(0, 100);
    if (u?.name) return String(u.name).trim().slice(0, 100);
  } catch {
    /* optional */
  }
  return '';
}

function metadataUrl() {
  const root = strip(process.env.TWENTY_API_URL || 'http://twenty-server:3000').replace(/\/+$/, '');
  return `${root}/metadata`;
}

async function gqlMetadata(accessToken, query, variables, origin) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (origin) {
    headers.origin = origin;
    headers.referer = origin.endsWith('/') ? origin : `${origin}/`;
  }
  const res = await fetch(metadataUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables: variables || undefined }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      data?.errors?.[0]?.message || data?.message || `Twenty metadata HTTP ${res.status}`;
    const err = new Error(String(msg).slice(0, 500));
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.details = data;
    throw err;
  }
  if (data?.errors?.length) {
    const err = new Error(String(data.errors[0]?.message || 'Twenty GraphQL error').slice(0, 500));
    err.status = 502;
    err.details = data.errors;
    throw err;
  }
  return data?.data;
}

export async function exchangeLoginToken(loginToken, workspaceOrigin) {
  const origin = strip(workspaceOrigin) || getTwentyFrontOrigin();
  const data = await gqlMetadata(
    null,
    `mutation GetAuthTokensFromLoginToken($loginToken: String!, $origin: String!) {
      getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) {
        tokens {
          accessOrWorkspaceAgnosticToken { token }
          refreshToken { token }
        }
      }
    }`,
    { loginToken, origin },
    origin
  );
  const access =
    data?.getAuthTokensFromLoginToken?.tokens?.accessOrWorkspaceAgnosticToken?.token;
  if (!access) {
    throw Object.assign(new Error('Twenty loginToken exchange failed'), { status: 502 });
  }
  return { accessToken: access };
}

async function accessFor(email, workspaceId, workspaceOrigin) {
  const loginToken = mintTwentyLoginToken({ email, workspaceId, authProvider: 'SSO' });
  return exchangeLoginToken(loginToken, workspaceOrigin);
}

let _pool = null;
async function getPool() {
  if (_pool) return _pool;
  try {
    const mod = await import('pg');
    const { Pool } = mod.default || mod;
    const url =
      strip(process.env.TWENTY_DATABASE_URL) ||
      `postgres://${encodeURIComponent(process.env.TWENTY_DB_USER || 'twenty')}:${encodeURIComponent(process.env.TWENTY_DB_PASSWORD || 'twenty')}@${process.env.TWENTY_DB_HOST || 'twenty-db'}:5432/${process.env.TWENTY_DB_NAME || 'twenty'}`;
    _pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 8000 });
    return _pool;
  } catch (e) {
    console.warn('[twenty-workspace] pg unavailable', e?.message || e);
    return null;
  }
}

async function pgQuery(sql, params = []) {
  const pool = await getPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export async function loadTwentyWorkspaceRow(workspaceId) {
  if (!isTwentyUuid(workspaceId)) return null;
  const r = await pgQuery(
    `SELECT id, "displayName", subdomain, "activationStatus"
     FROM core.workspace WHERE id = $1 AND "deletedAt" IS NULL LIMIT 1`,
    [workspaceId]
  );
  return r?.rows?.[0] || null;
}

async function findBootstrapAdmin() {
  const email = strip(process.env.TWENTY_BOOTSTRAP_EMAIL);
  if (email) {
    const r = await pgQuery(
      `SELECT u.email, uw."workspaceId", w.subdomain
       FROM core."user" u
       JOIN core."userWorkspace" uw ON uw."userId" = u.id AND uw."deletedAt" IS NULL
       JOIN core.workspace w ON w.id = uw."workspaceId" AND w."deletedAt" IS NULL
       WHERE lower(u.email) = lower($1) AND w."activationStatus" = 'ACTIVE'
       ORDER BY uw."createdAt" ASC LIMIT 1`,
      [email]
    );
    if (r?.rows?.[0]) return r.rows[0];
  }
  const r = await pgQuery(
    `SELECT u.email, uw."workspaceId", w.subdomain
     FROM core."user" u
     JOIN core."userWorkspace" uw ON uw."userId" = u.id AND uw."deletedAt" IS NULL
     JOIN core.workspace w ON w.id = uw."workspaceId" AND w."deletedAt" IS NULL
     WHERE w."activationStatus" = 'ACTIVE' AND u."deletedAt" IS NULL
     ORDER BY CASE WHEN u."canImpersonate" THEN 0 ELSE 1 END, uw."createdAt" ASC
     LIMIT 1`
  );
  return r?.rows?.[0] || null;
}

export async function createAndActivateTwentyWorkspace({ displayName, subdomain }) {
  const name = strip(displayName).slice(0, 100) || 'Flolah CRM';
  const sub = strip(subdomain)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 48);
  if (!sub) throw Object.assign(new Error('subdomain required'), { status: 400 });

  const admin = await findBootstrapAdmin();
  if (!admin?.email) {
    throw Object.assign(
      new Error(
        'No bootstrap Twenty admin. Complete first Twenty signup or set TWENTY_BOOTSTRAP_EMAIL.'
      ),
      { status: 503 }
    );
  }
  const bootstrapBase = getTwentyWorkspacePublicBase(admin.subdomain);
  if (!bootstrapBase) {
    throw Object.assign(new Error('TWENTY_EMBED_URL not configured'), { status: 503 });
  }

  const { accessToken } = await accessFor(admin.email, admin.workspaceId, bootstrapBase);
  const created = await gqlMetadata(
    accessToken,
    `mutation SignUpInNewWorkspace($input: SignUpInNewWorkspaceInput) {
      signUpInNewWorkspace(input: $input) {
        loginToken { token }
        workspace { id }
      }
    }`,
    { input: { displayName: name, subdomain: sub } },
    bootstrapBase
  );

  const loginToken = created?.signUpInNewWorkspace?.loginToken?.token;
  const workspaceId = created?.signUpInNewWorkspace?.workspace?.id;
  if (!loginToken || !workspaceId) {
    throw Object.assign(new Error('signUpInNewWorkspace incomplete'), { status: 502 });
  }

  const newBase = getTwentyWorkspacePublicBase(sub);
  const { accessToken: newAccess } = await exchangeLoginToken(loginToken, newBase);
  const activated = await gqlMetadata(
    newAccess,
    `mutation ActivateWorkspace($data: ActivateWorkspaceInput!) {
      activateWorkspace(data: $data) {
        id
        activationStatus
        displayName
        subdomain
      }
    }`,
    { data: { displayName: name } },
    newBase
  );
  const row = activated?.activateWorkspace;
  console.info(
    '[twenty-workspace] created id=%s sub=%s status=%s',
    workspaceId,
    sub,
    row?.activationStatus || '?'
  );
  return {
    id: workspaceId,
    subdomain: row?.subdomain || sub,
    displayName: row?.displayName || name,
    activationStatus: row?.activationStatus || 'ACTIVE',
  };
}

/**
 * Ensure company has a real ACTIVE Twenty workspace (creates when bind missing/local).
 */
export async function ensureCompanyTwentyWorkspace(ownerUserId, { displayName } = {}) {
  const owner = strip(ownerUserId);
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  const profile = assertCrmEntitled(owner);
  if (profile.crm_provider !== 'twenty') {
    throw Object.assign(new Error('crm_provider must be twenty'), { status: 400 });
  }

  const name =
    strip(displayName) ||
    resolveDisplayName(owner) ||
    profile.twenty.workspace_name ||
    'Flolah CRM';
  const bound = strip(profile.twenty.workspace_id);

  const bindMeta = profile.twenty.bind && typeof profile.twenty.bind === 'object' ? profile.twenty.bind : {};
  const legacySharedSource = ['env_TWENTY_WORKSPACE_ID', 'twenty_db_active_workspace'].includes(
    String(bindMeta.source || '')
  );
  const exclusiveModes = new Set(['remote_active', 'remote_created', 'remote_activated']);
  const bindOwner = strip(bindMeta.flolah_owner_user_id);
  const isExclusiveOwn =
    exclusiveModes.has(String(bindMeta.mode || '')) && (!bindOwner || bindOwner === owner);
  // Shared/legacy maps must not reuse another CEO's workspace, even if UUID matches.
  const forceNewWorkspace =
    legacySharedSource || (isTwentyUuid(bound) && !isExclusiveOwn && isTwentyWorkspaceBoundToOtherOwner(bound, owner));

  if (isTwentyUuid(bound) && !forceNewWorkspace) {
    const row = await loadTwentyWorkspaceRow(bound);
    if (row?.activationStatus === 'ACTIVE' && row.subdomain) {
      setTwentyBind(owner, {
        workspace_id: row.id,
        workspace_name: name || row.displayName || profile.twenty.workspace_name,
        api_key_hint: profile.twenty.api_key_hint || '',
        bind: {
          flolah_owner_user_id: owner,
          mode: 'remote_active',
          subdomain: row.subdomain,
          verified_at: new Date().toISOString(),
        },
      });
      return {
        workspace_id: row.id,
        workspace_name: name || row.displayName,
        subdomain: row.subdomain,
        public_base: getTwentyWorkspacePublicBase(row.subdomain),
        created: false,
        mode: 'existing',
      };
    }
    // Resume incomplete provision (sign-up without activate)
    if (row?.subdomain && row.activationStatus && row.activationStatus !== 'ACTIVE') {
      try {
        const resumeBase = getTwentyWorkspacePublicBase(row.subdomain);
        const adminEmail =
          strip(process.env.TWENTY_BOOTSTRAP_EMAIL) ||
          (
            await pgQuery(
              `SELECT lower(u.email) as email FROM core."user" u
               JOIN core."userWorkspace" uw ON uw."userId" = u.id
               WHERE uw."workspaceId" = $1 LIMIT 1`,
              [row.id]
            )
          )?.rows?.[0]?.email;
        if (adminEmail && resumeBase) {
          const { accessToken } = await accessFor(adminEmail, row.id, resumeBase);
          const activated = await gqlMetadata(
            accessToken,
            `mutation ActivateWorkspace($data: ActivateWorkspaceInput!) {
              activateWorkspace(data: $data) {
                id activationStatus displayName subdomain
              }
            }`,
            { data: { displayName: name || row.displayName } },
            resumeBase
          );
          const act = activated?.activateWorkspace;
          if (act?.activationStatus === 'ACTIVE' || act?.id) {
            const sub = act.subdomain || row.subdomain;
            setTwentyBind(owner, {
              workspace_id: row.id,
              workspace_name: name || act.displayName || row.displayName,
              api_key_hint: profile.twenty.api_key_hint || '',
              bind: {
                flolah_owner_user_id: owner,
                mode: 'remote_activated',
                subdomain: sub,
                verified_at: new Date().toISOString(),
              },
            });
            return {
              workspace_id: row.id,
              workspace_name: name || act.displayName || row.displayName,
              subdomain: sub,
              public_base: getTwentyWorkspacePublicBase(sub),
              created: false,
              mode: 'remote_activated',
            };
          }
        }
      } catch (e) {
        console.warn(
          '[twenty-workspace] resume activate failed ws=%s %s',
          bound,
          e?.message || e
        );
      }
    }
  }

  let trySub = subdomainForOwner(owner, name);
  for (let i = 0; i < 6; i++) {
    const clash = await pgQuery(
      `SELECT id FROM core.workspace WHERE subdomain = $1 AND "deletedAt" IS NULL LIMIT 1`,
      [trySub]
    );
    if (!clash?.rows?.length) break;
    trySub = `${trySub.slice(0, 40)}${i + 1}`;
  }

  const created = await createAndActivateTwentyWorkspace({
    displayName: name,
    subdomain: trySub,
  });

  setTwentyBind(owner, {
    workspace_id: created.id,
    workspace_name: created.displayName || name,
    api_key_hint: profile.twenty.api_key_hint || '',
    bind: {
      flolah_owner_user_id: owner,
      mode: 'remote_created',
      subdomain: created.subdomain,
      previous_bind: bound || null,
      created_at: new Date().toISOString(),
    },
  });

  console.info(
    '[twenty-workspace] bound owner=%s ws=%s sub=%s',
    owner,
    created.id,
    created.subdomain
  );

  return {
    workspace_id: created.id,
    workspace_name: created.displayName || name,
    subdomain: created.subdomain,
    public_base: getTwentyWorkspacePublicBase(created.subdomain),
    created: true,
    mode: 'remote_created',
  };
}

/**
 * Add Flolah user into the company Twenty workspace (Member).
 */
export async function ensureUserInCompanyWorkspace(ownerUserId, flolahUser) {
  const ensured = await ensureCompanyTwentyWorkspace(ownerUserId);
  const email = strip(flolahUser?.email);
  if (!email || !email.includes('@')) {
    throw Object.assign(new Error('Authenticated user email required for CRM SSO'), {
      status: 400,
    });
  }
  const nameParts = strip(flolahUser?.name).split(/\s+/);
  const firstName = nameParts[0] || email.split('@')[0];
  const lastName = nameParts.slice(1).join(' ') || '';
  const join = await ensureTwentyUserForEmail({
    email,
    firstName,
    lastName,
    workspaceId: ensured.workspace_id,
  });
  return { ...ensured, ensure_user: join, email };
}