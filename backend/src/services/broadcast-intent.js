/**
 * LLM intent: should broadcast recipients call notify_ceo?
 * No keyword routing — meaning-based classify (same stack as intent-classifier).
 */
import { chatCompletions } from '../config/llm.js';

const SYSTEM = `You classify CEO broadcast messages for an agent OS.

Decide from meaning (not keywords):
1. require_notify — true if the CEO wants agents to send an in-app notification (notify_ceo) when done / when ready / to reach them / to get back to them.
2. status_rollup — true if every addressed agent should give their own status/progress summary (org-wide roll-up), not a specialty-only ask.

Rules:
- Ordinary questions ("what is 2+2", "list departments") → require_notify false, status_rollup false.
- "Get back with your status and notify me when ready" → both true.
- "Social expert reach me" → require_notify true, status_rollup false.
- Output JSON only: { "require_notify": boolean, "status_rollup": boolean, "reason": "short" }`;

/**
 * @param {string} message
 * @param {string} [ownerUserId] - CEO id for BYOK
 * @returns {Promise<{ require_notify: boolean, status_rollup: boolean, reason: string, source: string }>}
 */
export async function classifyBroadcastNotifyIntent(message, ownerUserId = null) {
  const text = String(message || '').trim();
  if (!text) {
    return { require_notify: false, status_rollup: false, reason: 'empty', source: 'empty' };
  }

  try {
    const { content } = await chatCompletions({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `CEO broadcast message:\n\n"${text}"` },
      ],
      maxTokens: 120,
      ownerUserId,
    });
    const raw = String(content || '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) {
      return { require_notify: false, status_rollup: false, reason: 'parse_fail', source: 'llm' };
    }
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return {
      require_notify: parsed.require_notify === true,
      status_rollup: parsed.status_rollup === true,
      reason: String(parsed.reason || '').slice(0, 200),
      source: 'llm',
    };
  } catch (e) {
    console.warn('[broadcast-intent] classify failed:', e?.message || e);
    // Fail closed: soft hint only (agent LLM still decides).
    return {
      require_notify: false,
      status_rollup: false,
      reason: e?.message || 'error',
      source: 'error',
    };
  }
}
