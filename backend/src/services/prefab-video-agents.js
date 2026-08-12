/**
 * Prefabricated video_content workforce for short-form / Veo storyboard studio.
 * Agents: company-blueprints/standard/video-content/agents.json
 * Workspaces (golden): openclaw-workspace-templates/video-*
 * Workflows: seed via video-content-workflows.js from standard/video-content/
 */
import { getDb } from '../db/schema.js';
import { createFullAgent } from './create-full-agent.js';
import { setAgentToolGrants } from './openclaw-agent-tools.js';
import { grantUserAgent, revokeUserAgent } from './users.js';
import { getVideoAgentDefs, ownerSlug as packOwnerSlug } from './company-blueprints/standard-prefabs.js';
import { seedVideoContentWorkflowsForOwner } from './video-content-workflows.js';
import { seedVideoContentKnowledgeTables } from './video-content-knowledge.js';
import {
  ensureTenantOpenClawAgent,
  forcePushTemplateDocs,
} from './openclaw-tenant.js';

function pushVideoWorkspace(agentRow, def, ownerUserId) {
  const templateBase = def.template_base_id || def.workspace_template_base;
  if (!templateBase) return null;
  try {
    const ensured = ensureTenantOpenClawAgent(
      {
        ...agentRow,
        template_base_id: templateBase,
        workspace_template: def.workspace_template,
      },
      ownerUserId
    );
    const pushed = forcePushTemplateDocs(templateBase, ensured.workspacePath, {
      forceIdentity: true,
    });
    console.info(
      '[prefab-video] workspace template=%s agent=%s files=%s',
      templateBase,
      agentRow.id,
      (pushed.copied || []).join(',')
    );
    return pushed;
  } catch (e) {
    console.warn(
      '[prefab-video] workspace template push failed agent=%s template=%s err=%s',
      agentRow?.id,
      templateBase,
      e?.message || e
    );
    return null;
  }
}

/** Idempotent: create/grant video studio agents for this CEO only. */
export async function ensurePrefabVideoAgents(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });

  const defs = getVideoAgentDefs(owner);
  if (!defs.length) {
    return { ok: false, skipped: true, reason: 'video agent pack empty', agents: [] };
  }

  const created = [];
  const ensured = [];

  for (const def of defs) {
    const row = getDb().prepare(`SELECT * FROM agents WHERE id = ?`).get(def.id);
    if (row) {
      try {
        if (row.owner_user_id && row.owner_user_id !== owner) {
          console.warn(
            `[prefab-video] agent ${def.id} owned by ${row.owner_user_id}, skip for ${owner}`
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
        } catch (_) {
          /* ignore */
        }
        const refreshed = getDb().prepare(`SELECT * FROM agents WHERE id = ?`).get(def.id);
        if (refreshed) pushVideoWorkspace(refreshed, def, owner);
      } catch (e) {
        console.warn('[prefab-video] refresh grants', def.id, e?.message);
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
        template_base_id: def.template_base_id,
        workspace_template: def.workspace_template,
        preserveTemplateWorkspaceDocs: true,
      });
      const createdRow = getDb().prepare(`SELECT * FROM agents WHERE id = ?`).get(agent.id);
      if (createdRow) pushVideoWorkspace(createdRow, def, owner);
      created.push(agent.id);
      ensured.push(agent.id);
    } catch (e) {
      const again = getDb().prepare(`SELECT id FROM agents WHERE id = ?`).get(def.id);
      if (again) {
        grantUserAgent(owner, def.id);
        ensured.push(def.id);
      } else {
        console.warn('[prefab-video] create failed', def.id, e?.message || e);
      }
    }
  }

  let workflows = null;
  let knowledge = null;
  if (opts.seedWorkflows !== false) {
    try {
      workflows = seedVideoContentWorkflowsForOwner(owner, {
        includeStubs: opts.includeStubWorkflows === true,
        prefabIds: ensured,
      });
    } catch (e) {
      console.warn('[prefab-video] workflow seed failed:', e?.message || e);
    }
  }
  if (opts.seedKnowledge !== false) {
    try {
      knowledge = seedVideoContentKnowledgeTables(owner);
    } catch (e) {
      console.warn('[prefab-video] knowledge seed failed:', e?.message || e);
    }
  }

  return { ok: true, created, agents: ensured, workflows, knowledge };
}

/** Full Phase 1 install: agents + W-Reasoning + Master Data tables. */
export async function installVideoContentForOwner(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  console.info('[prefab-video] install start owner=%s', owner);
  const result = await ensurePrefabVideoAgents(owner, {
    seedWorkflows: true,
    seedKnowledge: true,
    includeStubWorkflows: opts.includeStubWorkflows === true,
  });
  console.info(
    '[prefab-video] install done owner=%s agents=%s workflows=%s',
    owner,
    (result.agents || []).join(','),
    JSON.stringify(result.workflows?.results || [])
  );
  return result;
}

export function listPrefabVideoAgentIdsForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const ids = new Set(getVideoAgentDefs(owner).map((d) => d.id));
  try {
    const s = packOwnerSlug(owner);
    for (const prefix of ['video-orch-', 'video-story-', 'video-scene-', 'video-prompt-']) {
      ids.add(`${prefix}${s}`.slice(0, 40));
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}

export function revokePrefabVideoAgentsFromOrg(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  const ids = listPrefabVideoAgentIdsForOwner(owner);
  const revoked = [];
  for (const id of ids) {
    try {
      revokeUserAgent(owner, id);
      revoked.push(id);
    } catch (e) {
      console.warn('[prefab-video] revoke', id, e?.message || e);
    }
  }
  if (revoked.length) {
    console.info('[prefab-video] removed from org owner=%s count=%s', owner, revoked.length);
  }
  return { ok: true, revoked, agents: [] };
}
