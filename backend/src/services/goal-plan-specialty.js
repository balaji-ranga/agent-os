/**
 * Specialty + multi-intent goal plan expansion and async specialization steps.
 * Used by agent-goal-run (specialty_task) and scheduled-goals draft plans.
 */
import { readCooAgentsMdForCeo } from './org-context.js';
import { classifyIntentAndAllocate, parseAgentsFromAgentsMd } from './intent-classifier.js';
import { isCooNativeWork, isRefuseDelegationRequest } from './coo-specialty-delegation.js';

/** Plan builders may use more specialists than one-shot COO chat (default chat still 2). */
export const GOAL_PLAN_MAX_SPECIALTY =
  Math.max(1, Math.min(12, Number(process.env.GOAL_PLAN_MAX_SPECIALTY) || 8));

const WORKFLOW_STRIP_RES = [
  // Only strip known structural workflow chat phrases — keep residual specialty text.
  /run\s+crm\s+maker\s+checker/gi,
  /run\s+erp\s+maker\s+checker/gi,
  /run\s+[a-z0-9][\w\s\-]{0,40}?maker\s+checker/gi,
];

/**
 * Remove structural workflow phrases so residual text drives specialty allocation.
 */
export function stripWorkflowPhrasesFromPrompt(prompt) {
  let t = String(prompt || '');
  for (const re of WORKFLOW_STRIP_RES) {
    t = t.replace(re, ' ');
  }
  // Drop pure CRM/ERP structure lines that remaining after phrase strip
  t = t
    .replace(/\b(pre-order|preorder)\s+pipeline\b/gi, ' ')
    .replace(/\border\s*[- ]?\s*to\s*[- ]?\s*cash\b/gi, ' ')
    .replace(/\bo2c\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t;
}


/**
 * Remove goal-plan orchestration leftovers from residual specialty text.
 * Notify / agent_goal_create are separate step types; leaving them in residual
 * falsely triggers isCooNativeWork and drops specialty_task steps.
 */
export function stripPlanOrchestrationFromResidual(text) {
  let t = String(text || '');
  t = t
    .replace(/\bnotify_ceo\b[\s\S]{0,240}/gi, ' ')
    .replace(/\bnotify\s+(?:the\s+)?ceo\b[\s\S]{0,240}/gi, ' ')
    .replace(/\bwhen\s+(?:you(?:'re| are)\s+)?finished\b[\s\S]{0,240}/gi, ' ')
    .replace(/\bagent_?goal_?(?:create|start|status|get|list|advance)?\b/gi, ' ')
    .replace(/\bagentgoalcreate\b/gi, ' ')
    .replace(/\b(start\s+execution|full\s+prompt|include\s+(?:the\s+)?goal\s+run\s+id)\b/gi, ' ')
    .replace(/\b(use\s+this\s+full\s+prompt|in\s+your\s+reply)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
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

  // Explicit Platform Help routing always becomes a specialty_task (help is not COO chat).
  const explicitHelp = extractExplicitPlatformHelpIntent(residual, md);
  if (isCooNativeWork(residual) && !explicitHelp) return [];
  if (isCooNativeWork(residual) && explicitHelp) {
    return [explicitHelp];
  }

  const hints = splitResidualIntoIntentHints(residual);
  const byAgent = new Map(); // agent_id -> message (merge later intents with same agent into multi-step)

  const classifyChunk = async (chunk) => {
    const instruction =
      `${chunk}\n\n` +
      `[System: Goal-plan specialty allocation. Return JSON for every distinct specialist deliverable in this text ` +
      `(up to ${max} agents). Prefer one agent per distinct intent. Multi-step work for the same specialty is OK ` +
      `as a single detailed task string. Return {} only for pure platform/COO ops with no specialty deliverable.]`;
    let allocated = await classifyIntentAndAllocate(instruction, md, { ownerUserId }, ownerUserId);
    if (!allocated || typeof allocated !== 'object') allocated = {};
    if (!Object.keys(allocated).length && chunk.length > 20) {
      const force =
        `${chunk}\n\n` +
        `[System: Pick the closest specialist agent(s) for this deliverable. Up to ${Math.min(3, max)} agents. ` +
        `Return {} only if pure COO coordination with no specialist work.]`;
      allocated = (await classifyIntentAndAllocate(force, md, { ownerUserId }, ownerUserId)) || {};
    }
    return allocated;
  };

  if (hints.length === 1) {
    const allocated = await classifyChunk(hints[0]);
    for (const [aid, msg] of Object.entries(allocated || {})) {
      const id = String(aid).toLowerCase().replace(/[`*]/g, '').trim();
      if (!id || !msg) continue;
      byAgent.set(id, String(msg).trim());
    }
  } else {
    // Each hint classified independently (supports >2 multi-intent goals)
    for (const hint of hints.slice(0, max)) {
      const allocated = await classifyChunk(hint);
      const entries = Object.entries(allocated || {}).filter(([, v]) => typeof v === 'string' && v.trim());
      if (entries.length) {
        for (const [aid, msg] of entries.slice(0, 2)) {
          const id = String(aid).toLowerCase().replace(/[`*]/g, '').trim();
          if (!id) continue;
          if (byAgent.has(id)) {
            byAgent.set(id, `${byAgent.get(id)}\n\nAlso: ${String(msg).trim()}`);
          } else if (byAgent.size < max) {
            byAgent.set(id, String(msg).trim());
          }
        }
      }
    }
  }

  // Over-cap: keep max entries insertion order
  const purpose = purposeByAgentId(md);
  const out = [];
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

  // Single intent → multi-step: if classifier returned one agent but residual has A)/B) style tasks for same domain, keep one step with combined message (already merged).
  // If one agent but user wants sequential subtasks: split numerical parts for same residual when classifier collapsed.
  if (out.length === 1 && hints.length >= 2) {
    // Expand to multi-step on same agent when lettered/numbered parts exist
    const agentId = out[0].agent_id;
    const name = out[0].name;
    return hints.slice(0, max).map((h, i) => ({
      agent_id: agentId,
      message: h,
      name,
      purpose: out[0].purpose,
      step_label: `Step ${i + 1}: ${h.slice(0, 48)}`,
    }));
  }

  // Deterministic fallback: multi-hint residual must never be dropped (hybrid CRM+specialty etc.)
  // when the LLM returns {} — round-robin non-COO agents from AGENTS.md.
  if (!out.length && hints.length >= 2) {
    const roster = parseAgentsFromAgentsMd(md || '').filter((a) => {
      const id = String(a.id || '').toLowerCase();
      const role = `${a.name || ''} ${a.role || ''}`.toLowerCase();
      if (/platformhelp|platform\s*help/i.test(role + ' ' + id) && explicitHelp) return true;
      return id && !/\bcoo\b|chief operating|platform help|workflow builder/i.test(role + ' ' + id);
    });
    if (roster.length) {
      console.info('[goal-plan-specialty] multi-hint fallback (LLM empty)', {
        hints: hints.length,
        agents: roster.length,
      });
      return hints.slice(0, max).map((h, i) => {
        const agent = roster[i % roster.length];
        return {
          agent_id: String(agent.id).toLowerCase(),
          message: h,
          name: agent.name || agent.id,
          purpose: agent.role || '',
          step_label: `Specialty: ${(agent.name || agent.id)} — ${h.slice(0, 40)}`,
        };
      });
    }
  }

  // Ensure explicit Platform Help intent is never dropped when classifier returned other agents
  // or empty (hybrid L2C + help docs is a common multi-intent plan).
  if (explicitHelp) {
    const hasHelp = out.some(
      (x) =>
        /platformhelp|platform\s*help/i.test(String(x.agent_id || '')) ||
        /platform\s*help/i.test(String(x.name || ''))
    );
    if (!hasHelp) {
      if (out.length >= max) out[out.length - 1] = explicitHelp;
      else out.push(explicitHelp);
    }
  }

  return out;
}

/**
 * Build specialty_task step specs from residual classification.
 * multi specialty → same parallel_group for concurrent execution (P2).
 */
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
