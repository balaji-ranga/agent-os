/**
 * Prefabricated specialized ERP AI employees when Profile ERP = ERPNext:
 * - ERP P&L Agent (finance / reports)
 * - ERP Invoice Agent (sales & purchase invoices)
 * - ERP Project Manager (projects & tasks)
 * Owner-scoped grants + erp_* content tools (same surface as mcp-flolah-erp).
 */
import { getDb } from '../db/schema.js';
import { createFullAgent } from './create-full-agent.js';
import { getBusinessProfile, setPrefabErpAgentIds } from './company-business-profile.js';
import { setAgentToolGrants } from './openclaw-agent-tools.js';
import { grantUserAgent, revokeUserAgent } from './users.js';

const SHARED = [
  'erp_status',
  'erp_sync_org',
  'erp_list_resource',
  'erp_get_resource',
  'kanban_create_task',
  'kanban_move_status',
  'notify_ceo',
  'ceo_profile',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_rag',
  'learnings_summary',
];

const PNL_TOOLS = [
  ...SHARED,
  'erp_profit_and_loss',
  'erp_list_gl_entries',
  'erp_list_sales_invoices',
  'erp_list_purchase_invoices',
  'erp_list_sales_orders',
  'erp_list_customers',
  'erp_list_items',
  'erp_list_quotations',
];

const INVOICE_TOOLS = [
  ...SHARED,
  'erp_list_sales_invoices',
  'erp_create_sales_invoice',
  'erp_list_purchase_invoices',
  'erp_create_purchase_invoice',
  'erp_list_sales_orders',
  'erp_list_quotations',
  'erp_list_customers',
  'erp_create_customer',
  'erp_list_items',
  'erp_list_leads',
  'erp_create_lead',
  'erp_create_resource',
  'erp_list_gl_entries',
];

const PROJECT_TOOLS = [
  ...SHARED,
  'erp_list_projects',
  'erp_create_project',
  'erp_list_tasks',
  'erp_create_task',
  'erp_create_resource',
  'erp_list_customers',
  'erp_list_sales_orders',
  'erp_list_sales_invoices',
  'erp_list_items',
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
      id: ('erp-pnl-' + s).slice(0, 40),
      name: 'ERP P&L Agent',
      role:
        'Finance specialist for company Profit & Loss on platform ERPNext. ' +
        'Run erp_profit_and_loss and erp_list_gl_entries for the CEO company only; explain income vs expense, ' +
        'variance, and margin. Never invent numbers — only ERP tool output. Draft commentary for the CEO; ' +
        'do not post journals unless CEO explicitly asks and tools allow. Coordinate Invoice Agent for invoice questions. ' +
        'Tools: erp_profit_and_loss, erp_list_gl_entries, invoice list tools, erp_sync_org.',
      department: 'Finance',
      tools: PNL_TOOLS,
    },
    {
      id: ('erp-inv-' + s).slice(0, 40),
      name: 'ERP Invoice Agent',
      role:
        'Accounts specialist for Sales Invoice and Purchase Invoice on ERPNext (company-scoped). ' +
        'Create draft invoices from CEO intent using erp_create_sales_invoice / erp_create_purchase_invoice; ' +
        'list and inspect with list/get tools. Validate party, items, tax fields when possible. ' +
        'Never use another company id. Escalate payments/write-offs that need Checker review. ' +
        'Tools: erp_* invoice create/list, customers, items, sales orders.',
      department: 'Finance',
      tools: INVOICE_TOOLS,
    },
    {
      id: ('erp-pm-' + s).slice(0, 40),
      name: 'ERP Project Manager',
      role:
        'Project specialist on ERPNext: Projects and Tasks for the CEO company only. ' +
        'Create and list projects/tasks (erp_create_project, erp_list_projects, erp_list_tasks, erp_create_task). ' +
        'Track status, link customers/sales orders when provided, and notify_ceo on blockers. ' +
        'Do not touch GL postings or invoices unless needed for project status — hand off to Invoice or P&L agents. ' +
        'Tools: erp project/task suite + customers + erp_sync_org.',
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
  return { ok: true, created: created, agents: ensured };
}

/**
 * Current + legacy ERP prefab ids (specialists and older Maker A/B/Checker packs).
 */
export function listPrefabErpAgentIdsForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const s = ownerSlug(owner);
  const ids = new Set(packDefs(owner).map((d) => d.id));
  for (const prefix of [
    'erp-pnl-',
    'erp-inv-',
    'erp-pm-',
    'erp-s1-',
    'erp-s2-',
    'erp-ap-',
  ]) {
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

/**
 * Remove platform ERP agents from CEO org when ERP is not ERPNext.
 * Does not delete agent rows; only disables user_agents (re-grant on re-select).
 */
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

/** Ensure granted only when platform ERP = ERPNext; otherwise remove from org. */
export async function syncPrefabErpAgentsForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const profile = getBusinessProfile(owner);
  if (profile.erp_provider === 'erpnext') {
    return ensurePrefabErpAgents(owner);
  }
  return revokePrefabErpAgentsFromOrg(owner);
}
