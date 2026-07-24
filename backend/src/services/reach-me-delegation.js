/**
 * Hard path: when CEO asks COO to have a specialist "reach me",
 * do not rely on the COO LLM — notify as the specialist and return a COO ack.
 */
import { getDb } from '../db/schema.js';
import { listAgentsForUser } from './users.js';
import { executeNotifyCeo } from './notify-ceo.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { registerOpenClawSessionOwner } from './tool-owner-scope.js';
import { selectBroadcastRecipients, isReachMeRequest } from './broadcast-routing.js';
import * as openclaw from '../gateway/openclaw.js';
import { normalizeReplyContent } from './delegation-queue.js';
import { insertChatTurn } from './chat-history.js';

/** CEO wants another agent (not COO) to reach/contact them. */
export function isAskSpecialistToReachMe(message) {
  const t = String(message || '').trim();
  if (!t) return false;

  // Must be a handoff ("ask/have/tell …") or a named specialty + reach-me
  const handoff =
    /\b(ask|have|tell)\b/i.test(t) ||
    /\b(social\s*media|tech\s*research|expense|vedic|astrolog).+\b(reach|contact|notify)\s+me\b/i.test(t);
  if (!handoff) return false;

  // Must look like reach / notify intent
  if (
    !isReachMeRequest(t) &&
    !/\b(reach|contact|notify|ping|get\s+(back\s+)?to)\s+me\b/i.test(t) &&
    !/\bvia\s+notif/i.test(t)
  ) {
    return false;
  }

  // Reject ONLY direct "you/COO reach me" — keep "Can you ask <specialist> to reach me"
  if (
    /\b(you|coo|balserve|bal\s*serve)\b.+\b(reach|contact|notify)\s+me\b/i.test(t) &&
    !/\b(ask|have|tell)\b/i.test(t)
  ) {
    return false;
  }

  return true;
}

/**
 * Resolve the specialist agent for a reach-me request under this CEO.
 * @returns {object|null} agent row
 */
export function resolveReachMeSpecialist(ownerUserId, message) {
  const agents = listAgentsForUser(ownerUserId).map((a) => ({
    id: a.id,
    name: a.name,
    openclaw_agent_id: a.openclaw_agent_id,
    is_coo: a.is_coo,
    department: a.department,
    role: a.role,
  }));
  const routed = selectBroadcastRecipients(agents, message);
  if (!routed.filtered || !routed.agents.length) return null;
  const pick = routed.agents.find((a) => !a.is_coo) || routed.agents[0];
  if (!pick || pick.is_coo) return null;
  return getDb().prepare('SELECT * FROM agents WHERE id = ?').get(pick.id) || pick;
}

/**
 * True when a COO notify_ceo payload is clearly about another specialist reaching the CEO.
 */
export function cooNotifyLooksLikeSpecialistProxy(title, body) {
  const text = `${title || ''} ${body || ''}`;
  if (!text.trim()) return false;
  return (
    /\b(social\s*media|social\s*assistant|tech\s*research|expense\s*manager|request for .+ (expert|agent|assistant))\b/i.test(
      text
    ) || /\b(ask|have).+\b(reach|contact|notify)\b/i.test(text)
  );
}

/**
 * Execute reach-me: notify as specialist (+ optional warm-up chat), return COO reply text.
 */
export async function executeReachMeViaSpecialist({
  ownerUserId,
  ceoMessage,
  specialist,
  pingSpecialist = true,
}) {
  if (!ownerUserId || !specialist?.id) {
    return { ok: false, error: 'missing owner or specialist' };
  }

  const name = specialist.name || specialist.id;
  const chatLink = `/agents/${encodeURIComponent(specialist.id)}/chat`;
  const title = `${name} ready to chat`;
  const body =
    `You asked me to reach you.\n\nOriginal request: ${String(ceoMessage || '').trim().slice(0, 500)}\n\n` +
    `Open Continue chat to keep talking with me.`;

  const notifyOut = executeNotifyCeo(
    {
      title,
      body,
      link_url: chatLink,
      source_key: `reach-me:${specialist.id}:${Date.now()}`,
    },
    {
      ownerUserId,
      callerAgentId: specialist.id,
      callerAgentName: name,
      force: true,
    }
  );

  let specialistReply = null;
  if (pingSpecialist) {
    try {
      const ensured = ensureTenantOpenClawAgent(specialist, ownerUserId);
      const sessionUser = openclaw.sessionUserFor(specialist.id, ownerUserId);
      const sessionKey = openclaw.sessionKeyFor(ensured.openclawAgentId, sessionUser);
      registerOpenClawSessionOwner(sessionKey, ownerUserId);
      const prompt =
        `[ceo_user_id: ${ownerUserId}]\n[owner_user_id: ${ownerUserId}]\n` +
        `The CEO asked you to reach them. A notification was already sent from you with link ${chatLink}. ` +
        `Reply with a short friendly greeting they will see when they open your chat. ` +
        `Do not call notify_ceo again.`;
      const { content } = await openclaw.chatCompletions(
        ensured.openclawAgentId,
        [{ role: 'user', content: prompt }],
        sessionUser,
        false,
        { timeoutMs: 90000 }
      );
      specialistReply = normalizeReplyContent(content);
      if (specialistReply) {
        insertChatTurn({
          agentId: specialist.id,
          ownerUserId,
          role: 'user',
          content: `[System] CEO asked you to reach them via COO: ${String(ceoMessage || '').trim().slice(0, 500)}`,
        });
        insertChatTurn({
          agentId: specialist.id,
          ownerUserId,
          role: 'assistant',
          content: specialistReply,
        });
      }
    } catch (e) {
      console.warn('[reach-me] specialist ping failed:', e?.message || e);
    }
  }

  const cooReply =
    `I've asked **${name}** to reach you. Check your notification bell — tap **Continue chat** to talk with ${name} directly.` +
    (notifyOut.sent ? '' : ` (Notify warning: ${notifyOut.error || 'unknown'})`);

  return {
    ok: !!notifyOut.sent,
    cooReply,
    specialist,
    notify: notifyOut,
    specialistReply,
    chat_url: chatLink,
  };
}

/**
 * If this COO chat message is a reach-me request, handle it server-side.
 * @returns {null | { cooReply, ... }}
 */
export async function tryHandleCooReachMeRequest(ownerUserId, ceoMessage) {
  if (!isAskSpecialistToReachMe(ceoMessage)) return null;
  const specialist = resolveReachMeSpecialist(ownerUserId, ceoMessage);
  if (!specialist) return null;
  return executeReachMeViaSpecialist({
    ownerUserId,
    ceoMessage,
    specialist,
    pingSpecialist: true,
  });
}

/**
 * If COO called notify_ceo on behalf of a specialist, re-attribute to that specialist.
 * @returns {null | object} executeNotifyCeo result when rewritten
 */
export function tryRewriteCooNotifyAsSpecialist(ownerUserId, body, cooAgent) {
  if (!cooAgent?.is_coo) return null;
  const title = String(body?.title || body?.subject || '');
  const msg = String(body?.body || body?.message || body?.text || '');
  if (!cooNotifyLooksLikeSpecialistProxy(title, msg)) return null;
  const specialist = resolveReachMeSpecialist(ownerUserId, `${title} ${msg}`);
  if (!specialist || specialist.id === cooAgent.id) return null;

  const name = specialist.name || specialist.id;
  const chatLink = `/agents/${encodeURIComponent(specialist.id)}/chat`;
  return executeNotifyCeo(
    {
      title: title.includes(name) ? title : `${name} ready to chat`,
      body: msg || `You asked ${name} to reach you.`,
      link_url: String(body?.link_url || body?.linkUrl || '').trim() || chatLink,
      source_key: String(body?.source_key || body?.sourceKey || '').trim() || `reach-me:${specialist.id}:${Date.now()}`,
    },
    {
      ownerUserId,
      callerAgentId: specialist.id,
      callerAgentName: name,
      force: true,
    }
  );
}
