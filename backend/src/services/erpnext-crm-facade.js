/**
 * Map Twenty-style crm_* tool surface onto ERPNext Sales/CRM DocTypes
 * when Profile CRM = erpnext (same owner company scope as erp_* tools).
 */
import { assertCrmEntitled, getBusinessProfile } from './company-business-profile.js';
import {
  getErpnextStatusForOwner,
  erpListCustomers,
  erpCreateCustomer,
  erpListLeads,
  erpCreateLead,
  erpListContacts,
  erpCreateContact,
  erpListOpportunities,
  erpCreateOpportunity,
  erpListTasks,
  erpCreateTask,
  erpDelete,
} from './erpnext-erp.js';
import { withWriteIdempotency } from './tool-write-idempotency.js';

function lim(n, d = 20) {
  return Math.min(100, Math.max(1, Number(n) || d));
}

export function isErpnextCrmOwner(ownerUserId) {
  try {
    return getBusinessProfile(ownerUserId).crm_provider === 'erpnext';
  } catch {
    return false;
  }
}

export async function erpCrmStatus(ownerUserId) {
  assertCrmEntitled(ownerUserId);
  const profile = getBusinessProfile(ownerUserId);
  const status = getErpnextStatusForOwner(ownerUserId);
  return {
    crm_provider: 'erpnext',
    mode: 'erpnext_sales_crm',
    note:
      'Profile CRM is ERPNext — use Sales modules (Lead, Opportunity, Customer, Contact, Quotation, Sales Order). Prefer erp_* tools or crm_* (this adapter).',
    profile: {
      crm_provider: profile.crm_provider,
      platform_crm: profile.platform_crm,
      uses_erpnext: profile.uses_erpnext,
    },
    erpnext: status,
    objects: {
      people: 'Contact',
      companies: 'Customer',
      opportunities: 'Opportunity',
      deals: 'Opportunity',
      leads: 'Lead',
      tasks: 'Task',
    },
  };
}

export async function erpCrmListPeople(ownerUserId, { limit } = {}) {
  assertCrmEntitled(ownerUserId);
  const r = await erpListContacts(ownerUserId, { limit: lim(limit) });
  return {
    ...r,
    source: 'erpnext',
    doctype: 'Contact',
    people: (r.data || []).map((row) => ({
      id: row.name,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.name,
      email: row.email_id || null,
      phone: row.mobile_no || row.phone || null,
      raw: row,
    })),
  };
}

export async function erpCrmCreatePerson(ownerUserId, { name, email, phone, companyId, idempotency_key } = {}) {
  return withWriteIdempotency({
    ownerUserId,
    toolName: 'crm_create_person',
    idempotencyKey: idempotency_key,
    identity: {
      name: String(name || '').trim().toLowerCase(),
      email: String(email || '').trim().toLowerCase(),
    },
    execute: async () => {
  assertCrmEntitled(ownerUserId);
  const parts = String(name || '')
    .trim()
    .split(/\s+/);
  const first = parts[0] || 'Contact';
  const last = parts.slice(1).join(' ') || undefined;
  const doc = {
    first_name: first,
    last_name: last,
    email_id: email || undefined,
    mobile_no: phone || undefined,
  };
  if (companyId) {
    doc.links = [{ link_doctype: 'Customer', link_name: companyId }];
  }
  const r = await erpCreateContact(ownerUserId, doc);
  return { ...r, source: 'erpnext', doctype: 'Contact' };
    },
  });
}

export async function erpCrmListCompanies(ownerUserId, { limit } = {}) {
  assertCrmEntitled(ownerUserId);
  const r = await erpListCustomers(ownerUserId, { limit: lim(limit) });
  return {
    ...r,
    source: 'erpnext',
    doctype: 'Customer',
    companies: (r.data || []).map((row) => ({
      id: row.name,
      name: row.customer_name || row.name,
      raw: row,
    })),
  };
}

export async function erpCrmCreateCompany(ownerUserId, { name, domainUrl, idempotency_key } = {}) {
  return withWriteIdempotency({
    ownerUserId,
    toolName: 'crm_create_company',
    idempotencyKey: idempotency_key,
    identity: {
      name: String(name || '').trim().toLowerCase(),
      domain: String(domainUrl || '').trim().toLowerCase(),
    },
    execute: async () => {
      assertCrmEntitled(ownerUserId);
      if (!name) throw Object.assign(new Error('name required'), { status: 400 });
      const r = await erpCreateCustomer(ownerUserId, {
        customer_name: name,
        customer_type: 'Company',
        website: domainUrl || undefined,
      });
      return { ...r, source: 'erpnext', doctype: 'Customer' };
    },
  });
}

export async function erpCrmListOpportunities(ownerUserId, { limit } = {}) {
  assertCrmEntitled(ownerUserId);
  const r = await erpListOpportunities(ownerUserId, { limit: lim(limit) });
  return {
    ...r,
    source: 'erpnext',
    doctype: 'Opportunity',
    opportunities: r.data || [],
    deals: r.data || [],
  };
}

export async function erpCrmCreateOpportunity(ownerUserId, body = {}) {
  assertCrmEntitled(ownerUserId);
  const name = body.name || body.title || body.opportunity_from;
  const doc = {
    opportunity_from: body.opportunity_from || body.party_type || 'Lead',
    party_name: body.party_name || body.lead || body.customer || name,
    opportunity_type: body.opportunity_type || 'Sales',
    sales_stage: body.stage || body.sales_stage || 'Prospecting',
    ...body,
  };
  if (!doc.party_name && name) doc.party_name = name;
  const r = await erpCreateOpportunity(ownerUserId, doc);
  return { ...r, source: 'erpnext', doctype: 'Opportunity' };
}

export async function erpCrmUpdateOpportunity(ownerUserId, body = {}) {
  assertCrmEntitled(ownerUserId);
  const { erpUpdate } = await import('./erpnext-erp.js');
  const id = body.id || body.name;
  if (!id) throw Object.assign(new Error('id or name required'), { status: 400 });
  const fields = { ...body };
  delete fields.id;
  delete fields.name;
  if (body.stage) fields.sales_stage = body.stage;
  const r = await erpUpdate(ownerUserId, 'Opportunity', id, fields);
  return { ...r, source: 'erpnext', doctype: 'Opportunity' };
}

export async function erpCrmListLeads(ownerUserId, { limit } = {}) {
  assertCrmEntitled(ownerUserId);
  const r = await erpListLeads(ownerUserId, { limit: lim(limit) });
  return {
    ...r,
    source: 'erpnext',
    doctype: 'Lead',
    leads: (r.data || []).map((row) => ({
      id: row.name,
      name: row.lead_name || row.name,
      email: row.email_id || null,
      raw: row,
    })),
  };
}

export async function erpCrmCreateLead(ownerUserId, body = {}) {
  return withWriteIdempotency({
    ownerUserId,
    toolName: 'crm_create_lead',
    idempotencyKey: body.idempotency_key,
    identity: {
      name: String(body.name || body.lead_name || '').trim().toLowerCase(),
      email: String(body.email || body.email_id || '').trim().toLowerCase(),
    },
    execute: async () => {
      assertCrmEntitled(ownerUserId);
      const r = await erpCreateLead(ownerUserId, {
        lead_name: body.name || body.lead_name,
        email_id: body.email || body.email_id,
        company_name: body.company_name || body.company,
        ...body,
      });
      return { ...r, source: 'erpnext', doctype: 'Lead' };
    },
  });
}

export async function erpCrmListNotes(ownerUserId, { limit } = {}) {
  assertCrmEntitled(ownerUserId);
  const { erpList } = await import('./erpnext-erp.js');
  // CRM Note if installed; otherwise empty with hint
  try {
    const r = await erpList(ownerUserId, 'CRM Note', { limit: lim(limit) });
    if (r.mode === 'live') return { ...r, source: 'erpnext', doctype: 'CRM Note', notes: r.data || [] };
  } catch {
    /* fall through */
  }
  return {
    mode: 'live',
    source: 'erpnext',
    notes: [],
    message: 'CRM Note doctype not used; store notes on Lead/Opportunity via erp_update_resource',
  };
}

export async function erpCrmListTasks(ownerUserId, { limit } = {}) {
  assertCrmEntitled(ownerUserId);
  const r = await erpListTasks(ownerUserId, { limit: lim(limit) });
  return {
    ...r,
    source: 'erpnext',
    doctype: 'Task',
    tasks: r.data || [],
  };
}

function assertConfirm(confirm) {
  if (confirm === true || confirm === 1 || confirm === '1' || String(confirm || '').toLowerCase() === 'true') {
    return;
  }
  throw Object.assign(new Error('Pass confirm=true after Checker audit to delete'), { status: 400 });
}

export async function erpCrmDeletePerson(ownerUserId, { id, confirm } = {}) {
  assertCrmEntitled(ownerUserId);
  assertConfirm(confirm);
  const name = String(id || '').trim();
  if (!name) throw Object.assign(new Error('id required (Contact name)'), { status: 400 });
  const r = await erpDelete(ownerUserId, 'Contact', name);
  return { ...r, source: 'erpnext', doctype: 'Contact', id: name };
}

export async function erpCrmDeleteCompany(ownerUserId, { id, confirm } = {}) {
  assertCrmEntitled(ownerUserId);
  assertConfirm(confirm);
  const name = String(id || '').trim();
  if (!name) throw Object.assign(new Error('id required (Customer name)'), { status: 400 });
  const r = await erpDelete(ownerUserId, 'Customer', name);
  return { ...r, source: 'erpnext', doctype: 'Customer', id: name };
}
