/**
 * CEO-scoped read-only CRM/ERP tools for COO (company entitle via tool owner resolution).
 * No create/update/submit/cancel. crm_sync_org / erp_sync_org optional bootstrap only.
 */
export const COO_CRM_READONLY_TOOLS = Object.freeze([
  'crm_status',
  'crm_list_people',
  'crm_list_companies',
  'crm_list_opportunities',
  'crm_list_deals',
  'crm_list_leads',
  'crm_list_notes',
  'crm_list_tasks',
  'crm_sync_org',
]);

export const COO_ERP_READONLY_TOOLS = Object.freeze([
  'erp_status',
  'erp_get_company',
  'erp_list_fiscal_years',
  'erp_list_customers',
  'erp_list_leads',
  'erp_list_contacts',
  'erp_list_opportunities',
  'erp_list_items',
  'erp_list_quotations',
  'erp_list_sales_orders',
  'erp_list_delivery_notes',
  'erp_list_sales_invoices',
  'erp_list_purchase_orders',
  'erp_list_purchase_invoices',
  'erp_list_payment_entries',
  'erp_list_journal_entries',
  'erp_list_material_requests',
  'erp_list_projects',
  'erp_list_tasks',
  'erp_list_gl_entries',
  'erp_profit_and_loss',
  'erp_list_resource',
  'erp_get_resource',
  'erp_sync_org',
]);

export const COO_CRM_ERP_READONLY_TOOLS = Object.freeze([
  ...COO_CRM_READONLY_TOOLS,
  ...COO_ERP_READONLY_TOOLS,
]);