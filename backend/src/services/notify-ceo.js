/**
 * notify_ceo content tool — agent → CEO in-app notification (user-scoped).
 * Recipient is always the entitled CEO from the OpenClaw session — never body spoof.
 */
import { randomUUID } from 'crypto';
import { sendPlatformNotifications } from './platform-notifications.js';
import { isReachMeRequest } from './broadcast-routing.js';
import { lookupActiveDashboardChat } from './tool-owner-scope.js';

/**
 * Block notify_ceo while the CEO is already in Dashboard chat with this agent,
 * unless they explicitly asked to be reached / notified.
 * Hard paths pass ctx.force = true. Broadcast / cron / sessions_send do not register
 * active dashboard chat, so they are not blocked by this gate.
 *
 * @returns {{ allowed: true } | { allowed: false, error: string, blocked_reason?: string }}
 */
export function assertNotifyCeoAllowed(body = {}, ctx = {}) {
  if (ctx.force === true) return { allowed: true };

  const sourceKey = String(body.source_key || body.sourceKey || '').trim();
  if (/^(reach-me:|broadcast:|hard-path:)/i.test(sourceKey)) return { allowed: true };

  const ownerUserId = String(ctx.ownerUserId || '').trim();
  const callerAgentId = String(ctx.callerAgentId || body.caller_agent_id || '').trim();
  if (!ownerUserId || !callerAgentId) return { allowed: true };

  const active = lookupActiveDashboardChat(callerAgentId, ownerUserId);
  if (!active) return { allowed: true };

  const title = String(body.title || body.subject || '');
  const msg = String(body.body || body.message || body.text || '');
  if (isReachMeRequest(active.message) || isReachMeRequest(`${title} ${msg}`)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    error:
      'CEO is already chatting with you in Dashboard. Reply in chat — do not call notify_ceo ' +
      'unless they explicitly asked you to reach/notify/ping them.',
    blocked_reason: 'active_chat',
  };
}

/**
 * @param {object} body
 * @param {{ ownerUserId: string, callerAgentId?: string|null, callerAgentName?: string|null, force?: boolean }} ctx
 */
export function executeNotifyCeo(body = {}, ctx = {}) {
  const ownerUserId = String(ctx.ownerUserId || '').trim();
  if (!ownerUserId) {
    return { sent: false, error: 'Could not resolve CEO user for this session' };
  }

  const gate = assertNotifyCeoAllowed(body, ctx);
  if (!gate.allowed) {
    return { sent: false, error: gate.error, blocked_reason: gate.blocked_reason };
  }

  const title = String(body.title || body.subject || '').trim();
  if (!title) {
    return { sent: false, error: 'title is required' };
  }

  const message = String(body.body || body.message || body.text || '').trim();
  const agentId = String(ctx.callerAgentId || body.caller_agent_id || 'agent').trim() || 'agent';
  const agentName = String(ctx.callerAgentName || agentId).trim() || agentId;
  const defaultChatLink = `/agents/${encodeURIComponent(agentId)}/chat`;
  const linkUrl = String(body.link_url || body.linkUrl || body.link || '').trim() || defaultChatLink;

  const bodyText = message
    ? `${message}\n\n— ${agentName}`
    : `Message from ${agentName}`;

  const sourceKey =
    String(body.source_key || body.sourceKey || '').trim() ||
    `notify-ceo:${agentId}:${randomUUID()}`;

  try {
    const out = sendPlatformNotifications({
      userIds: [ownerUserId],
      title,
      body: bodyText,
      linkUrl,
      createdBy: agentId,
      source: 'agent_notify',
      sourceKey,
    });
    const created = Number(out.sent) || 0;
    return {
      sent: created > 0,
      notified_user_id: ownerUserId,
      title,
      agent_id: agentId,
      agent_name: agentName,
      notifications_created: created,
      notifications_refreshed: Number(out.refreshed) || 0,
      source: 'agent_notify',
      source_key: sourceKey,
      link_url: linkUrl,
      chat_url: defaultChatLink,
      ...(created > 0
        ? {}
        : { error: 'Notification was not created (no matching enabled user or write failed)' }),
    };
  } catch (e) {
    return { sent: false, error: e.message || String(e) };
  }
}
