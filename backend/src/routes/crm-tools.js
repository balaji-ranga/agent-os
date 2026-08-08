/**
 * CRM content tools — Twenty Core REST (people, companies, opportunities/leads/deals, notes, tasks).
 * Owner-scoped via resolveToolOwnerUserId; company CRM entitlements.
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
} from '../services/twenty-crm.js';
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
    return { profile: getBusinessProfile(ownerUserId), twenty: getTwentyStatusForOwner(ownerUserId) };
  })
);

router.post('/crm-list-people', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    return crmListPeople(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-create-person', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
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
    return crmListCompanies(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-create-company', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
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
    return crmListOpportunities(ownerUserId, {
      limit: req.body?.limit,
      stage: req.body?.stage,
    });
  })
);
// Alias: deals
router.post('/crm-list-deals', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
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
    return crmListLeads(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-create-lead', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    const b = req.body || {};
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
    return crmListNotes(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-list-tasks', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    return crmListTasks(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/crm-sync-org', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertCrmEntitled(ownerUserId);
    return syncFlolahOrgToBusinessCore(ownerUserId, { targets: ['crm'] });
  })
);

export default router;