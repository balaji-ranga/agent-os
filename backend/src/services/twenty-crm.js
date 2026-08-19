/**
 * Twenty CRM adapter — Core REST against platform Twenty.
 * Objects: people, companies, opportunities (deals + leads via stage), notes, tasks.
 * One Flolah company → one Twenty workspace; all REST calls use a **workspace-scoped**
 * access token minted for the company owner (LOGIN exchange), not a shared platform
 * API key (which would write into a single wrong workspace for every CEO).
 * Docs: https://twenty.com /rest/people, /rest/companies, /rest/opportunities
 */
import {
  getBusinessProfile,
  assertCrmEntitled,
  resolveTwentyWorkspaceForOwner,
} from './company-business-profile.js';
import { getUserById } from './users.js';
import { isTwentySsoEnabled, mintTwentyLoginToken } from './twenty-sso.js';
import { withWriteIdempotency } from './tool-write-idempotency.js';

function baseUrl() {
  return String(process.env.TWENTY_API_URL || '')
    .trim()
    .replace(/\/+$/, '');
}

function platformApiKey() {
  return String(process.env.TWENTY_API_KEY || process.env.TWENTY_API_TOKEN || '').trim();
}

export function isTwentyConfigured() {
  return Boolean(baseUrl());
}

/** Lead-like opportunity stages in default Twenty pipeline */
const LEAD_STAGES = new Set(['NEW', 'SCREENING', 'MEETING', 'PROPOSAL', 'QUALIFIED']);

/** @type {Map<string, { token: string, expMs: number, workspaceId: string, subdomain: string|null, workspaceName: string|null }>} */
const ownerTokenCache = new Map();

function strip(s) {
  return String(s || '').trim();
}

/**
 * Mint short-lived workspace-scoped Twenty access token for CEO owner.
 * Never use platform TWENTY_API_KEY for multi-CEO REST — one key == one workspace.
 */
async function resolveOwnerWorkspaceAuth(ownerUserId) {
  const owner = strip(ownerUserId);
  if (!owner) {
    throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  }
  assertCrmEntitled(owner);
  const profile = getBusinessProfile(owner);
  if (profile.crm_provider !== 'twenty') {
    throw Object.assign(new Error(`CRM provider is ${profile.crm_provider}, not twenty`), {
      status: 400,
    });
  }

  const cached = ownerTokenCache.get(owner);
  if (cached && cached.expMs > Date.now() + 15_000 && cached.token) {
    return {
      workspaceId: cached.workspaceId,
      workspaceName: cached.workspaceName,
      subdomain: cached.subdomain,
      apiKey: cached.token,
      mode: 'owner_access_token_cached',
    };
  }

  const user = getUserById(owner);
  const email = strip(user?.email);
  if (!email || !email.includes('@')) {
    throw Object.assign(
      new Error('Company owner email is required for workspace-scoped CRM API access'),
      { status: 400 }
    );
  }

  if (!isTwentySsoEnabled()) {
    // Single-workspace legacy: allow platform API key, but warn.
    const key = platformApiKey();
    if (!key) {
      throw Object.assign(
        new Error(
          'TWENTY_APP_SECRET (SSO) is required for multi-company CRM tools, or set TWENTY_API_KEY for a single shared workspace'
        ),
        { status: 503 }
      );
    }
    let workspaceId = strip(profile.twenty?.workspace_id);
    let workspaceName = strip(profile.twenty?.workspace_name) || null;
    let subdomain = strip(profile.twenty?.subdomain || profile.twenty?.bind?.subdomain) || null;
    if (!workspaceId) {
      const { ensureCompanyTwentyWorkspace } = await import('./twenty-workspace.js');
      const ens = await ensureCompanyTwentyWorkspace(owner);
      workspaceId = ens.workspace_id;
      workspaceName = ens.workspace_name || workspaceName;
      subdomain = ens.subdomain || subdomain;
    }
    console.warn(
      '[twenty-crm] using platform TWENTY_API_KEY (SSO off) — all CEOs share one Twenty workspace; set TWENTY_APP_SECRET for multi-workspace'
    );
    return {
      workspaceId,
      workspaceName,
      subdomain,
      apiKey: key,
      mode: 'platform_api_key_legacy',
    };
  }

  const { ensureUserInCompanyWorkspace, exchangeLoginToken } = await import(
    './twenty-workspace.js'
  );
  const ens = await ensureUserInCompanyWorkspace(owner, {
    id: owner,
    email,
    name: user?.name || user?.business_name || '',
  });
  const workspaceId = ens.workspace_id;
  if (!workspaceId) {
    throw Object.assign(new Error('Twenty workspace not bound for this company'), { status: 409 });
  }
  if (ens.ensure_user && ens.ensure_user.ok === false) {
    console.warn(
      '[twenty-crm] ensure owner membership incomplete owner=%s reason=%s',
      owner,
      ens.ensure_user.reason || '?'
    );
  }

  const loginToken = mintTwentyLoginToken({
    email,
    workspaceId,
    authProvider: 'SSO',
    expiresSec: 300,
  });
  const { accessToken } = await exchangeLoginToken(loginToken, ens.public_base);
  if (!accessToken) {
    throw Object.assign(new Error('Failed to mint workspace-scoped Twenty access token'), {
      status: 502,
    });
  }

  ownerTokenCache.set(owner, {
    token: accessToken,
    expMs: Date.now() + 4 * 60 * 1000,
    workspaceId,
    subdomain: ens.subdomain || null,
    workspaceName: ens.workspace_name || null,
  });

  console.info(
    '[twenty-crm] owner access token owner=%s workspace=%s sub=%s',
    owner,
    workspaceId,
    ens.subdomain || '?'
  );

  return {
    workspaceId,
    workspaceName: ens.workspace_name || null,
    subdomain: ens.subdomain || null,
    publicBase: ens.public_base || null,
    apiKey: accessToken,
    mode: 'owner_access_token',
  };
}

async function twentyFetch(path, { method = 'GET', body, apiKey } = {}) {
  const root = baseUrl();
  if (!root) {
    const err = new Error('TWENTY_API_URL is not configured on the platform');
    err.status = 503;
    throw err;
  }
  const key = apiKey || platformApiKey();
  if (!key) {
    const err = new Error('No Twenty credentials for this request');
    err.status = 503;
    throw err;
  }
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
  };
  const url = `${root}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
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
      (Array.isArray(data?.messages) && data.messages[0]) ||
      data?.message ||
      (typeof data?.error === 'string' ? data.error : data?.error?.message) ||
      data?.errors?.[0]?.message ||
      `Twenty HTTP ${res.status}`;
    const err = new Error(String(msg).slice(0, 500));
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    err.details = data;
    throw err;
  }
  return data;
}

function unwrapList(data, ...keys) {
  if (Array.isArray(data)) return data;
  for (const k of keys) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  if (Array.isArray(data?.data)) return data.data;
  if (data?.data && Array.isArray(data.data?.[keys[0]])) return data.data[keys[0]];
  return [];
}

function lim(n, d = 25) {
  return Math.min(100, Math.max(1, Number(n) || d));
}

function scopeMeta(auth) {
  return {
    workspace_id: auth.workspaceId,
    workspace_name: auth.workspaceName || null,
    subdomain: auth.subdomain || null,
    auth_mode: auth.mode || null,
  };
}

export async function ensureTwentyWorkspaceForCompany(ownerUserId, { displayName } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });

  const { ensureCompanyTwentyWorkspace } = await import('./twenty-workspace.js');
  const ensured = await ensureCompanyTwentyWorkspace(owner, { displayName });
  return {
    workspace_id: ensured.workspace_id,
    workspace_name: ensured.workspace_name,
    subdomain: ensured.subdomain,
    public_base: ensured.public_base,
    created: Boolean(ensured.created),
    mode: ensured.mode || (ensured.created ? 'remote_created' : 'existing'),
  };
}

function offlinePayload(workspaceId, message, mode) {
  return {
    offline: true,
    workspace_id: workspaceId || null,
    mode,
    message,
  };
}

async function requireLiveAuth(ownerUserId) {
  if (!isTwentyConfigured()) {
    let workspaceId = null;
    try {
      workspaceId = resolveTwentyWorkspaceForOwner(ownerUserId).workspaceId;
    } catch {
      /* unbound */
    }
    return {
      off: offlinePayload(
        workspaceId,
        'TWENTY_API_URL not set — bind only',
        'offline'
      ),
    };
  }
  try {
    const auth = await resolveOwnerWorkspaceAuth(ownerUserId);
    return { auth };
  } catch (e) {
    if (e.status === 403 || e.status === 400 || e.status === 409) throw e;
    console.warn('[twenty-crm] resolve owner auth failed', e?.message || e);
    return {
      off: offlinePayload(
        null,
        e.message || 'Could not resolve workspace CRM credentials',
        'auth_error'
      ),
    };
  }
}

export async function crmListPeople(ownerUserId, { limit = 25 } = {}) {
  const { auth, off } = await requireLiveAuth(ownerUserId);
  if (off) return { ...off, people: [] };
  try {
    const data = await twentyFetch(`/rest/people?limit=${lim(limit)}`, { apiKey: auth.apiKey });
    return {
      ...scopeMeta(auth),
      mode: 'live',
      people: unwrapList(data, 'people'),
    };
  } catch (e) {
    return { ...scopeMeta(auth), mode: 'error', people: [], error: e.message };
  }
}

export async function crmCreatePerson(ownerUserId, { name, email, phone, companyId, idempotency_key } = {}) {
  return withWriteIdempotency({
    ownerUserId,
    toolName: 'crm_create_person',
    idempotencyKey: idempotency_key,
    identity: {
      name: String(name || '').trim().toLowerCase(),
      email: String(email || '').trim().toLowerCase(),
    },
    execute: () => crmCreatePersonUniq(ownerUserId, { name, email, phone, companyId }),
  });
}

async function crmCreatePersonUniq(ownerUserId, { name, email, phone, companyId } = {}) {
  if (!isTwentyConfigured()) {
    throw Object.assign(new Error('TWENTY_API_URL not configured'), { status: 503 });
  }
  const auth = await resolveOwnerWorkspaceAuth(ownerUserId);
  const parts = String(name || '')
    .trim()
    .split(/\s+/);
  const body = {
    name: name
      ? { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' }
      : undefined,
    emails: email ? { primaryEmail: String(email).trim() } : undefined,
    phones: phone ? { primaryPhoneNumber: String(phone).trim() } : undefined,
  };
  if (companyId) body.companyId = companyId;
  const data = await twentyFetch('/rest/people', {
    method: 'POST',
    body,
    apiKey: auth.apiKey,
  });
  const person = data?.data?.createPerson || data?.data || data;
  console.info(
    '[twenty-crm] createPerson owner workspace=%s sub=%s person=%s',
    auth.workspaceId,
    auth.subdomain || '?',
    person?.id || person?.createPerson?.id || '?'
  );
  return {
    ...scopeMeta(auth),
    mode: 'live',
    person,
  };
}

export async function crmListCompanies(ownerUserId, { limit = 25 } = {}) {
  const { auth, off } = await requireLiveAuth(ownerUserId);
  if (off) return { ...off, companies: [] };
  try {
    const data = await twentyFetch(`/rest/companies?limit=${lim(limit)}`, { apiKey: auth.apiKey });
    return {
      ...scopeMeta(auth),
      mode: 'live',
      companies: unwrapList(data, 'companies'),
    };
  } catch (e) {
    return { ...scopeMeta(auth), mode: 'error', companies: [], error: e.message };
  }
}

export async function crmCreateCompany(ownerUserId, { name, domainUrl, employees, idempotency_key } = {}) {
  return withWriteIdempotency({
    ownerUserId,
    toolName: 'crm_create_company',
    idempotencyKey: idempotency_key,
    identity: {
      name: String(name || '').trim().toLowerCase(),
      domain: String(domainUrl || '').trim().toLowerCase(),
    },
    execute: () => crmCreateCompanyUniq(ownerUserId, { name, domainUrl, employees }),
  });
}

async function crmCreateCompanyUniq(ownerUserId, { name, domainUrl, employees } = {}) {
  if (!isTwentyConfigured()) {
    throw Object.assign(new Error('TWENTY_API_URL not configured'), { status: 503 });
  }
  const auth = await resolveOwnerWorkspaceAuth(ownerUserId);
  const body = { name: String(name || '').trim() };
  if (!body.name) throw Object.assign(new Error('name required'), { status: 400 });
  if (domainUrl) body.domainName = String(domainUrl).trim();
  if (employees != null) body.employees = Number(employees);
  const data = await twentyFetch('/rest/companies', {
    method: 'POST',
    body,
    apiKey: auth.apiKey,
  });
  const company = data?.data?.createCompany || data?.data || data;
  console.info(
    '[twenty-crm] createCompany owner workspace=%s sub=%s company=%s',
    auth.workspaceId,
    auth.subdomain || '?',
    company?.id || '?'
  );
  return {
    ...scopeMeta(auth),
    mode: 'live',
    company,
  };
}

/** Deals = Twenty opportunities (pipeline). */
export async function crmListOpportunities(ownerUserId, { limit = 25, stage } = {}) {
  const { auth, off } = await requireLiveAuth(ownerUserId);
  if (off) return { ...off, opportunities: [], deals: [] };
  try {
    let path = `/rest/opportunities?limit=${lim(limit)}`;
    if (stage) {
      path += `&filter[stage][eq]=${encodeURIComponent(String(stage))}`;
    }
    const data = await twentyFetch(path, { apiKey: auth.apiKey });
    const opportunities = unwrapList(data, 'opportunities');
    return {
      ...scopeMeta(auth),
      mode: 'live',
      opportunities,
      deals: opportunities,
    };
  } catch (e) {
    return {
      ...scopeMeta(auth),
      mode: 'error',
      opportunities: [],
      deals: [],
      error: e.message,
    };
  }
}

export async function crmCreateOpportunity(
  ownerUserId,
  { name, amount, currencyCode = 'USD', stage = 'NEW', companyId, closeDate, pointOfContactId, idempotency_key } = {}
) {
  return withWriteIdempotency({
    ownerUserId,
    toolName: 'crm_create_opportunity',
    idempotencyKey: idempotency_key,
    identity: {
      name: String(name || '').trim().toLowerCase(),
      companyId: String(companyId || ''),
      stage: String(stage || 'NEW'),
    },
    execute: () =>
      crmCreateOpportunityUniq(ownerUserId, {
        name,
        amount,
        currencyCode,
        stage,
        companyId,
        closeDate,
        pointOfContactId,
      }),
  });
}

async function crmCreateOpportunityUniq(
  ownerUserId,
  { name, amount, currencyCode = 'USD', stage = 'NEW', companyId, closeDate, pointOfContactId } = {}
) {
  if (!isTwentyConfigured()) {
    throw Object.assign(new Error('TWENTY_API_URL not configured'), { status: 503 });
  }
  const auth = await resolveOwnerWorkspaceAuth(ownerUserId);
  const title = String(name || '').trim();
  if (!title) throw Object.assign(new Error('name required'), { status: 400 });
  const body = {
    name: title,
    stage: String(stage || 'NEW').toUpperCase(),
  };
  if (amount != null && amount !== '') {
    const n = Number(amount);
    body.amount = {
      amountMicros: Math.round(n * 1_000_000),
      currencyCode: String(currencyCode || 'USD'),
    };
  }
  if (companyId) body.companyId = companyId;
  if (pointOfContactId) body.pointOfContactId = pointOfContactId;
  if (closeDate) body.closeDate = closeDate;
  const data = await twentyFetch('/rest/opportunities', {
    method: 'POST',
    body,
    apiKey: auth.apiKey,
  });
  const opportunity = data?.data?.createOpportunity || data?.data || data;
  return {
    ...scopeMeta(auth),
    mode: 'live',
    opportunity,
    deal: opportunity,
  };
}

function assertConfirm(confirm) {
  const v = confirm;
  if (v === true || v === 1 || v === '1' || String(v || '').toLowerCase() === 'true') return;
  throw Object.assign(new Error('Pass confirm=true after Checker audit to soft-delete'), { status: 400 });
}

function assertRecordId(id) {
  const recId = String(id || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(recId)) {
    throw Object.assign(new Error('id required (workspace record id)'), { status: 400 });
  }
  return recId;
}

async function twentySoftDelete(ownerUserId, object, recId) {
  const auth = await resolveOwnerWorkspaceAuth(ownerUserId);
  const path = `/rest/${object}/${encodeURIComponent(recId)}`;
  try {
    const data = await twentyFetch(path, { method: 'DELETE', apiKey: auth.apiKey });
    return { auth, data, via: 'rest_delete' };
  } catch (e) {
    const status = Number(e?.status) || 0;
    if (status !== 404 && status !== 405 && status !== 400) throw e;
    const typeName = object === 'people' ? 'People' : object === 'companies' ? 'Companies' : object;
    const data = await twentyFetch('/graphql', {
      method: 'POST',
      apiKey: auth.apiKey,
      body: {
        query: `mutation Delete($ids: [UUID!]!) { delete${typeName}(ids: $ids) }`,
        variables: { ids: [recId] },
      },
    });
    if (data?.errors?.length) {
      throw Object.assign(new Error(String(data.errors[0]?.message || 'Twenty GraphQL delete failed').slice(0, 400)), {
        status: 502,
      });
    }
    return { auth, data, via: 'graphql_delete' };
  }
}

/** Soft-delete a person (Twenty deletedAt / archive). Checker-only grant. */
export async function crmDeletePerson(ownerUserId, { id, confirm } = {}) {
  if (!isTwentyConfigured()) {
    throw Object.assign(new Error('TWENTY_API_URL not configured'), { status: 503 });
  }
  assertConfirm(confirm);
  const recId = assertRecordId(id);
  const { auth, data, via } = await twentySoftDelete(ownerUserId, 'people', recId);
  console.info('[twenty-crm] deletePerson owner workspace=%s person=%s via=%s', auth.workspaceId, recId, via);
  return { ...scopeMeta(auth), mode: 'live', deleted: true, id: recId, person: data?.data || data, via };
}

/** Soft-delete a company (Twenty deletedAt / archive). Checker-only grant. */
export async function crmDeleteCompany(ownerUserId, { id, confirm } = {}) {
  if (!isTwentyConfigured()) {
    throw Object.assign(new Error('TWENTY_API_URL not configured'), { status: 503 });
  }
  assertConfirm(confirm);
  const recId = assertRecordId(id);
  const { auth, data, via } = await twentySoftDelete(ownerUserId, 'companies', recId);
  console.info('[twenty-crm] deleteCompany owner workspace=%s company=%s via=%s', auth.workspaceId, recId, via);
  return { ...scopeMeta(auth), mode: 'live', deleted: true, id: recId, company: data?.data || data, via };
}

export async function crmUpdateOpportunity(ownerUserId, { id, patch } = {}) {
  if (!isTwentyConfigured()) {
    throw Object.assign(new Error('TWENTY_API_URL not configured'), { status: 503 });
  }
  const auth = await resolveOwnerWorkspaceAuth(ownerUserId);
  const oppId = String(id || '').trim();
  if (!oppId) throw Object.assign(new Error('id required'), { status: 400 });
  const body = { ...(patch || {}) };
  if (body.amount != null && typeof body.amount === 'number') {
    body.amount = {
      amountMicros: Math.round(Number(body.amount) * 1_000_000),
      currencyCode: body.currencyCode || 'USD',
    };
    delete body.currencyCode;
  }
  const data = await twentyFetch(`/rest/opportunities/${encodeURIComponent(oppId)}`, {
    method: 'PATCH',
    body,
    apiKey: auth.apiKey,
  });
  return {
    ...scopeMeta(auth),
    mode: 'live',
    opportunity: data?.data || data,
  };
}

/**
 * Leads: Twenty has no separate Lead object in default schema.
 * Map to opportunities in early pipeline stages (NEW/SCREENING/…).
 */
export async function crmListLeads(ownerUserId, { limit = 25 } = {}) {
  const all = await crmListOpportunities(ownerUserId, { limit: lim(limit, 50) });
  if (all.mode !== 'live') return { ...all, leads: [] };
  const leads = (all.opportunities || []).filter((o) => {
    const st = String(o.stage || o.pipelineStepId || 'NEW').toUpperCase();
    return LEAD_STAGES.has(st) || !o.stage;
  });
  return {
    workspace_id: all.workspace_id,
    workspace_name: all.workspace_name,
    subdomain: all.subdomain,
    auth_mode: all.auth_mode,
    mode: 'live',
    leads,
    note: 'Twenty maps leads to opportunities in early stages (NEW, SCREENING, …)',
  };
}

export async function crmCreateLead(ownerUserId, opts = {}) {
  return crmCreateOpportunity(ownerUserId, {
    ...opts,
    stage: opts.stage || 'NEW',
    name: opts.name || opts.title || 'New lead',
  });
}

export async function crmListNotes(ownerUserId, { limit = 25 } = {}) {
  const { auth, off } = await requireLiveAuth(ownerUserId);
  if (off) return { ...off, notes: [] };
  try {
    const data = await twentyFetch(`/rest/notes?limit=${lim(limit)}`, { apiKey: auth.apiKey });
    return { ...scopeMeta(auth), mode: 'live', notes: unwrapList(data, 'notes') };
  } catch (e) {
    return { ...scopeMeta(auth), mode: 'error', notes: [], error: e.message };
  }
}

export async function crmListTasks(ownerUserId, { limit = 25 } = {}) {
  const { auth, off } = await requireLiveAuth(ownerUserId);
  if (off) return { ...off, tasks: [] };
  try {
    const data = await twentyFetch(`/rest/tasks?limit=${lim(limit)}`, { apiKey: auth.apiKey });
    return { ...scopeMeta(auth), mode: 'live', tasks: unwrapList(data, 'tasks') };
  } catch (e) {
    return { ...scopeMeta(auth), mode: 'error', tasks: [], error: e.message };
  }
}

export function getTwentyStatusForOwner(ownerUserId) {
  const p = getBusinessProfile(ownerUserId);
  return {
    configured: isTwentyConfigured(),
    api_key_set: Boolean(platformApiKey()),
    owner_token_sso: isTwentySsoEnabled(),
    crm_provider: p.crm_provider,
    bound: p.twenty.bound,
    workspace_id: p.twenty.workspace_id,
    workspace_name: p.twenty.workspace_name,
    subdomain: p.twenty.subdomain || p.twenty.bind?.subdomain || null,
    objects: ['people', 'companies', 'opportunities (deals/leads)', 'notes', 'tasks'],
    note: isTwentySsoEnabled()
      ? 'REST tools mint workspace-scoped access tokens per company (not shared TWENTY_API_KEY).'
      : 'SSO off: REST tools may use platform TWENTY_API_KEY (single shared workspace).',
  };
}
