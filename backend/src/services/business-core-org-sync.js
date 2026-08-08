/**
 * Sync Flolah org (departments master-data + AI employees) into platform CRM / ERP.
 * Owner-scoped only; never accepts foreign owner ids for authorization.
 */
import { listDepartmentsForOwner } from './ceo-default-master-data.js';
import { listAgentsForUser } from './users.js';
import { getDb } from '../db/schema.js';
import {
  assertCrmEntitled,
  assertErpEntitled,
  getBusinessProfile,
} from './company-business-profile.js';
import {
  isTwentyConfigured,
  ensureTwentyWorkspaceForCompany,
  crmListCompanies,
  crmCreatePerson,
  crmListPeople,
} from './twenty-crm.js';
import {
  isErpnextApiConfigured,
  ensureErpnextCompanyForOwner,
} from './erpnext-erp.js';

function companyDisplay(ownerUserId) {
  const u = getDb().prepare(`SELECT id, name, business_name, email FROM platform_users WHERE id = ?`).get(ownerUserId);
  return {
    name: u?.business_name || u?.name || ownerUserId,
    email: u?.email || null,
  };
}

/**
 * Snapshot Flolah org for sync (departments + agents granted to CEO).
 */
export function listFlolahOrgSnapshot(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const departments = listDepartmentsForOwner(owner);
  const agents = listAgentsForUser(owner).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    department: a.department || '',
    is_coo: !!a.is_coo,
  }));
  const company = companyDisplay(owner);
  return {
    owner_user_id: owner,
    company_name: company.name,
    company_email: company.email,
    departments,
    agents,
    department_count: departments.length,
    agent_count: agents.length,
  };
}

async function twentyUpsertWorkspaceCompany(owner, snap) {
  // Twenty "Company" account for the Flolah company itself
  try {
    const list = await crmListCompanies(owner, { limit: 50 });
    const companies = Array.isArray(list.people)
      ? []
      : Array.isArray(list.companies)
        ? list.companies
        : [];
    const hit = companies.find(
      (c) =>
        String(c?.name ?? c?.domainName ?? '').toLowerCase() === snap.company_name.toLowerCase() ||
        String(c?.name?.firstName || c?.name || '').toLowerCase() === snap.company_name.toLowerCase()
    );
    if (hit) return { company: hit, created: false };
  } catch (_) {}
  // REST create company (best-effort)
  if (!isTwentyConfigured()) {
    return { company: null, created: false, mode: 'offline', note: 'TWENTY_API_URL not configured' };
  }
  try {
    const root = String(process.env.TWENTY_API_URL || '').replace(/\/+$/, '');
    const key = String(process.env.TWENTY_API_KEY || process.env.TWENTY_API_TOKEN || '').trim();
    const res = await fetch(`${root}/rest/companies`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ name: snap.company_name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { company: null, created: false, error: data?.message || `HTTP ${res.status}` };
    }
    return { company: data?.data || data, created: true };
  } catch (e) {
    return { company: null, created: false, error: e.message };
  }
}

async function twentySyncPeople(owner, snap) {
  const created = [];
  const skipped = [];
  const errors = [];

  let existing = [];
  try {
    const list = await crmListPeople(owner, { limit: 100 });
    existing = Array.isArray(list.people) ? list.people : [];
  } catch (e) {
    errors.push(`list people: ${e.message}`);
  }

  const emailOf = (p) =>
    String(
      p?.emails?.primaryEmail ||
        p?.email ||
        p?.emails?.[0]?.email ||
        p?.primaryEmail ||
        ''
    )
      .trim()
      .toLowerCase();

  const names = new Set(
    existing.map((p) => {
      const n = p?.name;
      if (n && typeof n === 'object') {
        return `${n.firstName || ''} ${n.lastName || ''}`.trim().toLowerCase();
      }
      return String(n || p?.displayName || '').trim().toLowerCase();
    })
  );

  // Departments → virtual people (Department · Role) not ideal; create dept stubs as companies tags via people notes
  for (const d of snap.departments) {
    const label = `Dept: ${d.name}`;
    if (names.has(label.toLowerCase())) {
      skipped.push(label);
      continue;
    }
    try {
      if (!isTwentyConfigured()) {
        skipped.push(`${label} (offline)`);
        continue;
      }
      await crmCreatePerson(owner, {
        name: label,
        email: null,
        phone: null,
      });
      created.push(label);
      names.add(label.toLowerCase());
    } catch (e) {
      errors.push(`${label}: ${e.message}`);
    }
  }

  // AI employees + CEO as people
  const people = [
    { name: snap.company_name, email: snap.company_email, kind: 'ceo' },
    ...snap.agents.map((a) => ({
      name: a.name,
      email: null,
      kind: 'agent',
      role: a.role,
      department: a.department,
    })),
  ];

  for (const p of people) {
    const key = String(p.name || '').trim().toLowerCase();
    if (!key) continue;
    if (names.has(key)) {
      skipped.push(p.name);
      continue;
    }
    try {
      if (!isTwentyConfigured()) {
        skipped.push(`${p.name} (offline)`);
        continue;
      }
      await crmCreatePerson(owner, {
        name: p.kind === 'agent' && p.department ? `${p.name} (${p.department})` : p.name,
        email: p.email,
      });
      created.push(p.name);
      names.add(key);
    } catch (e) {
      errors.push(`${p.name}: ${e.message}`);
    }
  }

  return { created, skipped, errors, existing_count: existing.length };
}

async function erpSyncDepartmentsAndUsers(owner, snap) {
  const results = { departments: [], users: [], errors: [], mode: 'local' };
  if (!isErpnextApiConfigured()) {
    results.mode = 'offline';
    results.note = 'ERPNEXT_URL / API keys not configured — bind only; no live ERPNext writes';
    // Still record intended map locally
    results.planned_departments = snap.departments.map((d) => d.name);
    results.planned_agents = snap.agents.map((a) => a.name);
    return results;
  }

  const root = String(process.env.ERPNEXT_URL || '').replace(/\/+$/, '');
  const auth = `token ${process.env.ERPNEXT_API_KEY}:${process.env.ERPNEXT_API_SECRET}`;
  async function frappe(method, path, body) {
    const res = await fetch(`${root}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: auth,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.message || data?.exc || `ERPNext HTTP ${res.status}`);
    }
    return data;
  }

  results.mode = 'live';
  const profile = getBusinessProfile(owner);
  const company = profile.erpnext.company_name || profile.erpnext.company_id || snap.company_name;

  for (const d of snap.departments) {
    try {
      const data = await frappe('POST', '/api/resource/Department', {
        department_name: d.name,
        company,
        // Frappe Department doctype
      }).catch(async (e) => {
        // maybe exists
        if (/exists|duplicate/i.test(e.message)) return { existing: true, name: d.name };
        throw e;
      });
      results.departments.push({ name: d.name, ok: true, data: data?.data || data });
    } catch (e) {
      results.errors.push(`dept ${d.name}: ${e.message}`);
    }
  }

  for (const a of snap.agents) {
    try {
      const email = `${a.id.replace(/[^a-z0-9_-]/gi, '_')}@flolah.local`;
      const data = await frappe('POST', '/api/resource/Employee', {
        first_name: a.name,
        company,
        department: a.department || undefined,
        designation: a.role || undefined,
        status: 'Active',
        // Prefer not create full User unless API allows
      }).catch(async (e) => {
        if (/exists|duplicate/i.test(e.message)) return { existing: true };
        throw e;
      });
      results.users.push({ agent_id: a.id, name: a.name, ok: true, data: data?.data || data });
      try {
        getDb()
          .prepare(
            `INSERT INTO company_erpnext_user_map
               (owner_user_id, flolah_user_id, erpnext_user_id, erpnext_company_id, roles_json, updated_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(owner_user_id, flolah_user_id, erpnext_company_id) DO UPDATE SET
               erpnext_user_id = excluded.erpnext_user_id,
               updated_at = datetime('now')`
          )
          .run(owner, a.id, email, profile.erpnext.company_id || company, JSON.stringify(['Employee']));
      } catch (_) {}
    } catch (e) {
      results.errors.push(`agent ${a.name}: ${e.message}`);
    }
  }

  return results;
}

/**
 * Sync Flolah org → CRM and/or ERP for entitled provider selections.
 * @param {string} ownerUserId
 * @param {{ targets?: ('crm'|'erp')[] }} opts
 */
export async function syncFlolahOrgToBusinessCore(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });

  const profile = getBusinessProfile(owner);
  const want = Array.isArray(opts.targets) && opts.targets.length
    ? opts.targets.map((t) => String(t).toLowerCase())
    : ['crm', 'erp'].filter((t) => (t === 'crm' ? profile.platform_crm : profile.platform_erp));

  const snap = listFlolahOrgSnapshot(owner);
  const out = {
    ok: true,
    owner_user_id: owner,
    snapshot: {
      company_name: snap.company_name,
      department_count: snap.department_count,
      agent_count: snap.agent_count,
      departments: snap.departments.map((d) => d.name),
      agents: snap.agents.map((a) => ({ id: a.id, name: a.name, department: a.department })),
    },
    crm: null,
    erp: null,
  };

  if (want.includes('crm')) {
    if (!profile.platform_crm) {
      out.crm = { skipped: true, reason: 'crm_provider is not twenty' };
    } else {
      assertCrmEntitled(owner);
      const bind = await ensureTwentyWorkspaceForCompany(owner, { displayName: snap.company_name });
      const company = await twentyUpsertWorkspaceCompany(owner, snap);
      const people = await twentySyncPeople(owner, snap);
      out.crm = { bind, company, people };
    }
  }

  if (want.includes('erp')) {
    if (!profile.platform_erp) {
      out.erp = { skipped: true, reason: 'erp_provider is not erpnext' };
    } else {
      assertErpEntitled(owner);
      const bind = await ensureErpnextCompanyForOwner(owner, { displayName: snap.company_name });
      const sync = await erpSyncDepartmentsAndUsers(owner, snap);
      out.erp = { bind, sync };
    }
  }

  if (!want.length) {
    out.ok = false;
    out.error = 'No CRM/ERP target: select platform Twenty and/or ERPNext on Profile first';
  }

  console.info('[business-core-org-sync] owner=%s targets=%s depts=%s agents=%s', owner, want.join(','), snap.department_count, snap.agent_count);
  return out;
}