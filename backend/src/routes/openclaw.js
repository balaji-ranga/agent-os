/**
 * AgentSystem config sync — scoped to the signed-in CEO's tenant runtimes.
 * Tenant OpenClaw ids: t-{ceoUserId}--{baseAgentId}
 */
import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { getDb } from '../db/schema.js';
import { attachAuthUser, requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';
import { listAgentsForUser, grantUserAgent } from '../services/users.js';
import {
  parseTenantOpenClawAgentId,
  tenantOpenClawAgentId,
  ensureTenantOpenClawAgent,
} from '../services/openclaw-tenant.js';
import { getOpenClawConfigPath } from '../config/openclaw-paths.js';
import { syncAllowlistsFile } from '../services/openclaw-agent-tools.js';
import { isAgentTombstoned } from '../services/agent-delete.js';
import { log } from '../utils/logger.js';

const router = Router();
router.use(attachAuthUser);
router.use(requireAuth);
router.use(requireCeoOrAdmin);

function readOpenClawList() {
  const configPath = getOpenClawConfigPath();
  if (!existsSync(configPath)) return { configPath, openclawList: [] };
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return { configPath, openclawList: config?.agents?.list ?? [] };
  } catch (e) {
    throw new Error('Could not read AgentSystem config: ' + e.message);
  }
}

function resolveCeoId(req) {
  if (req.authUser.role === 'ceo') return req.authUser.id;
  const fromBody = req.body?.ceo_user_id || req.body?.ceoUserId || req.query?.ceo_user_id;
  if (fromBody) return String(fromBody).trim();
  const err = new Error('ceo_user_id required for admin');
  err.status = 400;
  throw err;
}

function tenantAgentsForCeo(openclawList, ceoUserId) {
  const ceo = String(ceoUserId).toLowerCase();
  return (openclawList || [])
    .map((a) => {
      const parsed = parseTenantOpenClawAgentId(a.id);
      if (!parsed || parsed.ceoUserId !== ceo) return null;
      return {
        id: a.id,
        name: a.name || a.id,
        workspace: a.workspace || null,
        base_agent_id: parsed.baseOpenClawId,
        ceo_user_id: parsed.ceoUserId,
        tenant: true,
      };
    })
    .filter(Boolean);
}

/**
 * GET /api/openclaw/agents
 * Lists only this CEO's tenant OpenClaw agents + this CEO's DB agents.
 */
router.get('/agents', (req, res) => {
  try {
    const ceoUserId = resolveCeoId(req);
    const { configPath, openclawList } = readOpenClawList();
    const openclaw = tenantAgentsForCeo(openclawList, ceoUserId);
    const dbAgents = listAgentsForUser(ceoUserId).map((a) => ({
      ...a,
      openclaw_runtime_id: tenantOpenClawAgentId(ceoUserId, a.openclaw_agent_id || a.id),
    }));

    res.json({
      ceo_user_id: ceoUserId,
      openclaw,
      db: dbAgents,
      configPath,
      scope: 'tenant',
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * POST /api/openclaw/sync
 * Body: { agent_id?: string } — OpenClaw runtime id (t-ceo--base) or logical base id.
 * Pulls tenant OpenClaw agents into DB as custom agents owned by this CEO (under COO).
 */
router.post('/sync', (req, res) => {
  try {
    const ceoUserId = resolveCeoId(req);
    const { configPath, openclawList } = readOpenClawList();
    if (!existsSync(configPath) && openclawList.length === 0) {
      return res.status(400).json({ error: 'AgentSystem config not found at ' + configPath });
    }

    const filterRaw = req.body?.agent_id ? String(req.body.agent_id).trim().toLowerCase() : null;
    let tenantList = tenantAgentsForCeo(openclawList, ceoUserId);
    if (filterRaw) {
      const parsed = parseTenantOpenClawAgentId(filterRaw);
      tenantList = tenantList.filter((a) => {
        if (a.id.toLowerCase() === filterRaw) return true;
        if (a.base_agent_id === filterRaw) return true;
        if (parsed && a.base_agent_id === parsed.baseOpenClawId) return true;
        return false;
      });
    }

    const db = getDb();
    const coo = db.prepare('SELECT id FROM agents WHERE is_coo = 1 LIMIT 1').get();
    const parentId = coo?.id || null;
    const updated = [];
    const skipped = [];

    for (const a of tenantList) {
      const logicalId = a.base_agent_id;

      // A deleted agent must stay deleted. Config entries can outlive the DB row
      // (stale tenant entries, deploy-time config merges), and recreating from
      // them is what used to resurrect agents after a delete.
      if (isAgentTombstoned(db, logicalId)) {
        skipped.push({ id: logicalId, reason: 'deleted_by_user' });
        log.info(`[openclaw/sync] skipped tombstoned agent ${logicalId} for ${ceoUserId}`);
        continue;
      }

      const name = String(a.name || logicalId)
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim() || logicalId;
      const workspacePath = a.workspace ? String(a.workspace).trim() : null;

      const existing = db
        .prepare(
          `SELECT * FROM agents WHERE LOWER(id) = LOWER(?) OR LOWER(openclaw_agent_id) = LOWER(?)`
        )
        .get(logicalId, logicalId);

      if (existing) {
        if (existing.is_coo) {
          // Never overwrite COO identity from a pull; just ensure grant + tenant
          grantUserAgent(ceoUserId, existing.id);
          ensureTenantOpenClawAgent(existing, ceoUserId);
          updated.push({
            id: existing.id,
            name: existing.name,
            workspace_path: workspacePath,
            action: 'granted',
            openclaw_runtime_id: tenantOpenClawAgentId(ceoUserId, existing.openclaw_agent_id || existing.id),
          });
          continue;
        }
        db.prepare(
          `UPDATE agents SET name = COALESCE(NULLIF(?, ''), name),
             workspace_path = COALESCE(?, workspace_path),
             openclaw_agent_id = COALESCE(openclaw_agent_id, ?),
             parent_id = COALESCE(parent_id, ?),
             owner_user_id = COALESCE(owner_user_id, ?),
             agent_type = CASE WHEN agent_type = 'standard' THEN agent_type ELSE 'custom' END
           WHERE id = ?`
        ).run(name, workspacePath, logicalId, parentId, ceoUserId, existing.id);
        grantUserAgent(ceoUserId, existing.id);
        const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(existing.id);
        const ensured = ensureTenantOpenClawAgent(row, ceoUserId);
        updated.push({
          id: row.id,
          name: row.name,
          workspace_path: ensured.workspacePath,
          action: 'updated',
          openclaw_runtime_id: ensured.openclawAgentId,
        });
      } else {
        // Do not insert tenant runtime id as agents.id — use logical base id
        db.prepare(
          `INSERT INTO agents (id, name, role, parent_id, workspace_path, openclaw_agent_id, is_coo, agent_type, owner_user_id)
           VALUES (?, ?, ?, ?, ?, ?, 0, 'custom', ?)`
        ).run(logicalId, name, 'Agent', parentId, workspacePath, logicalId, ceoUserId);
        grantUserAgent(ceoUserId, logicalId);
        const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(logicalId);
        const ensured = ensureTenantOpenClawAgent(row, ceoUserId);
        updated.push({
          id: logicalId,
          name,
          workspace_path: ensured.workspacePath,
          action: 'created',
          openclaw_runtime_id: ensured.openclawAgentId,
        });
      }
    }

    syncAllowlistsFile();
    res.json({
      synced: updated.length,
      agents: updated,
      skipped,
      ceo_user_id: ceoUserId,
      scope: 'tenant',
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
