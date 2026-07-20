/**
 * notify_ceo content tool — agent → CEO in-app notification (user-scoped).
 * Recipient is always the entitled CEO from the OpenClaw session — never body spoof.
 */
import { randomUUID } from 'crypto';
import { sendPlatformNotifications } from './platform-notifications.js';

/**
 * @param {object} body
 * @param {{ ownerUserId: string, callerAgentId?: string|null, callerAgentName?: string|null }} ctx
 */
export function executeNotifyCeo(body = {}, ctx = {}) {
  const ownerUserId = String(ctx.ownerUserId || '').trim();
  if (!ownerUserId) {
    return { sent: false, error: 'Could not resolve CEO user for this session' };
  }

  const title = String(body.title || body.subject || '').trim();
  if (!title) {
    return { sent: false, error: 'title is required' };
  }

  const message = String(body.body || body.message || body.text || '').trim();
  const linkUrl = String(body.link_url || body.linkUrl || body.link || '').trim();
  const agentId = String(ctx.callerAgentId || body.caller_agent_id || 'agent').trim() || 'agent';
  const agentName = String(ctx.callerAgentName || agentId).trim() || agentId;

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
      linkUrl: linkUrl || '',
      createdBy: agentId,
      source: 'agent_notify',
      sourceKey,
    });
    return {
      sent: true,
      notified_user_id: ownerUserId,
      title,
      agent_id: agentId,
      agent_name: agentName,
      notifications_created: out.sent,
      source: 'agent_notify',
      source_key: sourceKey,
      link_url: linkUrl || null,
    };
  } catch (e) {
    return { sent: false, error: e.message || String(e) };
  }
}
