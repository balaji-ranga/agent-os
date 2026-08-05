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
  listCompanyTypeCards,
  resolveCompanyTypeId,
} from "./company-blueprints/index.js";
import {
  getOperatingModelTemplate,
  sanitizeOperatingModel,
  shouldUseLlmOperateDesign,
  attachReadinessDefaults,
} from "./company-operate-models/index.js";
import { designOperatingModelWithLlm } from "./company-llm-operate.js";
import { listAgentsForUser } from "./users.js";
import { createTable, findTableByName, insertRow, uploadDocument } from "./master-data.js";
import { createDefinition, getDefinition, updateDraft } from "./agent-workflow-store.js";
import * as workspace from "../workspace/adapter.js";

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
  return {
    owner_user_id: ownerUserId,
    operate_gate: gate,
    company_formed: formed,
    company_name: strategic.company_name || null,
    company_type: strategic.company_type || null,
    company_type_card: strategic.company_type_card || null,
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

export function getOperateState(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const strategic = getStrategic(row);
  const gate = getOperateGate(ownerUserId);
  const companyType = resolveCompanyTypeId(strategic.company_type || "general_ops");
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
  const cards = listCompanyTypeCards();
  const card = cards.find(
    (c) =>
      c.id === strategic.company_type_card ||
      c.id === strategic.company_type ||
      c.maps_to === companyType
  );

  return {
    ...gate,
    operate_step: strategic.operate_step || "welcome",
    company_type: companyType,
    company_type_label: card?.label || bp.label || companyType,
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

  const companyType = resolveCompanyTypeId(strategic.company_type || "general_ops");
  const cards = listCompanyTypeCards();
  const card = cards.find((c) => c.id === strategic.company_type_card || c.maps_to === companyType);
  const sourcePref = String(body.source || "auto").toLowerCase();
  const force = sourcePref === "llm" || sourcePref === "template" ? sourcePref : undefined;
  const useLlm = shouldUseLlmOperateDesign(companyType, { force });

  let design;
  if (useLlm) {
    const agents = listAgentsForUser(ownerUserId);
    design = await designOperatingModelWithLlm(ownerUserId, {
      company_name: strategic.company_name || "",
      company_type: companyType,
      company_type_label: card?.label || companyType,
      mission: strategic.mission || "",
      org_dna: strategic.org_dna || "",
      org_dna_notes: strategic.org_dna_notes || "",
      management_style: strategic.management_style || "after_approval",
      industry: strategic.industry || "",
      describe_company: strategic.describe_company || "",
      agents,
    });
  } else {
    design = {
      model: getOperatingModelTemplate(companyType, {
        management_style: strategic.management_style,
      }),
      design_source: "template",
    };
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
  return `

---
## Company operating model (Day 1 install)

Versioned run contract. Follow these **daily tasks** and **loops**. Respect the **autonomy matrix** — never publish, spend, or hire beyond your level.

### Daily tasks
${taskLines}

### Your loops
${loopLines}

### Autonomy matrix (company-wide)
${matrix || "- (see Policies)"}

### Quality bars
${(model.quality_bars || []).map((q) => `- ${q}`).join("\n") || "- Align with mission"}

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

function buildLoopGraph({ loop, agent, publishGated }) {
  const prompt = `You are operating the company loop "${loop.name}".
${loop.description || ""}

Steps: ${(loop.steps || []).join(" → ")}
Cadence: ${loop.cadence || "daily"}

Work within autonomy rules. Produce a concise status of what you planned/drafted.
Do NOT publish externally or spend money unless company policy already allows.
If CEO approval is required, state what needs approval.`;

  const nodes = [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 40, y: 120 },
      data: {
        label: "Start",
        triggerModes: ["manual"],
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
        prompt,
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
        title: `Approve: ${loop.name}`,
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
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };
}

function createOperateWorkflow(ownerUserId, loop, agent, model) {
  const publishLevel = autonomyLevel(model, "publish");
  const publishGated = publishLevel === "require_ceo" || publishLevel === "recommend";
  const graph = buildLoopGraph({ loop, agent, publishGated: publishLevel === "require_ceo" });
  const name = `Operate · ${loop.name}`.slice(0, 80);
  const description = `${loop.description || loop.name} | Day-1 from operating model. Publish gate: ${publishLevel}.`;
  try {
    const existingId = `operate-${ownerUserId.slice(0, 12)}-${loop.id}`.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 64);
    const prior = getDefinition(existingId, ownerUserId);
    if (prior) {
      updateDraft(
        existingId,
        ownerUserId,
        {
          name,
          description,
          graph,
          trigger_modes: ["manual"],
        },
        { id: ownerUserId, name: "company-operate" }
      );
      return { id: existingId, name, updated: true, publish_gated: publishLevel === "require_ceo" };
    }
    const def = createDefinition({
      id: existingId,
      name,
      description,
      ownerUserId,
      actor: { id: ownerUserId, name: "company-operate" },
      graph,
      trigger_modes: ["manual"],
      schedule_cron: "",
    });
    return {
      id: def?.id || existingId,
      name,
      created: true,
      publish_gated: publishLevel === "require_ceo",
    };
  } catch (e) {
    console.warn("[company-operate] workflow", loop.id, e?.message || e);
    return { loop_id: loop.id, ok: false, error: e?.message || String(e) };
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
    }
    if (status === "ready" && sys.id !== "kanban") {
      // Only trust explicit CEO-marked ready; kanban is platform-native
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
  ];
  return lines.join("\n");
}

function buildDay1OperateBriefing({ model, md, workflows, readiness, knowledge, version }) {
  const blocked = readiness.filter((r) => r.required && r.status !== "ready");
  const ready = readiness.filter((r) => r.status === "ready");
  const wfOk = workflows.filter((w) => w.id && !w.error);
  const mdOk = md.filter((m) => m.ok);
  return {
    message: `Day 1 install complete for operating model v${version}. ${mdOk.length} employee runbooks updated, ${wfOk.length} workflow(s) drafted.`,
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
    md_updated: mdOk.map((m) => m.name || m.agent_id),
    workflows: wfOk,
    knowledge,
    links: [
      { label: "Workflows", path: "/workflows" },
      { label: "Browser Session", path: "/browser-session" },
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
  const model = strategic.operating_model;
  if (!model) {
    const err = new Error("No operating model to apply.");
    err.status = 400;
    throw err;
  }
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
    version,
  });

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
