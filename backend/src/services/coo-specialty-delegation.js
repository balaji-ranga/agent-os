/**
 * Hard path: COO chat delegates via AGENTS.md intent classification (LLM),
 * not keyword specialty hints. Cap at 2 specialists (same as standup / intent tool).
 */
import { getCooAgentRow, readCooAgentsMdForCeo } from './org-context.js';
import { classifyIntentAndAllocate } from './intent-classifier.js';
import { scheduleCeoRequestViaOpenClawCron } from './delegation-queue.js';
import { isAskSpecialistToReachMe } from './reach-me-delegation.js';
import { getOrCreateDelegationHubStandup } from './standup-hub.js';
import { splitAllocationByKind } from './org-member-keys.js';

/** Match intent-classifier + delegation-queue multi-intent cap. */
const MAX_DELEGATE_AGENTS = 2;

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

/**
 * The model copies ids straight out of the AGENTS.md table, so they arrive wrapped in the
 * cell's markdown — `` `a2a:wf-…` `` for leaf members and `**techresearcher**` for internal
 * agents. Strip the decoration, otherwise the key matches no agent and no member-key prefix.
 */
function normalizeAllocationKey(key) {
  return String(key || '')
    .replace(/[`*]/g, '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim()
    .toLowerCase();
}

function capAllocation(allocated, max = MAX_DELEGATE_AGENTS) {
  if (!allocated || typeof allocated !== 'object') return {};
  const entries = Object.entries(allocated)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => [normalizeAllocationKey(k), v.trim()])
    .filter(([k]) => k);
  return Object.fromEntries(entries.slice(0, max));
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
 * Drop vague-purpose agents when a clearer peer exists; keep up to MAX_DELEGATE_AGENTS.
 */
function refineAllocationAgainstAgentsMd(allocated, agentsMdContent) {
  if (!allocated || typeof allocated !== 'object') return {};
  const entries = Object.entries(allocated)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => [normalizeAllocationKey(k), v.trim()])
    .filter(([k]) => k);
  if (!entries.length) return {};

  // Parse purposes from AGENTS.md table lines.
  const purposeById = new Map();
  for (const line of String(agentsMdContent || '').split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 4) continue;
    const id = normalizeAllocationKey(parts[1]);
    if (!id || id === 'agent id' || id === 'member key' || /^[-–—\s]+$/.test(id)) continue;
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
 * Classify CEO message against COO AGENTS.md purposes; return agent_id → task query (max 2).
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

  // Over-cap only: keep clearly multi-intent pairs (≤2). When >2, ask model to keep at most 2 distinct intents.
  if (Object.keys(allocated).length > MAX_DELEGATE_AGENTS) {
    const refine =
      `${msg}\n\n` +
      `[System: Return JSON for at most ${MAX_DELEGATE_AGENTS} agents. Keep only clearly distinct intents ` +
      `(split the CEO message per agent). Omit vague-purpose agents (purpose "Agent"/"demo"). ` +
      `Do not collapse a true multi-intent ask into a single agent.]`;
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
  const { internal, leaf } = splitAllocationByKind(allocated);

  // External / published-A2A leaf members run outside OpenClaw — call them directly.
  let leafOutcome = null;
  if (Object.keys(leaf).length) {
    try {
      const { delegateToOrgMembers } = await import('./org-member-delegation.js');
      leafOutcome = await delegateToOrgMembers(ownerUserId, leaf, {
        callerAgentId: getCooAgentRow()?.id,
      });
    } catch (e) {
      console.warn('[coo-delegation] external member delegation failed:', e?.message || e);
    }
  }

  const restrictToAgentIds = Object.keys(internal);
  if (!restrictToAgentIds.length) {
    if (leafOutcome) {
      return { ok: true, ...buildLeafOnlyReply(leafOutcome) };
    }
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
    preAllocated: internal,
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
      : '') +
    (leafOutcome ? ` ${describeLeafOutcome(leafOutcome)}` : '');

  return {
    ok: true,
    cooReply,
    result: {
      ...result,
      external_delegated: leafOutcome?.delegated?.map((d) => d.member.id) || [],
      external_blocked: leafOutcome?.blocked?.map((b) => b.member.id) || [],
      external_failed: leafOutcome?.failed?.map((f) => f.member.id) || [],
    },
    standup_id: null,
  };
}

/** One-line summary of external/A2A leaf delegation for the COO reply. */
function describeLeafOutcome(outcome) {
  const parts = [];
  if (outcome.delegated?.length) {
    parts.push(
      `Also ran external agent(s) ${outcome.delegated.map((d) => d.member.display_name).join(', ')}.`
    );
  }
  if (outcome.failed?.length) {
    parts.push(
      `External agent(s) ${outcome.failed.map((f) => f.member.display_name).join(', ')} failed — see Kanban.`
    );
  }
  if (outcome.blocked?.length) {
    parts.push(
      `Blocked by budget: ${outcome.blocked.map((b) => `${b.member.display_name} (${b.reasons.join('; ')})`).join(', ')}.`
    );
  }
  return parts.join(' ');
}

function buildLeafOnlyReply(outcome) {
  const first = outcome.delegated?.[0];
  const summary = describeLeafOutcome(outcome);
  const cooReply = first?.text
    ? `${summary}\n\n${String(first.text).slice(0, 4000)}`
    : summary || 'No external agent could take this on.';
  return {
    cooReply,
    result: {
      count: outcome.delegated?.length || 0,
      agentNames: (outcome.delegated || []).map((d) => d.member.display_name),
      kanbanTaskIds: (outcome.delegated || []).map((d) => d.taskId).filter(Boolean),
      external_blocked: (outcome.blocked || []).map((b) => b.member.id),
      external_failed: (outcome.failed || []).map((f) => f.member.id),
    },
    standup_id: null,
  };
}
