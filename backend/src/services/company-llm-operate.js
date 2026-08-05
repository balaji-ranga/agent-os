/**
 * LLM proposes operating model when no dedicated pack / CEO chooses AI.
 */
import { chatCompletions } from "../config/llm.js";
import {
  getOperatingModelTemplate,
  sanitizeOperatingModel,
} from "./company-operate-models/index.js";

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {string} ownerUserId
 * @param {object} ctx
 */
export async function designOperatingModelWithLlm(ownerUserId, ctx = {}) {
  const fallback = getOperatingModelTemplate(ctx.company_type || "general_ops", {
    management_style: ctx.management_style,
  });

  const system = `You design a lean company OPERATING MODEL for an AI-employee company.
Return ONLY valid JSON (no markdown) with this shape:
{
  "loops": [{"id","name","description","cadence":"daily|weekly|event","owner_roles":[],"steps":[],"critical_day1":true,"primary_agent_role":""}],
  "daily_tasks": [{"agent_name","tasks":[]}],
  "weekly_rituals": [],
  "autonomy_matrix": [{"action","label","level":"auto|recommend|require_ceo"}],
  "channels": [{"id","label","owner_role","path","system_id"}],
  "systems_run": [{"id","label","path","required":true}],
  "quality_bars": [],
  "raci": [{"activity","responsible","accountable","consulted","informed"}],
  "digest": {"mode":"daily","channel":"in_app","include":[]},
  "escalations": {"public_risk":"","budget":"","connector_down":""}
}
Rules:
- Max 5 loops, max 8 daily_tasks agents.
- Prefer require_ceo for publish/spend/hire.
- Prefer Browser Session path /browser-session for social.
- Do not invent live OAuth connections.
- Align roles with the existing AI employees when listed.`;

  const agentsList = (ctx.agents || [])
    .map((a) => `- ${a.name || a.id}: ${a.role || ""}`)
    .join("\n");

  const user = `Company: ${ctx.company_name || "Unnamed"}
Type: ${ctx.company_type_label || ctx.company_type || "general"}
Mission: ${ctx.mission || "(none)"}
Org DNA: ${ctx.org_dna || ""} ${ctx.org_dna_notes || ""}
Management style: ${ctx.management_style || "after_approval"}
Industry notes: ${ctx.industry || ""} ${ctx.describe_company || ""}

Existing AI employees:
${agentsList || "(none listed - use COO + specialists)"}

Design a practical Day-0 operating model so Day-1 can install MD + workflows.`;

  try {
    const result = await chatCompletions({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: 2500,
    });
    const text = result?.content || result?.text || result?.message || "";
    const parsed = extractJson(typeof text === "string" ? text : JSON.stringify(text));
    if (!parsed) {
      console.warn("[company-llm-operate] no JSON from LLM owner=", ownerUserId);
      return {
        model: sanitizeOperatingModel(fallback, fallback),
        design_source: "template_fallback",
        design_error: "LLM returned non-JSON; used template",
      };
    }
    const model = sanitizeOperatingModel(
      {
        ...parsed,
        id: ctx.company_type || fallback.id,
        label: `${ctx.company_type_label || ctx.company_type || "Company"} operations`,
      },
      fallback
    );
    return {
      model,
      design_source: "llm",
      model_used: result?.model || null,
    };
  } catch (e) {
    console.warn("[company-llm-operate] failed", e?.message || e);
    return {
      model: sanitizeOperatingModel(fallback, fallback),
      design_source: "template_fallback",
      design_error: e?.message || String(e),
    };
  }
}
