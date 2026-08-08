/**
 * Browser embed / deep-link URLs for platform Twenty + ERPNext.
 * Public URLs only (never internal docker hostnames for iframe src).
 * Always resolve company from authenticated owner — never trust body workspace ids.
 */
import {
  getBusinessProfile,
  assertCrmEntitled,
  assertErpEntitled,
} from './company-business-profile.js';
import { getPublicBaseUrl } from '../config/public-url.js';

function stripTrailingSlash(s) {
  return String(s || '')
    .trim()
    .replace(/\/+$/, '');
}

function isInternalDockerHostname(urlStr) {
  try {
    const host = new URL(urlStr).hostname;
    return (
      host === 'twenty-server' ||
      host === 'twenty-worker' ||
      host === 'erpnext-backend' ||
      host === 'erpnext-frontend' ||
      host.endsWith('.internal')
    );
  } catch {
    return true;
  }
}

function sameOriginTlsPort(portEnv, defaultPort) {
  const pub = stripTrailingSlash(getPublicBaseUrl());
  if (!pub || !/^https?:\/\//i.test(pub)) return '';
  try {
    const u = new URL(pub);
    const port = String(process.env[portEnv] || defaultPort).trim() || defaultPort;
    if (!port || port === '443' || port === '80') return '';
    return u.protocol + '//' + u.hostname + ':' + port;
  } catch {
    return '';
  }
}

function publicLoginHostBase() {
  const pub = stripTrailingSlash(getPublicBaseUrl());
  if (!pub || !/^https?:\/\//i.test(pub)) return '';
  try {
    const u = new URL(pub);
    return u.protocol + '//' + u.hostname;
  } catch {
    return '';
  }
}

/**
 * Prefer same-origin /crm-app on :443 (Hostinger often drops non-standard ports).
 * Env TWENTY_EMBED_URL / SERVER_URL still win when set.
 */
export function getTwentyPublicBase() {
  for (const raw of [
    process.env.TWENTY_EMBED_URL,
    process.env.TWENTY_SERVER_URL,
    process.env.TWENTY_PUBLIC_URL,
  ]) {
    const v = stripTrailingSlash(raw || '');
    if (v && !isInternalDockerHostname(v)) return v;
  }
  const host = publicLoginHostBase();
  if (host) return host + '/crm-app';
  return sameOriginTlsPort('TWENTY_PUBLIC_HTTPS_PORT', '8443');
}

export function getErpnextPublicBase() {
  for (const raw of [
    process.env.ERPNEXT_EMBED_URL,
    process.env.ERPNEXT_PUBLIC_URL,
    process.env.ERPNEXT_SERVER_URL,
  ]) {
    const v = stripTrailingSlash(raw || '');
    if (v && !isInternalDockerHostname(v)) return v;
  }
  return sameOriginTlsPort('ERPNEXT_PUBLIC_HTTPS_PORT', '8444');
}

async function probeHttp(url, { timeoutMs = 2500 } = {}) {
  if (!url) return { ok: false, status: 0, error: 'no_url' };
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'text/html,application/json' },
    });
    return { ok: res.status > 0 && res.status < 500, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: e.message || String(e) };
  }
}

export async function getBusinessCoreStackStatus() {
  const twentyInternal =
    stripTrailingSlash(process.env.TWENTY_API_URL || 'http://twenty-server:3000') ||
    'http://twenty-server:3000';
  const erpInternal = stripTrailingSlash(process.env.ERPNEXT_URL || '');
  const twentyPublic = getTwentyPublicBase();
  const erpPublic = getErpnextPublicBase();

  const [twentyLoop, twentyPub, erpLoop, erpPub] = await Promise.all([
    probeHttp(twentyInternal + '/healthz').catch(() => probeHttp(twentyInternal)),
    twentyPublic
      ? probeHttp(twentyPublic + '/')
      : Promise.resolve({ ok: false, status: 0, error: 'no_public_url' }),
    erpInternal
      ? probeHttp(erpInternal)
      : Promise.resolve({
          ok: false,
          status: 0,
          error: 'ERPNEXT_URL not set; stack not started',
        }),
    erpPublic
      ? probeHttp(erpPublic + '/')
      : Promise.resolve({ ok: false, status: 0, error: 'no_public_url' }),
  ]);

  return {
    crm: {
      provider: 'twenty',
      internal_url: twentyInternal,
      public_url: twentyPublic || null,
      internal_ok: !!twentyLoop.ok,
      public_ok: !!twentyPub.ok,
      internal_status: twentyLoop.status || 0,
      public_status: twentyPub.status || 0,
      api_key_set: Boolean(
        String(process.env.TWENTY_API_KEY || process.env.TWENTY_API_TOKEN || '').trim()
      ),
      containers_hint: 'docker compose --profile optional-twenty ps twenty-server',
      public_note: twentyPub.ok
        ? null
        : 'If public probe fails: Hostinger may block non-443 ports. Prefer https://login.flolah.cloud/crm-app (same-origin).',
    },
    erp: {
      provider: 'erpnext',
      internal_url: erpInternal || null,
      public_url: erpPublic || null,
      internal_ok: !!erpLoop.ok,
      public_ok: !!erpPub.ok,
      internal_status: erpLoop.status || 0,
      public_status: erpPub.status || 0,
      api_key_set: Boolean(
        String(process.env.ERPNEXT_API_KEY || '').trim() &&
          String(process.env.ERPNEXT_API_SECRET || '').trim()
      ),
      stack_running: Boolean(erpInternal) && !!erpLoop.ok,
      containers_hint:
        'ERPNext is optional-erpnext profile — not started by default. START_ERPNEXT=1; site init required.',
      public_note:
        'ERPNext not running until optional-erpnext + site init. :8444 returns 502 until then.',
    },
  };
}

export function getCrmEmbedForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const profile = getBusinessProfile(owner);
  if (!profile.platform_crm) {
    const err = new Error(
      'CRM menu is only available when platform CRM (Twenty) is selected for this company.'
    );
    err.status = 403;
    throw err;
  }
  assertCrmEntitled(owner);

  const base = getTwentyPublicBase();
  const workspaceId = profile.twenty.workspace_id || null;
  const workspaceName = profile.twenty.workspace_name || null;

  return {
    kind: 'crm',
    provider: 'twenty',
    available: Boolean(base),
    reason: base
      ? null
      : 'No browser-reachable CRM URL. Prefer TWENTY_EMBED_URL=https://login.flolah.cloud/crm-app',
    iframe_url: base ? base + '/' : null,
    open_url: base ? base + '/' : null,
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    bound: profile.twenty.bound,
    login_hint:
      'Sign in with your company Twenty workspace credentials. Each Flolah company is bound to one Twenty workspace.',
    owner_user_id: owner,
    stack: {
      database: 'PostgreSQL (compose service twenty-db / postgres:16)',
      api_configured: Boolean(String(process.env.TWENTY_API_URL || '').trim()),
    },
    wiring: {
      flolah_owner_user_id: owner,
      twenty_workspace_id: workspaceId,
      bind_mode: profile.twenty.bound ? 'profile' : 'pending_ensure_on_provision_or_sync',
      sync: 'POST /api/business-core/sync-org or button Sync Flolah org (crm_sync_org tool)',
    },
  };
}

export function getErpEmbedForOwner(ownerUserId, { flolahUserId } = {}) {
  const owner = String(ownerUserId || '').trim();
  const profile = getBusinessProfile(owner);
  if (!profile.platform_erp) {
    const err = new Error(
      'ERP menu is only available when platform ERP (ERPNext) is selected for this company.'
    );
    err.status = 403;
    throw err;
  }
  assertErpEntitled(owner);

  const base = getErpnextPublicBase();
  const companyId = profile.erpnext.company_id || null;
  const companyName = profile.erpnext.company_name || null;

  let iframe_url = null;
  let open_url = null;
  if (base) {
    const companyQs =
      companyName || companyId
        ? '?company=' + encodeURIComponent(companyName || companyId)
        : '';
    open_url = base + '/app' + companyQs;
    iframe_url =
      base + '/login?redirect-to=' + encodeURIComponent('/app' + companyQs);
  }

  return {
    kind: 'erp',
    provider: 'erpnext',
    available: Boolean(base),
    reason: base
      ? null
      : 'No browser-reachable ERP URL. Set ERPNEXT_EMBED_URL after ERPNext is running.',
    iframe_url,
    open_url,
    company_id: companyId,
    company_name: companyName,
    bound: profile.erpnext.bound,
    flolah_user_id: flolahUserId || owner,
    login_hint:
      'Sign in as your mapped ERPNext user for this company. ERPNext is multi-company.',
    owner_user_id: owner,
    stack: {
      database: 'MariaDB (compose service erpnext-db / mariadb:10.11)',
      api_configured: Boolean(
        String(process.env.ERPNEXT_URL || '').trim() &&
          String(process.env.ERPNEXT_API_KEY || '').trim()
      ),
    },
    wiring: {
      flolah_owner_user_id: owner,
      erpnext_company_id: companyId,
      bind_mode: profile.erpnext.bound ? 'profile' : 'pending_ensure_on_provision_or_sync',
      sync: 'POST /api/business-core/sync-org or button Sync Flolah org (erp_sync_org tool)',
    },
  };
}

export function getBusinessMenuFlags(ownerUserId) {
  const profile = getBusinessProfile(ownerUserId);
  return {
    show_crm_menu: profile.platform_crm === true,
    show_erp_menu: profile.platform_erp === true,
    crm_provider: profile.crm_provider,
    erp_provider: profile.erp_provider,
    twenty_bound: profile.twenty.bound,
    erpnext_bound: profile.erpnext.bound,
  };
}
