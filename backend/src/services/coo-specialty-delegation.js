/**
 * Hard path: COO chat delegates via AGENTS.md intent classification (LLM),
 * not keyword specialty hints. Cap at 2 specialists (same as standup / intent tool).
 */
import { getCooAgentRow, readCooAgentsMdForCeo, getAgentsUnderCooForCeo } from './org-context.js';
import { classifyIntentAndAllocate, parseAgentsFromAgentsMd } from './intent-classifier.js';
import { classifyCooOwnedToolIntent } from './coo-tool-ownership.js';
import { scheduleCeoRequestViaOpenClawCron } from './delegation-queue.js';
import { isAskSpecialistToReachMe } from './reach-me-delegation.js';
import { getOrCreateDelegationHubStandup } from './standup-hub.js';
import { splitAllocationByKind } from './org-member-keys.js';
import { enforceBudget } from './agent-budgets.js';

/** Match intent-classifier + delegation-queue multi-intent cap. */
const MAX_DELEGATE_AGENTS = 2;

/**
 * CEO wants the COO to keep the work (skip specialty hard-path).
 * "don't/dont/do not delegate" must NOT count as an explicit delegate request.
 */
export function isRefuseDelegationRequest(message) {
  const t = String(message || '');
  return (
    /\b(don'?t|dont|do\s+not|never|no)\s+(?:please\s+)?delegat\w*/i.test(t) ||
    /\b(without\s+delegat\w*|no\s+delegat\w*|stop\s+delegat\w*)\b/i.test(t) ||
    /\b(handle\s+(this|it)\s+yourself|you\s+(do\s+it|handle\s+it|find\s+it)|keep\s+it\s+with\s+you|no\s+specialist)\b/i.test(
      t
    ) ||
    /\b(don'?t|dont|do\s+not)\s+assign\b/i.test(t)
  );
}

/** Explicit "please delegate …" / "assign to specialist" (not "don't delegate"). */
export function isExplicitDelegateRequest(message) {
  if (isRefuseDelegationRequest(message)) return false;
  return /\b(delegat\w*|assign\s+to\s+(a\s+)?(specialist|agent)|hand\s*off|send\s+this\s+to)\b/i.test(
    String(message || '')
  );
}

/**
 * Work the COO should handle itself — never hard-delegate.
 * Coordination / platform ops / local files stay with COO even if the classifier is unsure.
 */
export function isCooNativeWork(message) {
  const t = String(message || '');
  if (isRefuseDelegationRequest(t)) return true;
  // Previously uploaded / inbound files: find, list, download, re-attach (COO tools).
  if (
    /\b(list_inbound|inbound\/attachments|inbound\s+attach|list_inbound_attachments|master_data_list_documents|master_data_index_document)\b/i.test(
      t
    ) ||
    /\b(download|find|locate|fetch|get|open|attach|re-?attach|re-?send|share)\b[\s\S]{0,80}\b(file|pdf|docx?|xlsx?|csv|attachment|document|resume|inbound)\b/i.test(
      t
    ) ||
    /\b(file|pdf|docx?|attachment|document|resume)\b[\s\S]{0,80}\b(download|attach|here|inbound|uploaded|paperclip)\b/i.test(
      t
    ) ||
    /\.(pdf|docx?|xlsx?|csv|txt|md)\b/i.test(t) ||
    /\b(uploaded|paperclip|chat\s+attach)\b[\s\S]{0,60}\b(file|pdf|doc|attachment)\b/i.test(t)
  ) {
    return true;
  }
  return /\b(workflow|workflows|agent_workflow|trigger\s+(a\s+)?workflow|run\s+(a\s+)?workflow|list\s+workflows|what\s+workflows|publish\s+workflow|(?:what|list|which)\s+(?:your\s+)?tools?|tools?\s+(?:do\s+you\s+)?(?:have|access)|kanban|stand-?up|digest|org\.md|resync\s+org|who\s+(are|is)\s+(on\s+)?(the\s+)?(team|agents)|email_send|send\s+(an?\s+)?email|calendar|meeting\s+invite|notify_ceo|master_data_\w+|master\s*data\s+(list|tables?|upload|import|tool|api)|what\s+can\s+you\s+do|your\s+(role|purpose)|as\s+coo|coo\s+chat)\b/i.test(
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
 * Uses parseAgentsFromAgentsMd (first-wins, skips empty purpose) so Session-keys table
 * rows cannot wipe internal agent purposes — that bug dropped internals in mixed
 * internal + leaf allocations while dual-internal still worked via the empty-specific fallback.
 */
export function refineAllocationAgainstAgentsMd(allocated, agentsMdContent) {
  if (!allocated || typeof allocated !== 'object') return {};
  const entries = Object.entries(allocated)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => [normalizeAllocationKey(k), v.trim()])
    .filter(([k]) => k);
  if (!entries.length) return {};

  const purposeById = new Map(
    parseAgentsFromAgentsMd(agentsMdContent).map((a) => [String(a.id).toLowerCase(), a.role])
  );

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
  // Never force-fit status updates / COO coordination / local files into a specialist — leave {} for COO tools.
  if (Object.keys(allocated).length === 0) {
    const closest =
      `${msg}\n\n` +
      `[System: Pick exactly ONE agent from the list whose department/purpose domain is closest to this ask. ` +
      `Never pick agents whose purpose is only "Agent" or "demo". Adjacent domain fit is required when any specialist is closer than none. ` +
      `Return {} for COO-ops: workflows, tools, standups, Kanban ops, list/find/download/attach inbound or Master Data files, ` +
      `"don't delegate" / handle yourself, and any org/Kanban/A2A/delegation status update or status report.]`;
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
  // "don't delegate" / find-download-attach files / workflows etc. → leave to COO LLM + tools.
  if (isCooNativeWork(t) || isRefuseDelegationRequest(t)) {
    if (isRefuseDelegationRequest(t) || isCooNativeWork(t)) {
      console.info('[coo-delegation] skip hard-delegate; COO-native or refuse-delegation', {
        ownerUserId,
        refuse: isRefuseDelegationRequest(t),
        native: isCooNativeWork(t),
        preview: t.slice(0, 120),
      });
    }
    return null;
  }

  // Intent: if a COO content tool matches (esp. status updates → status_checker), do not hard-delegate.
  // Lets OpenClaw/COO run the tool — same as WhatsApp channel path.
  try {
    const owned = await classifyCooOwnedToolIntent(ownerUserId, t);
    if (owned?.tool) {
      console.info('[coo-delegation] skip hard-delegate; COO tool owns intent', {
        tool: owned.tool,
        ownerUserId,
      });
      return null;
    }
  } catch (e) {
    console.warn('[coo-delegation] tool-ownership classify failed', e?.message || e);
  }

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

  // Refuse internal specialists that are already over token / error budget before enqueue/cron.
  const agentById = new Map(
    getAgentsUnderCooForCeo(ownerUserId).map((a) => [String(a.id).toLowerCase(), a])
  );
  const allowedInternal = {};
  const internalBlocked = [];
  for (const [id, query] of Object.entries(internal)) {
    const agent = agentById.get(String(id).toLowerCase());
    const label = agent?.name || id;
    const budget = enforceBudget(ownerUserId, id, {
      action: 'delegation',
      memberLabel: label,
      throwOnBlock: false,
    });
    if (budget?.state === 'blocked') {
      internalBlocked.push({ id, name: label, reasons: budget.reasons || [] });
      console.warn(
        `[coo-delegation] budget blocked member=${id} owner=${ownerUserId} reasons="${(budget.reasons || []).join('; ')}"`
      );
      continue;
    }
    allowedInternal[id] = query;
  }

  const restrictToAgentIds = Object.keys(allowedInternal);
  if (!restrictToAgentIds.length) {
    if (leafOutcome || internalBlocked.length) {
      return {
        ok: true,
        ...buildNoInternalReply({ leafOutcome, internalBlocked }),
      };
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
    preAllocated: allowedInternal,
  });
  const moreBlocked = [
    ...internalBlocked,
    ...((result?.internalBlocked || []).map((b) => ({
      id: b.id,
      name: b.name || b.id,
      reasons: b.reasons || [],
    })) || []),
  ];
  if (!result?.count && !leafOutcome?.delegated?.length) {
    return {
      ok: true,
      ...buildNoInternalReply({ leafOutcome, internalBlocked: moreBlocked }),
      result: {
        ...(result || { count: 0, agentNames: [], kanbanTaskIds: [] }),
        internal_blocked: moreBlocked,
        external_blocked: leafOutcome?.blocked?.map((b) => b.member.id) || [],
        external_failed: leafOutcome?.failed?.map((f) => f.member.id) || [],
      },
    };
  }

  const names = (result.agentNames || []).join(', ');
  const kanbanHint =
    result.kanbanTaskIds?.length > 0
      ? ` Kanban task id(s): ${result.kanbanTaskIds.join(', ')}.`
      : '';
  const blockHint = moreBlocked.length ? ` ${describeInternalBlocked(moreBlocked)}` : '';
  const cooReply =
    (result?.count
      ? `I've delegated this to **${names}** based on AGENTS.md purposes (not doing the specialist work myself).` +
        ` They'll pick it up via the delegation run — track progress on Kanban.${kanbanHint}` +
        (result.pendingCount > 0
          ? ' Some work is queued; refresh Kanban or Check for updates shortly.'
          : '')
      : '') +
    (leafOutcome ? ` ${describeLeafOutcome(leafOutcome)}` : '') +
    blockHint;

  return {
    ok: true,
    cooReply: cooReply.trim(),
    result: {
      ...result,
      internal_blocked: moreBlocked,
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

function describeInternalBlocked(blocked) {
  if (!blocked?.length) return '';
  return `Blocked by budget: ${blocked
    .map((b) => `${b.name || b.id} (${(b.reasons || []).join('; ')})`)
    .join(', ')}.`;
}

/** Reply when every internal target was budget-blocked (and optionally leaf ran). */
function buildNoInternalReply({ leafOutcome = null, internalBlocked = [] } = {}) {
  const parts = [];
  if (leafOutcome) {
    const leafSummary = describeLeafOutcome(leafOutcome);
    if (leafSummary) parts.push(leafSummary);
    const first = leafOutcome.delegated?.[0];
    if (first?.text) parts.push(String(first.text).slice(0, 4000));
  }
  const blockLine = describeInternalBlocked(internalBlocked);
  if (blockLine) parts.push(blockLine);
  if (!parts.length) {
    parts.push(
      'I could not delegate — the matched specialist(s) are over their monthly token or error budget. Raise the budget in Efficiency → Agent View or wait for next month.'
    );
  }
  return {
    cooReply: parts.join('\n\n'),
    result: {
      count: leafOutcome?.delegated?.length || 0,
      agentNames: (leafOutcome?.delegated || []).map((d) => d.member.display_name),
      kanbanTaskIds: (leafOutcome?.delegated || []).map((d) => d.taskId).filter(Boolean),
      internal_blocked: internalBlocked,
      external_blocked: (leafOutcome?.blocked || []).map((b) => b.member.id),
      external_failed: (leafOutcome?.failed || []).map((f) => f.member.id),
    },
    standup_id: null,
  };
}
