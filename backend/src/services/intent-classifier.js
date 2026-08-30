/**
 * Use OpenAPI-compliant LLM to classify CEO message intent and allocate a task query per agent.
 * Agent list and purpose come only from the COO's AGENTS.md (parsed and passed to the model).
 * No hardcoded agent IDs or intent rules. Uses config/llm.js. Override: OPENAI_INTENT_MODEL or OPENAI_COO_MODEL.
 * Returns { [agentId: string]: string } with agent_id keys as written in the document.
 * Returns null on error (caller decides fallback).
 */
import { getLlmConfig, chatCompletions } from '../config/llm.js';

function getIntentModelOverride() {
  return (process.env.OPENAI_INTENT_MODEL || process.env.OPENAI_COO_MODEL || '').trim() || undefined;
}

/**
 * Parse the agents table from COO AGENTS.md.
 * Supports 3-col (Agent ID | Name | Role), 4-col (Agent ID | Name | Department | Role),
 * and the leaf-member table (Member key | Name | Department | Purpose).
 * Leaf keys are written as `` `ext:…` `` / `` `a2a:…` `` in markdown — strip the decoration
 * so the model (and later routing) see the bare member key.
 * @param {string} md - Full AGENTS.md content
 * @returns {{ id: string, name: string, role: string }[]}
 */
export function parseAgentsFromAgentsMd(md) {
  const agents = [];
  const seen = new Set();
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || !line.includes('|')) continue;
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length < 4) continue;
    // Strip markdown cell decoration (`id`, **id**) and surrounding quotes.
    const rawId = (parts[1] || '')
      .replace(/[`*]/g, '')
      .trim()
      .replace(/^['"]+|['"]+$/g, '')
      .trim();
    const name = (parts[2] || '').replace(/[`*]/g, '').trim();
    if (!rawId) continue;
    const headerIds = new Set(['agent id', 'member key', 'id', 'key']);
    if (headerIds.has(rawId.toLowerCase())) continue;
    if (/^[-–—\s]+$/.test(rawId) || /^[-–—\s]+$/.test(name)) continue;
    const id = rawId.toLowerCase();
    if (seen.has(id)) continue;
    const col3 = (parts[3] || '').trim();
    const col4 = (parts[4] || '').trim();
    const purpose =
      col4 && !/^[-–—\s]+$/.test(col4)
        ? `${col3 && col3 !== '—' && col3 !== '-' ? `${col3} — ` : ''}${col4}`
        : col3;
    if (!purpose || /^[-–—\s]+$/.test(purpose)) continue;
    const headerPurposes = new Set(['role', 'purpose', 'department — purpose', 'department']);
    if (headerPurposes.has(purpose.toLowerCase())) continue;
    // Smoke/demo fixtures sometimes live in the same tenant while verification
    // is running. They are not executable company capabilities and must never
    // win production delegation merely because the CEO used the word "test".
    const roleKey = purpose.toLowerCase().replace(/^[^—]+—\s*/, '').trim();
    const placeholderRole = /^(?:test(?:er)?|demo|placeholder|sample)(?:\s+(?:agent|employee))?$/.test(roleKey);
    const placeholderName = /^(?:test|demo|placeholder|sample)(?:\s*\d+|\s*roll)?$/i.test(name);
    const fixtureId = /(?:^|[-_])test(?:[-_]|$)/i.test(id);
    if (placeholderRole && (placeholderName || fixtureId)) continue;
    seen.add(id);
    agents.push({ id, name, role: purpose });
  }
  return agents;
}

/**
 * Build the list of agents and their purpose from parsed AGENTS.md for the model.
 * @param {{ id: string, name: string, role: string }[]} agents
 * @returns {string}
 */
function formatAgentsPurposeForModel(agents) {
  return agents
    .map((a) => `- Agent ID: "${a.id}", Name: ${a.name}, Purpose: ${a.role}`)
    .join('\n');
}

/**
 * Normalize model output keys to agent IDs from the document (so spelling/name variants map to doc id).
 * @param {Record<string, string>} parsed - model output with lowercase keys
 * @param {{ id: string, name: string, role: string }[]} agentsFromDoc
 * @returns {Record<string, string>}
 */
function normalizeKeysToDocIds(parsed, agentsFromDoc) {
  const idByKey = new Map();
  for (const a of agentsFromDoc) {
    idByKey.set(a.id.toLowerCase(), a.id);
    const nameKey = (a.name || '').toLowerCase().replace(/\s+/g, '');
    if (nameKey) idByKey.set(nameKey, a.id);
  }
  const result = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    // Model often re-wraps ids in backticks/asterisks when copying from the AGENTS.md table.
    const cleaned = String(k)
      .replace(/[`*]/g, '')
      .trim()
      .replace(/^['"]+|['"]+$/g, '')
      .trim()
      .toLowerCase();
    const key = cleaned.replace(/\s+/g, '');
    const canonical = idByKey.get(key) ?? idByKey.get(cleaned) ?? key;
    result[canonical] = v.trim();
  }
  return result;
}

/**
 * Extract a JSON object from model output that may contain markdown, prefixes, or trailing text.
 * Tries: strip markdown code fence, then find first { and matching } by brace count.
 * @param {string} raw - Raw model response
 * @returns {object | null} Parsed object or null
 */
function extractJsonFromModelResponse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  // Strip markdown code block
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/g, '').trim();
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const jsonStr = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

const SYSTEM_PROMPT = `You are an intent classifier for a COO. You will receive:
1. A list of agents and their purpose (from the COO's AGENTS.md — this is the source of truth).
2. A message from the CEO.

Your job: Map the CEO message to the agent(s) whose **department + purpose** best matches. Match by meaning and domain fit (read each Purpose), not by isolated keywords.

Critical:
- Prefer **exactly one** best-fit agent when the CEO ask is a single intent.
- For clearly multi-intent messages (conjunctions like "and", ";", or two distinct asks), return **exactly the distinct specialists needed**, up to **2** agents — one internal and one external/A2A leaf is valid and expected (e.g. deep research + ops status desk). Do not collapse a true multi-intent ask into a single agent.
- Never assign agents whose Purpose is only "Agent", "demo", or empty/placeholder — skip them unless the CEO named them.
- If the CEO explicitly names an agent (by Agent ID or Name), map to that agent.
- Agent IDs may look like \`ext:…\` or \`a2a:…\` — those are valid external/A2A leaf members. Use the exact Agent ID string as the JSON key (no backticks, no asterisks).
- **Each value is the specialist task**, not a meta debate. Prefer a self-contained work order: original CEO request + any follow-up instruction. If Recent user messages exist and the current line is meta ("why not market researcher?", "please delegate", "ok go ahead"), the task string **must still include** the prior substantive ask (e.g. market insights for Mag7).
- Choose the **closest** specialist by department/purpose domain. Adjacent fit is OK (food → Social/content; science/markets/equities/Mag7/tech research → Research/MarketResearcher; money/budget → Finance; software/code → code agent). Do not require the ask to be an exact copy of the purpose wording.
- **Market / investment / equity / "insights for Mag7 (or similar)"** → Research / MarketResearcher-class agent when present — not COO coordination {}.
- **Do not** assign org / Kanban / A2A / delegation **status updates**, status reports, status digests, or "run status checker" style asks to any specialist (including ops/echo leaves). Those are COO coordination — return {}.
- Include only agents that are meaningfully closer than others. Never fan out to all agents.
- Do not use keyword shortcuts. Read each agent's Purpose and decide by semantic fit.
- Return {} if the message is pure COO coordination (workflows, tools, standups, Kanban ops, **status updates / status reports / status digests**, greetings, "what can you do") with **no** specialist deliverable implied, OR no listed agent is a better fit than random.
- Do not assign to the CEO. Only agents from the list.
- Output valid JSON only: { "agent_id": "task query for that agent only", ... }
- Use exact Agent IDs from the list as keys.`;

/** When DEBUG_INTENT=1, last run's input and output (for API to return in response). */
let lastIntentDebug = null;

export function getLastIntentDebug() {
  return lastIntentDebug;
}

/**
 * @param {string} ceoMessage - Raw message from the CEO
 * @param {string} agentsMdContent - Full content of the COO's AGENTS.md (lists agents and their use cases)
 * @param {{ lastUserMessages?: string[], agentResponses?: { agent_id: string, content: string }[], ownerUserId?: string }} [context] - Optional context + BYOK owner
 * @param {string} [ownerUserId] - CEO id for BYOK (also accepted via context.ownerUserId)
 * @returns {Promise<{ [agentId: string]: string } | null>} Map of agent_id -> task query, or null on error
 */
export async function classifyIntentAndAllocate(ceoMessage, agentsMdContent, context = undefined, ownerUserId = null) {
  const owner = ownerUserId || context?.ownerUserId || null;
  const cfg = getLlmConfig(owner);
  const apiKey = cfg.primary?.apiKey || cfg.secondary?.apiKey;
  if (!apiKey) {
    lastIntentDebug = { systemPrompt: SYSTEM_PROMPT, userMessage: '(CEO message: ' + (ceoMessage || '').slice(0, 100) + ')', modelRawResponse: null, finalMapping: {}, error: 'No LLM API key (OPENAI_API_KEY or OPENAI_PRIMARY_API_KEY)' };
    return null;
  }

  const text = (ceoMessage || '').trim();
  if (!text) return null;

  const md = (agentsMdContent || '').trim();
  if (!md) {
    lastIntentDebug = { systemPrompt: SYSTEM_PROMPT, userMessage: '(COO AGENTS.md empty or unreadable)', modelRawResponse: null, finalMapping: {}, error: 'No AGENTS.md content' };
    return null;
  }

  const agentsFromDoc = parseAgentsFromAgentsMd(md);
  const agentsPurposeText = formatAgentsPurposeForModel(agentsFromDoc);
  if (!agentsPurposeText) {
    if (process.env.DEBUG_INTENT === '1') console.warn('[intent] No agents table parsed from AGENTS.md');
    lastIntentDebug = { systemPrompt: SYSTEM_PROMPT, userMessage: '(No agents table parsed from AGENTS.md)', modelRawResponse: null, finalMapping: {}, error: 'No agents parsed' };
    return {};
  }

  let userContent = `Agents and their purpose (from COO AGENTS.md):\n\n${agentsPurposeText}\n\n---\n\n`;
  if (context?.lastUserMessages?.length) {
    const recent = context.lastUserMessages.slice(-8).map((m) => (typeof m === 'string' ? m : String(m)).trim().slice(0, 300)).filter(Boolean);
    if (recent.length) userContent += `Recent user messages (for context; newest last):\n${recent.map((m, i) => `${i + 1}. "${m}"`).join('\n')}\n\n---\n\n`;
  }
  if (context?.agentResponses?.length) {
    const responses = context.agentResponses.slice(-10).map((r) => `- ${r.agent_id}: ${(r.content || '').trim().slice(0, 250)}`).filter((s) => s.length > 5);
    if (responses.length) userContent += `Recent agent responses (for context):\n${responses.join('\n')}\n\n---\n\n`;
  }
  userContent += `Current CEO message to classify and split:\n\n"${text}"`;

  lastIntentDebug = { systemPrompt: SYSTEM_PROMPT, userMessage: userContent, modelRawResponse: null, finalMapping: null, error: null };
  if (process.env.DEBUG_INTENT === '1') {
    console.warn('\n[intent] === SYSTEM PROMPT ===\n' + SYSTEM_PROMPT + '\n[intent] === END SYSTEM PROMPT ===');
    console.warn('\n[intent] === USER MESSAGE (to intent model) ===\n' + userContent + '\n[intent] === END USER MESSAGE ===');
  }

  try {
    const { content } = await chatCompletions({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      modelOverride: getIntentModelOverride(),
      maxTokens: 512,
      ownerUserId: owner,
      toolName: 'intent_classify_and_delegate',
    });

    const raw = (content ?? '').trim();

    if (lastIntentDebug) lastIntentDebug.modelRawResponse = raw;
    if (process.env.DEBUG_INTENT === '1') console.warn('\n[intent] === MODEL RAW RESPONSE ===\n' + raw + '\n[intent] === END MODEL RESPONSE ===');

    const parsed = extractJsonFromModelResponse(raw);
    if (!parsed || typeof parsed !== 'object') {
      if (lastIntentDebug) lastIntentDebug.error = 'Could not parse JSON from model response';
      if (lastIntentDebug) lastIntentDebug.finalMapping = {};
      return {};
    }
    const withLowerKeys = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) withLowerKeys[String(k).trim().toLowerCase()] = v.trim();
    }
    const result = normalizeKeysToDocIds(withLowerKeys, agentsFromDoc);
    if (lastIntentDebug) lastIntentDebug.finalMapping = result;
    if (process.env.DEBUG_INTENT === '1') console.warn('[intent] Final mapping (agent_id -> message):', JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (lastIntentDebug) lastIntentDebug.error = errMsg;
    if (process.env.DEBUG_INTENT === '1') console.warn('[intent] Error:', errMsg, e.stack);
    return null;
  }
}
