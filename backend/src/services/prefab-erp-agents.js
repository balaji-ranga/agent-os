/**
 * Prefabricated ERP workforce when Profile ERP = ERPNext.
 * Agent pack: company-blueprints/standard/business-core/agents-erp-erpnext.json
 * Workflow: workflow-erp-maker-checker.json (install after agents).
 */
import { getDb } from '../db/schema.js';
import { createFullAgent } from './create-full-agent.js';
import { getBusinessProfile, setPrefabErpAgentIds } from './company-business-profile.js';
import { setAgentToolGrants } from './openclaw-agent-tools.js';
import { grantUserAgent, revokeUserAgent } from './users.js';
import {
  getErpAgentDefs,
  loadErpAgentPack,
  ownerSlug as packOwnerSlug,
} from './company-blueprints/standard-prefabs.js';
import { seedMakerCheckerWorkflowsForBusinessProfile } from './business-core-maker-checker-workflows.js';

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

export const ERP_CHECKER_GATE_TOOLS = ['erp_submit_doc', 'erp_cancel_doc'];

function packDefs(ownerUserId) {
  const defs = getErpAgentDefs(ownerUserId);
  if (!defs.length) {
    console.warn('[prefab-erp] empty agent pack (erpnext)');
  }
  return defs;
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
  let workflows = null;
  try {
    const profileAfter = getBusinessProfile(owner);
    workflows = seedMakerCheckerWorkflowsForBusinessProfile(owner, profileAfter);
    if (workflows?.results?.length) {
      console.info(
        '[prefab-erp] maker-checker workflows owner=%s %s',
        owner,
        JSON.stringify(workflows.results)
      );
    } else if (workflows?.skipped?.length) {
      console.info(
        '[prefab-erp] maker-checker seed skipped owner=%s %s',
        owner,
        JSON.stringify(workflows.skipped)
      );
    }
  } catch (e) {
    console.warn('[prefab-erp] maker-checker workflow seed failed:', e?.message || e);
  }
  return { ok: true, created, agents: ensured, workflows };
}

export function listPrefabErpAgentIdsForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const s = packOwnerSlug(owner);
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
  // Keep loadErp pack warm for diagnostics
  try {
    void loadErpAgentPack();
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