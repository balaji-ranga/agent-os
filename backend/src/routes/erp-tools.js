/**
 * ERP tools - ERPNext Frappe REST (sales, buying, stock, accounting, projects, submit).
 * Every MCP erp_* tool has a matching content tool route here.
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
  erpUpdate,
  erpSubmitDoc,
  erpCancelDoc,
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
  erpCreateQuotation,
  erpCreateSalesOrder,
  erpCreateItem,
  erpListOpportunities,
  erpCreateOpportunity,
  erpListContacts,
  erpCreateContact,
  erpListPurchaseOrders,
  erpCreatePurchaseOrder,
  erpListPaymentEntries,
  erpCreatePaymentEntry,
  erpListDeliveryNotes,
  erpCreateDeliveryNote,
  erpListJournalEntries,
  erpCreateJournalEntry,
  erpListMaterialRequests,
  erpCreateMaterialRequest,
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
    if (profile.uses_erpnext || profile.platform_erp) assertErpEntitled(ownerUserId);
    return { profile, erpnext: getErpnextStatusForOwner(ownerUserId) };
  })
);

function docBody(b) {
  return b?.doc || b?.data || b || {};
}

router.post('/erp-list-customers', (req, res) =>
  run(res, async () => erpListCustomers(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-customer', (req, res) =>
  run(res, async () => {
    const b = req.body || {};
    return erpCreateCustomer(owner(req, b), {
      customer_name: b.customer_name || b.name,
      customer_type: b.customer_type || 'Company',
      ...b,
    });
  })
);
router.post('/erp-list-leads', (req, res) =>
  run(res, async () => erpListLeads(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-lead', (req, res) =>
  run(res, async () => {
    const b = req.body || {};
    return erpCreateLead(owner(req, b), {
      lead_name: b.lead_name || b.name,
      email_id: b.email_id || b.email,
      company_name: b.company_name,
      ...b,
    });
  })
);
router.post('/erp-list-contacts', (req, res) =>
  run(res, async () => erpListContacts(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-contact', (req, res) =>
  run(res, async () => erpCreateContact(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-opportunities', (req, res) =>
  run(res, async () => erpListOpportunities(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-opportunity', (req, res) =>
  run(res, async () => erpCreateOpportunity(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-items', (req, res) =>
  run(res, async () => erpListItems(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-item', (req, res) =>
  run(res, async () => erpCreateItem(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-quotations', (req, res) =>
  run(res, async () => erpListQuotations(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-quotation', (req, res) =>
  run(res, async () => erpCreateQuotation(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-sales-orders', (req, res) =>
  run(res, async () => erpListSalesOrders(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-sales-order', (req, res) =>
  run(res, async () => erpCreateSalesOrder(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-delivery-notes', (req, res) =>
  run(res, async () => erpListDeliveryNotes(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-delivery-note', (req, res) =>
  run(res, async () => erpCreateDeliveryNote(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-sales-invoices', (req, res) =>
  run(res, async () => erpListSalesInvoices(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-sales-invoice', (req, res) =>
  run(res, async () => erpCreateSalesInvoice(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-purchase-orders', (req, res) =>
  run(res, async () => erpListPurchaseOrders(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-purchase-order', (req, res) =>
  run(res, async () => erpCreatePurchaseOrder(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-purchase-invoices', (req, res) =>
  run(res, async () => erpListPurchaseInvoices(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-purchase-invoice', (req, res) =>
  run(res, async () => erpCreatePurchaseInvoice(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-payment-entries', (req, res) =>
  run(res, async () => erpListPaymentEntries(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-payment-entry', (req, res) =>
  run(res, async () => erpCreatePaymentEntry(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-journal-entries', (req, res) =>
  run(res, async () => erpListJournalEntries(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-journal-entry', (req, res) =>
  run(res, async () => erpCreateJournalEntry(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-material-requests', (req, res) =>
  run(res, async () => erpListMaterialRequests(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-material-request', (req, res) =>
  run(res, async () => erpCreateMaterialRequest(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-projects', (req, res) =>
  run(res, async () => erpListProjects(owner(req, req.body || {}), { limit: req.body?.limit }))
);
router.post('/erp-create-project', (req, res) =>
  run(res, async () => erpCreateProject(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-tasks', (req, res) =>
  run(res, async () =>
    erpListTasks(owner(req, req.body || {}), { limit: req.body?.limit, filters: req.body?.filters })
  )
);
router.post('/erp-create-task', (req, res) =>
  run(res, async () => erpCreateTask(owner(req, req.body || {}), docBody(req.body)))
);
router.post('/erp-list-gl-entries', (req, res) =>
  run(res, async () =>
    erpListGlEntries(owner(req, req.body || {}), { limit: req.body?.limit, filters: req.body?.filters })
  )
);
router.post('/erp-profit-and-loss', (req, res) =>
  run(res, async () => {
    const b = req.body || {};
    return erpProfitAndLoss(owner(req, b), {
      from_date: b.from_date,
      to_date: b.to_date,
      periodicity: b.periodicity,
      accumulated_values: b.accumulated_values,
    });
  })
);
router.post('/erp-list-resource', (req, res) =>
  run(res, async () => {
    const b = req.body || {};
    return erpList(owner(req, b), b.doctype || b.resource, {
      limit: b.limit,
      filters: b.filters,
      fields: b.fields,
    });
  })
);
router.post('/erp-create-resource', (req, res) =>
  run(res, async () => {
    const b = req.body || {};
    return erpCreate(owner(req, b), b.doctype || b.resource, b.doc || b.data || b);
  })
);
router.post('/erp-get-resource', (req, res) =>
  run(res, async () => {
    const b = req.body || {};
    return erpGet(owner(req, b), b.doctype || b.resource, b.name || b.id);
  })
);
router.post('/erp-update-resource', (req, res) =>
  run(res, async () => {
    const b = req.body || {};
    return erpUpdate(
      owner(req, b),
      b.doctype || b.resource,
      b.name || b.id,
      b.fields || b.doc || b.data || {}
    );
  })
);
router.post('/erp-submit-doc', (req, res) =>
  run(res, async () => {
    const b = req.body || {};
    return erpSubmitDoc(owner(req, b), b.doctype || b.resource, b.name || b.id);
  })
);
router.post('/erp-cancel-doc', (req, res) =>
  run(res, async () => {
    const b = req.body || {};
    return erpCancelDoc(owner(req, b), b.doctype || b.resource, b.name || b.id);
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