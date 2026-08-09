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
    const msg = data?.message || data?.exc || data?.error || `ERPNext HTTP ${res.status}`;
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

function lim(n, d = 20) {
  return Math.min(100, Math.max(1, Number(n) || d));
}

/**
 * List doctype rows: GET /api/resource/{Doctype}?limit_page_length=
 */
export async function erpList(ownerUserId, doctype, { limit = 20, filters, fields } = {}) {
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
  const dt = String(doctype || '').trim();
  if (!dt) throw Object.assign(new Error('doctype required'), { status: 400 });
  const params = new URLSearchParams();
  params.set('limit_page_length', String(lim(limit)));
  if (fields) params.set('fields', JSON.stringify(fields));
  const f = Array.isArray(filters) ? [...filters] : [];
  const co = companyFilter(ownerUserId);
  // Company-scoped doctypes when company known and field usually exists
  const companyDocs = new Set([
    'Customer',
    'Contact',
    'Opportunity',
    'Quotation',
    'Sales Order',
    'Sales Invoice',
    'Delivery Note',
    'Purchase Order',
    'Purchase Invoice',
    'Payment Entry',
    'Project',
    'Task',
    'Department',
    'Employee',
    'GL Entry',
    'Journal Entry',
    'Stock Entry',
    'Material Request',
  ]);
  if (co && companyDocs.has(dt) && !f.some((x) => Array.isArray(x) && x[0] === 'company')) {
    f.push(['company', '=', co]);
  }
  if (f.length) params.set('filters', JSON.stringify(f));
  try {
    const data = await frappeFetch(`/api/resource/${encodeURIComponent(dt)}?${params}`);
    const rows = Array.isArray(data?.data) ? data.data : [];
    return {
      mode: 'live',
      doctype: dt,
      data: rows,
      company: co,
      count: rows.length,
    };
  } catch (e) {
    return { mode: 'error', doctype: dt, data: [], error: e.message, company: co };
  }
}

export async function erpCreate(ownerUserId, doctype, doc = {}) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = String(doctype || '').trim();
  if (!dt) throw Object.assign(new Error('doctype required'), { status: 400 });
  const body = { ...(doc || {}) };
  const co = companyFilter(ownerUserId);
  if (co && !body.company) body.company = co;
  const data = await frappeFetch(`/api/resource/${encodeURIComponent(dt)}`, {
    method: 'POST',
    body,
  });
  return { mode: 'live', doctype: dt, data: data?.data || data, company: co };
}

export async function erpGet(ownerUserId, doctype, name) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = String(doctype || '').trim();
  const nm = String(name || '').trim();
  if (!dt || !nm) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  const data = await frappeFetch(
    `/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(nm)}`
  );
  return { mode: 'live', doctype: dt, data: data?.data || data };
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
  return erpCreate(ownerUserId, 'Sales Invoice', doc);
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
  const co = companyFilter(ownerUserId);
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


export async function erpUpdate(ownerUserId, doctype, name, fields = {}) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = String(doctype || '').trim();
  const nm = String(name || '').trim();
  if (!dt || !nm) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  const data = await frappeFetch(
    `/api/resource/${encodeURIComponent(dt)}/${encodeURIComponent(nm)}`,
    { method: 'PUT', body: fields }
  );
  return { mode: 'live', doctype: dt, name: nm, data: data?.data || data };
}

export async function erpSubmitDoc(ownerUserId, doctype, name) {
  assertErpEntitled(ownerUserId);
  if (!isErpnextApiConfigured()) {
    throw Object.assign(new Error('ERPNEXT_URL / API keys not configured'), { status: 503 });
  }
  const dt = String(doctype || '').trim();
  const nm = String(name || '').trim();
  if (!dt || !nm) throw Object.assign(new Error('doctype and name required'), { status: 400 });
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
  const dt = String(doctype || '').trim();
  const nm = String(name || '').trim();
  if (!dt || !nm) throw Object.assign(new Error('doctype and name required'), { status: 400 });
  const data = await frappeFetch('/api/method/frappe.client.cancel', {
    method: 'POST',
    body: { doctype: dt, name: nm },
  });
  return { mode: 'live', doctype: dt, name: nm, data: data?.message || data };
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
    return {
      company_id: profile.erpnext.company_id,
      company_name: profile.erpnext.company_name,
      created: false,
      mode: 'existing',
    };
  }

  const name =
    String(displayName || '').trim() ||
    `Flolah ${owner.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 40) || 'Company'}`;

  const localCompanyId = `flolah-co-${owner}`.slice(0, 80);
  let remoteId = null;
  let mode = 'local_bind';

  if (isErpnextApiConfigured()) {
    try {
      const data = await frappeFetch('/api/resource/Company', {
        method: 'POST',
        body: {
          company_name: name,
          abbr:
            name
              .split(/\s+/)
              .map((w) => w[0])
              .join('')
              .slice(0, 5)
              .toUpperCase() || 'FL',
          default_currency: process.env.ERPNEXT_DEFAULT_CURRENCY || 'USD',
        },
      });
      remoteId = data?.data?.name || data?.name || null;
      if (remoteId) mode = 'remote';
    } catch (e) {
      console.warn('[erpnext] company create failed', owner, e?.message || e);
      mode = 'local_bind_fallback';
    }
  }

  const companyId = String(remoteId || localCompanyId);
  setErpnextBind(owner, {
    company_id: companyId,
    company_name: name,
    bind: { flolah_owner_user_id: owner, mode, created_at: new Date().toISOString() },
  });

  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO company_erpnext_user_map
         (owner_user_id, flolah_user_id, erpnext_user_id, erpnext_company_id, roles_json, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(owner_user_id, flolah_user_id, erpnext_company_id) DO UPDATE SET
         updated_at = datetime('now')`
    ).run(owner, owner, owner, companyId, JSON.stringify(['System Manager']));
  } catch (e) {
    console.warn('[erpnext] user map', e?.message || e);
  }

  console.info('[erpnext] bound company owner=%s company=%s mode=%s', owner, companyId, mode);
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
    objects: [
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
      'Project',
      'Task',
      'GL Entry',
      'Department',
      'Employee',
      'Profit and Loss Statement',
    ],
  };
}