/**
 * Prefabricated CRM workforce for platform Twenty (Profile CRM = Twenty):
 * 2 Makers + 1 Checker, owner-scoped + user_agents grant + crm_* content tools.
 * Yes: provisioned when the CEO selects platform CRM on Profile / Company setup Apply.
 */
import { getDb } from '../db/schema.js';
import { createFullAgent } from './create-full-agent.js';
import { getBusinessProfile, setPrefabCrmAgentIds } from './company-business-profile.js';
import { setAgentToolGrants } from './openclaw-agent-tools.js';
import { grantUserAgent } from './users.js';

const CRM_TOOLS = [
  'crm_status',
  'crm_list_people',
  'crm_create_person',
  'crm_list_companies',
  'crm_create_company',
  'crm_list_opportunities',
  'crm_list_deals',
  'crm_create_opportunity',
  'crm_create_deal',
  'crm_update_opportunity',
  'crm_list_leads',
  'crm_create_lead',
  'crm_list_notes',
  'crm_list_tasks',
  'crm_sync_org',
  'kanban_create_task',
  'kanban_move_status',
  'notify_ceo',
  'ceo_profile',
  'master_data_list_tables',
  'master_data_list_rows',
  'master_data_rag',
  'learnings_summary',
  'summarize_url',
];

const CRM_APPROVER_TOOLS = [
  'crm_status',
  'crm_list_people',
  'crm_list_companies',
  'crm_list_opportunities',
  'crm_list_deals',
  'crm_list_leads',
  'crm_list_notes',
  'crm_list_tasks',
  'crm_sync_org',
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
      id: `crm-s1-${s}`.slice(0, 40),
      name: 'CRM Maker A',
      role:
        'CRM Maker - accounts, contacts, pipeline execution on platform Twenty via Flolah CRM tools (crm_* content tools; same surface as MCP mcp-flolah-crm). Can crm_sync_org from Flolah departments + AI employees.',
      department: 'Sales',
      tools: CRM_TOOLS,
    },
    {
      id: `crm-s2-${s}`.slice(0, 40),
      name: 'CRM Maker B',
      role:
        'CRM Maker - enrichment, research, follow-ups on platform Twenty via Flolah CRM tools (crm_*; MCP mcp-flolah-crm). Can crm_sync_org.',
      department: 'Sales',
      tools: CRM_TOOLS,
    },
    {
      id: `crm-ap-${s}`.slice(0, 40),
      name: 'CRM Checker',
      role:
        'CRM Checker - review and gate risky CRM changes; prefer read + recommend unless CEO confirms. Has crm_status/list + crm_sync_org for controlled sync review.',
      department: 'Sales',
      tools: CRM_APPROVER_TOOLS,
    },
  ];
}

/** Idempotent: create missing prefab agents and grant to this CEO only. */
export async function ensurePrefabCrmAgents(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });

  const profile = getBusinessProfile(owner);
  if (profile.crm_provider !== 'twenty') {
    return { ok: false, skipped: true, reason: 'crm_provider is not twenty', agents: [] };
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
            `[prefab-crm] agent ${def.id} owned by ${row.owner_user_id}, skip for ${owner}`
          );
          continue;
        }
        grantUserAgent(owner, def.id);
        setAgentToolGrants(row, def.tools);
        // Keep display names aligned with Maker/Checker pack (idempotent re-provision)
        try {
          getDb()
            .prepare(
              `UPDATE agents SET name = ?, role = ?, department = ? WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)`
            )
            .run(def.name, def.role, def.department, def.id, owner);
        } catch (_) {}
      } catch (e) {
        console.warn('[prefab-crm] refresh grants', def.id, e?.message);
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
        console.warn('[prefab-crm] create failed', def.id, e?.message || e);
      }
    }
  }

  setPrefabCrmAgentIds(owner, ensured);
  return { ok: true, created, agents: ensured };
}

export function getPrefabCrmAgentIds(ownerUserId) {
  return getBusinessProfile(ownerUserId).prefab_crm_agent_ids || [];
}
