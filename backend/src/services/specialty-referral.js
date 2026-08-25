/**
 * Peer-agent referral: use COO AGENTS.md intent classification.
 * Stay if this agent is a classified target; otherwise point to the best peer.
 *
 * Platform Help is exempt: product how-to must answer first (RAG), then may soft-recommend.
 */
import { getDb } from '../db/schema.js';
import { isPlatformHelpAgent } from './master-data-tools.js';
import { readCooAgentsMdForCeo } from './org-context.js';
import { classifyIntentAndAllocate } from './intent-classifier.js';
import { isVideoContentOrchestratorAgent } from './openclaw-agent-tools.js';

/** Product help / graph build desks — never hard-redirect to specialists mid-chat. */
function isHelpOrBuilderAgent(agent) {
  if (!agent) return false;
  if (isPlatformHelpAgent(agent.id) || isPlatformHelpAgent(agent.openclaw_agent_id)) return true;
  const id = String(agent.id || agent.openclaw_agent_id || '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  if (id === 'workflowbuilder' || id.endsWith('--workflowbuilder') || /workflowbuilder$/.test(id)) {
    return true;
  }
  if (
    id === 'onboardinghelper' ||
    id.endsWith('--onboardinghelper') ||
    /onboardinghelper$/.test(id)
  ) {
    return true;
  }
  return false;
}

/**
 * Video Content Orchestrator is the pack front door for story/storyboard/video asks.
 * Never hard-redirect to Story/Scene/Prompt (those are workflow-only specialties).
 */
function isVideoOrchestratorAgent(agent) {
  return isVideoContentOrchestratorAgent(agent);
}

/** A prompt-writing desk owns prompt composition even when the prompt's subject is CRM, research, etc. */
export function isPromptAuthoringAskForAgent(agent, message) {
  const identity = [agent?.id, agent?.openclaw_agent_id, agent?.name, agent?.role]
    .filter(Boolean)
    .join(' ');
  if (!/\bprompt\b/i.test(identity)) return false;
  return /\b(prompt|system instructions?|instruction set|template)\b/i.test(String(message || ''));
}

/** Operational asks should stay with the current agent (Kanban / workflows / status). */
function isOperationalMessage(message) {
  return /\b(kanban|create\s+(a\s+)?task|move\s+(the\s+)?task|workflow|notify_ceo|sessions_send|stand-?up|status|storyboard|run\s+video)\b/i.test(
    String(message || '')
  );
}

/**
 * @returns {Promise<null | { reply: string, target: object, matchedSpecialty: string, chat_url: string }>}
 */
export async function tryBuildSpecialtyReferral(ownerUserId, currentAgent, message) {
  if (!ownerUserId || !currentAgent?.id || currentAgent.is_coo) return null;
  // Platform Help / Workflow Builder / Onboarding Helper: answer in-role; no hard peer redirect.
  if (isHelpOrBuilderAgent(currentAgent)) return null;
  // Video Content Orchestrator owns story/storyboard intake — never bounce to Story Agent chat.
  if (isVideoOrchestratorAgent(currentAgent)) return null;
  // Composition intent belongs to a Prompt Agent; subject-domain words must not bounce it
  // to the execution specialist (e.g. CRM Maker for "write a CRM lead-gen prompt").
  if (isPromptAuthoringAskForAgent(currentAgent, message)) return null;

  const msg = String(message || '').trim();
  if (!msg || msg.length < 8) return null;
  if (isOperationalMessage(msg)) return null;

  const md = await readCooAgentsMdForCeo(ownerUserId);
  if (!md?.trim()) return null;

  const allocated = await classifyIntentAndAllocate(msg, md, { ownerUserId }, ownerUserId);
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
    `Tip: use **New chat** on that agent so you start with a clean session (avoids TPM/context bloat).\n\n` +
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
  if (isPlatformHelpAgent(id)) {
    return (
      `\n\n[System — Dashboard chat · Platform Help] The CEO is already talking with you in this chat. ` +
      `You are the product help desk — **answer here first**. Call **master_data_rag** (and related Master Data tools) and give clear numbered UI steps from retrieved help docs. ` +
      `Never open with "that request fits **X** better than my role" or a specialty-only redirect. ` +
      `After the how-to, you may **optionally** soft-recommend a peer (COO, CRM Maker, Workflow Builder, etc.) for live data or execution — as a short closing tip only, not a substitute for your answer. ` +
      `Do **NOT** create a Kanban task for ordinary help Q&A. ` +
      `Reply here only. Do **NOT** call **notify_ceo** unless they explicitly asked you to reach/notify/ping them.`
    );
  }
  return (
    `\n\n[System — Dashboard chat] The CEO is already talking with you in this chat. ` +
    `First decide using YOUR role/purpose in ORG.md / SOUL whether this request is in your specialty. ` +
    `If it is, handle it here and answer in this chat. ` +
    `Do **NOT** create a Kanban task for ordinary chat requests (research, recipes, Q&A) unless the CEO explicitly asked to track it on Kanban. ` +
    `If you have a Kanban card: move in_progress when you start; move completed ONLY after you actually finished the deliverable (self-check). Never mark completed without doing the work. ` +
    `Follow **AGENT-OS-OPS.md** for learnings and Kanban self-check. ` +
    `Only if the ask is clearly outside your purpose, point to the best peer from ORG.md. ` +
    `Reply here only. Do **NOT** call **notify_ceo** unless they explicitly asked you to reach/notify/ping them. ` +
    `Prefer link paths like /agents/${id}/chat only when notify_ceo is actually allowed.`
  );
}
