/**
 * Prefabricated CRM workforce for platform Twenty / ERPNext CRM.
 * Agent packs: company-blueprints/standard/business-core/agents-crm-*.json
 * Workflow templates: same folder, workflow-crm-maker-checker.json
 * Provisioned when the CEO selects platform CRM on Profile / Company setup Apply.
 */
import { getDb } from '../db/schema.js';
import { createFullAgent } from './create-full-agent.js';
import { getBusinessProfile, setPrefabCrmAgentIds } from './company-business-profile.js';
import { setAgentToolGrants } from './openclaw-agent-tools.js';
import { grantUserAgent, revokeUserAgent } from './users.js';
import { getCrmAgentDefs, ownerSlug as packOwnerSlug } from './company-blueprints/standard-prefabs.js';
import { seedMakerCheckerWorkflowsForBusinessProfile } from './business-core-maker-checker-workflows.js';

function packDefs(ownerUserId, provider = 'twenty') {
  const defs = getCrmAgentDefs(ownerUserId, provider);
  if (!defs.length) {
    console.warn('[prefab-crm] empty agent pack for provider=%s', provider);
  }
  return defs;
}

/** Idempotent: create missing prefab agents and grant to this CEO only. */
export async function ensurePrefabCrmAgents(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });

  const profile = getBusinessProfile(owner);
  if (profile.crm_provider !== 'twenty' && profile.crm_provider !== 'erpnext') {
    return { ok: false, skipped: true, reason: 'crm_provider is not twenty or erpnext', agents: [] };
  }

  const defs = packDefs(owner, profile.crm_provider);
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
  let workflows = null;
  try {
    const profileAfter = getBusinessProfile(owner);
    workflows = seedMakerCheckerWorkflowsForBusinessProfile(owner, profileAfter);
    if (workflows?.results?.length) {
      console.info(
        '[prefab-crm] maker-checker workflows owner=%s %s',
        owner,
        JSON.stringify(workflows.results)
      );
    } else if (workflows?.skipped?.length) {
      console.info(
        '[prefab-crm] maker-checker seed skipped owner=%s %s',
        owner,
        JSON.stringify(workflows.skipped)
      );
    }
  } catch (e) {
    console.warn('[prefab-crm] maker-checker workflow seed failed:', e?.message || e);
  }
  return { ok: true, created, agents: ensured, workflows };
}

export function listPrefabCrmAgentIdsForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const ids = new Set([
    ...packDefs(owner, 'twenty').map((d) => d.id),
    ...packDefs(owner, 'erpnext').map((d) => d.id),
  ]);
  try {
    for (const id of getBusinessProfile(owner).prefab_crm_agent_ids || []) {
      if (id) ids.add(String(id));
    }
  } catch {
    /* ignore */
  }
  try {
    const s = packOwnerSlug(owner);
    for (const prefix of ['crm-s1-', 'crm-s2-', 'crm-ap-']) {
      ids.add(`${prefix}${s}`.slice(0, 40));
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}

export function revokePrefabCrmAgentsFromOrg(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  const ids = listPrefabCrmAgentIdsForOwner(owner);
  const revoked = [];
  for (const id of ids) {
    try {
      revokeUserAgent(owner, id);
      revoked.push(id);
    } catch (e) {
      console.warn('[prefab-crm] revoke', id, e?.message || e);
    }
  }
  setPrefabCrmAgentIds(owner, []);
  if (revoked.length) {
    console.info('[prefab-crm] removed from org owner=%s count=%s', owner, revoked.length);
  }
  return { ok: true, revoked, agents: [] };
}

export async function syncPrefabCrmAgentsForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const profile = getBusinessProfile(owner);
  if (profile.crm_provider === 'twenty' || profile.crm_provider === 'erpnext') {
    return ensurePrefabCrmAgents(owner);
  }
  return revokePrefabCrmAgentsFromOrg(owner);
}

export function getPrefabCrmAgentIds(ownerUserId) {
  return getBusinessProfile(ownerUserId).prefab_crm_agent_ids || [];
}