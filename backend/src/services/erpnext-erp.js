/**
 * ERPNext adapter — real Frappe REST API (token auth).
 * Documents: Customer, Lead, Item, Quotation, Sales Order, Project, ToDo, Department, Employee.
 * Multi-company site; Flolah company → ERPNext Company map (owner-scoped).
 */
import {
  assertErpEntitled,
  getBusinessProfile,
  setErpnextBind,
} from './company-business-profile.js';
import { getDb } from '../db/schema.js';
import { getUserById } from './users.js';
import { parseIsoLocation, erpnextCountryName } from '../lib/iso-country-region.js';

export function baseUrl() {
  return String(process.env.ERPNEXT_URL || '')
    .trim()
    .replace(/\/+$/, '');
}

function apiKey() {
  return String(process.env.ERPNEXT_API_KEY || '').trim();
}

function apiSecret() {
  return String(process.env.ERPNEXT_API_SECRET || '').trim();
}

function parseJsonSafe(raw, fallback) {
  try {
    const v = JSON.parse(raw || '');
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function resolveErpnextCountryName(ownerUserId) {
  const envFallback =
    String(process.env.ERPNEXT_DEFAULT_COUNTRY || 'United States').trim() || 'United States';
  try {
    const user = getUserById(ownerUserId);
    const fromUser = parseIsoLocation(user?.country, user?.region);
    const named = erpnextCountryName(fromUser.country);
    if (named) return named;
  } catch (e) {
    console.warn('[erpnext] country from profile', e?.message || e);
  }
  try {
    const row = getDb()
      .prepare(`SELECT strategic_profile_json FROM ceo_org_strategy WHERE owner_user_id = ?`)
      .get(ownerUserId);
    const strategic = parseJsonSafe(row?.strategic_profile_json, {});
    const fromCo = parseIsoLocation(strategic.country, strategic.region);
    const named = erpnextCountryName(fromCo.country);
    if (named) return named;
  } catch (e) {
    console.warn('[erpnext] country from company setup', e?.message || e);
  }
  return envFallback;
}

/** Match Company default_currency to country so invoices and Debtors use the same currency. */
const ERPNEXT_CURRENCY_BY_COUNTRY = {
  Singapore: 'SGD',
  'United States': 'USD',
  'United Kingdom': 'GBP',
  India: 'INR',
  Australia: 'AUD',
  Canada: 'CAD',
  'New Zealand': 'NZD',
  'United Arab Emirates': 'AED',
  Malaysia: 'MYR',
  Indonesia: 'IDR',
  China: 'CNY',
  Japan: 'JPY',
  'Hong Kong': 'HKD',
  Germany: 'EUR',
  France: 'EUR',
  Netherlands: 'EUR',
  Ireland: 'EUR',
};

function resolveErpnextCurrency(ownerUserId) {
  const country = resolveErpnextCountryName(ownerUserId);
  if (ERPNEXT_CURRENCY_BY_COUNTRY[country]) return ERPNEXT_CURRENCY_BY_COUNTRY[country];
  return String(process.env.ERPNEXT_DEFAULT_CURRENCY || 'USD').trim() || 'USD';
}

export function isErpnextApiConfigured() {
  return Boolean(baseUrl() && apiKey() && apiSecret());
}

export async function frappeFetch(path, { method = 'GET', body, form = false } = {}) {
  const root = baseUrl();
  if (!root) {
    const err = new Error('ERPNEXT_URL is not configured');
    err.status = 503;
    throw err;
  }
  if (!apiKey() || !apiSecret()) {
    const err = new Error('ERPNEXT_API_KEY / ERPNEXT_API_SECRET required');
    err.status = 503;
    throw err;
  }
  // Prefer ERPNEXT_URL that routes through erpnext-frontend nginx (site header),
  // not bare gunicorn hostname — Node fetch ignores custom Host, so site resolution
  // would use the URL hostname and 404 "erpnext-backend does not exist".
  const headers = {
    Accept: 'application/json',
    Authorization: `token ${apiKey()}:${apiSecret()}`,
  };
  let payload;
  if (body != null) {
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload =
        typeof body === 'string'
          ? body
          : new URLSearchParams(
              Object.fromEntries(
                Object.entries(body).map(([k, v]) => [k, v == null ? '' : String(v)])
              )
            ).toString();
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const url = `${root}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers,
    body: payload,
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
    // Prefer Frappe _server_messages (validation) over raw traceback noise
    let msg = data?.message || data?.exc || data?.error || `ERPNext HTTP ${res.status}`;
    try {
      const sm = data?._server_messages;
      if (sm) {
        const arr = typeof sm === 'string' ? JSON.parse(sm) : sm;
        const parts = (Array.isArray(arr) ? arr : [arr]).map((x) => {
          try {
            const o = typeof x === 'string' ? JSON.parse(x) : x;
            return o?.message || o?.title || String(x);
          } catch {
            return String(x);
          }
        });
        if (parts.filter(Boolean).length) msg = parts.join('; ');
      }
    } catch (_) {}
    if (Array.isArray(msg)) msg = msg.join('; ');
    const err = new Error(String(msg).slice(0, 500));
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }
  return data;
}

function companyFilter(ownerUserId) {
  const p = getBusinessProfile(ownerUserId);
  return p.erpnext.company_name || p.erpnext.company_id || null;
}

/**
 * Doctypes that must never be agent/MCP accessible via site API key.
 * Site-wide ERPNEXT_API_KEY bypasses desk User Permission — without this denylist
 * any CEO's Maker can list other tenants' SSO User rows (cross-tenant leak).
 *
 * Note: Company / Account / Fiscal Year are NOT site-wide blocked — they use
 * owner-company assertion (OWN_COMPANY_DOC / company-scoped filters) so Makers
 * can set up company + fiscal years equal to the CEO desk user's company scope.
 */
const ERP_BLOCKED_DOCTYPES = new Set(
  [
    'User',
    'User Permission',
    'Role',
    'Has Role',
    'Role Profile',
    'Role Permission for Page and Report',
    'Custom Role',
    'DocPerm',
    'Custom DocPerm',
    'DocType',
    'Custom Field',
    'Property Setter',
    'Module Def',
    'Installed Application',
    'API Request Log',
    'Activity Log',
    'Access Log',
    'Error Log',
    'Scheduled Job Type',
    'System Settings',
    'Website Settings',
    'Email Account',
    'Email Domain',
    'Connected App',
    'OAuth Bearer Token',
    'OAuth Client',
    'Integration Request',
    'Google Settings',
    'LDAP Settings',
    'Social Login Key',
    'Token Cache',
    'Sessions',
    'User Type',
    'User Document Type',
    'User Email',
    'User Social Login',
  ].map((x) => x.toLowerCase())
);

/** Operational allowlist for generic erp_*_resource tools (named tools still go through erpList). */
const ERP_RESOURCE_ALLOWLIST = new Set(
  [
    // Company setup (own company only — see assertOwnCompanyDoc)
    'Company',
    'Fiscal Year',
    'Account',
    'Cost Center',
    'Warehouse',
    'Bank Account',
    'Mode of Payment',
    'Payment Terms Template',
    'Terms and Conditions',
    'Tax Category',
    'Sales Taxes and Charges Template',
    'Purchase Taxes and Charges Template',
    'Currency Exchange',
    'Budget',
    // CRM / sales / ops
    'Customer',
    'Lead',
    'Contact',
    'Address',
    'Opportunity',
    'Item',
    'Item Group',
    'Item Price',
    'Quotation',
    'Sales Order',
    'Sales Invoice',
    'Delivery Note',
    'Purchase Order',
    'Purchase Invoice',
    'Payment Entry',
    'Payment Request',
    'Journal Entry',
    'Material Request',
    'Stock Entry',
    'Project',
    'Task',
    'Timesheet',
    'Department',
    'Employee',
    'GL Entry',
    'Supplier',
    'BOM',
    'Work Order',
    'ToDo',
    'Note',
    'File',
  ].map((x) => x.toLowerCase())
);

/** Frappe doctypes with a built-in top-level Link `company` (transactions / org tree). */
const NATIVE_COMPANY_FIELD_DOCTYPES = new Set(
  [
    'Opportunity',
    'Quotation',
    'Sales Order',
    'Sales Invoice',
    'Delivery Note',
    'Purchase Order',
    'Purchase Invoice',
    'Payment Entry',
    'Payment Request',
    'Project',
    'Task',
    'Timesheet',
    'Department',
    'Employee',
    'GL Entry',
    'Journal Entry',
    'Stock Entry',
    'Material Request',
    'Cost Center',
    'Warehouse',
    'BOM',
    'Work Order',
    'Account',
    'Bank Account',
    'Budget',
    'Sales Taxes and Charges Template',
    'Purchase Taxes and Charges Template',
  ].map((x) => x.toLowerCase())
);

/**
 * Global masters (no reliable native company Link). Flolah adds Link field
 * `flolah_company` → Company so desk Company User Permission + agent filters align.
 * Opportunity listed here too so CRM parties stay tenant-tagged on create even if native company exists.
 */
const TENANT_TAG_DOCTYPES = new Set(
  [
    'Customer',
    'Supplier',
    'Lead',
    'Contact',
    'Address',
    'Item',
    'Item Price',
    'Opportunity',
  ].map((x) => x.toLowerCase())
);

/** @deprecated name kept for greps — union of native company + tenant-tag masters */
const COMPANY_SCOPED_DOCTYPES = new Set([
  ...NATIVE_COMPANY_FIELD_DOCTYPES,
  ...TENANT_TAG_DOCTYPES,
]);

/** Custom field name (Link Company). Must not set ignore_user_permissions. */
export const FLOLAH_TENANT_COMPANY_FIELD = 'flolah_company';

let _tenantSchemaReady = false;
let _tenantSchemaPromise = null;
let _tenantBackfillDone = false;

function needsTenantTag(dt) {
  return TENANT_TAG_DOCTYPES.has(doctypeKey(dt));
}

function needsNativeCompany(dt) {
  return NATIVE_COMPANY_FIELD_DOCTYPES.has(doctypeKey(dt));
}

function needsAnyCompanyScope(dt) {
  return needsTenantTag(dt) || needsNativeCompany(dt);
}

/** Read tenant company from a Frappe doc (tag field preferred). */
export function getDocTenantCompany(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const v = doc[FLOLAH_TENANT_COMPANY_FIELD] ?? doc.company;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

function docMatchesBoundCompany(doc, company) {
  const bound = String(company || '').trim().toLowerCase();
  if (!bound) return false;
  const v = getDocTenantCompany(doc);
  if (!v) return false;
  return v.toLowerCase() === bound;
}

/**
 * Ensure Custom Field flolah_company (Link → Company) on global masters.
 * Company User Permission then applies on desk like Sales Invoice.company.
 */
export async function ensureErpnextTenantIsolationSchema() {
  if (_tenantSchemaReady) return { ok: true, cached: true };
  if (_tenantSchemaPromise) return _tenantSchemaPromise;
  _tenantSchemaPromise = (async () => {
    if (!isErpnextApiConfigured()) {
      return { ok: false, reason: 'not_configured' };
    }
    const doctypes = [
      { dt: 'Customer', after: 'customer_name' },
      { dt: 'Supplier', after: 'supplier_name' },
      { dt: 'Lead', after: 'lead_name' },
      { dt: 'Contact', after: 'first_name' },
      { dt: 'Address', after: 'address_title' },
      { dt: 'Item', after: 'item_name' },
      { dt: 'Item Price', after: 'item_code' },
      { dt: 'Opportunity', after: 'party_name' },
    ];
    const created = [];
    const errors = [];
    for (const { dt, after } of doctypes) {
      try {
        const listed = await frappeFetch(
          '/api/resource/Custom%20Field?filters=' +
            encodeURIComponent(
              JSON.stringify([
                ['dt', '=', dt],
                ['fieldname', '=', FLOLAH_TENANT_COMPANY_FIELD],
              ])
            ) +
            '&limit_page_length=1'
        );
        if (Array.isArray(listed?.data) && listed.data.length) continue;
        await frappeFetch('/api/resource/Custom%20Field', {
          method: 'POST',
          body: {
            dt,
            fieldname: FLOLAH_TENANT_COMPANY_FIELD,
            label: 'Company (Flolah tenant)',
            fieldtype: 'Link',
            options: 'Company',
            reqd: 0,
            in_list_view: 1,
            in_standard_filter: 1,
            insert_after: after,
            // Crucial: leave ignore_user_permissions unset/0 so Company UP applies
            description:
              'Flolah multi-tenant isolation: bound ERP Company. Desk User Permission (Company) filters this field.',
          },
        });
        created.push(dt);
      } catch (e) {
        if (/exists|duplicate|UniqueValidation/i.test(String(e.message || e))) continue;
        errors.push(`${dt}: ${String(e.message || e).slice(0, 120)}`);
        console.warn('[erpnext-tenant] custom field', dt, e.message || e);
      }
    }
    try {
      await frappeFetch('/api/method/frappe.clear_cache', { method: 'POST', body: {} });
    } catch (_) {
      /* optional */
    }
    // Strict UP: empty company Link does not match → hide untagged global masters on desk
    if (String(process.env.ERPNEXT_STRICT_USER_PERMISSIONS || '1') !== '0') {
      try {
        await frappeFetch('/api/resource/System%20Settings/System%20Settings', {
          method: 'PUT',
          body: { apply_strict_user_permissions: 1 },
        });
      } catch (e) {
        console.warn('[erpnext-tenant] strict user permissions', e.message || e);
      }
    }
    console.info(
      '[erpnext-tenant] isolation schema ready created=%s errors=%s',
      created.join(',') || 'none',
      errors.length
    );
    _tenantSchemaReady = true;
    return { ok: true, created, errors };
  })().finally(() => {
    _tenantSchemaPromise = null;
  });
  return _tenantSchemaPromise;
}

/**
 * Backfill flolah_company on existing global masters (owner SSO email → company, then name match).
 */
export async function backfillErpnextTenantCompanyTags() {
  if (!isErpnextApiConfigured()) return { ok: false, reason: 'not_configured' };
  if (_tenantBackfillDone) return { ok: true, cached: true };
  await ensureErpnextTenantIsolationSchema();

  const ownerToCompany = new Map();
  const companyNames = [];
  try {
    const { getDb } = await import('../db/schema.js');
    const rows = getDb()
      .prepare(
        `SELECT owner_user_id, erpnext_company_name, erpnext_company_id, erpnext_bind_json
         FROM company_business_profiles
         WHERE LOWER(COALESCE(crm_provider,'')) = 'erpnext'
            OR LOWER(COALESCE(erp_provider,'')) = 'erpnext'`
      )
      .all();
    for (const r of rows) {
      const co = String(r.erpnext_company_name || r.erpnext_company_id || '').trim();
      if (!co || co.startsWith('flolah-co-')) continue;
      companyNames.push(co);
      let email = null;
      try {
        const bind = r.erpnext_bind_json ? JSON.parse(r.erpnext_bind_json) : {};
        email = bind.sso_email || bind.sso_user || null;
      } catch (_) {}
      if (email) ownerToCompany.set(String(email).toLowerCase(), co);
    }
  } catch (e) {
    console.warn('[erpnext-tenant] backfill owner map', e.message || e);
  }
  companyNames.sort((a, b) => b.length - a.length);

  function inferCompany(doc) {
    const owner = String(doc.owner || '').toLowerCase();
    if (owner && ownerToCompany.has(owner)) return ownerToCompany.get(owner);
    const blob = `${doc.name || ''} ${doc.customer_name || ''} ${doc.supplier_name || ''} ${doc.lead_name || ''} ${doc.item_name || ''}`.toLowerCase();
    for (const co of companyNames) {
      if (blob.includes(String(co).toLowerCase())) return co;
    }
    return null;
  }

  const masters = ['Customer', 'Supplier', 'Lead', 'Contact', 'Address', 'Item', 'Item Price', 'Opportunity'];
  const stats = { updated: 0, skipped: 0, errors: 0, unmapped: 0 };

  for (const dt of masters) {
    try {
      const listed = await frappeFetch(
        `/api/resource/${encodeURIComponent(dt)}?` +
          new URLSearchParams({
            limit_page_length: '200',
            fields: JSON.stringify(['name', 'owner', FLOLAH_TENANT_COMPANY_FIELD]),
          }).toString()
      );
      const rows = Array.isArray(listed?.data) ? listed.data : [];
      for (const row of rows) {
        if (row[FLOLAH_TENANT_COMPANY_FIELD]) {
          stats.skipped += 1;
          continue;
        }
        // Prefer full doc for owner
        let doc = row;
        try {
          const full = await frappeFetch(
            `/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(row.name)}`
          );
          doc = full?.data || row;
        } catch (_) {}
        if (doc[FLOLAH_TENANT_COMPANY_FIELD]) {
          stats.skipped += 1;
          continue;
        }
        const co = inferCompany(doc);
        if (!co) {
          stats.unmapped += 1;
          continue;
        }
        try {
          await frappeFetch(
            `/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(doc.name)}`,
            { method: 'PUT', body: { [FLOLAH_TENANT_COMPANY_FIELD]: co } }
          );
          stats.updated += 1;
        } catch (e) {
          stats.errors += 1;
          console.warn('[erpnext-tenant] backfill put', dt, doc.name, e.message || e);
        }
      }
    } catch (e) {
      console.warn('[erpnext-tenant] backfill list', dt, e.message || e);
      stats.errors += 1;
    }
  }
  console.info('[erpnext-tenant] backfill', JSON.stringify(stats));
  // Only cache success so a failed field list does not skip later repair
  if (stats.errors === 0 || stats.updated > 0 || stats.skipped > 0) {
    _tenantBackfillDone = true;
  }
  return { ok: true, ...stats };
}

/** Stamp create/update body with tenant company for isolation. */
function applyTenantCompanyToBody(dt, body, company) {
  const co = String(company || '').trim();
  if (!co) return body;
  const out = { ...(body || {}) };
  if (needsTenantTag(dt)) {
    out[FLOLAH_TENANT_COMPANY_FIELD] = co;
    // Prefer not inventing native `company` on masters that don't have it (avoids Invalid field)
    // Opportunity may have both
    if (needsNativeCompany(dt) || doctypeKey(dt) === 'opportunity') {
      out.company = out.company || co;
    }
  } else if (needsNativeCompany(dt)) {
    out.company = co;
  } else if (doctypeKey(dt) !== 'fiscal year' && !out.company) {
    // best-effort for other allowlisted docs
    out.company = co;
  }
  return out;
}

/** Server-side force after Frappe fetch: reject or strip wrong company. */
function assertTenantAccess(ownerUserId, doc, dt) {
  if (!needsAnyCompanyScope(dt) && doctypeKey(dt) !== 'company') return;
  const co = companyFilter(ownerUserId);
  if (!co) return;
  if (isCompanyNamedDoctype(dt)) {
    assertDocBelongsToOwner(ownerUserId, doc, { doctype: dt });
    return;
  }
  if (doctypeKey(dt) === 'fiscal year') return; // separate path
  const v = getDocTenantCompany(doc);
  if (!v) {
    // Untagged legacy: deny for agents (same entitlements as strict company tenant)
    const err = new Error(
      `ERP document is not tagged to your company (missing ${FLOLAH_TENANT_COMPANY_FIELD}/company). Re-create or ask admin to tag under ${co}.`
    );
    err.status = 403;
    throw err;
  }
  if (v.toLowerCase() !== String(co).toLowerCase()) {
    const err = new Error('Document belongs to another company (not accessible)');
    err.status = 403;
    throw err;
  }
}

/** Singleton/setup docs keyed by bound company name (not free list-all). */
function isCompanyNamedDoctype(dt) {
  return doctypeKey(dt) === 'company';
}

function normalizeDoctype(doctype) {
  return String(doctype || '').trim();
}

function doctypeKey(dt) {
  return normalizeDoctype(dt).toLowerCase();
}

function denyBlockedDoctype(dt) {
  if (ERP_BLOCKED_DOCTYPES.has(doctypeKey(dt))) {
    const err = new Error(
      `ERP doctype "${dt}" is blocked for agent/MCP tools (tenant isolation). Use company-scoped business tools only.`
    );
    err.status = 403;
    throw err;
  }
}

function requireResourceAllowlist(dt, { genericResource = false } = {}) {
  denyBlockedDoctype(dt);
  if (genericResource && !ERP_RESOURCE_ALLOWLIST.has(doctypeKey(dt))) {
    const err = new Error(
      `ERP doctype "${dt}" is not on the operational allowlist for list/get/create/update resource tools.`
    );
    err.status = 403;
    throw err;
  }
}

function requireBoundCompany(ownerUserId) {
  const co = companyFilter(ownerUserId);
  if (!co) {
    const err = new Error(
      'ERP company is not bound for this owner — cannot run live ERP list/mutate until company is provisioned.'
    );
    err.status = 409;
    throw err;
  }
  return co;
}

/**
 * When a document has a company field, it must match this owner's bound company.
 * Company doctype itself: name must equal bound company.
 * Fiscal Year: companies child table must include bound company when present.
 */
function assertDocBelongsToOwner(ownerUserId, doc, { doctype } = {}) {
  if (!doc || typeof doc !== 'object') return;
  const co = companyFilter(ownerUserId);
  if (!co) return;
  const dt = doctypeKey(doctype);

  if (dt === 'company') {
    const nm = String(doc.name || '').trim();
    if (nm && nm.toLowerCase() !== String(co).toLowerCase()) {
      const err = new Error('Document is another company (not accessible)');
      err.status = 403;
      throw err;
    }
    return;
  }

  if (dt === 'fiscal year') {
    const rows = Array.isArray(doc.companies) ? doc.companies : [];
    if (rows.length) {
      const ok = rows.some(
        (r) => String(r.company || r).toLowerCase() === String(co).toLowerCase()
      );
      if (!ok) {
        const err = new Error('Fiscal Year is not linked to your company');
        err.status = 403;
        throw err;
      }
    }
    return;
  }

  // Prefer Flolah tenant tag, then native company
  const docCo = getDocTenantCompany(doc);
  if (!docCo) {
    if (needsAnyCompanyScope(doctype)) {
      const err = new Error(
        `Document is not tagged to a company (${FLOLAH_TENANT_COMPANY_FIELD}/company missing)`
      );
      err.status = 403;
      throw err;
    }
    return;
  }
  if (docCo.toLowerCase() !== String(co).toLowerCase()) {
    console.warn(
      '[erpnext-erp] company isolation reject owner=%s doctype=%s doc.company=%s bound=%s',
      String(ownerUserId).slice(0, 24),
      doctype || '?',
      docCo.slice(0, 64),
      String(co).slice(0, 64)
    );
    const err = new Error('Document belongs to another company (not accessible)');
    err.status = 403;
    throw err;
  }
}

function lim(n, d = 20) {
  return Math.min(100, Math.max(1, Number(n) || d));
}

/**
 * List doctype rows: GET /api/resource/{Doctype}?limit_page_length=
 * @param {{ genericResource?: boolean }} opts — set genericResource for erp_list_resource (strict allowlist)
 */
export async function erpList(ownerUserId, doctype, { limit = 20, filters, fields, genericResource = false } = {}) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    return {
      mode: 'offline',
      doctype,
      data: [],
      message: 'ERPNEXT_URL / API keys not configured',
      company: companyFilter(ownerUserId),
    };
  }
  const dt = normalizeDoctype(doctype);
  if (!dt) throw Object.assign(new Error('doctype required'), { status: 400 });
  requireResourceAllowlist(dt, { genericResource });
  const co = requireBoundCompany(ownerUserId);

  // Company: never site-wide list — return only the bound company for this CEO
  if (isCompanyNamedDoctype(dt)) {
    try {
      const one = await erpGet(ownerUserId, 'Company', co, { genericResource: true });
      const row = one?.data || { name: co };
      return { mode: 'live', doctype: dt, data: [row], company: co, count: 1 };
    } catch (e) {
      return {
        mode: 'live',
        doctype: dt,
        data: [{ name: co, company_name: co, note: 'bound in Flolah; desk fetch failed: ' + (e.message || e) }],
        company: co,
        count: 1,
      };
    }
  }

  // Fiscal Year: never return peer companies / creator emails via generic list
  if (doctypeKey(dt) === 'fiscal year') {
    return erpListFiscalYears(ownerUserId, { limit, fields });
  }

  if (needsTenantTag(dt) || needsNativeCompany(dt)) {
    try {
      await ensureErpnextTenantIsolationSchema();
    } catch (_) {
      /* continue; filters still applied */
    }
  }

  const params = new URLSearchParams();
  params.set('limit_page_length', String(lim(limit)));
  // Always request tenant fields so post-filter works when Frappe ignores unknown filters poorly
  let fieldList = fields;
  if (needsAnyCompanyScope(dt)) {
    const base = Array.isArray(fields) ? fields.map(String) : ['name', 'owner', 'modified'];
    // Only request flolah_company on doctypes that actually have the custom field.
    // Requesting it on native-company doctypes (Quotation, Warehouse, Account, …)
    // fails Frappe with "Field not permitted in query: flolah_company".
    if (needsTenantTag(dt) && !base.includes(FLOLAH_TENANT_COMPANY_FIELD)) {
      base.push(FLOLAH_TENANT_COMPANY_FIELD);
    }
    // Only request native `company` when the doctype actually has it
    fieldList = base.filter((f) => {
      if (String(f).toLowerCase() === 'company') {
        return needsNativeCompany(dt) || doctypeKey(dt) === 'opportunity';
      }
      if (String(f).toLowerCase() === FLOLAH_TENANT_COMPANY_FIELD) {
        return needsTenantTag(dt);
      }
      return true;
    });
    if (
      (needsNativeCompany(dt) || doctypeKey(dt) === 'opportunity') &&
      !fieldList.some((f) => String(f).toLowerCase() === 'company')
    ) {
      fieldList.push('company');
    }
  }
  if (fieldList) params.set('fields', JSON.stringify(fieldList));
  const f = Array.isArray(filters) ? [...filters] : [];
  // Strip client attempts to widen company scope
  const stripped = f.filter(
    (x) =>
      !(
        Array.isArray(x) &&
        (String(x[0]).toLowerCase() === 'company' ||
          String(x[0]).toLowerCase() === FLOLAH_TENANT_COMPANY_FIELD)
      )
  );
  if (needsTenantTag(dt)) {
    stripped.push([FLOLAH_TENANT_COMPANY_FIELD, '=', co]);
  } else if (needsNativeCompany(dt) || COMPANY_SCOPED_DOCTYPES.has(doctypeKey(dt))) {
    stripped.push(['company', '=', co]);
  }
  if (stripped.length) params.set('filters', JSON.stringify(stripped));
  try {
    const data = await frappeFetch(`/api/resource/${encodeURIComponent(dt)}?${params}`);
    let rows = Array.isArray(data?.data) ? data.data : [];
    // Hard post-filter — never return untagged or foreign-tenant rows (agents inherit CEO binding)
    if (needsAnyCompanyScope(dt)) {
      rows = rows.filter((row) => docMatchesBoundCompany(row, co));
    }
    return {
      mode: 'live',
      doctype: dt,
      data: rows,
      company: co,
      count: rows.length,
    };
  } catch (e) {
    if (e.status === 403 || e.status === 409) throw e;
    // Fallback: list without invalid filter field, post-filter in process
    if (needsTenantTag(dt) && /flolah_company|unknown field|invalid/i.test(String(e.message || e))) {
      try {
        await ensureErpnextTenantIsolationSchema();
        const data2 = await frappeFetch(
          `/api/resource/${encodeURIComponent(dt)}?` +
            new URLSearchParams({
              limit_page_length: String(lim(Math.max(limit, 50))),
              fields: JSON.stringify(
                fieldList || ['name', FLOLAH_TENANT_COMPANY_FIELD, 'company', 'owner']
              ),
            }).toString()
        );
        let rows = Array.isArray(data2?.data) ? data2.data : [];
        rows = rows.filter((row) => docMatchesBoundCompany(row, co));
        return {
          mode: 'live',
          doctype: dt,
          data: rows.slice(0, lim(limit)),
          company: co,
          count: Math.min(rows.length, lim(limit)),
          note: 'Listed with post-filter after schema ensure',
        };
      } catch (e2) {
        return { mode: 'error', doctype: dt, data: [], error: e2.message, company: co };
      }
    }
    return { mode: 'error', doctype: dt, data: [], error: e.message, company: co };
  }
}

export async function erpCreate(ownerUserId, doctype, doc = {}, { genericResource = false } = {}) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = normalizeDoctype(doctype);
  if (!dt) throw Object.assign(new Error('doctype required'), { status: 400 });
  requireResourceAllowlist(dt, { genericResource });
  const co = requireBoundCompany(ownerUserId);
  if (isCompanyNamedDoctype(dt)) {
    throw Object.assign(
      new Error('Cannot create another Company via tools — use the bound Flolah company only (erp_get_company / erp_update_company).'),
      { status: 403 }
    );
  }
  if (needsTenantTag(dt)) {
    try {
      await ensureErpnextTenantIsolationSchema();
    } catch (_) {}
  }
  let body = applyTenantCompanyToBody(dt, doc || {}, co);
  // Fiscal Year: ensure companies child includes bound company
  if (doctypeKey(dt) === 'fiscal year') {
    const companies = Array.isArray(body.companies) ? [...body.companies] : [];
    const has = companies.some(
      (r) => String(r?.company || r).toLowerCase() === String(co).toLowerCase()
    );
    if (!has) companies.push({ company: co });
    body.companies = companies;
  }
  // Never allow client override to peer company
  if (needsTenantTag(dt)) body[FLOLAH_TENANT_COMPANY_FIELD] = co;
  if (needsNativeCompany(dt)) body.company = co;
  if (needsTenantTag(dt) && !needsNativeCompany(dt) && doctypeKey(dt) !== 'opportunity') {
    delete body.company;
  }

  const data = await frappeFetch(`/api/resource/${encodeURIComponent(dt)}`, {
    method: 'POST',
    body,
  });
  let outDoc = data?.data || data;
  if (doctypeKey(dt) === 'fiscal year') {
    outDoc = redactFiscalYearForOwner(outDoc, co);
  } else {
    assertDocBelongsToOwner(ownerUserId, outDoc, { doctype: dt });
  }
  return { mode: 'live', doctype: dt, data: outDoc, company: co };
}

export async function erpGet(ownerUserId, doctype, name, { genericResource = false } = {}) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = normalizeDoctype(doctype);
  let nm = String(name || '').trim();
  if (!dt) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  requireResourceAllowlist(dt, { genericResource });
  const co = requireBoundCompany(ownerUserId);
  if (isCompanyNamedDoctype(dt)) {
    nm = nm || co;
    if (nm.toLowerCase() !== String(co).toLowerCase()) {
      throw Object.assign(new Error('Only your bound company is readable'), { status: 403 });
    }
  }
  if (!nm) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  const data = await frappeFetch(
    `/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(nm)}`
  );
  const doc = data?.data || data;
  assertDocBelongsToOwner(ownerUserId, doc, { doctype: dt });
  const safe =
    doctypeKey(dt) === 'fiscal year' ? redactFiscalYearForOwner(doc, co) : doc;
  return { mode: 'live', doctype: dt, data: safe, company: co };
}

/** Explicit company helpers for Makers (equal to desk company scope). */
export async function erpGetCompany(ownerUserId) {
  const co = requireBoundCompany(ownerUserId);
  return erpGet(ownerUserId, 'Company', co, { genericResource: true });
}

export async function erpUpdateCompany(ownerUserId, fields = {}) {
  const co = requireBoundCompany(ownerUserId);
  const body = { ...(fields || {}) };
  delete body.name;
  delete body.abbr;
  delete body.company_name;
  return erpUpdate(ownerUserId, 'Company', co, body, { genericResource: true });
}

/**
 * ERPNext Fiscal Year is **site-global** (unique name like "2026"), not a company-owned parent doc.
 * Companies join via child table `companies` [{ company }]. Other tenants' company names and
 * foreign owner emails must NEVER leave Flolah tool responses (entitlement isolation).
 */
function fiscalYearHasCompany(doc, company) {
  const co = String(company || '').toLowerCase();
  if (!co) return false;
  const rows = Array.isArray(doc?.companies) ? doc.companies : [];
  if (!rows.length) {
    // Empty child = legacy/global FY (all companies on site can use it) — treat as linked
    return true;
  }
  return rows.some((r) => String(r?.company || r || '').toLowerCase() === co);
}

/** Redact peer companies + foreign PII before any tool / MCP / agent sees the FY doc. */
function redactFiscalYearForOwner(doc, company) {
  if (!doc || typeof doc !== 'object') return doc;
  const co = String(company || '').trim();
  const coLower = co.toLowerCase();
  const rows = Array.isArray(doc.companies) ? doc.companies : [];
  const onlyMine = rows.filter((r) => String(r?.company || r || '').toLowerCase() === coLower);
  // If empty on server (legacy global), surface only this CEO's company so we never imply peer count
  const companies =
    onlyMine.length > 0
      ? onlyMine.map((r) =>
          typeof r === 'object'
            ? { company: r.company, doctype: r.doctype || 'Fiscal Year Company' }
            : { company: co }
        )
      : co
        ? [{ company: co }]
        : [];

  const out = {
    name: doc.name,
    year: doc.year ?? doc.name,
    year_start_date: doc.year_start_date,
    year_end_date: doc.year_end_date,
    disabled: doc.disabled ?? 0,
    is_short_year: doc.is_short_year,
    auto_created: doc.auto_created,
    doctype: 'Fiscal Year',
    companies,
    linked_for_company: co || null,
    // Never expose who else is linked or who first created (email of another CEO)
    peer_companies_visible: false,
  };
  return out;
}

async function erpGetFiscalYearDoc(yearName) {
  const data = await frappeFetch(
    `/api/resource/${encodeURIComponent('Fiscal Year')}/${encodeURIComponent(yearName)}`
  );
  return data?.data || data || null;
}

/**
 * Ensure bound company is on Fiscal Year.companies child.
 * Response data is redacted (own company only).
 */
export async function erpEnsureCompanyOnFiscalYear(ownerUserId, yearName) {
  assertErpEntitled(ownerUserId);
  const co = requireBoundCompany(ownerUserId);
  const year = String(yearName || '').trim();
  if (!year) {
    throw Object.assign(new Error('fiscal year name required'), { status: 400 });
  }
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const doc = await erpGetFiscalYearDoc(year);
  if (!doc) {
    throw Object.assign(new Error(`Fiscal Year ${year} not found`), { status: 404 });
  }
  if (fiscalYearHasCompany(doc, co) && Array.isArray(doc.companies) && doc.companies.length) {
    return {
      mode: 'live',
      action: 'already_linked',
      year,
      company: co,
      data: redactFiscalYearForOwner(doc, co),
      note: 'Your company is already linked to this Fiscal Year period.',
    };
  }
  // Preserve other companies on write server-side; never return them to the caller
  const companies = Array.isArray(doc.companies) ? [...doc.companies] : [];
  const has = companies.some((r) => String(r?.company || '').toLowerCase() === String(co).toLowerCase());
  if (!has) companies.push({ company: co });
  const updated = await frappeFetch(
    `/api/resource/${encodeURIComponent('Fiscal Year')}/${encodeURIComponent(year)}`,
    {
      method: 'PUT',
      body: { companies },
    }
  );
  const fresh = updated?.data || (await erpGetFiscalYearDoc(year)) || doc;
  return {
    mode: 'live',
    action: 'linked',
    year,
    company: co,
    data: redactFiscalYearForOwner(fresh, co),
    note: `Linked your company "${co}" to Fiscal Year "${year}".`,
  };
}

export async function erpListFiscalYears(ownerUserId, opts = {}) {
  assertErpEntitled(ownerUserId);
  const co = requireBoundCompany(ownerUserId);
  if (!isErpnextApiConfigured()) {
    return {
      mode: 'offline',
      doctype: 'Fiscal Year',
      data: [],
      company: co,
      note: 'Fiscal Year periods; responses show only your company linkage.',
    };
  }
  const limit = lim(opts.limit, 20);
  const fields = opts.fields || [
    'name',
    'year',
    'year_start_date',
    'year_end_date',
    'disabled',
  ];
  // Drop owner from client field requests (tenant PII)
  const safeFields = (Array.isArray(fields) ? fields : [])
    .map(String)
    .filter((f) => !/^(owner|modified_by|creation|modified)$/i.test(f));
  if (!safeFields.length) {
    safeFields.push('name', 'year', 'year_start_date', 'year_end_date', 'disabled');
  }
  const data = await frappeFetch(
    `/api/resource/${encodeURIComponent('Fiscal Year')}?` +
      new URLSearchParams({
        limit_page_length: String(limit),
        fields: JSON.stringify(safeFields),
      }).toString()
  );
  const rows = Array.isArray(data?.data) ? data.data : [];
  const enriched = [];
  for (const row of rows) {
    let full = row;
    try {
      full = (await erpGetFiscalYearDoc(row.name)) || row;
    } catch (_) {}
    if (!fiscalYearHasCompany(full, co)) continue;
    enriched.push(redactFiscalYearForOwner(full, co));
  }
  return {
    mode: 'live',
    doctype: 'Fiscal Year',
    data: enriched,
    company: co,
    count: enriched.length,
    note: 'Each row shows only your company link. Peer company names and creator emails are never returned.',
  };
}

/**
 * Create Fiscal Year + link bound company, or if year already exists, link company only.
 * Responses never include other companies or foreign owner emails.
 */
export async function erpCreateFiscalYear(ownerUserId, doc = {}) {
  assertErpEntitled(ownerUserId);
  const co = requireBoundCompany(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  if (!doc.year && !doc.name) {
    throw Object.assign(new Error('year (e.g. 2026) required for Fiscal Year'), { status: 400 });
  }
  const year = String(doc.year || doc.name).trim();
  const year_start_date = doc.year_start_date || `${String(year).slice(0, 4)}-01-01`;
  const year_end_date = doc.year_end_date || `${String(year).slice(0, 4)}-12-31`;

  try {
    const existing = await erpGetFiscalYearDoc(year);
    if (existing?.name) {
      const linked = await erpEnsureCompanyOnFiscalYear(ownerUserId, year);
      return {
        mode: 'live',
        doctype: 'Fiscal Year',
        action: linked.action === 'already_linked' ? 'already_exists_linked' : 'linked_existing',
        year,
        company: co,
        data: linked.data,
        note:
          `Fiscal Year "${year}" already exists for this accounting period. Your company "${co}" is linked. ` +
          `Year names are unique per ERP site; you never receive other companies' linkage data.`,
      };
    }
  } catch (e) {
    if (e.status && e.status !== 404 && !/not found|DoesNotExist|404/i.test(String(e.message || e))) {
      // continue to create on missing only
    }
  }

  try {
    const created = await erpCreate(
      ownerUserId,
      'Fiscal Year',
      {
        year,
        year_start_date,
        year_end_date,
        companies: [{ company: co }],
      },
      { genericResource: true }
    );
    return {
      mode: 'live',
      doctype: 'Fiscal Year',
      action: 'created',
      year,
      company: co,
      data: redactFiscalYearForOwner(created.data || created, co),
      note: `Created Fiscal Year "${year}" and linked your company "${co}".`,
    };
  } catch (e) {
    if (/already exists|DuplicateName/i.test(String(e.message || e))) {
      const linked = await erpEnsureCompanyOnFiscalYear(ownerUserId, year);
      return {
        mode: 'live',
        doctype: 'Fiscal Year',
        action: 'linked_existing',
        year,
        company: co,
        data: linked.data,
        note: `Fiscal Year "${year}" already existed; linked your company "${co}".`,
      };
    }
    throw e;
  }
}

// Convenience CRM-mirror surface on ERPNext
export async function erpListCustomers(ownerUserId, opts) {
  return erpList(ownerUserId, 'Customer', opts);
}
export async function erpListLeads(ownerUserId, opts) {
  return erpList(ownerUserId, 'Lead', opts);
}
export async function erpListItems(ownerUserId, opts) {
  return erpList(ownerUserId, 'Item', { ...opts, fields: opts?.fields || ['name', 'item_name', 'item_code', 'stock_uom'] });
}
export async function erpListQuotations(ownerUserId, opts) {
  return erpList(ownerUserId, 'Quotation', opts);
}
export async function erpListSalesOrders(ownerUserId, opts) {
  return erpList(ownerUserId, 'Sales Order', opts);
}
export async function erpListProjects(ownerUserId, opts) {
  return erpList(ownerUserId, 'Project', opts);
}
export async function erpListSalesInvoices(ownerUserId, opts) {
  return erpList(ownerUserId, 'Sales Invoice', opts);
}
export async function erpCreateSalesInvoice(ownerUserId, doc = {}) {
  const body = { ...(doc || {}) };
  if (!body.currency) {
    try {
      const co = await erpGetCompany(ownerUserId);
      const cur = String(co?.data?.default_currency || '').trim();
      if (cur) body.currency = cur;
    } catch (e) {
      console.warn('[erpnext] invoice currency from company', e?.message || e);
    }
  }
  return erpCreate(ownerUserId, 'Sales Invoice', body);
}
export async function erpListPurchaseInvoices(ownerUserId, opts) {
  return erpList(ownerUserId, 'Purchase Invoice', opts);
}
export async function erpCreatePurchaseInvoice(ownerUserId, doc = {}) {
  return erpCreate(ownerUserId, 'Purchase Invoice', doc);
}
export async function erpCreateProject(ownerUserId, doc = {}) {
  if (!doc.project_name && !doc.name) {
    throw Object.assign(new Error('project_name required'), { status: 400 });
  }
  return erpCreate(ownerUserId, 'Project', {
    project_name: doc.project_name || doc.name,
    status: doc.status || 'Open',
    ...doc,
  });
}
export async function erpListTasks(ownerUserId, opts) {
  return erpList(ownerUserId, 'Task', opts);
}
export async function erpCreateTask(ownerUserId, doc = {}) {
  if (!doc.subject) throw Object.assign(new Error('subject required'), { status: 400 });
  return erpCreate(ownerUserId, 'Task', doc);
}
export async function erpListGlEntries(ownerUserId, opts) {
  return erpList(ownerUserId, 'GL Entry', opts);
}

/**
 * Run ERPNext Profit and Loss Statement (company-scoped).
 * Uses frappe.desk.query_report.run when API is live.
 */
export async function erpProfitAndLoss(ownerUserId, {
  from_date,
  to_date,
  periodicity = 'Monthly',
  accumulated_values = 0,
} = {}) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    return {
      mode: 'offline',
      report: 'Profit and Loss Statement',
      message: 'ERPNEXT_URL / API keys not configured',
      company: companyFilter(ownerUserId),
    };
  }
  const co = requireBoundCompany(ownerUserId);
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  const d = String(today.getUTCDate()).padStart(2, '0');
  const end = to_date || `${y}-${m}-${d}`;
  const start = from_date || `${y}-01-01`;
  try {
    const data = await frappeFetch('/api/method/frappe.desk.query_report.run', {
      method: 'POST',
      body: {
        report_name: 'Profit and Loss Statement',
        filters: {
          company: co,
          from_date: start,
          to_date: end,
          periodicity,
          accumulated_values: accumulated_values ? 1 : 0,
        },
      },
    });
    return {
      mode: 'live',
      report: 'Profit and Loss Statement',
      company: co,
      from_date: start,
      to_date: end,
      data: data?.message || data,
    };
  } catch (e) {
    return {
      mode: 'error',
      report: 'Profit and Loss Statement',
      company: co,
      error: e.message,
    };
  }
}
export async function erpCreateCustomer(ownerUserId, { customer_name, customer_type = 'Company', ...rest } = {}) {
  if (!customer_name) throw Object.assign(new Error('customer_name required'), { status: 400 });
  return erpCreate(ownerUserId, 'Customer', { customer_name, customer_type, ...rest });
}
export async function erpCreateLead(ownerUserId, { lead_name, email_id, company_name, ...rest } = {}) {
  if (!lead_name) throw Object.assign(new Error('lead_name required'), { status: 400 });
  return erpCreate(ownerUserId, 'Lead', { lead_name, email_id, company_name, ...rest });
}


export async function erpUpdate(ownerUserId, doctype, name, fields = {}, { genericResource = false } = {}) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = normalizeDoctype(doctype);
  let nm = String(name || '').trim();
  if (!dt) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  requireResourceAllowlist(dt, { genericResource });
  const co = requireBoundCompany(ownerUserId);
  if (isCompanyNamedDoctype(dt)) {
    nm = nm || co;
    if (nm.toLowerCase() !== String(co).toLowerCase()) {
      throw Object.assign(new Error('Only your bound company can be updated'), { status: 403 });
    }
  }
  if (!nm) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  await erpGet(ownerUserId, dt, nm, { genericResource });
  let body = applyTenantCompanyToBody(dt, fields || {}, co);
  if (isCompanyNamedDoctype(dt)) {
    delete body.name;
    delete body.abbr;
  }
  // Force tenant — agents cannot reassign to peer company
  if (needsTenantTag(dt)) body[FLOLAH_TENANT_COMPANY_FIELD] = co;
  if (needsNativeCompany(dt)) body.company = co;
  // Fiscal Year: never accept a companies array from tools (would leak or wipe peers); merge link only
  if (doctypeKey(dt) === 'fiscal year') {
    delete body.companies;
    delete body.owner;
    delete body.modified_by;
  }
  // Masters without native company: drop invalid `company` key if not opportunity
  if (needsTenantTag(dt) && !needsNativeCompany(dt) && doctypeKey(dt) !== 'opportunity') {
    delete body.company;
  }
  const data = await frappeFetch(
    `/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(nm)}`,
    { method: 'PUT', body }
  );
  let outDoc = data?.data || data;
  if (doctypeKey(dt) === 'fiscal year') {
    outDoc = redactFiscalYearForOwner(outDoc, co);
  } else if (needsAnyCompanyScope(dt)) {
    assertDocBelongsToOwner(ownerUserId, outDoc, { doctype: dt });
  }
  return { mode: 'live', doctype: dt, name: nm, data: outDoc, company: co };
}

export async function erpSubmitDoc(ownerUserId, doctype, name) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = normalizeDoctype(doctype);
  const nm = String(name || '').trim();
  if (!dt || !nm) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  denyBlockedDoctype(dt);
  const full = await erpGet(ownerUserId, dt, nm);
  const doc = full?.data;
  if (!doc || typeof doc !== 'object') {
    throw Object.assign(new Error('document not found for submit'), { status: 404 });
  }
  const data = await frappeFetch('/api/method/frappe.client.submit', {
    method: 'POST',
    body: { doc },
  });
  return { mode: 'live', doctype: dt, name: nm, data: data?.message || data };
}

export async function erpCancelDoc(ownerUserId, doctype, name) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = normalizeDoctype(doctype);
  const nm = String(name || '').trim();
  if (!dt || !nm) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  denyBlockedDoctype(dt);
  // Ownership check
  await erpGet(ownerUserId, dt, nm);
  const data = await frappeFetch('/api/method/frappe.client.cancel', {
    method: 'POST',
    body: { doctype: dt, name: nm },
  });
  return { mode: 'live', doctype: dt, name: nm, data: data?.message || data };
}

export async function erpDelete(ownerUserId, doctype, name) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = normalizeDoctype(doctype);
  const nm = String(name || '').trim();
  if (!dt || !nm) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  denyBlockedDoctype(dt);
  await erpGet(ownerUserId, dt, nm);
  const data = await frappeFetch(
    `/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(nm)}`,
    { method: 'DELETE' }
  );
  console.info('[erpnext] delete doctype=%s name=%s owner=%s', dt, nm, ownerUserId);
  return { mode: 'live', deleted: true, doctype: dt, name: nm, data: data?.message || data || { ok: true } };
}

export async function erpCreateQuotation(ownerUserId, doc = {}) {
  return erpCreate(ownerUserId, 'Quotation', doc);
}
export async function erpCreateSalesOrder(ownerUserId, doc = {}) {
  return erpCreate(ownerUserId, 'Sales Order', doc);
}
export async function erpCreateItem(ownerUserId, doc = {}) {
  if (!doc.item_code && !doc.item_name) {
    throw Object.assign(new Error('item_code or item_name required'), { status: 400 });
  }
  return erpCreate(ownerUserId, 'Item', {
    item_code: doc.item_code || doc.item_name,
    item_name: doc.item_name || doc.item_code,
    item_group: doc.item_group || 'Products',
    stock_uom: doc.stock_uom || 'Nos',
    ...doc,
  });
}
export async function erpListOpportunities(ownerUserId, opts) {
  return erpList(ownerUserId, 'Opportunity', opts);
}
export async function erpCreateOpportunity(ownerUserId, doc = {}) {
  return erpCreate(ownerUserId, 'Opportunity', doc);
}
export async function erpListContacts(ownerUserId, opts) {
  return erpList(ownerUserId, 'Contact', opts);
}
export async function erpCreateContact(ownerUserId, doc = {}) {
  if (!doc.first_name && !doc.last_name && !doc.email_id) {
    throw Object.assign(new Error('first_name, last_name, or email_id required'), { status: 400 });
  }
  return erpCreate(ownerUserId, 'Contact', doc);
}
export async function erpListPurchaseOrders(ownerUserId, opts) {
  return erpList(ownerUserId, 'Purchase Order', opts);
}
export async function erpCreatePurchaseOrder(ownerUserId, doc = {}) {
  return erpCreate(ownerUserId, 'Purchase Order', doc);
}
export async function erpListPaymentEntries(ownerUserId, opts) {
  return erpList(ownerUserId, 'Payment Entry', opts);
}
export async function erpCreatePaymentEntry(ownerUserId, doc = {}) {
  return erpCreate(ownerUserId, 'Payment Entry', doc);
}
export async function erpListDeliveryNotes(ownerUserId, opts) {
  return erpList(ownerUserId, 'Delivery Note', opts);
}
export async function erpCreateDeliveryNote(ownerUserId, doc = {}) {
  return erpCreate(ownerUserId, 'Delivery Note', doc);
}
export async function erpListJournalEntries(ownerUserId, opts) {
  return erpList(ownerUserId, 'Journal Entry', opts);
}
export async function erpCreateJournalEntry(ownerUserId, doc = {}) {
  return erpCreate(ownerUserId, 'Journal Entry', doc);
}
export async function erpListMaterialRequests(ownerUserId, opts) {
  return erpList(ownerUserId, 'Material Request', opts);
}
export async function erpCreateMaterialRequest(ownerUserId, doc = {}) {
  return erpCreate(ownerUserId, 'Material Request', doc);
}

export async function ensureErpnextCompanyForOwner(ownerUserId, { displayName } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });

  const profile = assertErpEntitled(owner);
  if (!profile.uses_erpnext) {
    throw Object.assign(new Error('crm_provider or erp_provider must be erpnext'), { status: 400 });
  }

  if (profile.erpnext.company_id) {
    const id = String(profile.erpnext.company_id || '');
    const coName = String(profile.erpnext.company_name || '').trim();
    const isSynthetic = id.startsWith('flolah-co-');
    if (!(isSynthetic && isErpnextApiConfigured() && coName)) {
      if (isErpnextApiConfigured()) {
        try {
          await ensureErpnextTenantIsolationSchema();
          if (String(process.env.ERPNEXT_TENANT_BACKFILL || '1') !== '0') {
            await backfillErpnextTenantCompanyTags();
          }
        } catch (e) {
          console.warn('[erpnext] tenant isolation setup (existing)', owner, e?.message || e);
        }
      }
      return {
        company_id: profile.erpnext.company_id,
        company_name: profile.erpnext.company_name,
        created: false,
        mode: 'existing',
      };
    }
    // synthetic local bind — try remote resolve/create below using coName
    console.info('[erpnext] promote synthetic bind owner=%s name=%s', owner, coName);
  }

  const name =
    String(displayName || profile.erpnext.company_name || '').trim() ||
    `Flolah ${owner.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40) || 'Company'}`;

  const localCompanyId = `flolah-co-${owner}`.slice(0, 80);
  let remoteId = null;
  let mode = 'local_bind';

  if (isErpnextApiConfigured()) {
    try {
      // Fresh site often misses Warehouse Type fixtures; Company.on_update creates Transit warehouse.
      for (const wt of ['Transit', 'Stores', 'WIP', 'Finished Goods']) {
        try {
          await frappeFetch('/api/resource/Warehouse Type', { method: 'POST', body: { name: wt } });
        } catch (_) {
          /* exists */
        }
      }
      const abbrBase =
        name
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .slice(0, 5)
          .toUpperCase() || 'FL';
      // country is mandatory on ERPNext Company; missing it left CEOs on local_bind-only (no real Company doc).
      const country = resolveErpnextCountryName(owner);
      console.info('[erpnext] company country owner=%s country=%s currency=%s', owner, country, currency);
      const currency = resolveErpnextCurrency(owner);
      let data = null;
      let lastErr = null;
      for (let i = 0; i < 6; i++) {
        const abbr = i === 0 ? abbrBase : (abbrBase + String(i)).slice(0, 5);
        try {
          data = await frappeFetch('/api/resource/Company', {
            method: 'POST',
            body: {
              company_name: name,
              abbr,
              default_currency: currency,
              country,
            },
          });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          const msg = String(e?.message || e);
          if (/duplicate|already exists|UniqueValidation/i.test(msg)) {
            try {
              const existing = await frappeFetch(
                '/api/resource/Company/' + encodeURIComponent(name)
              );
              data = { data: existing?.data || { name } };
              lastErr = null;
              break;
            } catch (_) {
              /* retry abbr */
            }
          }
        }
      }
      if (!data) throw lastErr || new Error('Company create failed');
      remoteId = data?.data?.name || data?.name || null;
      if (remoteId) mode = 'remote';
    } catch (e) {
      console.warn('[erpnext] company create failed', owner, e?.message || e);
      mode = 'local_bind_fallback';
    }
  }

  const companyId = String(remoteId || localCompanyId);
  const prevBind =
    profile.erpnext && typeof profile.erpnext.bind === 'object' ? profile.erpnext.bind : {};
  setErpnextBind(owner, {
    company_id: companyId,
    company_name: name,
    bind: {
      ...prevBind,
      flolah_owner_user_id: owner,
      mode,
      created_at: prevBind.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO company_erpnext_user_map
         (owner_user_id, flolah_user_id, erpnext_user_id, erpnext_company_id, roles_json, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(owner_user_id, flolah_user_id, erpnext_company_id) DO UPDATE SET
         updated_at = datetime('now')`
    ).run(owner, owner, owner, companyId, JSON.stringify(['Sales Manager', 'Accounts Manager', 'Stock User']));
  } catch (e) {
    console.warn('[erpnext] user map', e?.message || e);
  }

  console.info('[erpnext] bound company owner=%s company=%s mode=%s', owner, companyId, mode);
  if (isErpnextApiConfigured()) {
    try {
      await ensureErpnextTenantIsolationSchema();
      if (String(process.env.ERPNEXT_TENANT_BACKFILL || '1') !== '0') {
        await backfillErpnextTenantCompanyTags();
      }
    } catch (e) {
      console.warn('[erpnext] tenant isolation setup', owner, e?.message || e);
    }
  }
  return {
    company_id: companyId,
    company_name: name,
    created: true,
    mode,
  };
}

export function getErpnextStatusForOwner(ownerUserId) {
  const p = getBusinessProfile(ownerUserId);
  return {
    configured: isErpnextApiConfigured(),
    crm_provider: p.crm_provider,
    erp_provider: p.erp_provider,
    uses_erpnext: p.uses_erpnext,
    bound: p.erpnext.bound,
    company_id: p.erpnext.company_id,
    company_name: p.erpnext.company_name,
    note:
      'Makers use company-scoped erp_* tools (API key) equal to CEO desk company. ' +
      'Global masters (Customer/Supplier/Lead/Item/…) tagged with flolah_company Link; Company User Permission enforces desk. ' +
      'Agents always filter/stamp that field — cannot list peer-tenant masters. Checker owns submit/cancel.',
    tenant_company_field: 'flolah_company',
    setup_objects: ['Company', 'Fiscal Year', 'Account', 'Cost Center', 'Warehouse', 'Bank Account'],
    objects: [
      'Company',
      'Fiscal Year',
      'Account',
      'Customer',
      'Lead',
      'Contact',
      'Opportunity',
      'Item',
      'Quotation',
      'Sales Order',
      'Delivery Note',
      'Sales Invoice',
      'Purchase Order',
      'Purchase Invoice',
      'Payment Entry',
      'Journal Entry',
      'Material Request',
      'Stock Entry',
      'Project',
      'Task',
      'GL Entry',
      'Department',
      'Employee',
      'Profit and Loss Statement',
    ],
  };
}

/** Live company + fiscal year snapshot for erp_status. */
export async function getErpnextStatusLive(ownerUserId) {
  const base = getErpnextStatusForOwner(ownerUserId);
  if (!base.configured || !base.bound) return base;
  try {
    const co = await erpGetCompany(ownerUserId);
    base.company_doc = {
      name: co?.data?.name,
      abbr: co?.data?.abbr,
      default_currency: co?.data?.default_currency,
      country: co?.data?.country,
    };
  } catch (e) {
    base.company_doc_error = e.message;
  }
  try {
    const fy = await erpListFiscalYears(ownerUserId, { limit: 10 });
    base.fiscal_years = (fy?.data || []).map((r) => r.name || r.year).filter(Boolean);
  } catch (e) {
    base.fiscal_years_error = e.message;
  }
  return base;
}