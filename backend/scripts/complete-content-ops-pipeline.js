/**
 * Complete productive content org: production, community, ops rollup + all agent goals/tools.
 * WORKFLOW_SEED_OWNER_ID=ceo-... node scripts/complete-content-ops-pipeline.js
 */
import { config } from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });
config({ path: join(__dirname, "../../deploy/.env") });

import { initDb, getDb } from "../src/db/schema.js";
import { listAgentsForUser, getUserById } from "../src/services/users.js";
import { createSession } from "../src/services/auth/session.js";
import {
  designOperate,
  confirmOperateDay0,
  applyOperateDay1,
  getOperateState,
} from "../src/services/company-operate.js";
import { createScheduledGoal, listScheduledGoals } from "../src/services/scheduled-goals.js";
import * as store from "../src/services/agent-workflow-store.js";
import { getAgentToolGrants, syncAllowlistsFile } from "../src/services/openclaw-agent-tools.js";
import { ensureTenantOpenClawAgent } from "../src/services/openclaw-tenant.js";
import {
  seedContentPublishSocialWorkflow,
  WORKFLOW_ID as PUBLISH_WF,
} from "./seed-content-publish-social-workflow.js";
import {
  createTable,
  findTableByName,
  insertRow,
} from "../src/services/master-data.js";

initDb();

const OWNER = process.env.WORKFLOW_SEED_OWNER_ID || "ceo-content-api-phase01-057515";
const actor = { id: "seed-content-ops", name: "complete-content-ops-pipeline", type: "system" };

function match(agents, role) {
  const n = String(role || "").toLowerCase();
  return (
    agents.find((a) => String(a.name || "").toLowerCase() === n) ||
    agents.find((a) => String(a.role || "").toLowerCase().includes(n)) ||
    agents.find((a) => String(a.name || "").toLowerCase().includes(n)) ||
    null
  );
}

function grant(agentId, tools) {
  const db = getDb();
  const ins = db.prepare("INSERT OR IGNORE INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)");
  let added = 0;
  for (const t of tools) {
    if (ins.run(agentId, t).changes) added += 1;
  }
  return added;
}

function upsertWorkflow({ id, name, description, graph, chatPhrase = "" }) {
  const existing =
    store.getDefinition(id, OWNER) ||
    store.listDefinitions(OWNER).find((w) => String(w.name || "") === name);
  const wfId = existing?.id || id;
  const patch = {
    name,
    description,
    graph,
    trigger_modes: ["manual", "event", "chat"],
    schedule_cron: "",
    chat_trigger_phrase: chatPhrase || undefined,
  };
  if (existing) store.updateDraft(wfId, OWNER, patch, actor);
  else {
    try {
      store.createDefinition({
        id: wfId,
        name,
        description,
        ownerUserId: OWNER,
        actor,
        graph,
        trigger_modes: patch.trigger_modes,
        schedule_cron: "",
        chat_trigger_phrase: chatPhrase || "",
      });
    } catch {
      const alt = (wfId.slice(0, 50) + "-" + OWNER.slice(-10)).replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 64);
      store.createDefinition({
        id: alt,
        name,
        description,
        ownerUserId: OWNER,
        actor,
        graph,
        trigger_modes: patch.trigger_modes,
        schedule_cron: "",
        chat_trigger_phrase: chatPhrase || "",
      });
      store.publishDefinition(alt, OWNER, actor);
      return { id: alt, status: "published" };
    }
  }
  store.publishDefinition(wfId, OWNER, actor);
  return { id: wfId, status: "published" };
}

function agentNode(id, agent, prompt, prevId, prevKey, x, extraBindings = []) {
  const bindings = [
    { id: "prompt", mode: "dynamic", sourceNodeId: prevId, sourceOutputKey: prevKey, value: "" },
    ...extraBindings,
  ];
  return {
    id,
    type: "agent",
    position: { x, y: 160 },
    data: {
      label: agent.name,
      agentId: agent.id,
      agentName: agent.name,
      prompt,
      inputBindings: bindings,
      outputs: [{ id: "text", label: "Agent response" }],
      taskConfig: { timeoutMs: 300000, timeoutAction: "fail" },
    },
  };
}

function buildProductionGraph(agents) {
  const chain = [
    ["Content Strategist", "agent-strategist", "You are Content Strategist. Use ONLY CEO goal from input. Check content_topics_history 20d. Output 1-3 angles + fingerprint. No publish."],
    ["Media Generator", "agent-media", "You are Media Generator. From prior brief write EXACT ### LinkedIn draft and ### Facebook draft bodies. No publish."],
    ["Content Reviewer", "agent-reviewer", "You are Content Reviewer. APPROVED or BLOCKED. If APPROVED include POST_BODIES lines platform=linkedin|facebook body=... No publish."],
    [
      "Channel Publisher",
      "agent-publisher",
      [
        "You are Channel Publisher last leg after CEO gate.",
        "Input includes CEO decision plus the approved Content Reviewer POST_BODIES (or CEO approval text containing POST_BODIES).",
        "Parse every platform=facebook|linkedin body=... line (body may be multiline until next platform= line).",
        "For each ready platform call agent_workflow_trigger workflow_id=content-publish-social with { platform, body, fingerprint } (page_id if known).",
        "Facebook is ready when Meta Graph MCP OAuth is connected for this CEO (Connectors → MCPs mcp-meta-graph). Treat that as the source of truth — do NOT require Master Data social_accounts / connectors_mcp rows.",
        "You HAVE agent_workflow_trigger: use it. Call content-publish-social with platform, body, page_id from CEO goal/input (and POST_BODIES), fingerprint.",
        "LinkedIn requires OpenConnector; skip LI with explicit skip log if OC not linked — still publish Facebook when FB body + page_id exist.",
        "Poll child runs. Log master_data honestly. Only fail-closed if no body, or Meta OAuth truly missing and LinkedIn also unavailable.",
      ].join(" "),
    ],
  ]
    .map(([role, nodeId, prompt]) => ({ role, nodeId, prompt, agent: match(agents, role) }))
    .filter((s) => s.agent);

  const nodes = [
    {
      id: "trigger-1",
      type: "trigger",
      position: { x: 40, y: 160 },
      data: {
        label: "Start (CEO goal)",
        triggerModes: ["manual", "event", "chat"],
        chatPhrase: "run content production",
        outputs: [
          { id: "text", label: "Input text" },
          { id: "trigger_input", label: "Trigger payload" },
        ],
      },
    },
  ];
  const edges = [];
  let prev = "trigger-1";
  let prevKey = "text";
  let reviewerId = null;
  let x = 280;
  for (const step of chain) {
    if (/channel publisher/i.test(step.role)) {
      reviewerId = prev;
      nodes.push({
        id: "ceo-1",
        type: "ceo_approval",
        position: { x, y: 160 },
        data: {
          label: "CEO gate (approve posts)",
          title: "Approve content before publish",
          instructions: "Review POST_BODIES. Channel Publisher posts next via content-publish-social.",
          inputBindings: [
            { id: "summary", mode: "dynamic", sourceNodeId: prev, sourceOutputKey: prevKey, value: "" },
          ],
          outputs: [
            { id: "decision", label: "Decision" },
            { id: "text", label: "Full outcome text (includes approved content)" },
            { id: "summary", label: "Approved content summary" },
          ],
        },
      });
      edges.push({ id: "e-ceo", source: prev, target: "ceo-1" });
      prev = "ceo-1";
      prevKey = "text";
      x += 220;
      // Publisher must receive CEO decision text (includes approved summary) + raw POST_BODIES from reviewer
      nodes.push(
        agentNode(step.nodeId, step.agent, step.prompt + "\n\nPrior step is context. Goal is topic source.", prev, prevKey, x, [
          {
            id: "post_bodies",
            mode: "dynamic",
            sourceNodeId: reviewerId,
            sourceOutputKey: "text",
            value: "",
          },
        ])
      );
      edges.push({ id: "e-" + step.nodeId, source: prev, target: step.nodeId });
      prev = step.nodeId;
      prevKey = "text";
      x += 220;
      continue;
    }
    nodes.push(agentNode(step.nodeId, step.agent, step.prompt + "\n\nPrior step is context. Goal is topic source.", prev, prevKey, x));
    edges.push({ id: "e-" + step.nodeId, source: prev, target: step.nodeId });
    prev = step.nodeId;
    prevKey = "text";
    x += 220;
  }
  return {
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.7 },
    agent_chain: chain.map((c) => c.agent.name),
  };
}

function buildCommunityGraph(agents) {
  const cm = match(agents, "Community Manager");
  if (!cm) throw new Error("Community Manager missing");
  const prompt = [
    "You are Community Manager on comment triage (no live connector scrapes required for this step).",
    "Input may include synthetic threads or master_data comment_inbox rows.",
    "Draft professional replies; escalate legal/PR. Use notify_ceo for high risk.",
    "Output DRAFT_REPLIES clearly. Do NOT claim public post of replies (connector path deferred).",
    "Log triage intent to master_data if tools allow.",
  ].join("\n");
  return {
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 40, y: 140 },
        data: {
          label: "Start (comments context)",
          triggerModes: ["manual", "event", "chat"],
          chatPhrase: "run community triage",
          outputs: [
            { id: "text", label: "Input text" },
            { id: "trigger_input", label: "Trigger payload" },
          ],
        },
      },
      agentNode("agent-cm", cm, prompt, "trigger-1", "text", 280),
      {
        id: "ceo-1",
        type: "ceo_approval",
        position: { x: 520, y: 140 },
        data: {
          label: "CEO gate (sensitive replies)",
          title: "Approve community replies",
          instructions: "Approve draft replies before any public connector post.",
          inputBindings: [
            { id: "summary", mode: "dynamic", sourceNodeId: "agent-cm", sourceOutputKey: "text", value: "" },
          ],
          outputs: [
            { id: "decision", label: "Decision" },
            { id: "text", label: "Full outcome text" },
          ],
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "agent-cm" },
      { id: "e2", source: "agent-cm", target: "ceo-1" },
    ],
    viewport: { x: 0, y: 0, zoom: 0.85 },
  };
}

function buildOpsGraph(agents) {
  const ops = match(agents, "Ops Reporter");
  if (!ops) throw new Error("Ops Reporter missing");
  const prompt = [
    "You are Ops Reporter on weekly ops rollup.",
    "Gather: master_data content_topics_history / publish_log / company_goals if present; scheduled goals context from input.",
    "Summarize: drafts/publishes, CEO approvals pending, missing goals, connector readiness honestly (connected vs not).",
    "Call notify_ceo with a short rollup. Do not invent connector publish success.",
  ].join("\n");
  return {
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 40, y: 140 },
        data: {
          label: "Start (ops rollup)",
          triggerModes: ["manual", "event", "chat"],
          chatPhrase: "run ops rollup",
          outputs: [
            { id: "text", label: "Input text" },
            { id: "trigger_input", label: "Trigger payload" },
          ],
        },
      },
      agentNode("agent-ops", ops, prompt, "trigger-1", "text", 300),
    ],
    edges: [{ id: "e1", source: "trigger-1", target: "agent-ops" }],
    viewport: { x: 0, y: 0, zoom: 0.9 },
  };
}

function ensureGoal(title, prompt, agentId, cadence = "weekly") {
  const existing = listScheduledGoals(OWNER).find((g) => String(g.title || "") === title);
  if (existing) return existing;
  return createScheduledGoal(OWNER, {
    title,
    prompt,
    agent_id: agentId,
    cadence,
    weekday: cadence === "weekly" ? 1 : null,
    time_local: "09:00",
    source: "complete-content-ops",
    approve_plan: true,
  });
}

function seedCommentInbox() {
  let table = findTableByName(OWNER, "comment_inbox");
  if (!table) {
    table = createTable(OWNER, {
      name: "comment_inbox",
      description: "Inbound social comments for community triage (synthetic OK until connector)",
      columns: ["when", "platform", "author", "comment_text", "risk", "status", "draft_reply"],
    });
  }
  try {
    insertRow(OWNER, table.id, {
      when: new Date().toISOString(),
      platform: "linkedin",
      author: "sample_user",
      comment_text: "Interesting tips - do you have a longer guide?",
      risk: "low",
      status: "open",
      draft_reply: "",
    });
  } catch (_) {
    /* duplicate ok */
  }
  return table?.name || "comment_inbox";
}

async function main() {
  const user = getUserById(OWNER);
  if (!user) throw new Error("CEO not found " + OWNER);
  createSession(OWNER);

  await designOperate(OWNER, { source: "template" });
  confirmOperateDay0(OWNER, {});
  await applyOperateDay1(OWNER);

  const agents = listAgentsForUser(OWNER);
  const shared = [
    "learnings_summary",
    "master_data_rag",
    "master_data_list_rows",
    "master_data_insert_row",
    "master_data_list_tables",
    "notify_ceo",
    "kanban_create_task",
    "kanban_get_task",
  ];
  const wfTools = [
    "agent_workflow_list",
    "agent_workflow_trigger",
    "agent_workflow_runs",
    "agent_workflow_enquire",
  ];
  const grants = [];
  for (const a of agents) {
    const n = String(a.name || "").toLowerCase();
    let tools = [...shared];
    if (n.includes("coo") || n.includes("publisher") || n.includes("ops reporter") || n.includes("workflow")) {
      tools = tools.concat(wfTools);
    }
    if (n.includes("media")) tools.push("generate_image", "analyze_image");
    if (n.includes("community")) tools.push("summarize_url");
    const added = grant(a.id, tools);
    grants.push({ id: a.id, name: a.name, added, total: getAgentToolGrants(a.id).length });
    try {
      ensureTenantOpenClawAgent(a, OWNER);
    } catch (_) {}
  }
  try {
    syncAllowlistsFile();
  } catch (_) {}

  seedCommentInbox();
  const publishWf = seedContentPublishSocialWorkflow(OWNER, { publish: true });

  const prodPack = buildProductionGraph(agents);
  const { agent_chain, ...prodGraph } = prodPack;
  const prod = upsertWorkflow({
    id: ("operate-" + OWNER + "-content_pipeline").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 64),
    name: "Operate - Content production loop",
    description: "Multi-agent production: Strategist->Media->Reviewer->CEO->Publisher->content-publish-social",
    graph: prodGraph,
    chatPhrase: "run content production",
  });

  const community = upsertWorkflow({
    id: ("operate-" + OWNER + "-community_triage").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 64),
    name: "Operate - Community comment triage",
    description: "Community Manager drafts replies from goal/inbox; CEO gate; connector post deferred",
    graph: buildCommunityGraph(agents),
    chatPhrase: "run community triage",
  });

  const ops = upsertWorkflow({
    id: ("operate-" + OWNER + "-weekly_ops_rollup").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 64),
    name: "Operate - Weekly ops rollup",
    description: "Ops Reporter gather + notify_ceo rollup (no connector required)",
    graph: buildOpsGraph(agents),
    chatPhrase: "run ops rollup",
  });

  const coo = match(agents, "COO") || { id: "coo" };
  const cm = match(agents, "Community Manager");
  const opsAgent = match(agents, "Ops Reporter");

  const goals = {
    content: ensureGoal(
      "Weekly content: product tips for busy professionals",
      "This week publish LinkedIn and Facebook Page posts that help busy professionals save 1 hour/day with practical AI-agent tips. Clear practical tone. No sexual/abusive/discriminatory content.",
      coo.id || "coo"
    ),
    community: ensureGoal(
      "Weekly community triage focus",
      "Triage open comments in comment_inbox / channels: prioritize product questions and low-risk feedback. Draft professional replies. Escalate legal/PR. Do not invent live scrape success.",
      cm?.id || coo.id
    ),
    ops: ensureGoal(
      "Weekly ops rollup for CEO",
      "Produce a concise weekly ops rollup: pipeline, topic-history coverage, missing goals, pending CEO approvals, connector readiness. notify_ceo.",
      opsAgent?.id || coo.id
    ),
  };

  const out = {
    ok: true,
    owner: OWNER,
    email: user.email,
    operate: getOperateState(OWNER)?.strategic?.operate_gate || getOperateState(OWNER)?.operate_gate,
    grants,
    workflows: {
      production: { ...prod, agent_chain },
      community,
      ops,
      publish: { id: PUBLISH_WF, status: publishWf?.status },
    },
    goals: Object.fromEntries(
      Object.entries(goals).map(([k, g]) => [k, { id: g.id, title: g.title, agent_id: g.agent_id, status: g.status }])
    ),
    published: store.listDefinitions(OWNER).filter((w) => w.status === "published").map((w) => ({ id: w.id, name: w.name })),
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});