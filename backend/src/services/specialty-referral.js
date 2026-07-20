/**
 * Peer-agent referral: use COO AGENTS.md intent classification.
 * Stay if this agent is a classified target; otherwise point to the best peer.
 */
import { getDb } from '../db/schema.js';
import { readCooAgentsMdForCeo } from './org-context.js';
import { classifyIntentAndAllocate } from './intent-classifier.js';

/** Operational asks should stay with the current agent (Kanban / workflows / status). */
function isOperationalMessage(message) {
  return /\b(kanban|create\s+(a\s+)?task|move\s+(the\s+)?task|workflow|notify_ceo|sessions_send|stand-?up|status)\b/i.test(
    String(message || '')
  );
}

/**
 * @returns {Promise<null | { reply: string, target: object, matchedSpecialty: string, chat_url: string }>}
 */
export async function tryBuildSpecialtyReferral(ownerUserId, currentAgent, message) {
  if (!ownerUserId || !currentAgent?.id || currentAgent.is_coo) return null;
  const msg = String(message || '').trim();
  if (!msg || msg.length < 8) return null;
  if (isOperationalMessage(msg)) return null;

  const md = await readCooAgentsMdForCeo(ownerUserId);
  if (!md?.trim()) return null;

  const allocated = await classifyIntentAndAllocate(msg, md, undefined);
  if (!allocated || typeof allocated !== 'object') return null;
  const ids = Object.keys(allocated).map((id) => String(id).toLowerCase());
  if (!ids.length) return null;

  const currentId = String(currentAgent.id).toLowerCase();
  // Self-fit: classifier included this agent → handle here.
  if (ids.includes(currentId)) return null;

  // Prefer the first classified peer (classifier already ordered/chose best fit).
  const targetId = ids[0];
  const full = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(targetId);
  if (!full) return null;

  const name = full.name || full.id;
  const dept = String(full.department || '').trim();
  const role = String(full.role || '').trim();
  const why = [dept && `department: ${dept}`, role && `role: ${role}`].filter(Boolean).join('; ');
  const chatPath = `/agents/${encodeURIComponent(full.id)}/chat`;

  const reply =
    `Based on org agent purposes (AGENTS.md), that request fits **${name}** better than my role` +
    (why ? ` (${why})` : '') +
    `.\n\n` +
    `Open their chat: ${chatPath}\n\n` +
    `I did **not** send a notification — please continue with ${name} for this work.`;

  return {
    reply,
    target: full,
    matchedSpecialty: 'agents_md_intent',
    chat_url: chatPath,
  };
}

/** Hint appended to every Dashboard agent chat so models do not spam notify_ceo. */
export function buildActiveChatNotifyHint(agentId) {
  const id = String(agentId || 'agent').trim() || 'agent';
  return (
    `\n\n[System — Dashboard chat] The CEO is already talking with you in this chat. ` +
    `First decide using YOUR role/purpose in ORG.md / SOUL whether this request is in your specialty. ` +
    `If it is, handle it here. Only if it is clearly outside your purpose, point to the best peer from ORG.md. ` +
    `Reply here only. Do **NOT** call **notify_ceo** unless they explicitly asked you to reach/notify/ping them. ` +
    `If they ask for Kanban create/move, use **kanban_create_task** / **kanban_move_status**. ` +
    `Prefer link paths like /agents/${id}/chat only when notify_ceo is actually allowed.`
  );
}
