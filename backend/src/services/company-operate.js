/**
 * Phase D — Company Operate Day 0 (operating model) + Day 1 (autonomy install).
 * Owner-scoped; state on ceo_org_strategy.strategic_profile_json.
 */
import { getDb } from "../db/schema.js";
import {
  ensureStrategyRow,
  parseJson,
  persistJourney,
  defaultJourney,
  detectExistingOrg,
} from "./onboarding-helper.js";
import {
  getBlueprint,
  resolveCompanyTypeId,
  resolveCompanyIndustryIdentity,
} from "./company-blueprints/index.js";
import {
  getOperatingModelTemplate,
  sanitizeOperatingModel,
  shouldUseLlmOperateDesign,
  attachReadinessDefaults,
  seedSystemsAndChannels,
} from "./company-operate-models/index.js";
import { designOperatingModelWithLlm } from "./company-llm-operate.js";
import { buildChannelsSystemsMdSection } from "./company-operate-models/operate-catalog.js";
import { listAgentsForUser } from "./users.js";
import { createTable, findTableByName, insertRow, uploadDocument, listRows } from "./master-data.js";
import { createDefinition, getDefinition, updateDraft, publishDefinition } from "./agent-workflow-store.js";
import * as workspace from "../workspace/adapter.js";
import { ensureUniversalSafetyGuardrails } from "./ceo-guardrails.js";
import { syncOrgContextForCeo } from "./org-context.js";
import {
  installBlueprintWorkflowTemplates,
  installBlueprintGoalTemplates,
  applyBlueprintAgentsMd,
  applyBlueprintPolicyText,
} from "./company-blueprint-publish.js";

const OPERATE_GATES = new Set([
  "pending",
  "in_progress",
  "day0_confirmed",
  "day1_applied",
  "skipped",
]);

function getStrategic(row) {
  return parseJson(row?.strategic_profile_json, {});
}

function writeStrategic(ownerUserId, row, journey, strategic) {
  persistJourney(ownerUserId, row, journey, {
    strategic_profile_json: JSON.stringify(strategic),
  });
}

function autonomyLevel(model, action) {
  const row = (model?.autonomy_matrix || []).find((a) => a.action === action);
  return row?.level || "require_ceo";
}

function companyHasBeenFormed(ownerUserId, strategic, row) {
  const org = detectExistingOrg(ownerUserId);
  if (org.has_custom_agents) return true;
  if (strategic.setup_gate === "completed" || strategic.setup_gate === "skipped") return true;
  if (row?.status === "applied") return true;
  return false;
}

/**
 * Bring older stored models up to current content-ops pack rules (goals, event cadence, topic history).
 * Structural blueprint fields only — does not invent live topics.
 */
function enrichModelFromIndustryTemplate(model, strategic) {
  const companyType = resolveCompanyTypeId(strategic.company_type || model?.id || "general_ops");
  const template = getOperatingModelTemplate(companyType, {
    management_style: strategic.management_style,
    blueprint_id: strategic.blueprint_id,
  });
  const isContent =
    String(template.id || "") === "content_creator" ||
    (template.knowledge_seeds || []).some((k) => k.name === "content_topics_history");
  if (!isContent) {
    return sanitizeOperatingModel(model, template);
  }

  const next = { ...(model || {}) };
  const tLoops = new Map((template.loops || []).map((l) => [l.id, l]));
  next.loops = (next.loops || []).map((l) => {
    const tl = tLoops.get(l.id);
    if (tl && (tl.cadence === "event" || tl.cadence === "manual")) {
      return { ...l, cadence: "event", steps: tl.steps?.length ? tl.steps : l.steps };
    }
    if (
      l.critical_day1 !== false &&
      /content|community|publish/i.test(String(l.name || "") + String(l.id || ""))
    ) {
      return { ...l, cadence: "event" };
    }
    return l;
  });
  if (!(next.loops || []).length) next.loops = template.loops;

  if (!(next.goals || []).length && (template.goals || []).length) {
    next.goals = structuredClone(template.goals);
  }

  if ((template.daily_tasks || []).length) {
    const byName = new Map(
      (next.daily_tasks || []).map((d) => [String(d.agent_name || "").toLowerCase(), d])
    );
    for (const td of template.daily_tasks) {
      const key = String(td.agent_name || "").toLowerCase();
      if (!key) continue;
      if (
        !byName.has(key) ||
        key === "coo" ||
        key === "content strategist" ||
        key === "channel publisher"
      ) {
        byName.set(key, td);
      }
    }
    next.daily_tasks = [...byName.values()];
  }

  const systems = Array.isArray(next.systems_run) ? [...next.systems_run] : [];
  if (
    !systems.some((s) => s.id === "master_data") &&
    (template.systems_run || []).some((s) => s.id === "master_data")
  ) {
    systems.push({ ...template.systems_run.find((s) => s.id === "master_data") });
  }
  next.systems_run = systems;

  const seeds = Array.isArray(next.knowledge_seeds) ? [...next.knowledge_seeds] : [];
  for (const ts of template.knowledge_seeds || []) {
    if (!seeds.some((s) => s.name === ts.name)) seeds.push(structuredClone(ts));
  }
  next.knowledge_seeds = seeds;

  if ((template.quality_bars || []).length) next.quality_bars = template.quality_bars;
  if ((template.weekly_rituals || []).length) next.weekly_rituals = template.weekly_rituals;
  if (template.escalations) next.escalations = { ...(next.escalations || {}), ...template.escalations };

  return sanitizeOperatingModel(next, template);
}

/**
 * Gate + banner flags for App / Home.
 */
export function getOperateGate(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const strategic = getStrategic(row);
  const formed = companyHasBeenFormed(ownerUserId, strategic, row);
  let gate = strategic.operate_gate || null;
  if (!gate) {
    gate = formed ? "pending" : "blocked_need_company";
  }
  if (!OPERATE_GATES.has(gate) && gate !== "blocked_need_company") {
    gate = formed ? "pending" : "blocked_need_company";
  }
  const confirmed = gate === "day0_confirmed" || gate === "day1_applied";
  const day1Done = gate === "day1_applied";
  const identity = resolveCompanyIndustryIdentity(strategic, {});
  return {
    owner_user_id: ownerUserId,
    operate_gate: gate,
    company_formed: formed,
    company_name: strategic.company_name || null,
    company_type: identity.company_type || strategic.company_type || null,
    company_type_card: identity.company_type_card || strategic.company_type_card || null,
    company_type_label: identity.company_type_label || null,
    mission: strategic.mission || null,
    setup_gate: strategic.setup_gate || null,
    operating_model_version: strategic.operating_model_version || null,
    operate_step: strategic.operate_step || null,
    needs_operate_day0: formed && (gate === "pending" || gate === "in_progress"),
    can_apply_day1: confirmed && !day1Done,
    day1_applied: day1Done,
    show_home_banner: formed && gate !== "day1_applied" && gate !== "skipped",
    banner_reason:
      gate === "pending" || gate === "in_progress"
        ? "operating_model_incomplete"
        : gate === "day0_confirmed"
          ? "day1_not_applied"
          : null,
  };
}

export function skipOperate(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  strategic.operate_gate = "skipped";
  strategic.operate_step = "welcome";
  writeStrategic(ownerUserId, row, journey, strategic);
  console.info("[company-operate] skip owner=", ownerUserId);
  return getOperateGate(ownerUserId);
}

export function beginOperate(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  if (!companyHasBeenFormed(ownerUserId, strategic, row)) {
    const err = new Error("Form the company first (Company setup), then design how it runs.");
    err.status = 400;
    throw err;
  }
  strategic.operate_gate = "in_progress";
  strategic.operate_step = "context";
  writeStrategic(ownerUserId, row, journey, strategic);
  console.info("[company-operate] begin owner=", ownerUserId);
  return getOperateState(ownerUserId);
}

function readIndustryFromCompanyMemory(ownerUserId) {
  try {
    const table = findTableByName(ownerUserId, "company_memory");
    if (!table?.id) return null;
    let offset = 0;
    for (;;) {
      const page = listRows(ownerUserId, table.id, { limit: 100, offset });
      const rows = page.rows || [];
      for (const r of rows) {
        const item = String(r.data?.item || "").trim().toLowerCase();
        if (item === "industry type" || item === "industry") {
          const d = String(r.data?.detail || "").trim();
          if (d) return d;
        }
      }
      if (!rows.length || offset + rows.length >= (page.total || 0)) break;
      offset += 100;
      if (offset > 2000) break;
    }
  } catch (e) {
    console.warn("[company-operate] company_memory industry read:", e?.message || e);
  }
  return null;
}

/**
 * Resolve display industry for How We Run; heal missing company_type_card from Knowledge.
 */
function resolveOperateCompanyIdentity(ownerUserId, strategic, row, journey) {
  const memoryIndustry = readIndustryFromCompanyMemory(ownerUserId);
  const identity = resolveCompanyIndustryIdentity(strategic, { memoryIndustry });

  // Soft-heal strategic so Day0/Day1 and future reads stay consistent with Knowledge.
  const needHeal =
    identity.company_type_card &&
    String(strategic.company_type_card || "").trim() !== String(identity.company_type_card);
  if (needHeal || (!strategic.company_type_card && identity.company_type_card)) {
    try {
      strategic.company_type_card = identity.company_type_card;
      strategic.company_type = identity.company_type;
      if (journey) {
        journey.company_type_card = identity.company_type_card;
        journey.company_type = identity.company_type;
      }
      writeStrategic(ownerUserId, row, journey || parseJson(row.draft_journey_json, defaultJourney()), strategic);
      console.info("[company-operate] healed company_type_card", {
        owner: String(ownerUserId).slice(0, 24),
        card: identity.company_type_card,
        type: identity.company_type,
        from_memory: !!memoryIndustry,
      });
    } catch (e) {
      console.warn("[company-operate] industry heal failed:", e?.message || e);
    }
  }
  return identity;
}

export function getOperateState(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  const gate = getOperateGate(ownerUserId);
  const identity = resolveOperateCompanyIdentity(ownerUserId, strategic, row, journey);
  const companyType = identity.company_type;
  const bp = getBlueprint(companyType);
  const agents = listAgentsForUser(ownerUserId).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    agent_type: a.agent_type,
  }));
  const model =
    strategic.operating_model && typeof strategic.operating_model === "object"
      ? strategic.operating_model
      : null;

  return {
    ...gate,
    operate_step: strategic.operate_step || "welcome",
    company_type: companyType,
    company_type_card: identity.company_type_card || strategic.company_type_card || null,
    company_type_label: identity.company_type_label,
    company_name: strategic.company_name || null,
    mission: strategic.mission || null,
    org_dna: strategic.org_dna || null,
    org_dna_notes: strategic.org_dna_notes || null,
    management_style: strategic.management_style || "after_approval",
    systems: strategic.systems || [],
    agents,
    operating_model: model,
    design_source: strategic.operate_design_source || null,
    design_error: strategic.operate_design_error || null,
    design_model: strategic.operate_design_model || null,
    digest: model?.digest || strategic.operate_digest || { mode: "daily", channel: "in_app" },
    day1_result: strategic.operate_day1 || null,
    has_template: true,
    template_hint: shouldUseLlmOperateDesign(companyType) ? "llm_preferred" : "template_preferred",
    template_pack_label: bp.label || companyType,
  };
}

/**
 * Save operate funnel draft (step, partial model patches, readiness, digest).
 */
export function saveOperateDraft(ownerUserId, body = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);

  if (body.operate_step) strategic.operate_step = String(body.operate_step).slice(0, 40);
  if (strategic.operate_gate === "pending") strategic.operate_gate = "in_progress";

  if (body.operating_model && typeof body.operating_model === "object") {
    const fallback = getOperatingModelTemplate(strategic.company_type || "general_ops", {
      management_style: strategic.management_style,
    });
    strategic.operating_model = sanitizeOperatingModel(
      { ...(strategic.operating_model || {}), ...body.operating_model },
      fallback
    );
  }

  if (Array.isArray(body.autonomy_matrix) && strategic.operating_model) {
    strategic.operating_model = sanitizeOperatingModel(
      { ...strategic.operating_model, autonomy_matrix: body.autonomy_matrix },
      strategic.operating_model
    );
  }
  if (Array.isArray(body.daily_tasks) && strategic.operating_model) {
    strategic.operating_model = sanitizeOperatingModel(
      { ...strategic.operating_model, daily_tasks: body.daily_tasks },
      strategic.operating_model
    );
  }
  if (Array.isArray(body.channels) && strategic.operating_model) {
    strategic.operating_model = sanitizeOperatingModel(
      { ...strategic.operating_model, channels: body.channels },
      strategic.operating_model
    );
  }
  if (Array.isArray(body.systems_run) && strategic.operating_model) {
    strategic.operating_model = sanitizeOperatingModel(
      { ...strategic.operating_model, systems_run: body.systems_run },
      strategic.operating_model
    );
  }
  if (Array.isArray(body.goals) && strategic.operating_model) {
    strategic.operating_model = sanitizeOperatingModel(
      { ...strategic.operating_model, goals: body.goals },
      strategic.operating_model
    );
  }
  if (Array.isArray(body.loops) && strategic.operating_model) {
    strategic.operating_model = sanitizeOperatingModel(
      { ...strategic.operating_model, loops: body.loops },
      strategic.operating_model
    );
  }
  if (body.digest && typeof body.digest === "object" && strategic.operating_model) {
    strategic.operating_model.digest = {
      ...(strategic.operating_model.digest || {}),
      ...body.digest,
    };
    strategic.operate_digest = strategic.operating_model.digest;
  }

  writeStrategic(ownerUserId, row, journey, strategic);
  console.info(
    "[company-operate] draft saved owner=",
    ownerUserId,
    "step=",
    strategic.operate_step
  );
  return getOperateState(ownerUserId);
}

/**
 * Design operating model from template or LLM.
 * body.source: 'template' | 'llm' | 'auto'
 */
export async function designOperate(ownerUserId, body = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  if (!companyHasBeenFormed(ownerUserId, strategic, row)) {
    const err = new Error("Complete company setup before designing the operating model.");
    err.status = 400;
    throw err;
  }

  const identityFull = resolveOperateCompanyIdentity(ownerUserId, strategic, row, journey);
  const companyTypeFinal = identityFull.company_type;
  const typeLabel = identityFull.company_type_label;
  const sourcePref = String(body.source || "auto").toLowerCase();
  const force = sourcePref === "llm" || sourcePref === "template" ? sourcePref : undefined;
  const useLlm = shouldUseLlmOperateDesign(companyTypeFinal, { force });

  const setupSystems = Array.isArray(strategic.systems) ? strategic.systems : [];
  const orgChannels =
    strategic.channels ||
    journey?.answers?.channels ||
    getBlueprint(companyTypeFinal)?.channels ||
    [];

  let design;
  if (useLlm) {
    const agents = listAgentsForUser(ownerUserId);
    design = await designOperatingModelWithLlm(ownerUserId, {
      company_name: strategic.company_name || "",
      company_type: companyTypeFinal,
      company_type_label: typeLabel,
      mission: strategic.mission || "",
      org_dna: strategic.org_dna || "",
      org_dna_notes: strategic.org_dna_notes || "",
      management_style: strategic.management_style || "after_approval",
      industry: typeLabel || strategic.industry || "",
      describe_company: strategic.describe_company || "",
      agents,
      setup_systems: setupSystems,
      org_channels: orgChannels,
    });
  } else {
    design = {
      model: getOperatingModelTemplate(companyTypeFinal, {
        management_style: strategic.management_style,
        blueprint_id: strategic.blueprint_id,
      }),
      design_source: strategic.blueprint_id ? "blueprint" : "template",
    };
    // Template packs keep their lists; still append CEO setup systems not already present.
    design.model = seedSystemsAndChannels(design.model, {
      design_source: "template",
      setup_systems: setupSystems,
      org_channels: orgChannels,
      company_type: companyType,
      force_setup_merge: true,
    });
  }

  // Preserve CEO readiness edits if regenerating same structure? Full replace design.
  strategic.operating_model = attachReadinessDefaults(design.model);
  strategic.operate_design_source = design.design_source;
  strategic.operate_design_error = design.design_error || null;
  strategic.operate_design_model = design.model_used || null;
  strategic.operate_gate = "in_progress";
  strategic.operate_step = strategic.operate_step === "welcome" ? "propose" : strategic.operate_step || "propose";
  writeStrategic(ownerUserId, ensureStrategyRow(ownerUserId), journey, strategic);

  console.info(
    "[company-operate] design owner=",
    ownerUserId,
    "source=",
    design.design_source,
    "loops=",
    design.model?.loops?.length
  );
  return getOperateState(ownerUserId);
}

/**
 * Confirm Day 0 operating model (locks version).
 */
export function confirmOperateDay0(ownerUserId, body = {}) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  let model = strategic.operating_model;
  if (body.operating_model && typeof body.operating_model === "object") {
    model = sanitizeOperatingModel(body.operating_model, model || getOperatingModelTemplate(strategic.company_type));
    strategic.operating_model = model;
  }
  if (!model || !Array.isArray(model.loops) || !model.loops.length) {
    const err = new Error("Design and review an operating model before confirming.");
    err.status = 400;
    throw err;
  }
  model = sanitizeOperatingModel(model, model);
  strategic.operating_model = model;
  const prev = Number(strategic.operating_model_version || 0) || 0;
  strategic.operating_model_version = prev + 1;
  strategic.operating_model_confirmed_at = new Date().toISOString();
  strategic.operate_gate = "day0_confirmed";
  strategic.operate_step = "day0_done";
  writeStrategic(ownerUserId, row, journey, strategic);
  console.info(
    "[company-operate] day0 confirmed owner=",
    ownerUserId,
    "v=",
    strategic.operating_model_version
  );
  return getOperateState(ownerUserId);
}

function matchAgentByRole(agents, roleOrName) {
  const n = String(roleOrName || "").trim().toLowerCase();
  if (!n) return null;
  return (
    agents.find((a) => String(a.name || "").toLowerCase() === n) ||
    agents.find((a) => String(a.role || "").toLowerCase().includes(n)) ||
    agents.find((a) => String(a.name || "").toLowerCase().includes(n)) ||
    null
  );
}

function buildOperateAgentsMdSection(model, agentName) {
  const tasks =
    (model.daily_tasks || []).find((d) => d.agent_name === agentName)?.tasks || [];
  const loops = (model.loops || []).filter((l) =>
    (l.owner_roles || []).some((r) => String(r).toLowerCase() === String(agentName).toLowerCase()) ||
    String(l.primary_agent_role || "").toLowerCase() === String(agentName).toLowerCase()
  );
  const matrix = (model.autonomy_matrix || [])
    .map((a) => `- **${a.label || a.action}**: \`${a.level}\``)
    .join("\n");
  const taskLines = tasks.length ? tasks.map((t) => `- [ ] ${t}`).join("\n") : "- [ ] Follow loops assigned in company operating model";
  const loopLines = loops.length
    ? loops.map((l) => `- **${l.name}** (${l.cadence}): ${l.description || l.steps?.join(" → ") || ""}`).join("\n")
    : "- Support company operating model loops as directed by COO / CEO";
  const surfaces = buildChannelsSystemsMdSection(model, { agentName });
  return `

---
## Company operating model (Day 1 install)

Versioned run contract. Follow these **daily tasks** and **loops**. Respect the **autonomy matrix** — never publish, spend, or hire beyond your level.

### Daily tasks
${taskLines}

### Your loops
${loopLines}

${surfaces}

### Autonomy matrix (company-wide)
${matrix || "- (see Policies)"}

### Quality bars
${(model.quality_bars || []).map((q) => `- ${q}`).join("\n") || "- Align with mission"}

### CEO weekly content goal (topic source)
- **Who sets the topic:** CEO only (Scheduled goals page targeting **COO**, COO chat, or an explicit brief in a loop run).
- **Who triggers production:** **COO** via \`agent_workflow_trigger\` on Operate content loops (manual/event — not silent cron).
- **Who expands it:** Strategist / Media Generator turn the goal into angles and drafts — they do **not** replace the goal.
- **If missing:** stop content production and ask the CEO; never invent the week’s campaign topic.

### 20-day topic / post memory
- Master Data table **content_topics_history** is the dedupe ledger.
- Before new drafts: \`master_data_rag\` / table query for the last **20 days**.
- Do not reuse title, topic fingerprint, or near-duplicate angle.
- After draft/publish: log when, platform, title, topic, fingerprint, status, expires_after.

When blocked by a gate (\`require_ceo\`), create Kanban / notify_ceo instead of acting externally.
`;
}

async function materializeAgentMd(ownerUserId, agent, model) {
  let root;
  try {
    root = workspace.resolveAgentWorkspaceRoot(agent, { ceoUserId: ownerUserId });
  } catch (e) {
    return { agent_id: agent.id, ok: false, error: e?.message || String(e) };
  }
  const section = buildOperateAgentsMdSection(model, agent.name);
  const MARKER = "## Company operating model (Day 1 install)";
  try {
    let agentsText = "";
    try {
      const r = await workspace.readWorkspaceFile("agents", { workspaceRoot: root });
      agentsText = r?.text || "";
    } catch {
      agentsText = `# AGENTS — ${agent.name}\n`;
    }
    if (agentsText.includes(MARKER)) {
      // Replace previous Day-1 block
      const idx = agentsText.indexOf("\n---\n## Company operating model");
      if (idx >= 0) agentsText = agentsText.slice(0, idx).trimEnd();
      else {
        const m = agentsText.indexOf(MARKER);
        const cut = agentsText.lastIndexOf("\n---", m);
        agentsText = agentsText.slice(0, cut >= 0 ? cut : m).trimEnd();
      }
    }
    agentsText = `${agentsText.trimEnd()}\n${section}`;
    await workspace.writeWorkspaceFile("agents", agentsText, { workspaceRoot: root, backup: true });

    // Append short run note to MEMORY
    try {
      let mem = "";
      try {
        const mr = await workspace.readWorkspaceFile("memory", { workspaceRoot: root });
        mem = mr?.text || "";
      } catch {
        mem = `# MEMORY — ${agent.name}\n`;
      }
      const note = `\n\n## Operate Day 1\nInstalled company operating model v${model._version || "?"}. Daily tasks live in AGENTS.md.\n`;
      if (!mem.includes("## Operate Day 1")) {
        await workspace.writeWorkspaceFile("memory", `${mem.trimEnd()}${note}`, {
          workspaceRoot: root,
          backup: true,
        });
      }
    } catch (e) {
      console.warn("[company-operate] memory write", agent.id, e?.message || e);
    }
    return { agent_id: agent.id, name: agent.name, ok: true, workspace: root };
  } catch (e) {
    console.warn("[company-operate] MD materialize", agent.id, e?.message || e);
    return { agent_id: agent.id, name: agent.name, ok: false, error: e?.message || String(e) };
  }
}

/** Map loop cadence to platform-timezone cron. event/manual = no schedule (COO/CEO trigger). */
function cadenceToCron(cadence) {
  const c = String(cadence || "daily").toLowerCase().trim();
  if (c === "event" || c === "event_driven" || c === "as_needed" || c === "manual" || c === "on_demand") {
    return "";
  }
  if (c === "weekly") return "0 9 * * 1";
  return "0 9 * * *";
}

function triggersFromLoop(loop) {
  const cron = cadenceToCron(loop && loop.cadence);
  if (cron) {
    return { trigger_modes: ["manual", "schedule"], schedule_cron: cron };
  }
  // Content-style operate: publish as manual + event; empty cron clears schedule registry
  return { trigger_modes: ["manual", "event"], schedule_cron: "" };
}

function buildLoopGraph(opts) {
  const loop = opts.loop;
  const agent = opts.agent;
  const publishGated = opts.publishGated;
  const triggerModes = opts.triggerModes || ["manual"];
  const scheduleCron = opts.scheduleCron || "";
  const cadenceLine = scheduleCron
    ? "Cadence: " + (loop.cadence || "daily") + " (platform schedule: " + scheduleCron + ")"
    : "Cadence: " + (loop.cadence || "daily") + " (on-demand / event)";
  const prompt = [
    "You are operating the company loop \"" + (loop.name || "") + "\".",
    loop.description || "",
    "",
    "Steps: " + ((loop.steps || []).join(" -> ")),
    cadenceLine,
    "",
    "TOPIC SOURCE (required for content production):",
    "- The week's topic is the CEO weekly content goal only.",
    "- Prefer: (1) trigger/input from this run (COO passes CEO goal), (2) operate goals / company_goals, (3) Scheduled goals, (4) content_calendar rows with ceo_set theme.",
    "- If none of those exist: notify_ceo / stop production. Do NOT invent a weekly topic or campaign from imagination.",
    "- You may invent angles, hooks, and post variations under the CEO goal — not a replacement goal.",
    "",
    "20-DAY UNIQUENESS (required):",
    "- Before drafting or publishing, query Master Data table content_topics_history (and publish_log).",
    "- Do NOT reuse a post title, topic, or near-duplicate angle that appears in the last 20 days on any channel.",
    "- After an approved draft or publish attempt, record when, platform, title, topic, fingerprint, status, expires_after (+20 days).",
    "",
    "Work within autonomy rules. Produce a concise status of what you planned/drafted.",
    "Do NOT publish externally or spend money unless company policy already allows.",
    "If CEO approval is required, state what needs approval.",
    "If social/channel readiness is not_ready for a channel, skip that channel - use Kanban / notify_ceo. Prefer ready channels only.",
  ].join("\n");

  const modes = Array.isArray(triggerModes) && triggerModes.length ? triggerModes : ["manual"];
  const nodes = [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 40, y: 120 },
      data: {
        label: "Start",
        triggerModes: modes,
        scheduleCron: scheduleCron || "",
        inputBindings: [],
        outputs: [
          { id: "text", label: "Input text" },
          { id: "trigger_input", label: "Trigger payload" },
        ],
      },
    },
    {
      id: "agent-1",
      type: "agent",
      position: { x: 280, y: 120 },
      data: {
        label: agent.name || "Agent",
        agentId: agent.id,
        agentName: agent.name,
        prompt: prompt,
        inputBindings: [
          {
            id: "prompt",
            label: "Task / prompt",
            mode: "dynamic",
            sourceNodeId: "trigger-1",
            sourceOutputKey: "text",
            value: "",
          },
        ],
        outputs: [{ id: "text", label: "Agent response" }],
      },
    },
  ];
  const edges = [{ id: "e1", source: "trigger-1", target: "agent-1" }];
  if (publishGated) {
    nodes.push({
      id: "ceo-1",
      type: "ceo_approval",
      position: { x: 540, y: 120 },
      data: {
        label: "CEO gate",
        title: "Approve: " + (loop.name || ""),
        instructions: "Review AI output before any public/external action.",
        inputBindings: [
          {
            id: "summary",
            label: "Summary for CEO",
            mode: "dynamic",
            sourceNodeId: "agent-1",
            sourceOutputKey: "text",
            value: "",
          },
        ],
        outputs: [
          { id: "decision", label: "Decision" },
          { id: "text", label: "Full outcome text" },
        ],
      },
    });
    edges.push({ id: "e2", source: "agent-1", target: "ceo-1" });
  }
  return { nodes: nodes, edges: edges, viewport: { x: 0, y: 0, zoom: 1 } };
}

function createOperateWorkflow(ownerUserId, loop, agent, model) {
  const publishLevel = autonomyLevel(model, "publish");
  const triggers = triggersFromLoop(loop);
  const graph = buildLoopGraph({
    loop: loop,
    agent: agent,
    publishGated: publishLevel === "require_ceo",
    triggerModes: triggers.trigger_modes,
    scheduleCron: triggers.schedule_cron,
  });
  const name = ("Operate - " + (loop.name || "loop")).slice(0, 80);
  const description = [
    loop.description || loop.name,
    "Day-1 fully configured from operating model.",
    "Cadence: " + (loop.cadence || "daily") + (triggers.schedule_cron ? " cron=" + triggers.schedule_cron : " (manual/event only)") + ".",
    "Publish gate: " + publishLevel + ".",
    "Open for CEO only: Browser Session / Connectors readiness - not workflow settings.",
  ].join(" ");
  const actor = { id: ownerUserId, name: "company-operate" };
  try {
    const existingId = ("operate-" + String(ownerUserId).replace(/[^a-zA-Z0-9-_]/g, "-") + "-" + loop.id)
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .slice(0, 64);
    const prior = getDefinition(existingId, ownerUserId);
    const patch = {
      name: name,
      description: description,
      graph: graph,
      trigger_modes: triggers.trigger_modes,
      schedule_cron: triggers.schedule_cron,
    };
    if (prior) {
      updateDraft(existingId, ownerUserId, patch, actor);
    } else {
      try {
        createDefinition({
          id: existingId,
          name: name,
          description: description,
          ownerUserId: ownerUserId,
          actor: actor,
          graph: graph,
          trigger_modes: triggers.trigger_modes,
          schedule_cron: triggers.schedule_cron,
        });
      } catch (ce) {
        // Id occupied by another owner (short-hash collision on older builds) — unique suffix
        const altId = (existingId.slice(0, 54) + "-" + String(ownerUserId).slice(-8))
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .slice(0, 64);
        try {
          createDefinition({
            id: altId,
            name: name,
            description: description,
            ownerUserId: ownerUserId,
            actor: actor,
            graph: graph,
            trigger_modes: triggers.trigger_modes,
            schedule_cron: triggers.schedule_cron,
          });
          // switch publish target
          const pubAlt = publishDefinition(altId, ownerUserId, actor);
          return {
            id: altId,
            name: name,
            updated: false,
            created: true,
            published: !!pubAlt,
            publish_error: null,
            publish_gated: publishLevel === "require_ceo",
            cadence: loop.cadence || "daily",
            schedule_cron: triggers.schedule_cron || null,
            trigger_modes: triggers.trigger_modes,
            ok: true,
          };
        } catch (ce2) {
          throw ce;
        }
      }
    }
    let published = false;
    let publish_error = null;
    try {
      publishDefinition(existingId, ownerUserId, actor);
      published = true;
    } catch (pe) {
      publish_error = pe && pe.message ? pe.message : String(pe);
      console.warn("[company-operate] publish workflow", loop.id, publish_error);
    }
    return {
      id: existingId,
      name: name,
      updated: !!prior,
      created: !prior,
      published: published,
      publish_error: publish_error,
      publish_gated: publishLevel === "require_ceo",
      cadence: loop.cadence || "daily",
      schedule_cron: triggers.schedule_cron || null,
      trigger_modes: triggers.trigger_modes,
      ok: true,
    };
  } catch (e) {
    console.warn("[company-operate] workflow", loop.id, e && e.message ? e.message : e);
    return { loop_id: loop.id, ok: false, error: e && e.message ? e.message : String(e) };
  }
}


function assessSystemsReadiness(model, strategic) {
  const readiness = [];
  for (const sys of model.systems_run || []) {
    const forced = sys.readiness || "not_ready";
    // Honest: CEO must mark ready or open setup; we never invent connected OAuth
    let status = forced;
    let note = null;
    if (sys.id === "browser_session") {
      note = "Log into social sites in Client Chrome via Browser Session. Not auto-connected.";
    } else if (sys.id === "kanban") {
      status = "ready";
      note = "Kanban is always available in the platform.";
    } else if (sys.id === "replicate") {
      note = "Add Replicate_BYOK under API Keys if media generation is required.";
    } else if (sys.id === "master_data") {
      status = "ready";
      note = "Master Data tables for goals, calendar, and 20-day content_topics_history.";
    } else if (sys.id === "policies") {
      note = "Universal content safety + company guardrails under Policies. Day 1 seeds baseline.";
    }
    if (status === "ready" && sys.id !== "kanban" && sys.id !== "master_data") {
      // Only trust explicit CEO-marked ready; kanban/master_data are platform-native
    }
    readiness.push({
      id: sys.id,
      label: sys.label,
      path: sys.path,
      required: !!sys.required,
      status,
      note,
    });
  }
  for (const ch of model.channels || []) {
    readiness.push({
      id: `channel:${ch.id}`,
      label: ch.label,
      path: ch.path || "/browser-session",
      required: true,
      status: ch.readiness || "not_ready",
      note: "Social via Browser Session until native API (Phase E).",
    });
  }
  for (const g of model.goals || []) {
    readiness.push({
      id: `goal:${g.id}`,
      label: g.label || g.id,
      path: g.path || "/scheduled-goals",
      required: g.required !== false,
      status: g.readiness || "not_ready",
      note: g.note || "Track goal readiness like systems/channels. CEO goals provide content topics.",
    });
  }
  // Merge selected Phase C systems as soft recommendations if not listed
  for (const sid of strategic.systems || []) {
    if (!readiness.find((r) => r.id === sid)) {
      readiness.push({
        id: sid,
        label: sid,
        path: "/connectors",
        required: false,
        status: "not_ready",
        note: "Selected at company form; connect when ready.",
      });
    }
  }
  return readiness;
}

async function seedOperateKnowledge(ownerUserId, model) {
  const created = [];
  const rows = [];
  for (const tbl of model.knowledge_seeds || []) {
    try {
      let table = findTableByName(ownerUserId, tbl.name);
      if (!table) {
        table = createTable(ownerUserId, {
          name: tbl.name,
          description: tbl.description || "",
          columns: tbl.columns || ["item", "notes"],
        });
        created.push(table.name);
      }
      for (const seed of tbl.seed_rows || []) {
        try {
          insertRow(ownerUserId, table.id, seed);
          rows.push(tbl.name);
        } catch (e) {
          console.warn("[company-operate] seed row", tbl.name, e?.message || e);
        }
      }
    } catch (e) {
      console.warn("[company-operate] knowledge table", tbl.name, e?.message || e);
    }
  }
  // Operating model snapshot doc
  try {
    await uploadDocument(ownerUserId, {
      title: `Operating model v${model._version || 1}`,
      filename: "operating-model.md",
      mimeType: "text/markdown",
      contentText: formatModelMarkdown(model),
      source: "company_operate",
      tags: ["operating-model", "day1", "company-operate"],
    });
  } catch (e) {
    console.warn("[company-operate] model doc", e?.message || e);
  }
  return { tables: created, rows: rows.length };
}

function formatModelMarkdown(model) {
  const lines = [
    `# ${model.label || "Operating model"}`,
    "",
    `Version: ${model._version || 1}`,
    "",
    "## Loops",
    ...(model.loops || []).map(
      (l) => `- **${l.name}** (${l.cadence}): ${l.description || ""}`
    ),
    "",
    "## Autonomy",
    ...(model.autonomy_matrix || []).map((a) => `- ${a.label || a.action}: ${a.level}`),
    "",
    "## Daily tasks",
    ...(model.daily_tasks || []).map(
      (d) => `### ${d.agent_name}\n${(d.tasks || []).map((t) => `- ${t}`).join("\n")}`
    ),
    "",
    "## Systems",
    ...((model.systems_run || []).length
      ? (model.systems_run || []).map(
          (s) =>
            `- ${s.label || s.id} (${s.id}) path=${s.path || ""} readiness=${s.readiness || "not_ready"} required=${!!s.required}`
        )
      : ["- (none)"]),
    "",
    "## Channels / public surfaces",
    ...((model.channels || []).length
      ? (model.channels || []).map(
          (c) =>
            `- ${c.label || c.id} owner=${c.owner_role || "?"} via=${c.system_id || c.path || "?"} readiness=${c.readiness || "not_ready"}`
        )
      : ["- (none)"]),
    "",
    "## Goals",
    ...((model.goals || []).length
      ? (model.goals || []).map(
          (g) =>
            `- ${g.label || g.id} (${g.id}) owner=${g.owner_role || "?"} cadence=${g.cadence || "?"} readiness=${g.readiness || "not_ready"} path=${g.path || "/scheduled-goals"}`
        )
      : ["- (none)"]),

  ];
  return lines.join("\n");
}

function buildDay1OperateBriefing({ model, md, workflows, readiness, knowledge, policy = null, version }) {
  const blocked = readiness.filter((r) => r.required && r.status !== "ready");
  const ready = readiness.filter((r) => r.status === "ready");
  const wfOk = workflows.filter((w) => w.id && !w.error);
  const mdOk = md.filter((m) => m.ok);
  return {
    message: `Day 1 install complete for operating model v${version}. ${mdOk.length} employee runbooks updated, ${wfOk.length} workflow(s) published (manual/event or scheduled per loop cadence). Goals tracked with systems & channels. Only Browser Session / Connectors / unfilled CEO goals may still need you.`,
    version,
    what_runs: (model.loops || [])
      .filter((l) => l.critical_day1)
      .map((l) => ({
        loop: l.name,
        cadence: l.cadence,
        workflow: wfOk.find((w) => String(w.name || "").includes(l.name))?.id || null,
      })),
    needs_human: blocked.map((b) => ({
      label: b.label,
      path: b.path,
      note: b.note || "Setup still required — not connected automatically.",
    })),
    ready_systems: ready.map((r) => r.label),
    goals: (model.goals || []).map((g) => ({
      id: g.id,
      label: g.label,
      readiness: g.readiness || "not_ready",
      path: g.path || "/scheduled-goals",
      owner_role: g.owner_role || null,
      cadence: g.cadence || null,
      note: g.note || null,
    })),
    md_updated: mdOk.map((m) => m.name || m.agent_id),
    workflows: wfOk,
    configured_workflows: wfOk.map((w) => ({
      id: w.id,
      name: w.name,
      published: w.published !== false && !w.publish_error,
      schedule_cron: w.schedule_cron || null,
      cadence: w.cadence || null,
      trigger_modes: w.trigger_modes || null,
      note: w.publish_error || null,
    })),
    open_for_ceo: (readiness || [])
      .filter((r) => {
        if (r.status === "ready") return false;
        const id = String(r.id || "");
        const path = String(r.path || "");
        return (
          id.includes("browser") ||
          path.includes("browser") ||
          path.includes("connector") ||
          id === "replicate" ||
          path.includes("api-keys") ||
          id.startsWith("channel:") ||
          id.startsWith("goal:") ||
          path.includes("scheduled-goal")
        );
      })
      .map((r) => ({ label: r.label, path: r.path, status: r.status, note: r.note })),
    knowledge,
    policies: policy
      ? {
          seeded: !!policy.ok,
          action: policy.action || null,
          note: policy.ok
            ? "Universal content safety (no sexual/abusive/discriminatory content) seeded. Review under /policies."
            : (policy.error || "Policy seed failed"),
        }
      : null,
    links: [
      { label: "Workflows", path: "/workflows" },
      { label: "Scheduled goals", path: "/scheduled-goals" },
      { label: "Policies", path: "/policies" },
      { label: "Browser Session", path: "/browser-session" },
      { label: "Master Data", path: "/master-data" },
      { label: "Kanban", path: "/kanban" },
      { label: "Home", path: "/" },
    ],
  };
}

/**
 * Day 1: materialize MD, workflows, knowledge, readiness report.
 */
export async function applyOperateDay1(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const strategic = getStrategic(row);
  const gate = strategic.operate_gate;
  if (gate !== "day0_confirmed" && gate !== "day1_applied") {
    const err = new Error("Confirm Day 0 operating model before Day 1 install.");
    err.status = 400;
    throw err;
  }
  const modelRaw = strategic.operating_model;
  if (!modelRaw) {
    const err = new Error("No operating model to apply.");
    err.status = 400;
    throw err;
  }
  const model = enrichModelFromIndustryTemplate(modelRaw, strategic);
  strategic.operating_model = model;
  const version = strategic.operating_model_version || 1;
  model._version = version;

  const agents = listAgentsForUser(ownerUserId);
  const mdResults = [];
  // Prefer specialty agents that appear in daily_tasks / loops
  const named = new Set(
    (model.daily_tasks || []).map((d) => String(d.agent_name || "").toLowerCase()).filter(Boolean)
  );
  for (const a of agents) {
    if (a.agent_type === "system" && !named.has(String(a.name || "").toLowerCase())) {
      // still update COO if listed / always for COO
      if (!/coo|chief|ops/i.test(String(a.name || "") + String(a.role || ""))) {
        // install for custom and COO-like only if in model or custom agents with daily_tasks match
        if (a.agent_type !== "custom" && !named.has(String(a.name || "").toLowerCase())) continue;
      }
    }
    // Always write for agents with matching daily_tasks or all custom
    const hasTasks = named.has(String(a.name || "").toLowerCase());
    const isCustom = a.agent_type === "custom" || a.owner_user_id === ownerUserId;
    const isCoo = /coo|chief operating/i.test(String(a.name || "") + String(a.role || ""));
    if (!hasTasks && !isCustom && !isCoo) continue;
    mdResults.push(await materializeAgentMd(ownerUserId, a, model));
  }

  const workflows = [];
  for (const loop of model.loops || []) {
    if (loop.critical_day1 === false) continue;
    const agent =
      matchAgentByRole(agents, loop.primary_agent_role) ||
      matchAgentByRole(agents, loop.owner_roles?.[0]) ||
      agents.find((x) => /coo/i.test(x.name || "")) ||
      agents[0];
    if (!agent) {
      workflows.push({ loop_id: loop.id, ok: false, error: "No agent to bind" });
      continue;
    }
    workflows.push(createOperateWorkflow(ownerUserId, loop, agent, model));
  }

  // Day 1 from published blueprint pack: multi-agent graphs, scheduled goals, agents MD, policy
  const bp = getBlueprint(strategic.blueprint_id || strategic.company_type || "general_ops");
  let blueprintWorkflows = [];
  let blueprintGoals = [];
  let blueprintAgentsMd = [];
  try {
    if (bp?.workflow_templates?.length) {
      blueprintWorkflows = installBlueprintWorkflowTemplates(ownerUserId, bp.workflow_templates, agents, {
        id: ownerUserId,
        name: "company-operate-day1",
      });
      for (const w of blueprintWorkflows) workflows.push({ ...w, source: "blueprint_template" });
      console.info(
        "[company-operate] day1 blueprint workflows owner=",
        ownerUserId,
        "count=",
        blueprintWorkflows.length,
        "ok=",
        blueprintWorkflows.filter((w) => w.ok).length
      );
    }
  } catch (e) {
    console.warn("[company-operate] day1 blueprint workflows", e?.message || e);
  }
  try {
    if (bp?.goal_templates?.length) {
      blueprintGoals = await installBlueprintGoalTemplates(ownerUserId, bp.goal_templates, agents);
      console.info(
        "[company-operate] day1 blueprint goals owner=",
        ownerUserId,
        "count=",
        blueprintGoals.length
      );
    }
  } catch (e) {
    console.warn("[company-operate] day1 blueprint goals", e?.message || e);
  }
  try {
    if (bp?.agents_md?.length) {
      blueprintAgentsMd = await applyBlueprintAgentsMd(ownerUserId, bp.agents_md, agents);
      console.info(
        "[company-operate] day1 blueprint agents_md owner=",
        ownerUserId,
        "count=",
        blueprintAgentsMd.length
      );
    }
  } catch (e) {
    console.warn("[company-operate] day1 blueprint agents_md", e?.message || e);
  }

  // Day 1: policies & guardrails (universal safety for every blueprint/company)
  let policySeed = { ok: false };
  try {
    if (bp?.policy_text) {
      applyBlueprintPolicyText(ownerUserId, bp.policy_text);
    } else if (bp?.policy_templates?.published_from_company) {
      applyBlueprintPolicyText(ownerUserId, bp.policy_templates.published_from_company);
    }
    policySeed = ensureUniversalSafetyGuardrails(ownerUserId);
    // mark policies system ready when present
    if (Array.isArray(model.systems_run)) {
      model.systems_run = model.systems_run.map((s) =>
        s.id === "policies" ? { ...s, readiness: "ready" } : s
      );
    }
    if (!(model.systems_run || []).some((s) => s.id === "policies")) {
      model.systems_run = [
        ...(model.systems_run || []),
        {
          id: "policies",
          label: "Policies & guardrails",
          path: "/policies",
          required: true,
          readiness: "ready",
        },
      ];
    }
    if (!(model.goals || []).some((g) => g.id === "policies_guardrails")) {
      model.goals = [
        ...(model.goals || []),
        {
          id: "policies_guardrails",
          label: "Policies & guardrails (content safety baseline)",
          path: "/policies",
          owner_role: "CEO",
          cadence: "once",
          required: true,
          readiness: "ready",
          note: "Universal safety seeded: no sexual, abusive, or discriminatory content. Edit under Policies.",
        },
      ];
    }
    strategic.operating_model = model;
    try {
      await syncOrgContextForCeo(ownerUserId);
    } catch (e) {
      console.warn("[company-operate] policy POLICY.md sync", e?.message || e);
    }
    policySeed = { ...policySeed, ok: true };
    console.info("[company-operate] day1 policies", policySeed.action || "ok", "owner=", ownerUserId);
  } catch (e) {
    console.warn("[company-operate] day1 policies", e?.message || e);
    policySeed = { ok: false, error: e?.message || String(e) };
  }

  let knowledge = { tables: [], rows: 0 };
  try {
    knowledge = await seedOperateKnowledge(ownerUserId, model);
  } catch (e) {
    console.warn("[company-operate] knowledge seed", e?.message || e);
  }

  // company memory note
  try {
    let table = findTableByName(ownerUserId, "company_memory");
    if (!table) {
      table = createTable(ownerUserId, {
        name: "company_memory",
        description: "Shared company memory",
        columns: ["item", "detail"],
      });
    }
    insertRow(ownerUserId, table.id, {
      item: `Operating model v${version}`,
      detail: `${model.label || "ops"} confirmed; Day 1 installed ${new Date().toISOString()}`,
    });
  } catch (e) {
    console.warn("[company-operate] company_memory", e?.message || e);
  }

  const readiness = assessSystemsReadiness(model, strategic);
  const day1 = buildDay1OperateBriefing({
    model,
    md: mdResults,
    workflows,
    readiness,
    knowledge,
    policy: policySeed,
    version,
  });
  day1.blueprint_workflows = blueprintWorkflows;
  day1.blueprint_goals = blueprintGoals;
  day1.blueprint_agents_md = blueprintAgentsMd;
  day1.blueprint_id = bp?.id || strategic.blueprint_id || null;

  strategic.operate_gate = "day1_applied";
  strategic.operate_step = "done";
  strategic.operate_day1 = day1;
  strategic.operate_readiness = readiness;
  writeStrategic(ownerUserId, ensureStrategyRow(ownerUserId), journey, strategic);

  console.info(
    "[company-operate] day1 applied owner=",
    ownerUserId,
    "md=",
    mdResults.filter((m) => m.ok).length,
    "wf=",
    workflows.filter((w) => w.id).length
  );

  return {
    ...getOperateState(ownerUserId),
    applied: {
      md: mdResults,
      workflows,
      knowledge,
      readiness,
    },
    day1,
  };
}
