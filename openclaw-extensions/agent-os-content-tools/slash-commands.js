import { randomUUID } from 'node:crypto';
// Namespaced because core reserves /steer. Commands are handled before the LLM.
export function registerFlolahCommands(api, { baseUrl, brokerSecret, request = fetch }) {
  if (typeof api.registerCommand !== 'function') {
    api.logger?.warn?.('Flolah slash commands unavailable: gateway command API missing');
    return;
  }
  api.registerCommand({
    name: 'flolah', description: 'Platform tools and non-interrupting work guidance: tools | tool | steer',
    channels: ['whatsapp'], acceptsArgs: true, requireAuth: true,
    async handler(ctx) {
      const blocked = text => ({ text, continueAgent: false });
      if (!ctx.isAuthorizedSender || ctx.channel !== 'whatsapp' || !ctx.agentId || !ctx.senderId || !ctx.accountId || !ctx.sessionKey) return blocked('Verified private WhatsApp identity, agent and session are required.');
      if (!ctx.from || /@g\.us|\bgroup[:/]/i.test(`${ctx.from} ${ctx.sessionKey}`)) return blocked('Use a private WhatsApp conversation for Flolah commands.');
      const secret = brokerSecret();
      if (!baseUrl || !secret) return blocked('Flolah command broker is not configured. No tool was called.');
      try {
        const response = await request(`${baseUrl.replace(/\/$/, '')}/api/agent-commands/channel`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-agent-os-tool-broker': secret },
          body: JSON.stringify({ command: `/flolah ${ctx.args || ''}`.trim(), channel: 'whatsapp', agent_id: ctx.agentId,
            account_id: ctx.accountId, session_key: ctx.sessionKey, sender_id: ctx.senderId, from: ctx.from,
            idempotency_key: randomUUID() }), signal: AbortSignal.timeout(125000),
        });
        const out = await response.json();
        // No retry after a lost response: a tool may already have performed work.
        const reply = blocked(response.ok ? out.reply : `Flolah command blocked: ${out.error || 'request failed'}`);
        const media = String(out.media_uri || '').replace(/^MEDIA:/, '');
        if (response.ok && media.startsWith('/root/.openclaw/media/')) reply.mediaUrl = media;
        return reply;
      } catch {
        return blocked('Flolah command response unavailable. Outcome is unverified; check execution logs before resubmitting a tool command.');
      }
    },
  });
}
