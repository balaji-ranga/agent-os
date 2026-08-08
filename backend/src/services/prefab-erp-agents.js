/**
 * Prefabricated ERP workforce for platform ERPNext (Profile ERP = ERPNext):
 * 2 Makers + 1 Checker, owner-scoped + user_agents grant + erp_* content tools.
 * Yes: provisioned when the CEO selects platform ERP on Profile / Company setup Apply.
 */
import { getDb } from '../db/schema.js';
import { createFullAgent } from './create-full-agent.js';
import { getBusinessProfile, setPrefabErpAgentIds } from './company-business-profile.js';
import { setAgentToolGrants } from './openclaw-agent-tools.js';
import { grantUserAgent } from './users.js';

const ERP_TOOLS = [
  'erp_status',
  'erp_list_customers',
  'erp_create_customer',
  'erp_list_leads',
  'erp_create_lead',
  'erp_list_items',
  'erp_list_quotations',
  'erp_list_sales_orders',
  'erp_list_projects',
  'erp_list_resource',
  'erp_create_resource',
  'erp_get_resource',
  'erp_sync_org',
  'kanban_create_task',
  'kanban_move_status',
  'notify_ceo',
  'ceo_profile',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_rag',
  'learnings_summary',
];

const ERP_APPROVER_TOOLS = [
  'erp_status',
  'erp_list_customers',
  'erp_list_leads',
  'erp_list_items',
  'erp_list_quotations',
  'erp_list_sales_orders',
  'erp_list_projects',
  'erp_list_resource',
  'erp_get_resource',
  'erp_sync_org',
  'kanban_create_task',
  'kanban_move_status',
  'notify_ceo',
  'ceo_profile',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_rag',
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
      id: `erp-s1-${s}`.slice(0, 40),
      name: 'ERP Maker A',
      role:
        'ERP Maker - ops and projects on platform ERPNext via Flolah ERP tools (erp_* content tools; same surface as MCP mcp-flolah-erp). Can erp_sync_org from Flolah departments + AI employees.',
      department: 'Operations',
      tools: ERP_TOOLS,
    },
    {
      id: `erp-s2-${s}`.slice(0, 40),
      name: 'ERP Maker B',
      role:
        'ERP Maker - finance/books side via erp_* tools (MCP mcp-flolah-erp). Can erp_sync_org.',
      department: 'Finance',
      tools: ERP_TOOLS,
    },
    {
      id: `erp-ap-${s}`.slice(0, 40),
      name: 'ERP Checker',
      role:
        'ERP Checker - gate spend and book posts; prefer read + recommend unless CEO confirms. Has erp_status + erp_sync_org for controlled sync review.',
      department: 'Finance',
      tools: ERP_APPROVER_TOOLS,
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
    const row = getDb().prepare(`SELECT * FROM agents WHERE id = ?`).get(def.id);
    if (row) {
      try {
        if (row.owner_user_id && row.owner_user_id !== owner) {
          console.warn(
            `[prefab-erp] agent ${def.id} owned by ${row.owner_user_id}, skip for ${owner}`
          );
          continue;
        }
        grantUserAgent(owner, def.id);
        setAgentToolGrants(row, def.tools);
        try {
          getDb()
            .prepare(
              `UPDATE agents SET name = ?, role = ?, department = ? WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)`
            )
            .run(def.name, def.role, def.department, def.id, owner);
        } catch (_) {}
      } catch (e) {
        console.warn('[prefab-erp] refresh grants', def.id, e?.message);
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
      const again = getDb().prepare(`SELECT id FROM agents WHERE id = ?`).get(def.id);
      if (again) {
        grantUserAgent(owner, def.id);
        ensured.push(def.id);
      } else {
        console.warn('[prefab-erp] create failed', def.id, e?.message || e);
      }
    }
  }

  setPrefabErpAgentIds(owner, ensured);
  return { ok: true, created, agents: ensured };
}
