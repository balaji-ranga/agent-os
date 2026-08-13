/**
 * Specialty + multi-intent goal plan expansion and async specialization steps.
 * Used by agent-goal-run (specialty_task) and scheduled-goals draft plans.
 */
import { readCooAgentsMdForCeo, getAgentsUnderCooForCeo } from './org-context.js';
import { classifyIntentAndAllocate, parseAgentsFromAgentsMd } from './intent-classifier.js';
import { isCooNativeWork, isRefuseDelegationRequest } from './coo-specialty-delegation.js';
import { listChatTriggerableWorkflows, listPublishedWorkflows } from './agent-workflow-chat-tools.js';

/** Plan builders may use more specialists than one-shot COO chat (default chat still 2). */
export const GOAL_PLAN_MAX_SPECIALTY =
  Math.max(1, Math.min(12, Number(process.env.GOAL_PLAN_MAX_SPECIALTY) || 8));

/**
 * Remove workflow chat-trigger phrases so residual text drives specialty allocation.
 * Prefer tenant catalog phrases when ownerUserId is provided (no product hardcoding).
 */
export function stripWorkflowPhrasesFromPrompt(prompt, ownerUserId = null) {
  let t = String(prompt || '');
  const phrases = [];
  if (ownerUserId) {
    try {
      const chatable = listChatTriggerableWorkflows(ownerUserId) || [];
      const published = listPublishedWorkflows(ownerUserId) || [];
      for (const w of [...published, ...chatable]) {
        const phr = String(w?.chat_trigger_phrase || '').trim();
        if (phr.length >= 4) phrases.push(phr);
      }
    } catch (_) {
      /* ignore */
    }
  }
  phrases.sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    t = t.replace(new RegExp(esc, 'gi'), ' ');
  }
  // Generic maker-checker style chat phrases (not CRM/ERP product names)
  t = t.replace(/\brun\s+[a-z0-9][\w\s\-]{0,48}?maker\s*[- ]?\s*checker\b/gi, ' ');
  t = t.replace(/\s{2,}/g, ' ').trim();
  return t;
}


/** Lettered A) / numbered 1) lists in a goal residual (ordered specialty deliverables). */
export function residualIsLetteredOrNumbered(text) {
  const residual = String(text || '');
  return (
    /(?:^|[\n;]\s*)[A-G]\)\s+\S/i.test(residual) || /(?:^|[\n;]\s*)\d+[.)]\s+\S/.test(residual)
  );
}

/** True when residual names an org employee id or display name from AGENTS.md. */
export function residualNamesRosterAgent(residual, agentsMd) {
  const lower = String(residual || '').toLowerCase();
  if (!lower.trim()) return false;
  const roster = parseAgentsFromAgentsMd(agentsMd || '');
  for (const a of roster) {
    const id = String(a.id || '')
      .trim()
      .toLowerCase();
    const name = String(a.name || '')
      .trim()
      .toLowerCase();
    if (id && id.length >= 4 && lower.includes(id)) return true;
    if (name && name.length >= 4 && lower.includes(name)) return true;
  }
  return false;
}

/**
 * COO-chat native heuristic (kanban / workflows / notify / master_data) must not
 * wipe goal-plan specialties. Those tokens are often instructions *inside* a
 * named employee's task or a lettered A)/B) list. Drop all specialty only when
 * the residual is coordination-only (no lettered list, no roster employee).
 */
export function shouldSkipAllSpecialtyAsCooNative(
  residual,
  agentsMd,
  { explicitHelp = false } = {}
) {
  if (explicitHelp) return false;
  if (!isCooNativeWork(residual)) return false;
  if (residualIsLetteredOrNumbered(residual)) return false;
  if (residualNamesRosterAgent(residual, agentsMd)) return false;
  return true;
}

/** Merge AGENTS.md table + live under-COO roster (Exchange hires may be missing from MD). */
export function rosterAgentsForGoalPlan(agentsMd, ownerUserId = null) {
  const map = new Map();
  for (const a of parseAgentsFromAgentsMd(agentsMd || '')) {
    const id = String(a.id || '').toLowerCase();
    if (id) map.set(id, { id, name: a.name || id, role: a.role || '' });
  }
  if (ownerUserId) {
    try {
      for (const a of getAgentsUnderCooForCeo(ownerUserId) || []) {
        const id = String(a.id || '').toLowerCase();
        if (!id || a.is_coo) continue;
        if (map.has(id)) continue;
        map.set(id, {
          id,
          name: a.name || id,
          role: [a.department, a.role].filter(Boolean).join(' — ') || '',
        });
      }
    } catch {
      /* ignore */
    }
  }
  return [...map.values()].filter((a) => {
    const id = String(a.id || '').toLowerCase();
    return id && id !== 'balserve' && !/coo|chief operating/i.test(`${a.name || ''} ${a.role || ''}`);
  });
}

/**
 * Longest roster name/id appearing in text (lettered "A) Business Discovery …").
 */
export function matchNamedRosterAgentInText(text, roster) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return null;
  let best = null;
  let bestLen = 0;
  for (const a of roster || []) {
    const id = String(a.id || '').trim().toLowerCase();
    const name = String(a.name || '').trim().toLowerCase();
    const compact = name.replace(/\s+/g, '');
    for (const tok of [name, id, compact]) {
      if (!tok || tok.length < 4) continue;
      if (!lower.includes(tok)) continue;
      if (tok.length > bestLen) {
        best = a;
        bestLen = tok.length;
      }
    }
  }
  return best;
}

/**
 * Remove goal-plan orchestration leftovers from residual specialty text.
 * Notify / agent_goal_create are separate step types; leaving them in residual
 * falsely triggers isCooNativeWork and drops specialty_task steps.
 */
export function stripPlanOrchestrationFromResidual(text) {
  let t = String(text || '');
  t = t
    // Drop whole “when finished / notify …” tail (plan has its own notify_ceo step)
    .replace(/\bwhen\s+(?:you(?:'re| are)\s+)?finished\b[\s\S]*/gi, ' ')
    .replace(/\bnotify_ceo\b[\s\S]*/gi, ' ')
    .replace(/\bnotify\s+(?:the\s+)?ceo\b[\s\S]*/gi, ' ')
    // Tool / meta instructions from CEO→COO prompts (not specialty work)
    .replace(/\buse\s+agent_?goalcreate\b[\s\S]{0,160}?\breply\.?/gi, ' ')
    .replace(/\bagent_?goal_?(?:create|start|status|get|list|advance)?\b/gi, ' ')
    .replace(/\bagentgoalcreate\b/gi, ' ')
    .replace(/\b(start\s+execution|full\s+prompt|include\s+(?:the\s+)?goal\s+run\s+id)\b/gi, ' ')
    .replace(/\b(use\s+this\s+full\s+prompt|in\s+your\s+reply)\b/gi, ' ')
    .replace(/\bwith\s+this\s*,?\s*,?\s*and\s*\.?\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.;:\-]+|[\s,.;:\-]+$/g, '')
    .trim();
  return t;
}

/**
 * Explicit answer via Platform Help residual -> specialty_task (not COO chat).
 */
export function extractExplicitPlatformHelpIntent(residual, agentsMd = '') {
  const t = String(residual || '').trim();
  if (!t || !/\b(platform\s*help|platformhelp)\b/i.test(t)) return null;

  let agentId = 'platformhelp';
  try {
    const roster = parseAgentsFromAgentsMd(agentsMd || '');
    const hit = roster.find((a) => {
      const id = String(a.id || '').toLowerCase();
      const name = (String(a.name || '') + ' ' + String(a.role || '')).toLowerCase();
      return id === 'platformhelp' || /platformhelp/.test(id) || /platform\s*help/.test(name);
    });
    if (hit && hit.id) agentId = String(hit.id).toLowerCase().replace(/[`*]/g, '').trim();
  } catch (_) {}

  let message = t;
  const clause =
    t.match(/(?:also\s+)?(?:answer|ask|check|query|use)\s+(?:via|using|through|with)\s+platform\s*help\b[:\s,]*([\s\S]+)/i) ||
    t.match(/platform\s*help\b[:\s,]+([\s\S]+)/i) ||
    t.match(/\bvia\s+platform\s*help\b[:\s,]*([\s\S]+)/i);
  if (clause && clause[1]) {
    message = clause[1]
      .replace(/\bwhen\s+(?:you(?:'re| are)\s+)?finished\b[\s\S]*/i, '')
      .replace(/\bnotify_ceo\b[\s\S]*/i, '')
      .trim();
  }
  message = stripPlanOrchestrationFromResidual(message) || t;
  if (message.length < 8) message = t;
  return {
    agent_id: agentId,
    message: message.slice(0, 2000),
    name: 'Platform Help',
    purpose: 'Platform help / product how-to',
    step_label: 'Platform Help: ' + message.slice(0, 48),
  };
}

/**
 * Heuristic residual split without LLM: sections like "A) … B) …" or "1) … 2) …".
 * @returns {string[]}
 */
export function splitResidualIntoIntentHints(residual) {
  const text = String(residual || '').trim();
  if (!text) return [];
  // Allow A)/B) mid-sentence (e.g. hybrid residual: "Also A) research … B) design …")
  if (/[A-G]\)\s+\S/i.test(text)) {
    const byLetter = text
      .split(/(?:^|[\n;]|\s)(?=[A-G]\)\s+)/i)
      .map((s) => s.replace(/^[A-G]\)\s+/i, '').trim())
      .filter((s) => s.length > 8);
    // Drop leading preamble before the first lettered intent (e.g. "for Acme. Also")
    const lettered = byLetter.filter((s) => !/^(also|then|for|and|with|the)\b/i.test(s) || s.length > 40);
    const intents = lettered.length >= 2 ? lettered : byLetter.slice(1);
    if (intents.length >= 2) return intents.slice(0, GOAL_PLAN_MAX_SPECIALTY);
  }
  if (/\d+[\).]\s+\S/.test(text)) {
    const byNum = text
      .split(/(?:^|[\n;]|\s)(?=(?:\d+[\).])\s+)/)
      .map((s) => s.replace(/^\d+[\).]\s+/, '').trim())
      .filter((s) => s.length > 8);
    const intents = byNum[0] && byNum[0].length < 40 && !/\b(research|design|write|draft|build|plan)\b/i.test(byNum[0])
      ? byNum.slice(1)
      : byNum;
    if (intents.length >= 2) return intents.slice(0, GOAL_PLAN_MAX_SPECIALTY);
  }
  // Conjunction multi-intent: "research X and write Y and cook Z"
  const andParts = text.split(/\s+\band\b\s+/i).map((s) => s.trim()).filter((s) => s.length > 12);
  if (andParts.length >= 2 && andParts.length <= GOAL_PLAN_MAX_SPECIALTY) {
    // Only if parts look distinct enough (length diversity or different leading verbs)
    const heads = andParts.map((p) => p.slice(0, 24).toLowerCase());
    if (new Set(heads).size >= 2) return andParts;
  }
  return [text];
}

function purposeByAgentId(md) {
  const map = new Map();
  for (const a of parseAgentsFromAgentsMd(md || '')) {
    map.set(String(a.id).toLowerCase(), a);
  }
  return map;
}

/**
 * Classify residual specialty work into agent_id → task for goal plans (max N, not chat's 2).
 * @returns {Promise<{ agent_id: string, message: string, name?: string }[]>}
 */
export async function classifySpecialtyIntentsForPlan(ownerUserId, residualText, opts = {}) {
  const max = Math.max(1, Math.min(GOAL_PLAN_MAX_SPECIALTY, Number(opts.maxSpecialty) || GOAL_PLAN_MAX_SPECIALTY));
  const residualRaw = String(residualText || '').trim();
  // Strip notify_ceo / agent_goal_* leftovers before coo-native heuristics; those are other plan steps.
  const residual = stripPlanOrchestrationFromResidual(residualRaw);
  if (!ownerUserId || !residual || residual.length < 6) {
    const mdEarly = ownerUserId ? await readCooAgentsMdForCeo(ownerUserId) : '';
    const phOnly = extractExplicitPlatformHelpIntent(residualRaw || residual, mdEarly || '');
    return phOnly ? [phOnly] : [];
  }
  if (isRefuseDelegationRequest(residual)) return [];

  const md = await readCooAgentsMdForCeo(ownerUserId);
  if (!md?.trim()) return [];

  // Help / product how-to is never COO-owned in a goal plan — it is always a specialty_task.
  const explicitHelp = extractExplicitPlatformHelpIntent(residual, md);
  if (shouldSkipAllSpecialtyAsCooNative(residual, md, { explicitHelp })) return [];
  if (
    isCooNativeWork(residual) &&
    explicitHelp &&
    !residualIsLetteredOrNumbered(residual) &&
    !residualNamesRosterAgent(residual, md)
  ) {
    return [explicitHelp];
  }

  /**
   * Intent allocation is LLM-guided via classifyIntentAndAllocate (+ AGENTS.md roster).
   * We only pre-split residual when the CEO listed lettered/numbered deliverables (A)/B) or 1)/2)).
   * Soft “and / also” prose stays one residual so the model chooses agents — never round-robin.
   */
  const letteredOrNumbered = residualIsLetteredOrNumbered(residual);
  const hints = letteredOrNumbered ? splitResidualIntoIntentHints(residual) : [residual];
  const chunks = (hints.length ? hints : [residual]).filter((h) => String(h || '').trim().length >= 6).slice(0, max);
  const byAgent = new Map();

  const classifyChunk = async (chunk) => {
    const instruction =
      `${chunk}\n\n` +
      `[System: Goal-plan specialty allocation. From AGENTS.md, assign each distinct specialist deliverable ` +
      `(research, design, copy, product how-to via Platform Help, domain work) to the best agent id. ` +
      `Up to ${max} agents. Platform Help is the correct agent for "where do I find… / track goal plans / platform how-to". ` +
      `Do NOT assign CRM/ERP makers for documentation questions. Multi-step work for one specialist = one detailed task string. ` +
      `Return {} only if nothing left after workflows for a specialist (pure coordination).]`;
    let allocated = await classifyIntentAndAllocate(instruction, md, { ownerUserId }, ownerUserId);
    if (!allocated || typeof allocated !== 'object') allocated = {};
    if (!Object.keys(allocated).length && chunk.length > 20) {
      const force =
        `${chunk}\n\n` +
        `[System: Pick the closest specialist agent(s) for this deliverable. Up to ${Math.min(3, max)} agents. ` +
        `Include platformhelp for product/how-to questions. Return {} only for pure COO coordination.]`;
      allocated = (await classifyIntentAndAllocate(force, md, { ownerUserId }, ownerUserId)) || {};
    }
    return allocated;
  };

  // One residual → one LLM call (model may still return multi-agent JSON). Multi lettered chunks → per chunk.
  for (const chunk of chunks) {
    const allocated = await classifyChunk(chunk);
    const entries = Object.entries(allocated || {}).filter(([, v]) => typeof v === 'string' && v.trim());
    for (const [aid, msg] of entries) {
      if (byAgent.size >= max && !byAgent.has(String(aid).toLowerCase())) break;
      const id = String(aid).toLowerCase().replace(/[`*]/g, '').trim();
      if (!id) continue;
      if (byAgent.has(id)) {
        byAgent.set(id, `${byAgent.get(id)}\n\nAlso: ${String(msg).trim()}`);
      } else {
        byAgent.set(id, String(msg).trim());
      }
    }
  }

  const roster = rosterAgentsForGoalPlan(md, ownerUserId);
  if (letteredOrNumbered && chunks.length >= 1) {
    for (const chunk of chunks) {
      const hit = matchNamedRosterAgentInText(chunk, roster);
      if (!hit?.id) continue;
      const id = String(hit.id).toLowerCase();
      if (byAgent.has(id)) continue;
      if (byAgent.size >= max) break;
      byAgent.set(id, chunk);
      console.info('[goal-plan-specialty] lettered named-agent fallback', {
        agent: id,
        chunk: String(chunk).slice(0, 80),
      });
    }
  } else if (!byAgent.size) {
    const hit = matchNamedRosterAgentInText(residual, roster);
    if (hit?.id) {
      byAgent.set(String(hit.id).toLowerCase(), residual);
      console.info('[goal-plan-specialty] named-agent fallback', { agent: hit.id });
    }
  }

  const purpose = purposeByAgentId(md);
  for (const a of roster) {
    if (!purpose.has(String(a.id).toLowerCase())) purpose.set(String(a.id).toLowerCase(), a);
  }
  let out = [];
  for (const [agentId, message] of byAgent) {
    if (out.length >= max) break;
    const meta = purpose.get(agentId);
    out.push({
      agent_id: agentId,
      message,
      name: meta?.name || agentId,
      purpose: meta?.role || '',
    });
  }

  // Same-agent lettered multi-step only when residual truly lettered/numbered
  // and chunks do not name different roster employees.
  if (out.length === 1 && letteredOrNumbered && chunks.length >= 2) {
    const named = chunks
      .map((h) => matchNamedRosterAgentInText(h, roster)?.id)
      .filter(Boolean);
    const distinct = new Set(named.map((id) => String(id).toLowerCase()));
    if (distinct.size <= 1) {
      const agentId = out[0].agent_id;
      const name = out[0].name;
      out = chunks.slice(0, max).map((h, i) => ({
        agent_id: agentId,
        message: h,
        name,
        purpose: out[0].purpose,
        step_label: `Step ${i + 1}: ${h.slice(0, 48)}`,
      }));
    }
  }

  // No inventing specialty agents when the LLM returns empty — only carry explicit Platform Help
  // (or leave empty so the plan stays workflow + notify). Round-robin was mis-assigning CRM makers.
  if (!out.length && explicitHelp) {
    console.info('[goal-plan-specialty] LLM empty; using explicit Platform Help residual');
    return [explicitHelp];
  }

  // Ensure Platform Help is never dropped when residual asked for it
  if (explicitHelp) {
    const hasHelp = out.some(
      (x) =>
        /platformhelp|platform\s*help/i.test(String(x.agent_id || '')) ||
        /platform\s*help/i.test(String(x.name || ''))
    );
    if (!hasHelp) {
      if (out.length >= max) out[out.length - 1] = explicitHelp;
      else out.push(explicitHelp);
      console.info('[goal-plan-specialty] merged explicit Platform Help into specialty intents');
    }
  }

  return out;
}

export function specialtyIntentsToSteps(intents, { parallel = true } = {}) {
  const list = Array.isArray(intents) ? intents : [];
  if (!list.length) return [];
  const parallelGroup = parallel && list.length > 1 ? 1 : null;
  return list.map((it, i) => ({
    type: 'specialty_task',
    label: it.step_label || `Specialty: ${it.name || it.agent_id}`,
    agent_id: it.agent_id,
    message: it.message,
    parallel_group: parallelGroup,
    phase: 'specialty',
  }));
}
