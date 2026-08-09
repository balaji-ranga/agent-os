/**
 * Browser embed / deep-link URLs for platform Twenty + ERPNext.
 * Public URLs only (never internal docker hostnames for iframe src).
 * Always resolve company from authenticated owner ΓÇö never trust body workspace ids.
 */
import {
  getBusinessProfile,
  assertCrmEntitled,
  assertErpEntitled,
} from './company-business-profile.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { getSetupGate } from './company-setup.js';
import { getUserById } from './users.js';
import { buildCrmSsoHandoff, isTwentySsoEnabled } from './twenty-sso.js';

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
 * Prefer crm.<apex> host root (never marketing www/apex or /crm-app path).
 * Env TWENTY_EMBED_URL / SERVER_URL still win when set.
 */

/** Company label: setup name ΓåÆ business_name ΓåÆ user name. */
export function resolveCompanyDisplayName(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return '';
  try {
    const gate = getSetupGate(owner);
    if (gate?.company_name) return String(gate.company_name).trim().slice(0, 120);
  } catch {
    /* optional */
  }
  try {
    const u = getUserById(owner);
    if (u?.business_name) return String(u.business_name).trim().slice(0, 120);
    if (u?.name) return String(u.name).trim().slice(0, 120);
  } catch {
    /* optional */
  }
  return '';
}

export function getTwentyPublicBase() {
  for (const raw of [
    process.env.TWENTY_EMBED_URL,
    process.env.TWENTY_SERVER_URL,
    process.env.TWENTY_PUBLIC_URL,
  ]) {
    const v = stripTrailingSlash(raw || '');
    if (v && !isInternalDockerHostname(v)) return v;
  }
  // Dedicated CRM subdomain (host root). Never marketing apex/www; never /crm-app.
  const host = publicLoginHostBase();
  if (host) {
    try {
      const u = new URL(host);
      const labels = u.hostname.split('.');
      if (labels[0] === 'login' || labels[0] === 'www') {
        u.hostname = ['crm', ...labels.slice(1)].join('.');
      } else if (labels[0] !== 'crm') {
        u.hostname = ['crm', ...labels].join('.');
      }
      return u.origin;
    } catch {
      /* fall through */
    }
  }
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
        : 'If public probe fails: Hostinger may block non-443 ports. Prefer https://crm.flolah.cloud (CRM root host). Port 8443 is often blocked.',
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
        'ERPNext is optional-erpnext profile ΓÇö not started by default. START_ERPNEXT=1; site init required.',
      public_note:
        'ERPNext not running until optional-erpnext + site init. Public ERP :443 host returns 502 until then.',
    },
  };
}

export async function getCrmEmbedForOwner(ownerUserId, { flolahUser } = {}) {
  const owner = String(ownerUserId || '').trim();
  const profile = getBusinessProfile(owner);
  if (!profile.platform_crm) {
    const err = new Error(
      'CRM menu is only available when platform CRM (Twenty or ERPNext) is selected for this company.'
    );
    err.status = 403;
    throw err;
  }
  assertCrmEntitled(owner);

  // ERPNext CRM modules (Leads/Opportunity/Selling) via ERP desk SSO
  if (profile.crm_provider === 'erpnext') {
    const base = getErpnextPublicBase();
    let companyId = profile.erpnext.company_id || null;
    let companyName = profile.erpnext.company_name || null;
    let iframe_url = null;
    let open_url = null;
    let switch_account_url = null;
    let sso = {
      mode: 'login_redirect',
      note: 'Sign in as your mapped ERPNext user when SSO is unavailable.',
    };
    if (base) {
      try {
        const { buildErpSsoHandoff, isErpnextSsoEnabled } = await import('./erpnext-sso.js');
        const { getPublicBaseUrl } = await import('../config/public-url.js');
        const flolahApi =
          String(getPublicBaseUrl() || '')
            .trim()
            .replace(/\/+$/, '') + '/api/business-core/erp-sso-consume';
        const launch = await buildErpSsoHandoff(owner, {
          flolahUser: flolahUser || getUserById(owner) || undefined,
          publicBase: base,
          // Landing on CRM workspace when available; Desk falls back to /app
          redirectPath: '/app/crm',
        });
        if (launch.company_id) companyId = launch.company_id;
        if (launch.company_name) companyName = launch.company_name;
        if (launch.ok && launch.iframe_url) {
          iframe_url =
            launch.iframe_url +
            (launch.iframe_url.includes('?') ? '&' : '?') +
            'consume=' +
            encodeURIComponent(flolahApi);
          open_url = iframe_url;
          switch_account_url = launch.switch_account_url || null;
          sso = {
            mode: launch.mode || 'session_cookie_sso',
            ok: true,
            company_id: companyId,
            company_name: companyName,
            note:
              'Passwordless ERPNext CRM (Sales) desk via Flolah session; company-scoped user.',
          };
        } else {
          open_url = base + '/app/crm';
          iframe_url = base + '/login?redirect-to=' + encodeURIComponent('/app/crm');
          sso = {
            mode: 'login_redirect',
            ok: false,
            reason: launch.reason || 'sso_unavailable',
            note: 'ERPNext CRM SSO unavailable; open login.',
          };
        }
        void isErpnextSsoEnabled;
      } catch (e) {
        console.warn('[business-embed] erpnext crm sso failed', e?.message || e);
        iframe_url = base + '/login?redirect-to=' + encodeURIComponent('/app/crm');
        open_url = iframe_url;
        sso = { mode: 'login_redirect', ok: false, reason: e?.message || 'sso_failed' };
      }
    }
    return {
      kind: 'crm',
      provider: 'erpnext',
      available: Boolean(base),
      reason: base
        ? null
        : 'No browser-reachable ERPNext URL. Set ERPNEXT_EMBED_URL (e.g. https://erp.crm.flolah.cloud)',
      iframe_url,
      open_url,
      switch_account_url,
      company_id: companyId,
      company_name: companyName,
      bound: Boolean(companyId),
      sso,
      owner_user_id: owner,
      stack: {
        database: 'MariaDB (erpnext-db)',
        sales_crm_modules: true,
      },
      wiring: {
        flolah_owner_user_id: owner,
        sso: 'CRM open → ERPNext desk (SSO) for Sales/CRM modules',
      },
    };
  }

  // Twenty CRM (default platform path)
  const base = getTwentyPublicBase();
  let workspaceId = profile.twenty.workspace_id || null;
  let workspaceSubdomain =
    profile.twenty.subdomain || (profile.twenty.bind && profile.twenty.bind.subdomain) || null;
  let publicBase = null;
  const companyDisplay =
    resolveCompanyDisplayName(owner) || profile.twenty.workspace_name || null;
  const workspaceName = profile.twenty.workspace_name || companyDisplay || null;

  let iframe_url = null;
  let open_url = null;
  let switch_account_url = null;
  let sso = {
    mode: 'session_isolation_handoff',
    note: 'Switching Flolah company clears prior Twenty browser session for this CRM host.',
  };

  if (base) {
    try {
      const launch = await buildCrmSsoHandoff(owner, {
        flolahUser: flolahUser || getUserById(owner) || undefined,
      });
      iframe_url = launch.iframe_url || null;
      open_url = launch.open_url || iframe_url;
      switch_account_url = launch.switch_account_url || null;
      if (launch.workspace_id) workspaceId = launch.workspace_id;
      if (launch.subdomain) workspaceSubdomain = launch.subdomain;
      if (launch.public_base) publicBase = launch.public_base;
      sso = {
        mode: launch.mode || (isTwentySsoEnabled() ? 'login_token_sso' : 'session_isolation_handoff'),
        ok: launch.ok !== false,
        reason: launch.reason || null,
        ensure: launch.ensure || null,
        subdomain: launch.subdomain || null,
        public_base: launch.public_base || null,
        note:
          launch.mode === 'login_token_sso'
            ? 'Passwordless CRM login via Flolah session (Twenty LOGIN token + company workspace).'
            : 'Session isolation handoff only; passwordless SSO unavailable for this request.',
      };
    } catch (e) {
      console.warn('[business-embed] crm sso launch failed', e?.message || e);
      const next = '/';
      const handoff =
        base +
        '/flolah-handoff/?owner=' +
        encodeURIComponent(owner) +
        '&next=' +
        encodeURIComponent(next);
      iframe_url = handoff;
      open_url = handoff;
      switch_account_url =
        base +
        '/flolah-handoff/?owner=' +
        encodeURIComponent(owner + ':switch:' + Date.now()) +
        '&wipe=1&next=' +
        encodeURIComponent('/welcome');
      sso = {
        mode: 'session_isolation_handoff',
        ok: false,
        reason: e?.message || 'sso_failed',
        note: 'Fell back to isolation handoff after SSO error.',
      };
    }
  }

  return {
    kind: 'crm',
    provider: 'twenty',
    available: Boolean(base),
    reason: base
      ? null
      : 'No browser-reachable CRM URL. Prefer TWENTY_EMBED_URL=https://crm.flolah.cloud',
    iframe_url,
    open_url,
    switch_account_url,
    workspace_id: workspaceId,
    workspace_subdomain: workspaceSubdomain,
    public_base: publicBase || base || null,
    workspace_name: workspaceName,
    company_display_name: companyDisplay,
    bound: profile.twenty.bound,
    sso,
    owner_user_id: owner,
    stack: {
      database: 'PostgreSQL (compose service twenty-db / postgres:16)',
      api_configured: Boolean(String(process.env.TWENTY_API_URL || '').trim()),
      sso_enabled: isTwentySsoEnabled(),
    },
    wiring: {
      flolah_owner_user_id: owner,
      twenty_workspace_id: workspaceId,
      twenty_subdomain: workspaceSubdomain,
      bind_mode: profile.twenty.bound ? 'profile' : 'pending_ensure_on_provision_or_sync',
      sync: 'POST /api/business-core/sync-org or Sync org (crm_sync_org tool)',
      sso: 'One Flolah company -> one Twenty workspace; CRM open mints LOGIN token',
    },
  };
}


export async function getErpEmbedForOwner(ownerUserId, { flolahUser, flolahUserId } = {}) {
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
  let companyId = profile.erpnext.company_id || null;
  let companyName = profile.erpnext.company_name || null;

  let iframe_url = null;
  let open_url = null;
  let switch_account_url = null;
  let sso = {
    mode: 'login_redirect',
    note: 'Sign in as your mapped ERPNext user when SSO is unavailable.',
  };

  if (base) {
    try {
      const { buildErpSsoHandoff, isErpnextSsoEnabled } = await import('./erpnext-sso.js');
      const { getPublicBaseUrl } = await import('../config/public-url.js');
      const flolahApi =
        String(getPublicBaseUrl() || '')
          .trim()
          .replace(/\/+$/, '') + '/api/business-core/erp-sso-consume';
      const launch = await buildErpSsoHandoff(owner, {
        flolahUser: flolahUser || getUserById(owner) || { id: flolahUserId || owner },
        publicBase: base,
      });
      if (launch.company_id) companyId = launch.company_id;
      if (launch.company_name) companyName = launch.company_name;
      if (launch.ok && launch.iframe_url) {
        iframe_url =
          launch.iframe_url +
          (launch.iframe_url.includes('?') ? '&' : '?') +
          'consume=' +
          encodeURIComponent(flolahApi);
        open_url = iframe_url;
        switch_account_url = launch.switch_account_url || null;
        sso = {
          mode: launch.mode || 'session_cookie_sso',
          ok: true,
          company_id: companyId,
          company_name: companyName,
          note:
            'Passwordless ERP Desk via Flolah session: one-time token sets ERPNext sid for company-scoped user.',
        };
      } else {
        const companyQs =
          companyName || companyId
            ? '?company=' + encodeURIComponent(companyName || companyId)
            : '';
        open_url = base + '/app' + companyQs;
        iframe_url =
          base + '/login?redirect-to=' + encodeURIComponent('/app' + companyQs);
        sso = {
          mode: 'login_redirect',
          ok: false,
          reason: launch.reason || 'sso_unavailable',
          note:
            isErpnextSsoEnabled()
              ? 'SSO mint failed — password login fallback.'
              : 'Set ERPNEXT_API_KEY/SECRET and ERPNEXT_SSO_ENABLED for passwordless ERP.',
        };
      }
    } catch (e) {
      console.warn('[business-embed] erp sso launch failed', e?.message || e);
      const companyQs =
        companyName || companyId
          ? '?company=' + encodeURIComponent(companyName || companyId)
          : '';
      open_url = base + '/app' + companyQs;
      iframe_url =
        base + '/login?redirect-to=' + encodeURIComponent('/app' + companyQs);
      sso = {
        mode: 'login_redirect',
        ok: false,
        reason: e?.message || 'sso_failed',
        note: 'Fell back to ERP login page after SSO error.',
      };
    }
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
    switch_account_url,
    company_id: companyId,
    company_name: companyName,
    bound: profile.erpnext.bound,
    flolah_user_id: flolahUserId || flolahUser?.id || owner,
    login_hint:
      sso.mode === 'session_cookie_sso'
        ? 'Passwordless ERP for this company (User Permission scoped).'
        : 'Sign in as your mapped ERPNext user for this company. ERPNext is multi-company.',
    sso,
    owner_user_id: owner,
    stack: {
      database:
        'MariaDB (erpnext-db) — ERPNext requires MariaDB/MySQL; Twenty CRM uses Postgres twenty-db. Isolation model matches CRM (1 CEO company → 1 ERPNext Company).',
      api_configured: Boolean(
        String(process.env.ERPNEXT_URL || '').trim() &&
          String(process.env.ERPNEXT_API_KEY || '').trim()
      ),
      sso_enabled: String(process.env.ERPNEXT_SSO_ENABLED || '1') !== '0',
    },
    wiring: {
      flolah_owner_user_id: owner,
      erpnext_company_id: companyId,
      bind_mode: profile.erpnext.bound ? 'profile' : 'pending_ensure_on_provision_or_sync',
      sync: 'POST /api/business-core/sync-org or button Sync Flolah org (erp_sync_org tool)',
      isolation:
        'One Flolah company → one ERPNext Company + SSO User Permission filter; tools never accept foreign company ids.',
      agents:
        'Prefab: ERP P&L Agent, ERP Invoice Agent, ERP Project Manager (erp_* tools).',
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