/**
 * ERP tools - ERPNext Frappe REST (customers, invoices, P&L, projects, generic).
 */
import { Router } from 'express';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { resolveToolOwnerUserId } from '../services/tool-owner-scope.js';
import { getBusinessProfile, assertErpEntitled } from '../services/company-business-profile.js';
import {
  getErpnextStatusForOwner,
  erpList,
  erpCreate,
  erpGet,
  erpListCustomers,
  erpListLeads,
  erpListItems,
  erpListQuotations,
  erpListSalesOrders,
  erpListProjects,
  erpCreateCustomer,
  erpCreateLead,
  erpListSalesInvoices,
  erpCreateSalesInvoice,
  erpListPurchaseInvoices,
  erpCreatePurchaseInvoice,
  erpCreateProject,
  erpListTasks,
  erpCreateTask,
  erpListGlEntries,
  erpProfitAndLoss,
} from '../services/erpnext-erp.js';
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
    console.warn('[erp-tools]', e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
}

router.post('/erp-status', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    const profile = getBusinessProfile(ownerUserId);
    if (profile.platform_erp) assertErpEntitled(ownerUserId);
    return { profile, erpnext: getErpnextStatusForOwner(ownerUserId) };
  })
);

router.post('/erp-list-customers', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListCustomers(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/erp-create-customer', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    const b = req.body || {};
    return erpCreateCustomer(ownerUserId, {
      customer_name: b.customer_name || b.name,
      customer_type: b.customer_type || 'Company',
      ...b,
    });
  })
);

router.post('/erp-list-leads', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListLeads(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/erp-create-lead', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    const b = req.body || {};
    return erpCreateLead(ownerUserId, {
      lead_name: b.lead_name || b.name,
      email_id: b.email_id || b.email,
      company_name: b.company_name,
      ...b,
    });
  })
);

router.post('/erp-list-items', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListItems(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/erp-list-quotations', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListQuotations(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/erp-list-sales-orders', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListSalesOrders(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/erp-list-projects', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListProjects(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/erp-create-project', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpCreateProject(ownerUserId, req.body || {});
  })
);

router.post('/erp-list-tasks', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListTasks(ownerUserId, { limit: req.body?.limit, filters: req.body?.filters });
  })
);

router.post('/erp-create-task', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpCreateTask(ownerUserId, req.body || {});
  })
);

router.post('/erp-list-sales-invoices', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListSalesInvoices(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/erp-create-sales-invoice', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpCreateSalesInvoice(ownerUserId, req.body?.doc || req.body || {});
  })
);

router.post('/erp-list-purchase-invoices', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListPurchaseInvoices(ownerUserId, { limit: req.body?.limit });
  })
);

router.post('/erp-create-purchase-invoice', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpCreatePurchaseInvoice(ownerUserId, req.body?.doc || req.body || {});
  })
);

router.post('/erp-list-gl-entries', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    return erpListGlEntries(ownerUserId, { limit: req.body?.limit, filters: req.body?.filters });
  })
);

router.post('/erp-profit-and-loss', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    const b = req.body || {};
    return erpProfitAndLoss(ownerUserId, {
      from_date: b.from_date,
      to_date: b.to_date,
      periodicity: b.periodicity,
      accumulated_values: b.accumulated_values,
    });
  })
);

router.post('/erp-list-resource', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    const b = req.body || {};
    return erpList(ownerUserId, b.doctype || b.resource, {
      limit: b.limit,
      filters: b.filters,
      fields: b.fields,
    });
  })
);

router.post('/erp-create-resource', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    const b = req.body || {};
    return erpCreate(ownerUserId, b.doctype || b.resource, b.doc || b.data || b);
  })
);

router.post('/erp-get-resource', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    const b = req.body || {};
    return erpGet(ownerUserId, b.doctype || b.resource, b.name || b.id);
  })
);

router.post('/erp-sync-org', (req, res) =>
  run(res, async () => {
    const ownerUserId = owner(req, req.body || {});
    assertErpEntitled(ownerUserId);
    return syncFlolahOrgToBusinessCore(ownerUserId, { targets: ['erp'] });
  })
);

export default router;
