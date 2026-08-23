/**
 * Intent: does the CEO message ask for work a COO-owned content tool should do?
 * Used by web COO chat hard-delegation to skip specialty fan-out when a matching
 * tool exists (especially status updates → status_checker).
 *
 * Matching is LLM semantic fit against tool purposes from content_tools_meta —
 * not keyword lists.
 */
import { getLlmConfig, chatCompletions } from '../config/llm.js';
import { COO_CONTENT_TOOLS_ALLOW } from '../lib/content-tools-allow.js';
import { listEnabledContentTools } from './content-tools-meta.js';
import { shouldUseEfficiencyOllama } from './llm-efficiency-mode.js';

const COO_TOOL_OWNERSHIP_TOOL = 'coo_tool_ownership';

function getIntentModelOverride() {
  return (process.env.OPENAI_INTENT_MODEL || process.env.OPENAI_COO_MODEL || '').trim() || undefined;
}

function extractJsonObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/g, '').trim();
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < s.length; i += 1) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  try {
    const parsed = JSON.parse(s.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Enabled COO tools with purposes (DB catalog ∩ COO allowlist). */
export function listCooOwnedToolsForIntent() {
  const allow = new Set(COO_CONTENT_TOOLS_ALLOW.map((n) => String(n).toLowerCase()));
  return listEnabledContentTools()
    .filter((t) => allow.has(String(t.name || '').toLowerCase()))
    .map((t) => ({
      name: t.name,
      display_name: t.display_name || t.name,
      purpose: String(t.purpose || '').trim(),
    }))
    .filter((t) => t.purpose);
}

const SYSTEM_PROMPT = `You decide whether a CEO message should be handled by the COO using one of the COO's own content tools, or whether it is specialist work to delegate.

You receive:
1. The COO tool catalog (name + purpose) — source of truth for what the COO can run itself.
2. A CEO message.

Rules:
- Match by **intent / meaning** against each tool's purpose. Do not use isolated keyword shortcuts.
- Prefer a tool when the CEO asks for a capability that tool is designed to perform.
- **Status updates ownership (critical):** Any enquiry for org / Kanban / A2A / delegation **status**, status report, status digest, "how are tasks going", "run status checker", or similar operational status updates is **owned by the COO** when a status tool (typically status_checker) is in the catalog. Return that tool. Never treat these as specialist/ops-leaf work.
- **This Week Digest metrics ownership:** Questions about Digest Time Saved, Est. Value Delivered, weekly digest dollars/hours, "how is value calculated on Digest", or "About this week digest:" prefaces are **owned by the COO** when **this_week_digest** is in the catalog. Return that tool. Do not treat as Platform Help / specialist work.
- **CRM / ERP status and data (read tools):** Questions about pipeline, open deals, AR, invoices, customers, P&L figures (when erp_profit_and_loss / crm_list_* are in the catalog) are **COO-owned** for reporting. Return the best matching list/report tool. Mutations (draft/submit) → return {} so specialty CRM/ERP agents get work via delegation.
- **Operational effectiveness score ownership:** Questions about company operational effectiveness, OEI, effectiveness score Green/Amber/Red, "how effective is my AI company", or improve the ops score on Home are **owned by the COO** when **operational_effectiveness** is in the catalog. Return that tool. Not Digest dollar metrics.
- **LLMOps / token monitoring ownership:** Questions about token usage, LLM spend, LLMOps, traces, price book, or Efficiency LLMOps are **owned by the COO** when **llmops_summary** is in the catalog. Return that tool. Estimates are not invoices. Not Digest Est. Value and not OEI.
- If the message is specialist domain work (research, social content, coding, finance analysis, etc.) with no matching COO tool, return {}.
- If the CEO explicitly asks to delegate/assign to a specialist, return {}.
- If the CEO says **don't / do not delegate**, handle yourself, find/list/download/attach a file, PDF, resume, inbound attachment, or previously uploaded document — prefer **list_inbound_attachments**, **master_data_list_documents**, **master_data_index_document**, or **master_data_rag** when those are in the catalog. Do **not** return {}.
- Output valid JSON only: { "tool": "<exact_tool_name>" } or {}.
- Use the exact tool name from the catalog as the value.`;

/**
 * @returns {Promise<{ tool: string } | null>} Matching COO tool, or null if not COO-tool-owned / error
 */
export async function classifyCooOwnedToolIntent(ownerUserId, ceoMessage) {
  const text = String(ceoMessage || '').trim();
  if (!text || text.length < 4) return null;

  const tools = listCooOwnedToolsForIntent();
  if (!tools.length) {
    console.warn('[coo-tool-ownership] no COO tools in catalog');
    return null;
  }

  // Digest page / dollar-hour questions: prefer this_week_digest without LLM when catalog has it.
  const digestTool = tools.find((t) => String(t.name).toLowerCase() === 'this_week_digest');
  if (
    digestTool &&
    /\b(about this week digest|this week digest|time saved|value delivered|est\.?\s*value|digest\s+(hour|dollar|value|metric)|how (is|was|are) .{0,40}(calculated|computed))\b/i.test(
      text
    )
  ) {
    console.info('[coo-tool-ownership] COO owns message via tool', {
      tool: digestTool.name,
      deterministic: true,
    });
    return { tool: digestTool.name };
  }

  // Home OEI / operational effectiveness
  const oeiTool = tools.find((t) => String(t.name).toLowerCase() === 'operational_effectiveness');
  if (
    oeiTool &&
    /\b(operational\s+effectiveness|ops?\s+score|oei|effectiveness\s+score|how effective|company\s+effectiveness|green\/amber\/red|improve\s+(ops|operational|effectiveness)|why\s+(is\s+)?(my\s+)?score)\b/i.test(
      text
    )
  ) {
    console.info('[coo-tool-ownership] COO owns message via tool', {
      tool: oeiTool.name,
      deterministic: true,
    });
    return { tool: oeiTool.name };
  }

  const llmopsTool = tools.find((t) => String(t.name).toLowerCase() === 'llmops_summary');
  if (
    llmopsTool &&
    /\b(llmops|llm\s*ops|token\s+usage|token\s+spend|llm\s+spend|price\s+book|efficiency\s+llmops|agent\s+monitoring|trace_id|estimated\s+\$)\b/i.test(
      text
    )
  ) {
    console.info('[coo-tool-ownership] COO owns message via tool', {
      tool: llmopsTool.name,
      deterministic: true,
    });
    return { tool: llmopsTool.name };
  }

  const cfg = getLlmConfig(ownerUserId || null);
  const apiKey = cfg.primary?.apiKey || cfg.secondary?.apiKey;
  const efficiencyOllama = shouldUseEfficiencyOllama(ownerUserId, COO_TOOL_OWNERSHIP_TOOL);
  if (!apiKey && !efficiencyOllama) {
    console.warn('[coo-tool-ownership] no LLM API key — cannot classify tool ownership');
    return null;
  }

  const catalog = tools
    .map((t) => `- Tool: "${t.name}" (${t.display_name})\n  Purpose: ${t.purpose}`)
    .join('\n');
  const userContent =
    `COO tool catalog:\n\n${catalog}\n\n---\n\nCEO message:\n\n"${text}"\n\n` +
    `Return JSON { "tool": "..." } if a catalog tool should handle this, else {}.`;

  try {
    const { content } = await chatCompletions({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      modelOverride: getIntentModelOverride(),
      maxTokens: 128,
      ownerUserId: ownerUserId || null,
      toolName: COO_TOOL_OWNERSHIP_TOOL,
    });
    const parsed = extractJsonObject(String(content || ''));
    if (!parsed || typeof parsed !== 'object') return null;
    const toolName = String(parsed.tool || parsed.name || '').trim().toLowerCase();
    if (!toolName) return null;
    const hit = tools.find((t) => String(t.name).toLowerCase() === toolName);
    if (!hit) {
      console.info('[coo-tool-ownership] model returned unknown tool', { toolName });
      return null;
    }
    console.info('[coo-tool-ownership] COO owns message via tool', {
      tool: hit.name,
      ownerUserId: ownerUserId || null,
      preview: text.slice(0, 80),
    });
    return { tool: hit.name };
  } catch (e) {
    console.warn('[coo-tool-ownership] classify failed', e?.message || e);
    return null;
  }
}