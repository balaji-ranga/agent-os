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
  getErpnextBindRaw,
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
import { ensureSsoUserPermissions } from './erpnext-sso.js';

/** Desk isolation: Company UP + User UP (self only). */
async function tightenDeskUserIsolation(ownerUserId, companyName) {
  try {
    const bind = getErpnextBindRaw(ownerUserId) || {};
    const userId = bind.sso_user || bind.sso_email || null;
    if (!userId) return { skipped: true, reason: 'no sso user' };
    await ensureSsoUserPermissions(userId, companyName || bind.company_name || null);
    return { ok: true, user: userId, company: companyName || bind.company_name || null };
  } catch (e) {
    console.warn('[business-core-org-sync] desk isolation', ownerUserId, e?.message || e);
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}

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
  // REST create company (workspace-scoped via crmCreateCompany)
  if (!isTwentyConfigured()) {
    return { company: null, created: false, mode: 'offline', note: 'TWENTY_API_URL not configured' };
  }
  try {
    const { crmCreateCompany } = await import('./twenty-crm.js');
    const created = await crmCreateCompany(owner, { name: snap.company_name });
    return { company: created.company, created: true, workspace_id: created.workspace_id };
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

/**
 * ERPNext Department document name is usually "{department_name} - {company_abbr}".
 * Resolve or create under the bound company only.
 */
async function erpResolveCompanyMeta(frappe, company) {
  const enc = encodeURIComponent(company);
  try {
    const co = await frappe('GET', `/api/resource/Company/${enc}?fields=${encodeURIComponent(JSON.stringify(['name', 'abbr']))}`);
    const abbr = co?.data?.abbr || null;
    return { company: co?.data?.name || company, abbr };
  } catch {
    return { company, abbr: null };
  }
}

async function erpFindDepartment(frappe, company, departmentName) {
  const label = String(departmentName || '').trim();
  if (!label) return null;
  const filters = [
    ['company', '=', company],
    ['department_name', '=', label],
  ];
  const listed = await frappe(
    'GET',
    '/api/resource/Department?filters=' +
      encodeURIComponent(JSON.stringify(filters)) +
      '&limit_page_length=1&fields=' +
      encodeURIComponent(JSON.stringify(['name', 'department_name', 'company']))
  );
  const row = Array.isArray(listed?.data) ? listed.data[0] : null;
  if (row?.name) return row.name;

  // Fallback: exact name match "{label} - {abbr}"
  const listed2 = await frappe(
    'GET',
    '/api/resource/Department?filters=' +
      encodeURIComponent(JSON.stringify([['company', '=', company], ['name', 'like', `${label}%`]])) +
      '&limit_page_length=5&fields=' +
      encodeURIComponent(JSON.stringify(['name', 'department_name', 'company']))
  );
  const rows = Array.isArray(listed2?.data) ? listed2.data : [];
  const hit = rows.find((r) => String(r.department_name || '').toLowerCase() === label.toLowerCase()) || rows[0];
  return hit?.name || null;
}

async function erpEnsureDepartment(frappe, company, departmentName, abbr) {
  const label = String(departmentName || '').trim();
  if (!label) return null;
  const existing = await erpFindDepartment(frappe, company, label);
  if (existing) return { name: existing, created: false };

  try {
    const created = await frappe('POST', '/api/resource/Department', {
      department_name: label,
      company,
    });
    return { name: created?.data?.name || (abbr ? `${label} - ${abbr}` : label), created: true };
  } catch (e) {
    const msg = String(e.message || e);
    if (/exists|duplicate/i.test(msg)) {
      const again = await erpFindDepartment(frappe, company, label);
      if (again) return { name: again, created: false };
    }
    throw e;
  }
}

async function erpEnsureDesignation(frappe, designation) {
  // Keep designations short/simple — agent roles can be long; map to a safe title.
  let title = String(designation || 'AI Employee').trim().slice(0, 80);
  if (!title) title = 'AI Employee';
  // Prefer first segment before long role descriptions
  if (title.length > 40 && title.includes('—')) title = title.split('—')[0].trim().slice(0, 40);
  if (title.length > 40 && title.includes(' - ')) title = title.split(' - ')[0].trim().slice(0, 40);

  const listed = await frappe(
    'GET',
    '/api/resource/Designation?filters=' +
      encodeURIComponent(JSON.stringify([['name', '=', title]])) +
      '&limit_page_length=1&fields=' +
      encodeURIComponent(JSON.stringify(['name']))
  ).catch(() => null);
  if (Array.isArray(listed?.data) && listed.data[0]?.name) {
    return listed.data[0].name;
  }
  try {
    const created = await frappe('POST', '/api/resource/Designation', {
      designation_name: title,
    });
    return created?.data?.name || title;
  } catch (e) {
    if (/exists|duplicate/i.test(String(e.message || e))) return title;
    // Non-fatal: Employee can be created without designation
    console.warn('[business-core-org-sync] designation ensure failed', title, e.message || e);
    return null;
  }
}

function erpEmployeeDateToday() {
  return new Date().toISOString().slice(0, 10);
}

async function erpFindEmployeeByName(frappe, company, firstName) {
  const listed = await frappe(
    'GET',
    '/api/resource/Employee?filters=' +
      encodeURIComponent(
        JSON.stringify([
          ['company', '=', company],
          ['employee_name', '=', firstName],
        ])
      ) +
      '&limit_page_length=1&fields=' +
      encodeURIComponent(JSON.stringify(['name', 'employee_name', 'department', 'company']))
  ).catch(() => null);
  const row = Array.isArray(listed?.data) ? listed.data[0] : null;
  return row?.name || null;
}

async function erpSyncDepartmentsAndUsers(owner, snap) {
  const results = {
    departments: [],
    users: [],
    employees: [],
    errors: [],
    mode: 'local',
  };
  if (!isErpnextApiConfigured()) {
    results.mode = 'offline';
    results.note = 'ERPNEXT_URL / API keys not configured — bind only; no live ERPNext writes';
    results.planned_departments = snap.departments.map((d) => d.name);
    results.planned_agents = snap.agents.map((a) => a.name);
    return results;
  }

  const { frappeFetch } = await import('./erpnext-erp.js');
  async function frappe(method, path, body) {
    return frappeFetch(path, { method, body });
  }

  results.mode = 'live';
  const profile = getBusinessProfile(owner);
  const companyInput = profile.erpnext.company_name || profile.erpnext.company_id || snap.company_name;
  const meta = await erpResolveCompanyMeta(frappe, companyInput);
  const company = meta.company;
  const abbr = meta.abbr;
  results.company = company;
  results.company_abbr = abbr;

  const deptNameByLabel = new Map();

  // Always ensure a root "AI Team" department for unassigned agents
  for (const d of [{ name: 'AI Team' }, ...snap.departments]) {
    try {
      const out = await erpEnsureDepartment(frappe, company, d.name, abbr);
      if (out?.name) {
        deptNameByLabel.set(String(d.name).toLowerCase(), out.name);
        results.departments.push({
          name: d.name,
          erp_name: out.name,
          created: !!out.created,
          ok: true,
        });
      }
    } catch (e) {
      results.errors.push(`dept ${d.name}: ${String(e.message || e).slice(0, 240)}`);
    }
  }

  for (const a of snap.agents) {
    try {
      const deptLabel = String(a.department || 'AI Team').trim() || 'AI Team';
      let deptDoc = deptNameByLabel.get(deptLabel.toLowerCase());
      if (!deptDoc) {
        const ensured = await erpEnsureDepartment(frappe, company, deptLabel, abbr);
        deptDoc = ensured?.name || null;
        if (deptDoc) deptNameByLabel.set(deptLabel.toLowerCase(), deptDoc);
      }
      const designation = await erpEnsureDesignation(frappe, a.name || a.role || 'AI Employee');

      // Employees only — do NOT create Frappe User rows for agents (would leak in User list).
      const existingEmp = await erpFindEmployeeByName(frappe, company, a.name);
      let empName = existingEmp;
      let created = false;
      if (!empName) {
        const body = {
          first_name: String(a.name || a.id).slice(0, 80),
          company,
          status: 'Active',
          date_of_joining: erpEmployeeDateToday(),
          create_user_permission: 0,
        };
        if (deptDoc) body.department = deptDoc;
        if (designation) body.designation = designation;
        // Prefer optional gender only if site requires it — omit first; retry with Other
        try {
          const createdDoc = await frappe('POST', '/api/resource/Employee', body);
          empName = createdDoc?.data?.name || null;
          created = true;
        } catch (e1) {
          const msg = String(e1.message || e1);
          if (/gender/i.test(msg) && !body.gender) {
            body.gender = 'Other';
            const createdDoc = await frappe('POST', '/api/resource/Employee', body);
            empName = createdDoc?.data?.name || null;
            created = true;
          } else if (/exists|duplicate/i.test(msg)) {
            empName = await erpFindEmployeeByName(frappe, company, a.name);
          } else {
            throw e1;
          }
        }
      }

      results.employees.push({
        agent_id: a.id,
        name: a.name,
        employee: empName,
        department: deptDoc,
        designation,
        created,
        ok: !!empName,
      });
      // keep legacy key for older UI
      results.users.push({
        agent_id: a.id,
        name: a.name,
        employee: empName,
        ok: !!empName,
      });

      if (empName) {
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
            .run(
              owner,
              a.id,
              empName,
              profile.erpnext.company_id || company,
              JSON.stringify(['Employee'])
            );
        } catch (_) {}
      }
    } catch (e) {
      results.errors.push(`agent ${a.name}: ${String(e.message || e).slice(0, 280)}`);
    }
  }

  console.info(
    '[business-core-org-sync] erp company=%s depts=%s employees_ok=%s errors=%s',
    company,
    results.departments.length,
    results.employees.filter((x) => x.ok).length,
    results.errors.length
  );
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
    : ['crm', 'erp'].filter((t) => {
        if (t === 'crm') return profile.platform_crm === true;
        if (t === 'erp') return profile.platform_erp === true || profile.uses_erpnext === true;
        return false;
      });

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
    if (profile.crm_provider === 'twenty') {
      assertCrmEntitled(owner);
      const bind = await ensureTwentyWorkspaceForCompany(owner, { displayName: snap.company_name });
      const company = await twentyUpsertWorkspaceCompany(owner, snap);
      const people = await twentySyncPeople(owner, snap);
      out.crm = { provider: 'twenty', bind, company, people };
    } else if (profile.crm_provider === 'erpnext') {
      assertErpEntitled(owner);
      const bind = await ensureErpnextCompanyForOwner(owner, { displayName: snap.company_name });
      const sync = await erpSyncDepartmentsAndUsers(owner, snap);
      const isolation = await tightenDeskUserIsolation(
        owner,
        bind?.company_name || bind?.company_id || snap.company_name
      );
      out.crm = { provider: 'erpnext', bind, sync, desk_isolation: isolation };
    } else {
      out.crm = { skipped: true, reason: 'crm_provider is not twenty or erpnext' };
    }
  }

  if (want.includes('erp')) {
    if (profile.uses_erpnext) {
      assertErpEntitled(owner);
      const bind = await ensureErpnextCompanyForOwner(owner, { displayName: snap.company_name });
      const sync = await erpSyncDepartmentsAndUsers(owner, snap);
      const isolation = await tightenDeskUserIsolation(
        owner,
        bind?.company_name || bind?.company_id || snap.company_name
      );
      out.erp = { provider: 'erpnext', bind, sync, desk_isolation: isolation };
    } else {
      out.erp = { skipped: true, reason: 'ERPNext not selected for CRM or ERP' };
    }
  }

  if (!want.length) {
    out.ok = false;
    out.error = 'No CRM/ERP target: select platform Twenty and/or ERPNext on Profile first';
  }

  console.info('[business-core-org-sync] owner=%s targets=%s depts=%s agents=%s', owner, want.join(','), snap.department_count, snap.agent_count);
  return out;
}