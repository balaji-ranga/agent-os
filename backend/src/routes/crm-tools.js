/**
 * CRM content tools — Twenty when CRM=twenty; ERPNext Sales modules when CRM=erpnext.
 * Owner-scoped via resolveToolOwnerUserId; company CRM entitlements.
 * MCP mcp-flolah-crm and crm_* content tools share these routes.
 */
import { Router } from 'express';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { resolveToolOwnerUserId } from '../services/tool-owner-scope.js';
import { getBusinessProfile, assertCrmEntitled } from '../services/company-business-profile.js';
import {
  getTwentyStatusForOwner,
  crmListPeople,
  crmListCompanies,
  crmCreatePerson,
  crmCreateCompany,
  crmListOpportunities,
  crmCreateOpportunity,
  crmUpdateOpportunity,
  crmListLeads,
  crmCreateLead,
  crmListNotes,
  crmListTasks,
  crmDeletePerson,
  crmDeleteCompany,
} from '../services/twenty-crm.js';
import {
  isErpnextCrmOwner,
  erpCrmStatus,
  erpCrmListPeople,
  erpCrmCreatePerson,
  erpCrmListCompanies,
  erpCrmCreateCompany,
  erpCrmListOpportunities,
  erpCrmCreateOpportunity,
  erpCrmUpdateOpportunity,
  erpCrmListLeads,
  erpCrmCreateLead,
  erpCrmListNotes,
  erpCrmListTasks,
  erpCrmDeletePerson,
  erpCrmDeleteCompany,
} from '../services/erpnext-crm-facade.js';
import { syncFlolahOrgToBusinessCore } from '../services/business-core-org-sync.js';

const router = Router();

function owner(req, body = {}) {
  return resolveToolOwnerUserId(req, body, resolveAuthenticatedCeoUserId);
}

async function run(res, fn) {
  try {
    const data = await fn();
    res.json({ ok: true, ...data });
  } catch (e) {
    const status = e.status || 500;
    console.warn('[crm-tools]', e.message);
    res.status(status).json({ ok: false, error: e.message });
  }
}

router.post('/crm-status', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmStatus(ownerUserId);
    return { profile: getBusinessProfile(ownerUserId), twenty: getTwentyStatusForOwner(ownerUserId) };
  })
);

router.post('/crm-list-people', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmListPeople(ownerUserId, { limit: req.body?.limit });
    return crmListPeople(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-create-person', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
    if (isErpnextCrmOwner(ownerUserId)) {
      return erpCrmCreatePerson(ownerUserId, {
        name: b.name,
        email: b.email,
        phone: b.phone,
        companyId: b.company_id || b.companyId,
      });
    }
    return crmCreatePerson(ownerUserId, {
      name: b.name,
      email: b.email,
      phone: b.phone,
      companyId: b.company_id || b.companyId,
    });
  })
);

router.post('/crm-list-companies', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmListCompanies(ownerUserId, { limit: req.body?.limit });
    return crmListCompanies(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-create-company', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
    if (isErpnextCrmOwner(ownerUserId)) {
      return erpCrmCreateCompany(ownerUserId, {
        name: b.name,
        domainUrl: b.domain_url || b.domainUrl || b.website,
      });
    }
    return crmCreateCompany(ownerUserId, {
      name: b.name,
      domainUrl: b.domain_url || b.domainUrl || b.website,
      employees: b.employees,
    });
  })
);

router.post('/crm-list-opportunities', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmListOpportunities(ownerUserId, { limit: req.body?.limit });
    return crmListOpportunities(ownerUserId, {
      limit: req.body?.limit,
      stage: req.body?.stage,
    });
  })
);
router.post('/crm-list-deals', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmListOpportunities(ownerUserId, { limit: req.body?.limit });
    return crmListOpportunities(ownerUserId, {
      limit: req.body?.limit,
      stage: req.body?.stage,
    });
  })
);

router.post('/crm-create-opportunity', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmCreateOpportunity(ownerUserId, b);
    return crmCreateOpportunity(ownerUserId, {
      name: b.name,
      amount: b.amount,
      currencyCode: b.currency_code || b.currencyCode || 'USD',
      stage: b.stage,
      companyId: b.company_id || b.companyId,
      closeDate: b.close_date || b.closeDate,
      pointOfContactId: b.point_of_contact_id || b.pointOfContactId,
    });
  })
);
router.post('/crm-create-deal', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmCreateOpportunity(ownerUserId, { ...b, stage: b.stage || 'Proposal' });
    return crmCreateOpportunity(ownerUserId, {
      name: b.name,
      amount: b.amount,
      currencyCode: b.currency_code || b.currencyCode || 'USD',
      stage: b.stage || 'PROPOSAL',
      companyId: b.company_id || b.companyId,
      closeDate: b.close_date || b.closeDate,
      pointOfContactId: b.point_of_contact_id || b.pointOfContactId,
    });
  })
);

router.post('/crm-update-opportunity', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
    if (isErpnextCrmOwner(ownerUserId)) {
      return erpCrmUpdateOpportunity(ownerUserId, {
        id: b.id || b.name,
        stage: b.stage || b.patch?.stage,
        ...((b.patch && typeof b.patch === 'object') ? b.patch : {}),
        name: b.name || b.patch?.name,
      });
    }
    return crmUpdateOpportunity(ownerUserId, {
      id: b.id,
      patch: b.patch || {
        stage: b.stage,
        name: b.name,
        amount: b.amount,
        currencyCode: b.currency_code || b.currencyCode,
      },
    });
  })
);

router.post('/crm-list-leads', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmListLeads(ownerUserId, { limit: req.body?.limit });
    return crmListLeads(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-create-lead', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
    if (isErpnextCrmOwner(ownerUserId)) {
      return erpCrmCreateLead(ownerUserId, {
        name: b.name || b.title || b.lead_name,
        email: b.email || b.email_id,
        company_name: b.company_name || b.company,
        ...b,
      });
    }
    return crmCreateLead(ownerUserId, {
      name: b.name || b.title,
      amount: b.amount,
      stage: b.stage || 'NEW',
      companyId: b.company_id || b.companyId,
    });
  })
);

router.post('/crm-list-notes', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmListNotes(ownerUserId, { limit: req.body?.limit });
    return crmListNotes(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-list-tasks', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    if (isErpnextCrmOwner(ownerUserId)) return erpCrmListTasks(ownerUserId, { limit: req.body?.limit });
    return crmListTasks(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-delete-person', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
    if (isErpnextCrmOwner(ownerUserId)) {
      return erpCrmDeletePerson(ownerUserId, { id: b.id || b.name, confirm: b.confirm });
    }
    return crmDeletePerson(ownerUserId, { id: b.id || b.person_id, confirm: b.confirm });
  })
);

router.post('/crm-delete-company', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
    if (isErpnextCrmOwner(ownerUserId)) {
      return erpCrmDeleteCompany(ownerUserId, { id: b.id || b.name, confirm: b.confirm });
    }
    return crmDeleteCompany(ownerUserId, { id: b.id || b.company_id, confirm: b.confirm });
  })
);

router.post('/crm-sync-org', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    // ERPNext CRM still maps Flolah org into ERP company/user scope
    const targets = isErpnextCrmOwner(ownerUserId) ? ['erp'] : ['crm'];
    return syncFlolahOrgToBusinessCore(ownerUserId, { targets });
  })
);

export default router;
