/**
 * Provision OpenClaw tenant runtimes for a CEO's granted agents (SaaS signup / agent create).
 */
import { getDb } from '../db/schema.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { syncAllowlistsFile } from './openclaw-agent-tools.js';
import { syncOrgContextForCeo } from './org-context.js';
import { syncUserLlmToOpenClaw } from './user-llm-settings.js';

/** Ensure tenant OpenClaw agents + allowlists for every enabled user_agents row. */
export async function provisionCeoOpenClawAgents(ceoUserId) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.*
       FROM user_agents ua
       JOIN agents a ON a.id = ua.agent_id
       WHERE ua.user_id = ? AND ua.enabled = 1`
    )
    .all(ceoUserId);

  const provisioned = [];
  for (const agent of rows) {
    try {
      const ensured = ensureTenantOpenClawAgent(agent, ceoUserId);
      provisioned.push({
        agent_id: agent.id,
        openclaw_agent_id: ensured.openclawAgentId,
        workspace_path: ensured.workspacePath,
      });
    } catch (e) {
      console.warn('[ceo-openclaw] ensure failed', agent.id, ceoUserId, e?.message || e);
    }
  }
  syncAllowlistsFile();
  // Re-sync BYOK provider + auth profiles now that tenant agent dirs exist.
  let llmSync = null;
  try {
    llmSync = syncUserLlmToOpenClaw(ceoUserId);
  } catch (e) {
    console.warn('[ceo-openclaw] BYOK sync:', e?.message || e);
  }
  try {
    await syncOrgContextForCeo(ceoUserId);
  } catch (e) {
    console.warn('[ceo-openclaw] org sync:', e?.message || e);
  }
  return { ceo_user_id: ceoUserId, count: provisioned.length, agents: provisioned, llm_sync: llmSync };
}
