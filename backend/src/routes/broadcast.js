/**
 * Broadcast a message to one or all of the CEO's agents and collect replies.
 * POST /api/broadcast — body: { message: string, agent_ids?: string[] }
 * Returns: { results: [ { agent_id, name, reply?, error? } ] }
 *
 * Aligns with Agent Chat tenancy: tenant OpenClaw agent id, sessionUserFor,
 * registerOpenClawSessionOwner + [ceo_user_id] so tools like notify_ceo resolve.
 *
 * Fan-out is concurrency-limited to avoid OpenAI/OpenClaw TPM 429s when many agents
 * are targeted at once.
 */
import { Router } from 'express';
import { getDb } from '../db/schema.js';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { listAgentsForUser } from '../services/users.js';
import { userCanAccessAgent } from '../services/agent-chat-scope.js';
import { registerOpenClawSessionOwner } from '../services/tool-owner-scope.js';
import { ensureTenantOpenClawAgent } from '../services/openclaw-tenant.js';
import { normalizeReplyContent } from '../services/delegation-queue.js';
import {
  selectBroadcastRecipients,
  isReachMeRequest,
  buildBroadcastToolHint,
} from '../services/broadcast-routing.js';
import { classifyBroadcastNotifyIntent } from '../services/broadcast-intent.js';
import * as openclaw from '../gateway/openclaw.js';

const router = Router();

/** Parallel OpenClaw calls per broadcast (TPM-safe). Override: BROADCAST_CONCURRENCY. */
const BROADCAST_CONCURRENCY = Math.max(1, Number(process.env.BROADCAST_CONCURRENCY || 2));
const BROADCAST_RETRY_429 = Math.max(0, Number(process.env.BROADCAST_RETRY_429 || 2));

router.use(requireAuth);
router.use(requireCeoOrAdmin);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(err) {
  const m = String(err?.message || err || '');
  return /\b429\b|rate limit|tokens per min|TPM/i.test(m);
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function chatWithRetry(openclawAgentId, messages, sessionUser) {
  let lastErr;
  for (let attempt = 0; attempt <= BROADCAST_RETRY_429; attempt++) {
    try {
      return await openclaw.chatCompletions(openclawAgentId, messages, sessionUser, false);
    } catch (e) {
      lastErr = e;
      if (!isRateLimitError(e) || attempt >= BROADCAST_RETRY_429) throw e;
      const waitMs = 1500 * (attempt + 1) + Math.floor(Math.random() * 500);
      console.warn(`[broadcast] 429 for ${openclawAgentId}, retry in ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function persistBroadcastChat(db, agentId, ownerUserId, userContent, replyText) {
  try {
    db.prepare(
      'INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)'
    ).run(agentId, ownerUserId, 'user', userContent);
    if (replyText) {
      db.prepare(
        'INSERT INTO chat_turns (agent_id, owner_user_id, role, content) VALUES (?, ?, ?, ?)'
      ).run(agentId, ownerUserId, 'assistant', replyText);
    }
  } catch (e) {
    console.warn('[broadcast] chat persist failed', agentId, e?.message || e);
  }
}

router.post('/', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    const agentIds = Array.isArray(req.body?.agent_ids) ? req.body.agent_ids.filter(Boolean) : null;
    const forceAll = req.body?.force_all === true || req.body?.forceAll === true;
    const includeCoo = req.body?.include_coo === true || req.body?.includeCoo === true;
    const db = getDb();

    let agents;
    if (agentIds && agentIds.length > 0) {
      const placeholders = agentIds.map(() => '?').join(',');
      agents = db
        .prepare(
          `SELECT id, name, openclaw_agent_id, is_coo, department, role FROM agents WHERE id IN (${placeholders})`
        )
        .all(...agentIds)
        .filter((a) => userCanAccessAgent(req.authUser, a.id));
    } else {
      agents = listAgentsForUser(ownerUserId).map((a) => ({
        id: a.id,
        name: a.name,
        openclaw_agent_id: a.openclaw_agent_id,
        is_coo: a.is_coo,
        department: a.department,
        role: a.role,
      }));
      // Default "all agents" excludes COO unless include_coo is set.
      if (!includeCoo) agents = agents.filter((a) => !a.is_coo);
    }

    if (agents.length === 0) {
      return res.json({ results: [], owner_user_id: ownerUserId });
    }

    // When CEO did not explicitly pick a subset, route "reach me / specialist" messages
    // to the matching agent(s) only — prevents every agent from calling notify_ceo.
    const explicitSelection = !!(agentIds && agentIds.length > 0);
    const notifyIntent = await classifyBroadcastNotifyIntent(message);
    const statusNotifyAll = notifyIntent.status_rollup === true;
    const reachMe = notifyIntent.require_notify === true || isReachMeRequest(message);

    let routing = { agents, matchedSpecialty: null, filtered: false };
    if (statusNotifyAll) {
      // Org-wide status roll-up: keep full recipient set (already non-COO by default).
      routing = {
        agents,
        matchedSpecialty: 'status_notify_all',
        filtered: false,
      };
    } else if (!forceAll && !explicitSelection) {
      routing = selectBroadcastRecipients(agents, message);
    } else if (!forceAll && explicitSelection && reachMe && !statusNotifyAll) {
      const narrowed = selectBroadcastRecipients(agents, message);
      if (narrowed.filtered) routing = narrowed;
    }

    const recipients = routing.agents;
    const broadcastId = `broadcast-${Date.now()}`;

    const results = await mapPool(recipients, BROADCAST_CONCURRENCY, async (agent) => {
      try {
        const ensured = ensureTenantOpenClawAgent(agent, ownerUserId);
        const openclawAgentId = ensured.openclawAgentId;
        const sessionUser = openclaw.sessionUserFor(agent.id, ownerUserId);
        const sessionKey = openclaw.sessionKeyFor(openclawAgentId, sessionUser);
        registerOpenClawSessionOwner(sessionKey, ownerUserId);

        const sessionKeyLine = `\n\nYour session key for this run is ${sessionKey}. Use this exact sessionKey when calling sessions_history. If sessions_history returns empty, the conversation is in the messages above—proceed with those.`;
        const toolHint = buildBroadcastToolHint({
          ownerUserId,
          agent,
          reachMe,
          specialtyFiltered: routing.filtered,
          statusNotifyAll,
        });
        const userContent =
          `[ceo_user_id: ${ownerUserId}]\n[owner_user_id: ${ownerUserId}]\n` +
          `[broadcast_id: ${broadcastId}]\n` +
          `${message}${toolHint}${sessionKeyLine}`;

        const { content: reply } = await chatWithRetry(
          openclawAgentId,
          [{ role: 'user', content: userContent }],
          sessionUser
        );
        const replyText = normalizeReplyContent(reply);
        persistBroadcastChat(db, agent.id, ownerUserId, message, replyText);
        return {
          agent_id: agent.id,
          name: agent.name || agent.id,
          reply: replyText,
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
    });

    const okCount = results.filter((r) => !r.error).length;
    const errCount = results.filter((r) => r.error).length;
    const rateLimited = results.filter((r) => isRateLimitError({ message: r.error })).length;

    res.json({
      results,
      owner_user_id: ownerUserId,
      broadcast_id: broadcastId,
      routing: {
        matched_specialty: routing.matchedSpecialty,
        filtered: routing.filtered,
        recipient_ids: recipients.map((a) => a.id),
        status_notify_all: statusNotifyAll,
        reach_me: reachMe,
        notify_intent: notifyIntent,
      },
      summary: {
        recipients: recipients.length,
        ok: okCount,
        errors: errCount,
        rate_limited: rateLimited,
        concurrency: BROADCAST_CONCURRENCY,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Internal server error' });
  }
});

export default router;
