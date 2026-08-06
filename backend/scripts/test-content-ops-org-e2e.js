/**
 * E2E: productive content org — every agent loop except connector last-leg.
 * WORKFLOW_SEED_OWNER_ID=... node scripts/test-content-ops-org-e2e.js
 */
import { config } from "dotenv";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { setTimeout as sleep } from "timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });
config({ path: join(__dirname, "../../deploy/.env") });

import { initDb, getDb } from "../src/db/schema.js";
import { createSession } from "../src/services/auth/session.js";
import { getUserById } from "../src/services/users.js";
import { startAgentWorkflowRun, completeCeoApprovalResponse } from "../src/services/agent-workflow-runner.js";
import * as store from "../src/services/agent-workflow-store.js";
import { listScheduledGoals } from "../src/services/scheduled-goals.js";

initDb();

const OWNER = process.env.WORKFLOW_SEED_OWNER_ID || "ceo-content-api-phase01-057515";
const MAX_MS = Number(process.env.ORG_E2E_MAX_MS || 600000);

function findWf(re) {
  return store.listDefinitions(OWNER).find((w) => w.status === "published" && re.test(w.name || ""));
}

async function waitRun(runId, { untilStatuses = ["completed", "failed", "cancelled", "error"], alsoWait = null } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < MAX_MS) {
    const run = store.getRun(runId, OWNER);
    if (!run) throw new Error("run missing " + runId);
    if (untilStatuses.includes(String(run.status))) return run;
    if (alsoWait && alsoWait(run)) return run;
    // waiting for CEO gate: running with ceo_approval in_progress
    await sleep(2500);
  }
  return store.getRun(runId, OWNER);
}

function waitingCeo(run) {
  if (String(run.status) !== "running") return false;
  return (run.steps || []).some((s) => s.node_type === "ceo_approval" && s.status === "in_progress");
}

function summarize(run) {
  return {
    id: run.id,
    status: run.status,
    error: run.error_message || null,
    steps: (run.steps || []).map((s) => ({
      id: s.node_id,
      type: s.node_type,
      label: s.node_label,
      status: s.status,
      err: s.error_message || null,
    })),
  };
}

async function approveWaiting(runId) {
  const db = getDb();
  // find kanban awaiting for this run
  const rows = db
    .prepare(
      `SELECT id, status, description FROM kanban_tasks
       WHERE owner_user_id = ? AND status = 'awaiting_confirmation'
       ORDER BY id DESC LIMIT 20`
    )
    .all(OWNER);
  const task = rows.find((r) => String(r.description || "").includes(String(runId)));
  if (!task) return { approved: false, reason: "no_ceo_task" };
  const res = await completeCeoApprovalResponse({
    kanbanTaskId: task.id,
    decision: "approve",
    comment: "org e2e approve for agent validation",
    actor: { id: "org-e2e", name: "Org e2e", type: "system" },
  });
  return { approved: true, kanban_task_id: task.id, ...res };
}

async function runOps() {
  const wf = findWf(/ops rollup/i);
  if (!wf) throw new Error("ops workflow missing");
  const run = await startAgentWorkflowRun(wf.id, OWNER, {
    trigger: "manual",
    input:
      "Run weekly ops rollup now. Summarize master_data pipelines and goals. notify_ceo. Do not invent connector publish success.",
    actor: { id: "org-e2e", name: "Org e2e", type: "system" },
  });
  const final = await waitRun(run.id);
  return { workflow: wf.id, ...summarize(final) };
}

async function runCommunity() {
  const wf = findWf(/community comment/i);
  if (!wf) throw new Error("community workflow missing");
  const run = await startAgentWorkflowRun(wf.id, OWNER, {
    trigger: "manual",
    input: JSON.stringify({
      goal: "Triage product questions on LinkedIn samples",
      comments: [
        {
          platform: "linkedin",
          author: "sample_user",
          text: "Do you have a deeper guide on agent tips?",
          risk: "low",
        },
      ],
    }),
    actor: { id: "org-e2e", name: "Org e2e", type: "system" },
  });
  let cur = await waitRun(run.id, {
    untilStatuses: ["completed", "failed", "cancelled", "error"],
    alsoWait: waitingCeo,
  });
  let gate = null;
  if (waitingCeo(cur)) {
    gate = await approveWaiting(run.id);
    cur = await waitRun(run.id);
  }
  return { workflow: wf.id, gate, ...summarize(cur) };
}

async function runProduction() {
  const wf = findWf(/content production/i);
  if (!wf) throw new Error("production workflow missing");
  const goals = listScheduledGoals(OWNER);
  const contentGoal = goals.find((g) => /content|weekly/i.test(g.title || "")) || goals[0];
  const input =
    (contentGoal?.prompt || "Weekly tips for busy professionals") +
    "\n\nProduce LinkedIn + Facebook drafts under this CEO goal. Pipeline e2e fingerprint ORG-E2E-" +
    Date.now().toString(36) +
    ".";
  const run = await startAgentWorkflowRun(wf.id, OWNER, {
    trigger: "manual",
    input,
    actor: { id: "org-e2e", name: "Org e2e", type: "system" },
  });
  let cur = await waitRun(run.id, {
    untilStatuses: ["completed", "failed", "cancelled", "error"],
    alsoWait: waitingCeo,
  });
  const agentsBeforeGate = (cur.steps || []).filter((s) => s.node_type === "agent" && s.status === "completed");
  let gate = null;
  if (waitingCeo(cur)) {
    gate = await approveWaiting(run.id);
    cur = await waitRun(run.id);
  }
  const publisher = (cur.steps || []).find((s) => /publisher/i.test(String(s.node_label || s.node_id || "")));
  const connectorish =
    /OpenConnector|runtime token|not linked|connector|mcp|oauth|facebook|meta graph/i.test(
      String(cur.error_message || "") + " " + String(publisher?.error_message || "")
    );
  return {
    workflow: wf.id,
    agents_completed_before_or_at_gate: agentsBeforeGate.map((s) => s.node_label || s.node_id),
    gate,
    publisher: publisher
      ? { status: publisher.status, err: publisher.error_message || null }
      : null,
    expected_connector_boundary: connectorish || publisher?.status === "failed" || cur.status === "failed",
    ...summarize(cur),
  };
}

async function main() {
  const user = getUserById(OWNER);
  if (!user) throw new Error("missing owner");
  createSession(OWNER);

  const report = {
    owner: OWNER,
    email: user.email,
    goals: listScheduledGoals(OWNER).map((g) => ({
      id: g.id,
      title: g.title,
      agent_id: g.agent_id,
      status: g.status,
    })),
    workflows: store
      .listDefinitions(OWNER)
      .filter((w) => w.status === "published")
      .map((w) => ({ id: w.id, name: w.name })),
    tests: {},
  };

  try {
    report.tests.ops_rollup = await runOps();
  } catch (e) {
    report.tests.ops_rollup = { error: e.message };
  }
  try {
    report.tests.community_triage = await runCommunity();
  } catch (e) {
    report.tests.community_triage = { error: e.message };
  }
  try {
    report.tests.content_production = await runProduction();
  } catch (e) {
    report.tests.content_production = { error: e.message };
  }

  const opsOk =
    report.tests.ops_rollup?.status === "completed" ||
    (report.tests.ops_rollup?.steps || []).some((s) => s.id === "agent-ops" && s.status === "completed");
  const communityOk =
    report.tests.community_triage?.status === "completed" ||
    (report.tests.community_triage?.steps || []).some((s) => /cm|community/i.test(s.label || s.id) && s.status === "completed");
  const prodAgentsOk =
    (report.tests.content_production?.agents_completed_before_or_at_gate || []).length >= 2 ||
    (report.tests.content_production?.steps || []).filter((s) => s.type === "agent" && s.status === "completed").length >= 2;

  report.verdict = {
    ops_ok: !!opsOk,
    community_agents_ok: !!communityOk,
    production_agents_ok: !!prodAgentsOk,
    connector_deferred_ok:
      !!report.tests.content_production?.expected_connector_boundary ||
      report.tests.content_production?.status === "failed" ||
      report.tests.content_production?.publisher?.status === "failed",
    overall:
      opsOk && communityOk && prodAgentsOk
        ? "ORG_PRODUCTIVE_EXCEPT_CONNECTOR"
        : "PARTIAL_OR_FAILED",
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.verdict.overall === "ORG_PRODUCTIVE_EXCEPT_CONNECTOR" ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});