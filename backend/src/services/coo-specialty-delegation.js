/**
 * Hard path: COO chat delegates via AGENTS.md intent classification (LLM),
 * not keyword specialty hints. Cap at 1–2 specialists.
 */
import { readCooAgentsMdForCeo } from './org-context.js';
import { classifyIntentAndAllocate } from './intent-classifier.js';
import { scheduleCeoRequestViaOpenClawCron } from './delegation-queue.js';
import { isAskSpecialistToReachMe } from './reach-me-delegation.js';
import { getOrCreateDelegationHubStandup } from './standup-hub.js';

const MAX_DELEGATE_AGENTS = 1;

/** Explicit "please delegate …" / "assign to specialist". */
export function isExplicitDelegateRequest(message) {
  return /\b(delegat\w*|assign\s+to\s+(a\s+)?(specialist|agent)|hand\s*off|send\s+this\s+to)\b/i.test(
    String(message || '')
  );
}

/**
 * Work the COO should handle itself — never hard-delegate.
 * Coordination / platform ops stay with COO even if the classifier is unsure.
 */
export function isCooNativeWork(message) {
  const t = String(message || '');
  return /\b(workflow|workflows|agent_workflow|trigger\s+(a\s+)?workflow|run\s+(a\s+)?workflow|list\s+workflows|what\s+workflows|publish\s+workflow|(?:what|list|which)\s+(?:your\s+)?tools?|tools?\s+(?:do\s+you\s+)?(?:have|access)|kanban|stand-?up|digest|org\.md|resync\s+org|who\s+(are|is)\s+(on\s+)?(the\s+)?(team|agents)|email_send|send\s+(an?\s+)?email|calendar|meeting\s+invite|notify_ceo|master\s*data|what\s+can\s+you\s+do|your\s+(role|purpose)|as\s+coo|coo\s+chat)\b/i.test(
    t
  );
}

function capAllocation(allocated, max = MAX_DELEGATE_AGENTS) {
  if (!allocated || typeof allocated !== 'object') return {};
  const entries = Object.entries(allocated).filter(([, v]) => typeof v === 'string' && v.trim());
  if (entries.length <= max) {
    return Object.fromEntries(entries.map(([k, v]) => [String(k).toLowerCase(), v.trim()]));
  }
  return Object.fromEntries(
    entries.slice(0, max).map(([k, v]) => [String(k).toLowerCase(), v.trim()])
  );
}

/** Drop agents with empty/placeholder purposes (e.g. BalaSocial "Agent"). */
function isVaguePurpose(purpose) {
  const p = String(purpose || '')
    .replace(/\s*;\s*reports to you\s*$/i, '')
    .replace(/^[^—–-]+[—–-]\s*/, '') // strip department prefix
    .trim()
    .toLowerCase();
  return !p || p === 'agent' || p === 'demo' || p === '—' || p === '-';
}

/**
 * Prefer a single specialist; drop vague-purpose agents when a clearer peer exists.
 */
function refineAllocationAgainstAgentsMd(allocated, agentsMdContent) {
  if (!allocated || typeof allocated !== 'object') return {};
  const entries = Object.entries(allocated).filter(([, v]) => typeof v === 'string' && v.trim());
  if (!entries.length) return {};

  // Parse purposes from AGENTS.md table lines.
  const purposeById = new Map();
  for (const line of String(agentsMdContent || '').split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 4) continue;
    const id = (parts[1] || '').replace(/\*+/g, '').trim().toLowerCase();
    if (!id || id === 'agent id' || /^[-–—\s]+$/.test(id)) continue;
    const col3 = (parts[3] || '').trim();
    const col4 = (parts[4] || '').trim();
    const purpose = col4 && !/^[-–—\s]+$/.test(col4) ? `${col3} — ${col4}` : col3;
    purposeById.set(id, purpose);
  }

  const specific = entries.filter(([id]) => !isVaguePurpose(purposeById.get(String(id).toLowerCase())));
  const keep = specific.length ? specific : entries;
  return Object.fromEntries(keep.slice(0, MAX_DELEGATE_AGENTS).map(([k, v]) => [String(k).toLowerCase(), v.trim()]));
}

/**
 * Classify CEO message against COO AGENTS.md purposes; return agent_id → task query (max 1).
 * @returns {Promise<Record<string, string>>}
 */
export async function classifyCooDelegationTargets(ownerUserId, ceoMessage) {
  const md = await readCooAgentsMdForCeo(ownerUserId);
  if (!md?.trim()) return {};
  const msg = String(ceoMessage || '').trim();
  let allocated = await classifyIntentAndAllocate(msg, md, { ownerUserId }, ownerUserId);
  if (!allocated || typeof allocated !== 'object') allocated = {};

  // Second pass: force closest-fit when first pass is empty (model often too strict on purpose wording).
  if (Object.keys(allocated).length === 0) {
    const closest =
      `${msg}\n\n` +
      `[System: Pick exactly ONE agent from the list whose department/purpose domain is closest to this ask. ` +
      `Never pick agents whose purpose is only "Agent" or "demo". Adjacent domain fit is required when any specialist is closer than none. Return {} only for COO-ops questions.]`;
    const narrowed = await classifyIntentAndAllocate(closest, md, { ownerUserId }, ownerUserId);
    if (narrowed && Object.keys(narrowed).length > 0) allocated = narrowed;
  }

  if (Object.keys(allocated).length > 1) {
    const refine =
      `${msg}\n\n` +
      `[System: Return JSON for exactly ONE best-fit agent. Omit vague-purpose agents (purpose "Agent"/"demo"). Prefer Research for deep research / science / engineering analysis.]`;
    const narrowed = await classifyIntentAndAllocate(refine, md, { ownerUserId }, ownerUserId);
    if (narrowed && Object.keys(narrowed).length > 0) allocated = narrowed;
  }

  allocated = refineAllocationAgainstAgentsMd(allocated, md);
  return capAllocation(allocated, MAX_DELEGATE_AGENTS);
}

/**
 * @returns {null | { ok: true, cooReply: string, result: object, standup_id: number }}
 */
export async function tryHandleCooSpecialtyDelegation(ownerUserId, ceoMessage) {
  const t = String(ceoMessage || '').trim();
  if (!ownerUserId || !t || t.length < 8) return null;
  if (isAskSpecialistToReachMe(t)) return null;
  if (isCooNativeWork(t)) return null;

  // Generic: match intent to agents listed in COO AGENTS.md (purposes), not keywords.
  const allocated = await classifyCooDelegationTargets(ownerUserId, t);
  const restrictToAgentIds = Object.keys(allocated);
  if (!restrictToAgentIds.length) {
    // No specialist fit — leave to COO LLM (answer, clarify, or tool use).
    // Explicit "delegate" with no match: still tell the CEO we couldn't map it.
    if (!isExplicitDelegateRequest(t)) return null;
    return {
      ok: true,
      cooReply:
        "I couldn't map that to a specialist from AGENTS.md. Name an agent, or rephrase the specialist work.",
      result: { count: 0, agentNames: [], kanbanTaskIds: [] },
      standup_id: null,
    };
  }

  // Delegate via internal hub — do not create a user-visible standup entry.
  let standupId;
  try {
    standupId = getOrCreateDelegationHubStandup(ownerUserId);
  } catch (err) {
    return { ok: false, error: err.message || 'could not resolve delegation hub' };
  }

  const result = await scheduleCeoRequestViaOpenClawCron(standupId, t, ownerUserId, {
    restrictToAgentIds,
    preAllocated: allocated,
  });
  if (!result?.count) {
    return {
      ok: true,
      cooReply:
        "I classified this against AGENTS.md but couldn't queue the specialist run. Try again or name the agent.",
      result,
      standup_id: null,
    };
  }

  const names = (result.agentNames || []).join(', ');
  const kanbanHint =
    result.kanbanTaskIds?.length > 0
      ? ` Kanban task id(s): ${result.kanbanTaskIds.join(', ')}.`
      : '';
  const cooReply =
    `I've delegated this to **${names}** based on AGENTS.md purposes (not doing the specialist work myself).` +
    ` They'll pick it up via the delegation run — track progress on Kanban.${kanbanHint}` +
    (result.pendingCount > 0
      ? ' Some work is queued; refresh Kanban or Check for updates shortly.'
      : '');

  return {
    ok: true,
    cooReply,
    result,
    standup_id: null,
  };
}
