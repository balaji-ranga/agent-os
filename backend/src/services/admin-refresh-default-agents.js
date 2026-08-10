/**
 * Admin: refresh platform default agents from company-blueprints/standard/
 * (platform-agents.json → COO / Workflow Builder / Platform Help MD + grants)
 * and, when entitled, Business Core prefabs (CRM/ERP packs + maker-checker workflows).
 */
import { getDb } from '../db/schema.js';
import {
  grantStandardAgents,
  grantUserAgent,
  listDefaultOnboardAgentIds,
} from './users.js';
import {
  ensureTenantOpenClawAgent,
  forcePushTemplateDocs,
  tenantWorkspacePath,
  baseOcIdFromAgent,
} from './openclaw-tenant.js';
import { setAgentToolGrants, syncAllowlistsFile } from './openclaw-agent-tools.js';
import { syncOrgContextToWorkspace } from './org-context.js';
import { initCeoDb } from '../db/ceo-db.js';
import { usesTenantCeoDb } from '../db/ceo-db-config.js';
import {
  getPlatformLeanAgentDefs,
  getPlatformLeanAgentIds,
  listStandardPrefabInventory,
  invalidateStandardPrefabCache,
} from './company-blueprints/standard-prefabs.js';
import { getBusinessProfile } from './company-business-profile.js';
import { ensurePrefabCrmAgents } from './prefab-crm-agents.js';
import { ensurePrefabErpAgents } from './prefab-erp-agents.js';
import { seedMakerCheckerWorkflowsForBusinessProfile } from './business-core-maker-checker-workflows.js';
import { DEFAULT_AGENT_DEPARTMENTS } from '../db/seed-default-agents.js';

function resolveTargetCeoIds({ allUsers = false, userIds = [] } = {}) {
  const db = getDb();
  if (allUsers) {
    return db
      .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY created_at`)
      .all()
      .map((r) => r.id);
  }
  const wanted = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!wanted.length) throw new Error('user_ids required when all_users is false');
  const out = [];
  for (const id of wanted) {
    const row = db.prepare(`SELECT id, role, enabled FROM platform_users WHERE id = ?`).get(id);
    if (!row) throw new Error(`User not found: ${id}`);
    if (row.role !== 'ceo') throw new Error(`Not a CEO user: ${id}`);
    if (!row.enabled) throw new Error(`User disabled: ${id}`);
    out.push(row.id);
  }
  return out;
}

/**
 * Sync standard catalog rows (name/role/department/flags) from platform-agents.json.
 * Does not create missing agents if seeds never ran — resolveAgentRows will fail clearly.
 */
export function syncPlatformAgentCatalogFromStandardPack() {
  invalidateStandardPrefabCache();
  const db = getDb();
  const defs = getPlatformLeanAgentDefs();
  const updated = [];
  for (const def of defs) {
    const row = db
      .prepare(
        `SELECT id FROM agents WHERE LOWER(id) = ? OR LOWER(openclaw_agent_id) = ?`
      )
      .get(def.id, def.id);
    if (!row) continue;
    const dept =
      def.department ||
      DEFAULT_AGENT_DEPARTMENTS[def.id] ||
      (def.is_coo ? 'Executive' : 'Operations');
    try {
      db.prepare(
        `UPDATE agents SET
           name = ?,
           role = ?,
           department = COALESCE(NULLIF(?, ''), department),
           is_coo = ?,
           agent_type = 'standard'
         WHERE id = ?`
      ).run(def.name, def.role, dept, def.is_coo ? 1 : 0, row.id);
      updated.push(row.id);
    } catch (e) {
      console.warn('[refresh-default-agents] catalog sync', def.id, e?.message || e);
    }
  }
  return { defs, updated };
}

function resolveAgentRows(agentIds) {
  const db = getDb();
  const packIds = getPlatformLeanAgentIds();
  const requested =
    Array.isArray(agentIds) && agentIds.length
      ? agentIds.map((id) => String(id).trim().toLowerCase()).filter(Boolean)
      : packIds;
  const resolved = [];
  for (const id of requested) {
    const row = db
      .prepare(
        `SELECT * FROM agents
         WHERE LOWER(id) = ? OR LOWER(openclaw_agent_id) = ?`
      )
      .get(id, id);
    if (!row) throw new Error(`Default agent not found in catalog: ${id} (seed from platform-agents.json)`);
    resolved.push(row);
  }
  return resolved;
}

/**
 * Push MD from the pack's declared workspace template (folder under openclaw-workspace-templates).
 */
function pushLeanWorkspaceFromPack(agentRow, leanDef, ceoUserId, { forceIdentityMd }) {
  const ensured = ensureTenantOpenClawAgent(agentRow, ceoUserId);
  const baseId = leanDef?.template_base_id || baseOcIdFromAgent(agentRow);
  const ws = ensured.workspacePath || tenantWorkspacePath(ceoUserId, baseId);
  const pushed = forcePushTemplateDocs(baseId, ws, { forceIdentity: forceIdentityMd !== false });
  return {
    agent_id: agentRow.id,
    openclaw_runtime_id: ensured.openclawAgentId,
    workspace_path: ws,
    template_base_id: baseId,
    md_copied: pushed.copied,
    source: 'company-blueprints/standard/platform-agents.json',
  };
}

/**
 * Re-materialize Business Core agents + MC workflows from standard JSON packs
 * when the CEO profile already enables CRM and/or ERP.
 */
async function refreshBusinessCoreFromStandardPacks(ceoUserId) {
  const profile = getBusinessProfile(ceoUserId);
  const out = {
    crm_provider: profile.crm_provider || null,
    erp_provider: profile.erp_provider || null,
    crm: null,
    erp: null,
    workflows: null,
  };
  if (profile.crm_provider === 'twenty' || profile.crm_provider === 'erpnext') {
    out.crm = await ensurePrefabCrmAgents(ceoUserId);
  } else {
    out.crm = { skipped: true, reason: 'crm_provider not twenty|erpnext' };
  }
  if (profile.erp_provider === 'erpnext') {
    out.erp = await ensurePrefabErpAgents(ceoUserId);
  } else {
    out.erp = { skipped: true, reason: 'erp_provider not erpnext' };
  }
  // ensure* already seeds MC for its side; one more pass covers dual CRM+ERP edges
  try {
    out.workflows = seedMakerCheckerWorkflowsForBusinessProfile(ceoUserId, getBusinessProfile(ceoUserId));
  } catch (e) {
    out.workflows = { error: e?.message || String(e) };
  }
  return out;
}

/**
 * @param {{
 *   allUsers?: boolean,
 *   userIds?: string[],
 *   agentIds?: string[],
 *   forceIdentityMd?: boolean,
 *   syncOrg?: boolean,
 *   regrantDefaults?: boolean,
 *   includeBusinessCore?: boolean,
 * }} opts
 */
export async function refreshDefaultAgentsForUsers(opts = {}) {
  const {
    allUsers = false,
    userIds = [],
    agentIds,
    forceIdentityMd = true,
    syncOrg = true,
    regrantDefaults = true,
    includeBusinessCore = true,
  } = opts;

  const inventory = listStandardPrefabInventory();
  const catalogSync = syncPlatformAgentCatalogFromStandardPack();
  const leanDefsById = new Map(catalogSync.defs.map((d) => [d.id, d]));
  const ceoIds = resolveTargetCeoIds({ allUsers, userIds });
  const agents = resolveAgentRows(agentIds);
  const results = [];

  for (const ceoUserId of ceoIds) {
    const ceoResult = {
      user_id: ceoUserId,
      source: 'company-blueprints/standard/',
      agents: [],
      granted: [],
      business_core: null,
      error: null,
    };
    try {
      if (usesTenantCeoDb(ceoUserId)) initCeoDb(ceoUserId);
      if (regrantDefaults) {
        ceoResult.granted = grantStandardAgents(ceoUserId);
        for (const a of agents) {
          try {
            grantUserAgent(ceoUserId, a.id);
          } catch (_) {
            /* already granted */
          }
        }
      }

      for (const agent of agents) {
        const leanDef = leanDefsById.get(String(agent.id).toLowerCase());
        const pushed = pushLeanWorkspaceFromPack(agent, leanDef, ceoUserId, { forceIdentityMd });
        if (syncOrg !== false) {
          await syncOrgContextToWorkspace(agent, ceoUserId, pushed.workspace_path);
        }
        // COO / lean agents keep grant rows; optionally reassert empty tool allowlist from DB grants
        try {
          if (Array.isArray(agent?.tools) && agent.tools.length) {
            setAgentToolGrants(agent, agent.tools);
          }
        } catch (_) {
          /* no tools column / ignore */
        }
        ceoResult.agents.push(pushed);
      }

      if (includeBusinessCore !== false) {
        ceoResult.business_core = await refreshBusinessCoreFromStandardPacks(ceoUserId);
      }
    } catch (e) {
      ceoResult.error = e?.message || String(e);
      console.warn('[refresh-default-agents] user=%s err=%s', ceoUserId, ceoResult.error);
    }
    results.push(ceoResult);
  }

  try {
    syncAllowlistsFile();
  } catch (e) {
    console.warn('[refresh-default-agents] syncAllowlistsFile:', e?.message || e);
  }

  const failed = results.filter((r) => r.error);
  const bcOk = results.filter(
    (r) =>
      r.business_core &&
      ((r.business_core.crm && !r.business_core.crm.skipped && r.business_core.crm.ok !== false) ||
        (r.business_core.erp && !r.business_core.erp.skipped && r.business_core.erp.ok !== false))
  ).length;

  console.info(
    '[refresh-default-agents] users=%s ok=%s failed=%s lean=%s business_core_refreshed=%s pack_ids=%s',
    ceoIds.length,
    results.length - failed.length,
    failed.length,
    agents.map((a) => a.id).join(','),
    bcOk,
    getPlatformLeanAgentIds().join(',')
  );

  return {
    ok: failed.length === 0,
    source: 'company-blueprints/standard/',
    inventory,
    catalog_synced: catalogSync.updated,
    default_agent_ids: agents.map((a) => a.id),
    available_defaults: listDefaultOnboardAgentIds(),
    platform_lean_ids: getPlatformLeanAgentIds(),
    include_business_core: includeBusinessCore !== false,
    users_targeted: ceoIds.length,
    users_ok: results.length - failed.length,
    users_failed: failed.length,
    users_business_core_refreshed: bcOk,
    force_identity_md: forceIdentityMd !== false,
    results,
  };
}
