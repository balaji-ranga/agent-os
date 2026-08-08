/**
 * Twenty CRM adapter — real Core REST API against platform Twenty.
 * Objects: people, companies, opportunities (deals + leads via stage), notes, tasks.
 * One Flolah company → one Twenty workspace bind (owner-scoped).
 * Docs: https://twenty.com /rest/people, /rest/companies, /rest/opportunities
 */
import {
  getBusinessProfile,
  assertCrmEntitled,
  resolveTwentyWorkspaceForOwner,
} from './company-business-profile.js';
import { resolveCompanyDisplayName } from './business-embed.js';

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

async function twentyFetch(path, { method = 'GET', body, apiKey } = {}) {
  const root = baseUrl();
  if (!root) {
    const err = new Error('TWENTY_API_URL is not configured on the platform');
    err.status = 503;
    throw err;
  }
  const key = apiKey || platformApiKey();
  if (!key && method !== 'GET') {
    // still try GET for some public health; writes need key
  }
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (key) headers.Authorization = `Bearer ${key}`;
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
      data?.message || data?.error || data?.errors?.[0]?.message || `Twenty HTTP ${res.status}`;
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

function requireLive(workspaceId) {
  if (!isTwentyConfigured()) {
    return {
      offline: true,
      workspace_id: workspaceId,
      mode: 'offline',
      message: 'TWENTY_API_URL not set — bind only',
    };
  }
  if (!platformApiKey()) {
    return {
      offline: true,
      workspace_id: workspaceId,
      mode: 'no_api_key',
      message: 'TWENTY_API_KEY not set — open Twenty UI, create API key, set TWENTY_API_KEY on platform',
    };
  }
  return null;
}

export async function crmListPeople(ownerUserId, { limit = 25 } = {}) {
  const { workspaceId } = resolveTwentyWorkspaceForOwner(ownerUserId);
  const off = requireLive(workspaceId);
  if (off) return { ...off, people: [] };
  try {
    const data = await twentyFetch(`/rest/people?limit=${lim(limit)}`);
    return {
      workspace_id: workspaceId,
      mode: 'live',
      people: unwrapList(data, 'people'),
    };
  } catch (e) {
    return { workspace_id: workspaceId, mode: 'error', people: [], error: e.message };
  }
}

export async function crmCreatePerson(ownerUserId, { name, email, phone, companyId } = {}) {
  const { workspaceId } = resolveTwentyWorkspaceForOwner(ownerUserId);
  if (!isTwentyConfigured()) {
    throw Object.assign(new Error('TWENTY_API_URL not configured'), { status: 503 });
  }
  if (!platformApiKey()) {
    throw Object.assign(new Error('TWENTY_API_KEY not configured'), { status: 503 });
  }
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
  const data = await twentyFetch('/rest/people', { method: 'POST', body });
  return { workspace_id: workspaceId, mode: 'live', person: data?.data || data };
}

export async function crmListCompanies(ownerUserId, { limit = 25 } = {}) {
  const { workspaceId } = resolveTwentyWorkspaceForOwner(ownerUserId);
  const off = requireLive(workspaceId);
  if (off) return { ...off, companies: [] };
  try {
    const data = await twentyFetch(`/rest/companies?limit=${lim(limit)}`);
    return {
      workspace_id: workspaceId,
      mode: 'live',
      companies: unwrapList(data, 'companies'),
    };
  } catch (e) {
    return { workspace_id: workspaceId, mode: 'error', companies: [], error: e.message };
  }
}

export async function crmCreateCompany(ownerUserId, { name, domainUrl, employees } = {}) {
  const { workspaceId } = resolveTwentyWorkspaceForOwner(ownerUserId);
  if (!isTwentyConfigured() || !platformApiKey()) {
    throw Object.assign(new Error('TWENTY_API_URL / TWENTY_API_KEY required'), { status: 503 });
  }
  const body = { name: String(name || '').trim() };
  if (!body.name) throw Object.assign(new Error('name required'), { status: 400 });
  if (domainUrl) body.domainName = String(domainUrl).trim();
  if (employees != null) body.employees = Number(employees);
  const data = await twentyFetch('/rest/companies', { method: 'POST', body });
  return { workspace_id: workspaceId, mode: 'live', company: data?.data || data };
}

/** Deals = Twenty opportunities (pipeline). */
export async function crmListOpportunities(ownerUserId, { limit = 25, stage } = {}) {
  const { workspaceId } = resolveTwentyWorkspaceForOwner(ownerUserId);
  const off = requireLive(workspaceId);
  if (off) return { ...off, opportunities: [], deals: [] };
  try {
    let path = `/rest/opportunities?limit=${lim(limit)}`;
    if (stage) {
      path += `&filter[stage][eq]=${encodeURIComponent(String(stage))}`;
    }
    const data = await twentyFetch(path);
    const opportunities = unwrapList(data, 'opportunities');
    return {
      workspace_id: workspaceId,
      mode: 'live',
      opportunities,
      deals: opportunities,
    };
  } catch (e) {
    return {
      workspace_id: workspaceId,
      mode: 'error',
      opportunities: [],
      deals: [],
      error: e.message,
    };
  }
}

export async function crmCreateOpportunity(
  ownerUserId,
  { name, amount, currencyCode = 'USD', stage = 'NEW', companyId, closeDate, pointOfContactId } = {}
) {
  const { workspaceId } = resolveTwentyWorkspaceForOwner(ownerUserId);
  if (!isTwentyConfigured() || !platformApiKey()) {
    throw Object.assign(new Error('TWENTY_API_URL / TWENTY_API_KEY required'), { status: 503 });
  }
  const title = String(name || '').trim();
  if (!title) throw Object.assign(new Error('name required'), { status: 400 });
  const body = {
    name: title,
    stage: String(stage || 'NEW').toUpperCase(),
  };
  if (amount != null && amount !== '') {
    const n = Number(amount);
    // Twenty uses amountMicros
    body.amount = {
      amountMicros: Math.round(n * 1_000_000),
      currencyCode: String(currencyCode || 'USD'),
    };
  }
  if (companyId) body.companyId = companyId;
  if (pointOfContactId) body.pointOfContactId = pointOfContactId;
  if (closeDate) body.closeDate = closeDate;
  const data = await twentyFetch('/rest/opportunities', { method: 'POST', body });
  const opportunity = data?.data || data;
  return { workspace_id: workspaceId, mode: 'live', opportunity, deal: opportunity };
}

export async function crmUpdateOpportunity(ownerUserId, { id, patch } = {}) {
  const { workspaceId } = resolveTwentyWorkspaceForOwner(ownerUserId);
  if (!isTwentyConfigured() || !platformApiKey()) {
    throw Object.assign(new Error('TWENTY_API_URL / TWENTY_API_KEY required'), { status: 503 });
  }
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
  });
  return { workspace_id: workspaceId, mode: 'live', opportunity: data?.data || data };
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
  const { workspaceId } = resolveTwentyWorkspaceForOwner(ownerUserId);
  const off = requireLive(workspaceId);
  if (off) return { ...off, notes: [] };
  try {
    const data = await twentyFetch(`/rest/notes?limit=${lim(limit)}`);
    return { workspace_id: workspaceId, mode: 'live', notes: unwrapList(data, 'notes') };
  } catch (e) {
    return { workspace_id: workspaceId, mode: 'error', notes: [], error: e.message };
  }
}

export async function crmListTasks(ownerUserId, { limit = 25 } = {}) {
  const { workspaceId } = resolveTwentyWorkspaceForOwner(ownerUserId);
  const off = requireLive(workspaceId);
  if (off) return { ...off, tasks: [] };
  try {
    const data = await twentyFetch(`/rest/tasks?limit=${lim(limit)}`);
    return { workspace_id: workspaceId, mode: 'live', tasks: unwrapList(data, 'tasks') };
  } catch (e) {
    return { workspace_id: workspaceId, mode: 'error', tasks: [], error: e.message };
  }
}

export function getTwentyStatusForOwner(ownerUserId) {
  const p = getBusinessProfile(ownerUserId);
  return {
    configured: isTwentyConfigured(),
    api_key_set: Boolean(platformApiKey()),
    crm_provider: p.crm_provider,
    bound: p.twenty.bound,
    workspace_id: p.twenty.workspace_id,
    workspace_name: p.twenty.workspace_name,
    objects: ['people', 'companies', 'opportunities (deals/leads)', 'notes', 'tasks'],
  };
}
