/**
 * Broadcast a message to one or all of the CEO's agents and collect replies.
 * POST /api/broadcast — body: { message: string, agent_ids?: string[] }
 * Returns: { results: [ { agent_id, name, reply?, error? } ] }
 *
 * Aligns with Agent Chat tenancy: tenant OpenClaw agent id, sessionUserFor,
 * registerOpenClawSessionOwner + [ceo_user_id] so tools like notify_ceo resolve.
 */
import { Router } from 'express';
import { getDb } from '../db/schema.js';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { listAgentsForUser } from '../services/users.js';
import { userCanAccessAgent } from '../services/agent-chat-scope.js';
import { registerOpenClawSessionOwner } from '../services/tool-owner-scope.js';
import { ensureTenantOpenClawAgent } from '../services/openclaw-tenant.js';
import { normalizeReplyContent } from '../services/delegation-queue.js';
import * as openclaw from '../gateway/openclaw.js';

const router = Router();

router.use(requireAuth);
router.use(requireCeoOrAdmin);

router.post('/', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    const agentIds = Array.isArray(req.body?.agent_ids) ? req.body.agent_ids.filter(Boolean) : null;
    const db = getDb();

    let agents;
    if (agentIds && agentIds.length > 0) {
      const placeholders = agentIds.map(() => '?').join(',');
      agents = db
        .prepare(`SELECT id, name, openclaw_agent_id, is_coo FROM agents WHERE id IN (${placeholders})`)
        .all(...agentIds)
        .filter((a) => userCanAccessAgent(req.authUser, a.id));
    } else {
      agents = listAgentsForUser(ownerUserId).map((a) => ({
        id: a.id,
        name: a.name,
        openclaw_agent_id: a.openclaw_agent_id,
        is_coo: a.is_coo,
      }));
    }

    if (agents.length === 0) {
      return res.json({ results: [], owner_user_id: ownerUserId });
    }

    const broadcastId = `broadcast-${Date.now()}`;
    const results = await Promise.all(
      agents.map(async (agent) => {
        try {
          const ensured = ensureTenantOpenClawAgent(agent, ownerUserId);
          const openclawAgentId = ensured.openclawAgentId;
          const sessionUser = openclaw.sessionUserFor(agent.id, ownerUserId);
          const sessionKey = openclaw.sessionKeyFor(openclawAgentId, sessionUser);
          registerOpenClawSessionOwner(sessionKey, ownerUserId);

          const sessionKeyLine = `\n\nYour session key for this run is ${sessionKey}. Use this exact sessionKey when calling sessions_history. If sessions_history returns empty, the conversation is in the messages above—proceed with those.`;
          const toolHint =
            `\n\n[Broadcast from CEO user id "${ownerUserId}"] ` +
            `If the CEO asks you to reach them, call the **notify_ceo** tool with title/body (do not only reply in text). ` +
            `Recipient is always this CEO — never pass user_id.`;
          const userContent =
            `[ceo_user_id: ${ownerUserId}]\n[owner_user_id: ${ownerUserId}]\n` +
            `[broadcast_id: ${broadcastId}]\n` +
            `${message}${toolHint}${sessionKeyLine}`;

          const { content: reply } = await openclaw.chatCompletions(
            openclawAgentId,
            [{ role: 'user', content: userContent }],
            sessionUser,
            false
          );
          return {
            agent_id: agent.id,
            name: agent.name || agent.id,
            reply: normalizeReplyContent(reply),
            openclaw_agent_id: openclawAgentId,
            session_key: sessionKey,
          };
        } catch (e) {
          return {
            agent_id: agent.id,
            name: agent.name || agent.id,
            error: e.message || 'Gateway error',
          };
        }
      })
    );
    res.json({ results, owner_user_id: ownerUserId, broadcast_id: broadcastId });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

export default router;
