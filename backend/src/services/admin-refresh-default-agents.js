/**
 * Admin: refresh default onboard agents (COO / Workflow Builder / Platform Help)
 * template MD files + tool allowlists into CEO tenant workspaces.
 */
import { getDb } from '../db/schema.js';
import {
  DEFAULT_ONBOARD_AGENT_IDS,
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
import { syncAllowlistsFile } from './openclaw-agent-tools.js';
import { syncOrgContextToWorkspace } from './org-context.js';
import { initCeoDb } from '../db/ceo-db.js';
import { usesTenantCeoDb } from '../db/ceo-db-config.js';

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

function resolveAgentIds(agentIds) {
  const db = getDb();
  const requested = Array.isArray(agentIds) && agentIds.length
    ? agentIds.map((id) => String(id).trim().toLowerCase()).filter(Boolean)
    : [...DEFAULT_ONBOARD_AGENT_IDS];
  const resolved = [];
  for (const id of requested) {
    const row = db
      .prepare(
        `SELECT * FROM agents
         WHERE LOWER(id) = ? OR LOWER(openclaw_agent_id) = ?`
      )
      .get(id, id);
    if (!row) throw new Error(`Default agent not found in catalog: ${id}`);
    resolved.push(row);
  }
  return resolved;
}

/**
 * @param {{
 *   allUsers?: boolean,
 *   userIds?: string[],
 *   agentIds?: string[],
 *   forceIdentityMd?: boolean,
 *   syncOrg?: boolean,
 *   regrantDefaults?: boolean,
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
  } = opts;

  const ceoIds = resolveTargetCeoIds({ allUsers, userIds });
  const agents = resolveAgentIds(agentIds);
  const results = [];

  for (const ceoUserId of ceoIds) {
    const ceoResult = {
      user_id: ceoUserId,
      agents: [],
      granted: [],
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
            /* already granted / disabled path */
          }
        }
      }

      for (const agent of agents) {
        const ensured = ensureTenantOpenClawAgent(agent, ceoUserId);
        const baseId = baseOcIdFromAgent(agent);
        const ws = ensured.workspacePath || tenantWorkspacePath(ceoUserId, baseId);
        const pushed = forcePushTemplateDocs(baseId, ws, { forceIdentity: forceIdentityMd !== false });
        if (syncOrg !== false) {
          await syncOrgContextToWorkspace(agent, ceoUserId, ws);
        }
        ceoResult.agents.push({
          agent_id: agent.id,
          openclaw_runtime_id: ensured.openclawAgentId,
          workspace_path: ws,
          md_copied: pushed.copied,
        });
      }
    } catch (e) {
      ceoResult.error = e?.message || String(e);
    }
    results.push(ceoResult);
  }

  try {
    syncAllowlistsFile();
  } catch (e) {
    console.warn('[refresh-default-agents] syncAllowlistsFile:', e?.message || e);
  }

  const failed = results.filter((r) => r.error);
  return {
    ok: failed.length === 0,
    default_agent_ids: agents.map((a) => a.id),
    available_defaults: listDefaultOnboardAgentIds(),
    users_targeted: ceoIds.length,
    users_ok: results.length - failed.length,
    users_failed: failed.length,
    force_identity_md: forceIdentityMd !== false,
    results,
  };
}
