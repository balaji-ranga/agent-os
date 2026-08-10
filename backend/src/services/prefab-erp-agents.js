/**
 * Prefabricated ERP workforce when Profile ERP = ERPNext (or CRM also uses ERPNext):
 * - ERP Maker A / ERP Maker B: full erp_* operational surface (same as mcp-flolah-erp content tools)
 * - ERP Checker: read/list + submit/cancel gates + Kanban / workflow certify approvals
 * - Specialists: P&L, Invoice, Project Manager (focused subsets)
 * Grants only when platform ERPNext is selected; otherwise revoke from org.
 */
import { getDb } from '../db/schema.js';
import { createFullAgent } from './create-full-agent.js';
import { getBusinessProfile, setPrefabErpAgentIds } from './company-business-profile.js';
import { setAgentToolGrants } from './openclaw-agent-tools.js';
import { grantUserAgent, revokeUserAgent } from './users.js';

/** Full list/create/update surface — no submit/cancel (Checker owns those). */
export const ALL_ERP_TOOLS = [
  'erp_status',
  'erp_sync_org',
  'erp_get_company',
  'erp_update_company',
  'erp_list_fiscal_years',
  'erp_create_fiscal_year',
  'erp_list_customers',
  'erp_create_customer',
  'erp_list_leads',
  'erp_create_lead',
  'erp_list_contacts',
  'erp_create_contact',
  'erp_list_opportunities',
  'erp_create_opportunity',
  'erp_list_items',
  'erp_create_item',
  'erp_list_quotations',
  'erp_create_quotation',
  'erp_list_sales_orders',
  'erp_create_sales_order',
  'erp_list_delivery_notes',
  'erp_create_delivery_note',
  'erp_list_sales_invoices',
  'erp_create_sales_invoice',
  'erp_list_purchase_orders',
  'erp_create_purchase_order',
  'erp_list_purchase_invoices',
  'erp_create_purchase_invoice',
  'erp_list_payment_entries',
  'erp_create_payment_entry',
  'erp_list_journal_entries',
  'erp_create_journal_entry',
  'erp_list_material_requests',
  'erp_create_material_request',
  'erp_list_projects',
  'erp_create_project',
  'erp_list_tasks',
  'erp_create_task',
  'erp_list_gl_entries',
  'erp_profit_and_loss',
  'erp_list_resource',
  'erp_get_resource',
  'erp_create_resource',
  'erp_update_resource',
];

/** Gates reserved for ERP Checker (also in MCP catalog + content tools). */
export const ERP_CHECKER_GATE_TOOLS = ['erp_submit_doc', 'erp_cancel_doc'];

const SHARED_PLATFORM = [
  'kanban_create_task',
  'kanban_get_task',
  'notify_ceo',
  'ceo_profile',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_rag',
  'learnings_summary',
];

/** Company context both Makers need (own company only — enforced in erpnext-erp). */
const ERP_COMPANY_READ = [
  'erp_status',
  'erp_sync_org',
  'erp_get_company',
  'erp_list_fiscal_years',
  'erp_list_resource',
  'erp_get_resource',
];

/** Maker A owns chart / fiscal setup writes for the bound company. */
const ERP_COMPANY_SETUP = [
  ...ERP_COMPANY_READ,
  'erp_update_company',
  'erp_create_fiscal_year',
];

/**
 * Maker A — Finance / revenue / company chart (desk Accounts + Sales money path).
 * Maker A + Maker B together ≈ CEO desk operational roles (less System Manager / User admin).
 */
const ERP_MAKER_A_TOOLS = [
  ...ERP_COMPANY_SETUP,
  'erp_create_resource',
  'erp_update_resource',
  'erp_list_customers',
  'erp_create_customer',
  'erp_list_leads',
  'erp_create_lead',
  'erp_list_contacts',
  'erp_create_contact',
  'erp_list_opportunities',
  'erp_create_opportunity',
  'erp_list_items',
  'erp_create_item',
  'erp_list_quotations',
  'erp_create_quotation',
  'erp_list_sales_orders',
  'erp_create_sales_order',
  'erp_list_sales_invoices',
  'erp_create_sales_invoice',
  'erp_list_purchase_invoices',
  'erp_create_purchase_invoice',
  'erp_list_payment_entries',
  'erp_create_payment_entry',
  'erp_list_journal_entries',
  'erp_create_journal_entry',
  'erp_list_gl_entries',
  'erp_profit_and_loss',
  'erp_list_projects',
  'erp_create_project',
  'erp_list_tasks',
  'erp_create_task',
  ...SHARED_PLATFORM,
  'kanban_move_status',
];

/** Maker B — Ops / stock / fulfillment / buying (company read; write owned by Maker A). */
const ERP_MAKER_B_TOOLS = [
  ...ERP_COMPANY_READ,
  'erp_create_resource',
  'erp_update_resource',
  'erp_list_items',
  'erp_create_item',
  'erp_list_customers',
  'erp_create_customer',
  'erp_list_sales_orders',
  'erp_list_purchase_orders',
  'erp_create_purchase_order',
  'erp_list_delivery_notes',
  'erp_create_delivery_note',
  'erp_list_material_requests',
  'erp_create_material_request',
  'erp_list_purchase_invoices',
  'erp_list_projects',
  'erp_create_project',
  'erp_list_tasks',
  'erp_create_task',
  ...SHARED_PLATFORM,
  'kanban_move_status',
];

// Keep explicit alias for docs/MCP parity — union of makers equals full operational catalog
const ERP_MAKER_TOOLS = ALL_ERP_TOOLS.concat(SHARED_PLATFORM, ['kanban_move_status']);

/** Checker: read + submit/cancel gates + Kanban/workflow approvals */
const ERP_CHECKER_TOOLS = [
  'erp_status',
  'erp_sync_org',
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
  ...ERP_CHECKER_GATE_TOOLS,
  'kanban_create_task',
  'kanban_get_task',
  'kanban_move_status',
  'kanban_assign_task',
  'kanban_reassign_to_coo',
  'agent_workflow_certify_start',
  'agent_workflow_certify_status',
  'agent_workflow_certify_resume',
  'notify_ceo',
  'ceo_profile',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_rag',
  'learnings_summary',
  'status_checker',
];

const PNL_TOOLS = [
  'erp_status',
  'erp_sync_org',
  'erp_get_company',
  'erp_list_fiscal_years',
  'erp_profit_and_loss',
  'erp_list_gl_entries',
  'erp_list_journal_entries',
  'erp_list_sales_invoices',
  'erp_list_purchase_invoices',
  'erp_list_payment_entries',
  'erp_list_resource',
  'erp_get_resource',
  ...SHARED_PLATFORM,
];

const INVOICE_TOOLS = [
  'erp_status',
  'erp_sync_org',
  'erp_get_company',
  'erp_list_sales_invoices',
  'erp_create_sales_invoice',
  'erp_list_purchase_invoices',
  'erp_create_purchase_invoice',
  'erp_list_sales_orders',
  'erp_list_quotations',
  'erp_list_customers',
  'erp_create_customer',
  'erp_list_items',
  'erp_create_item',
  'erp_list_payment_entries',
  'erp_create_payment_entry',
  'erp_list_resource',
  'erp_get_resource',
  'erp_create_resource',
  'erp_update_resource',
  ...SHARED_PLATFORM,
  'kanban_move_status',
];

const PROJECT_TOOLS = [
  'erp_status',
  'erp_sync_org',
  'erp_get_company',
  'erp_list_projects',
  'erp_create_project',
  'erp_list_tasks',
  'erp_create_task',
  'erp_list_customers',
  'erp_list_sales_orders',
  'erp_list_sales_invoices',
  'erp_list_items',
  'erp_list_resource',
  'erp_get_resource',
  'erp_create_resource',
  ...SHARED_PLATFORM,
  'kanban_move_status',
];

function ownerSlug(ownerUserId) {
  return (
    String(ownerUserId || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 12) || 'ceo'
  );
}

function packDefs(ownerUserId) {
  const s = ownerSlug(ownerUserId);
  return [
    {
      id: ('erp-s1-' + s).slice(0, 40),
      name: 'ERP Maker A',
      role:
        'ERP Maker A (Finance/Setup) — company chart, fiscal years, accounts, customers, quotations, orders, ' +
        'invoices, payments, journals, P&L for the CEO company. Use erp_get_company / erp_create_fiscal_year / ' +
        'erp_* resource. Draft only — Checker submits. Kanban protocol: when a draft is ready to POST, create a Checker card titled [ERP] Submit {doctype} {name}; never erp_submit_doc/cancel. On FINDING: fix and reassign Checker (max ~3 then notify_ceo). Optional: seed workflow run erp maker checker. Org sync optional. Pair with Maker B. Never cross company.',
      department: 'Finance',
      tools: ERP_MAKER_A_TOOLS,
    },
    {
      id: ('erp-s2-' + s).slice(0, 40),
      name: 'ERP Maker B',
      role:
        'ERP Maker B (Ops/Stock) — materials, delivery notes, purchase orders, stock entries, projects/tasks. ' +
        'Can erp_get_company + fiscal year read. Draft-first; Kanban protocol: when a draft is ready to POST, create a Checker card titled [ERP] Submit {doctype} {name}; never erp_submit_doc/cancel. On FINDING: fix and reassign Checker (max ~3 then notify_ceo). Optional: seed workflow run erp maker checker. Org sync optional. Independent from Maker A.',
      department: 'Operations',
      tools: ERP_MAKER_B_TOOLS,
    },
    {
      id: ('erp-ap-' + s).slice(0, 40),
      name: 'ERP Checker',
      role:
        'ERP Checker — review Maker drafts and gate submit/cancel (erp_submit_doc, erp_cancel_doc). Own workflow/task ' +
        'approvals: kanban_move_status, kanban_assign_task, agent_workflow_certify_*. Read-only list tools for audit. ' +
        'Escalate ambiguity to CEO via notify_ceo. Do not create high-volume transactional drafts.',
      department: 'Finance',
      tools: ERP_CHECKER_TOOLS,
    },
    {
      id: ('erp-pnl-' + s).slice(0, 40),
      name: 'ERP P&L Agent',
      role:
        'Finance specialist for company Profit & Loss on ERPNext. Run erp_profit_and_loss and erp_list_gl_entries only; ' +
        'never invent numbers. Hand posting work to ERP Makers/Checker.',
      department: 'Finance',
      tools: PNL_TOOLS,
    },
    {
      id: ('erp-inv-' + s).slice(0, 40),
      name: 'ERP Invoice Agent',
      role:
        'Accounts specialist for Sales/Purchase invoices on ERPNext. Draft invoices; submit only when approved by Checker/CEO.',
      department: 'Finance',
      tools: INVOICE_TOOLS,
    },
    {
      id: ('erp-pm-' + s).slice(0, 40),
      name: 'ERP Project Manager',
      role:
        'Project specialist: Projects and Tasks on ERPNext company scope only.',
      department: 'Operations',
      tools: PROJECT_TOOLS,
    },
  ];
}

export async function ensurePrefabErpAgents(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });

  const profile = getBusinessProfile(owner);
  if (profile.erp_provider !== 'erpnext') {
    return { ok: false, skipped: true, reason: 'erp_provider is not erpnext', agents: [] };
  }

  const defs = packDefs(owner);
  const created = [];
  const ensured = [];

  for (const def of defs) {
    const row = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(def.id);
    if (row) {
      try {
        if (row.owner_user_id && row.owner_user_id !== owner) {
          console.warn('[prefab-erp] agent ' + def.id + ' owned by ' + row.owner_user_id + ', skip for ' + owner);
          continue;
        }
        grantUserAgent(owner, def.id);
        setAgentToolGrants(row, def.tools);
        try {
          getDb()
            .prepare(
              'UPDATE agents SET name = ?, role = ?, department = ? WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)'
            )
            .run(def.name, def.role, def.department, def.id, owner);
        } catch (_) {}
      } catch (e) {
        console.warn('[prefab-erp] refresh grants', def.id, e && e.message);
      }
      ensured.push(def.id);
      continue;
    }
    try {
      const agent = await createFullAgent({
        id: def.id,
        name: def.name,
        role: def.role,
        department: def.department,
        ownerUserId: owner,
        tools: def.tools,
      });
      created.push(agent.id);
      ensured.push(agent.id);
    } catch (e) {
      const again = getDb().prepare('SELECT id FROM agents WHERE id = ?').get(def.id);
      if (again) {
        grantUserAgent(owner, def.id);
        ensured.push(def.id);
      } else {
        console.warn('[prefab-erp] create failed', def.id, e && (e.message || e));
      }
    }
  }

  setPrefabErpAgentIds(owner, ensured);
  try {
    const { seedMakerCheckerWorkflowsForOwner } = await import(
      '../../scripts/seed-business-core-maker-checker-workflows.js'
    );
    const wf = seedMakerCheckerWorkflowsForOwner(owner);
    if (wf?.results?.length) {
      console.info(
        '[prefab-erp] maker-checker workflows owner=%s %s',
        owner,
        JSON.stringify(wf.results)
      );
    }
  } catch (e) {
    console.warn('[prefab-erp] maker-checker workflow seed skipped:', e?.message || e);
  }
  return { ok: true, created: created, agents: ensured };
}

export function listPrefabErpAgentIdsForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const s = ownerSlug(owner);
  const ids = new Set(packDefs(owner).map((d) => d.id));
  for (const prefix of ['erp-pnl-', 'erp-inv-', 'erp-pm-', 'erp-s1-', 'erp-s2-', 'erp-ap-']) {
    ids.add((prefix + s).slice(0, 40));
  }
  try {
    for (const id of getBusinessProfile(owner).prefab_erp_agent_ids || []) {
      if (id) ids.add(String(id));
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}

export function revokePrefabErpAgentsFromOrg(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  const ids = listPrefabErpAgentIdsForOwner(owner);
  const revoked = [];
  for (const id of ids) {
    try {
      revokeUserAgent(owner, id);
      revoked.push(id);
    } catch (e) {
      console.warn('[prefab-erp] revoke', id, e && e.message);
    }
  }
  setPrefabErpAgentIds(owner, []);
  if (revoked.length) {
    console.info('[prefab-erp] removed from org owner=%s count=%s', owner, revoked.length);
  }
  return { ok: true, revoked, agents: [] };
}

export async function syncPrefabErpAgentsForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const profile = getBusinessProfile(owner);
  if (profile.erp_provider === 'erpnext') {
    return ensurePrefabErpAgents(owner);
  }
  return revokePrefabErpAgentsFromOrg(owner);
}