/**
 * Hard path: COO lists org agents from DB (no LLM) for "what agents are in the org?" style asks.
 * Small local models (Ollama BYOK) often confuse this with workflows and invent tool calls.
 */
import { listAgentsForUser } from './users.js';

/** @param {string} message */
export function isOrgAgentsListRequest(message) {
  const t = String(message || '').trim();
  if (t.length < 6 || t.length > 400) return false;
  return (
    /\b((what|which|list|show|who|how\s+many).{0,48}(agents?|team|org(?:anization)?|org\s*chart)|(agents?|team).{0,24}(in|on|for).{0,24}(org|organization|company|team|flolah))\b/i.test(
      t
    ) || /\b(org\s*chart|who\s+reports\s+to\s+(me|coo|you))\b/i.test(t)
  );
}

/**
 * @param {string} ownerUserId
 * @param {string} ceoMessage
 * @returns {{ ok: true, cooReply: string, agent_count: number } | null}
 */
export function tryHandleCooOrgAgentsList(ownerUserId, ceoMessage) {
  if (!ownerUserId || !isOrgAgentsListRequest(ceoMessage)) return null;
  const agents = listAgentsForUser(ownerUserId) || [];
  if (!agents.length) {
    return {
      ok: true,
      agent_count: 0,
      cooReply:
        'You do not have any agents enabled in your org yet. Open the Dashboard to add or enable agents, or ask Platform Help for onboarding steps.',
    };
  }

  const lines = agents.map((a, i) => {
    const name = String(a.name || a.id || 'Agent').trim();
    const id = String(a.id || '').trim();
    const purpose = String(a.purpose || a.role || '').trim();
    const dept = String(a.department || a.dept || '').trim();
    const bits = [`${i + 1}. **${name}** (\`${id}\`)`];
    if (dept) bits.push(`— ${dept}`);
    if (purpose) bits.push(`— ${purpose}`);
    return bits.join(' ');
  });

  const cooReply = [
    `Here are the **${agents.length} agents** currently enabled in your organization:`,
    '',
    ...lines,
    '',
    'Open the **Dashboard** org chart to chat with any of them, or ask me to delegate work to a specialist.',
  ].join('\n');

  return { ok: true, agent_count: agents.length, cooReply };
}
