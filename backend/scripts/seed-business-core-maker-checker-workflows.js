/**
 * Seed ERP + CRM Maker/Checker protocol workflows per CEO when prefab agents exist.
 *
 * Flow (each): trigger → Maker agent → Checker agent (JSON decision) →
 *   if rejected → Maker revise → Checker again → if still rejected notify escalate
 *   if approved → notify complete
 *
 * Chat phrases: "run erp maker checker" | "run crm maker checker"
 *
 * Usage:
 *   node backend/scripts/seed-business-core-maker-checker-workflows.js
 *   WORKFLOW_SEED_OWNER_ID=ceo-bala node backend/scripts/seed-business-core-maker-checker-workflows.js
 */
import { config } from "dotenv";
import { dirname, join, resolve as pathResolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { getDb } from "../src/db/schema.js";
import * as store from "../src/services/agent-workflow-store.js";

function listTargetCeos() {
  const db = getDb();
  const only = String(process.env.WORKFLOW_SEED_OWNER_ID || "").trim();
  if (only) return db.prepare(`SELECT id, name FROM platform_users WHERE id = ?`).all(only);
  return db
    .prepare(`SELECT id, name FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all()
    .filter((c) => {
      const id = String(c.id || "");
      return !/^ceo-oc-connector-/i.test(id) && !/^ceo-os-rag-/i.test(id) && !/^ceo-md-[ab]-/i.test(id);
    });
}

function findAgent(ownerUserId, nameExact) {
  return getDb()
    .prepare(
      `SELECT a.id, a.name FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id
       WHERE ua.user_id = ? AND lower(a.name) = lower(?)
       LIMIT 1`
    )
    .get(ownerUserId, nameExact);
}

function buildGraph({ makerId, makerName, checkerId, checkerName, kind, chatPhrase }) {
  const isErp = kind === "erp";
  const makerPrompt1 = isErp
    ? `You are ERP Maker on Flolah. Goal from CEO/COO:

{{input}}

Rules:
1) Company-scoped erp_* only. Create/update DRAFT docs only — never erp_submit_doc / erp_cancel_doc.
2) When ready for post, kanban_create_task assigned to **${checkerName}** titled [ERP] Submit {doctype} {name} with full context.
3) Reply with a short summary: objects touched, Kanban task id, next step for Checker.`
    : `You are CRM Maker on Flolah. Goal from CEO/COO:

{{input}}

Rules:
1) Company-scoped crm_* (or ERPNext sales tools if that pack). Low-risk: execute. High-risk (Won large, merge/delete, bulk, ERP handoff): prepare proposal and kanban_create_task for **${checkerName}** titled [CRM] Review …
2) Do not treat high-risk as done without Checker path.
3) Reply with summary + any Kanban id.`;

  const checkerPrompt = isErp
    ? `You are ERP Checker. CEO/COO goal / Maker output:

{{input}}

Maker summary:
{{maker-1.reply}}

Rules:
1) Review with list/get tools. If safe to post: erp_submit_doc / cancel as required; complete related Kanban.
2) If bad: comment FINDING: on Kanban and reassign to Maker. Do not bulk-draft.
3) End your reply with ONLY one JSON line:
{"decision":"approved"|"rejected","adjustments":"...","notes":"..."}`
    : `You are CRM Checker. Goal / Maker:

{{input}}

Maker summary:
{{maker-1.reply}}

Review high-risk CRM proposals (list tools). Approve quality or reject with FINDING on Kanban back to Maker.
End with ONLY one JSON line:
{"decision":"approved"|"rejected","adjustments":"...","notes":"..."}`;

  const makerPrompt2 = isErp
    ? `Checker rejected your draft. Goal: {{input}}

Checker output:
{{checker-1.reply}}

Fix FINDINGS with erp draft tools only; update Kanban for ${checkerName}. Never submit.
Short summary of fixes.`
    : `Checker rejected your CRM proposal. Goal: {{input}}

Checker:
{{checker-1.reply}}

Revise; re-open Kanban for ${checkerName} if still high-risk. Short summary.`;

  const checkerPrompt2 = isErp
    ? `Second review after Maker fix.

Original goal: {{input}}
Maker fix: {{maker-2.reply}}

Prior Checker: {{checker-1.reply}}

Submit if ok (erp_submit_doc) or reject again.
End with ONLY JSON:
{"decision":"approved"|"rejected","adjustments":"...","notes":"..."}`
    : `Second CRM review after Maker fix.

Goal: {{input}}
Fix: {{maker-2.reply}}
Prior: {{checker-1.reply}}

End with ONLY JSON:
{"decision":"approved"|"rejected","adjustments":"...","notes":"..."}`;

  return {
    nodes: [
      {
        id: "trigger-1",
        type: "trigger",
        position: { x: 40, y: 200 },
        data: {
          label: "Start",
          triggerModes: ["manual", "chat"],
          chatPhrase,
          scheduleCron: "",
        },
      },
      {
        id: "maker-1",
        type: "agent",
        position: { x: 260, y: 200 },
        data: {
          label: makerName + " (draft)",
          agentId: makerId,
          agentName: makerName,
          prompt: makerPrompt1,
          inputBindings: [
            { id: "prompt", mode: "dynamic", sourceNodeId: "trigger-1", sourceOutputKey: "text" },
          ],
        },
      },
      {
        id: "checker-1",
        type: "agent",
        position: { x: 500, y: 200 },
        data: {
          label: checkerName + " (review)",
          agentId: checkerId,
          agentName: checkerName,
          prompt: checkerPrompt,
          inputBindings: [
            { id: "prompt", mode: "dynamic", sourceNodeId: "maker-1", sourceOutputKey: "reply" },
          ],
        },
      },
      {
        id: "parse-1",
        type: "brain",
        position: { x: 740, y: 200 },
        data: {
          label: "Parse Checker decision",
          taskConfig: {
            modelSource: "platform",
            maxTokens: 200,
            systemPrompt:
              'Extract the Checker decision JSON. Reply ONLY: {"decision":"approved"|"rejected","adjustments":"...","notes":"..."}. If unclear, decision rejected.',
            mcpToolCalling: false,
          },
          inputBindings: [
            {
              id: "userMessage",
              mode: "dynamic",
              sourceNodeId: "checker-1",
              sourceOutputKey: "reply",
            },
          ],
        },
      },
      {
        id: "if-1",
        type: "if",
        position: { x: 980, y: 200 },
        data: {
          label: "If approved (pass 1)",
          taskConfig: {
            sourceNodeId: "parse-1",
            sourceOutputKey: "text",
            operator: "contains",
            compareValue: "approved",
          },
        },
      },
      {
        id: "maker-2",
        type: "agent",
        position: { x: 980, y: 380 },
        data: {
          label: makerName + " (fix)",
          agentId: makerId,
          agentName: makerName,
          prompt: makerPrompt2,
          inputBindings: [
            { id: "prompt", mode: "dynamic", sourceNodeId: "checker-1", sourceOutputKey: "reply" },
          ],
        },
      },
      {
        id: "checker-2",
        type: "agent",
        position: { x: 1220, y: 380 },
        data: {
          label: checkerName + " (recheck)",
          agentId: checkerId,
          agentName: checkerName,
          prompt: checkerPrompt2,
          inputBindings: [
            { id: "prompt", mode: "dynamic", sourceNodeId: "maker-2", sourceOutputKey: "reply" },
          ],
        },
      },
      {
        id: "notify-ok",
        type: "content_tool",
        position: { x: 1220, y: 80 },
        data: {
          label: "Notify CEO (approved)",
          toolName: "notify_ceo",
          taskConfig: {
            toolName: "notify_ceo",
            bodyJson:
              '{"message":"Maker/Checker {{input}} completed (approved). See agent chat/Kanban.","title":"Business Core gate passed"}',
          },
          inputBindings: [
            { id: "input", mode: "dynamic", sourceNodeId: "trigger-1", sourceOutputKey: "text" },
          ],
        },
      },
      {
        id: "notify-escalate",
        type: "content_tool",
        position: { x: 1460, y: 380 },
        data: {
          label: "Notify CEO (escalated)",
          toolName: "notify_ceo",
          taskConfig: {
            toolName: "notify_ceo",
            bodyJson:
              '{"message":"Maker/Checker still rejected after one fix cycle. Review Kanban findings. Goal: see workflow run.","title":"Business Core gate needs CEO"}',
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "trigger-1", target: "maker-1" },
      { id: "e2", source: "maker-1", target: "checker-1" },
      { id: "e3", source: "checker-1", target: "parse-1" },
      { id: "e4", source: "parse-1", target: "if-1" },
      { id: "e5", source: "if-1", target: "notify-ok", sourceHandle: "true" },
      { id: "e6", source: "if-1", target: "maker-2", sourceHandle: "false" },
      { id: "e7", source: "maker-2", target: "checker-2" },
      { id: "e8", source: "checker-2", target: "notify-escalate" },
    ],
  };
}

function upsertWorkflow(ownerUserId, { name, description, chatPhrase, graph, forcedId }) {
  const actor = { id: "system", name: "seed-business-core-mc" };
  const existing = getDb()
    .prepare(
      `SELECT id FROM agent_workflow_definitions WHERE owner_user_id = ? AND (id = ? OR name = ?) ORDER BY updated_at DESC LIMIT 1`
    )
    .get(ownerUserId, forcedId, name);
  const patch = {
    name,
    description,
    graph,
    trigger_modes: ["manual", "chat"],
    chat_trigger_phrase: chatPhrase,
  };
  if (existing) {
    store.updateDraft(existing.id, ownerUserId, patch, actor);
    store.publishDefinition(existing.id, ownerUserId, actor);
    return { id: existing.id, action: "updated" };
  }
  const def = store.createDefinition({
    ...patch,
    ownerUserId,
    actor,
    id: forcedId,
  });
  store.publishDefinition(def.id, ownerUserId, actor);
  return { id: def.id, action: "created" };
}

export function seedMakerCheckerWorkflowsForOwner(ownerUserId) {
  const owner = String(ownerUserId || "").trim();
  if (!owner) return { ok: false, skipped: "no owner" };
  const safe = owner.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const results = [];

  const erpMaker = findAgent(owner, "ERP Maker A") || findAgent(owner, "ERP Maker B");
  const erpChecker = findAgent(owner, "ERP Checker");
  if (erpMaker && erpChecker) {
    const graph = buildGraph({
      makerId: erpMaker.id,
      makerName: erpMaker.name,
      checkerId: erpChecker.id,
      checkerName: erpChecker.name,
      kind: "erp",
      chatPhrase: "run erp maker checker",
    });
    results.push({
      kind: "erp",
      ...upsertWorkflow(owner, {
        name: "ERP: draft → check → post",
        description:
          "Optional Maker→Checker protocol for ERPNext drafts and submit gate. Kanban remains source of truth. Chat: run erp maker checker",
        chatPhrase: "run erp maker checker",
        graph,
        forcedId: `erp-mc-${safe}`,
      }),
    });
  }

  const crmMaker = findAgent(owner, "CRM Maker A") || findAgent(owner, "CRM Maker B");
  const crmChecker = findAgent(owner, "CRM Checker");
  if (crmMaker && crmChecker) {
    const graph = buildGraph({
      makerId: crmMaker.id,
      makerName: crmMaker.name,
      checkerId: crmChecker.id,
      checkerName: crmChecker.name,
      kind: "crm",
      chatPhrase: "run crm maker checker",
    });
    results.push({
      kind: "crm",
      ...upsertWorkflow(owner, {
        name: "CRM: high-risk → check",
        description:
          "Optional Maker→Checker for high-risk CRM proposals (Option 1 process gate). Chat: run crm maker checker",
        chatPhrase: "run crm maker checker",
        graph,
        forcedId: `crm-mc-${safe}`,
      }),
    });
  }

  return { ok: true, owner, results };
}

function isDirectRun() {
  try {
    const entry = process.argv[1] ? pathResolve(process.argv[1]) : "";
    return entry && entry === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  config({ path: join(__dirname, "..", ".env") });
  config({ path: join(__dirname, "../../deploy/.env") });
  const { initDb } = await import("../src/db/schema.js");
  initDb();
  const ceos = listTargetCeos();
  let seeded = 0;
  for (const ceo of ceos) {
    const r = seedMakerCheckerWorkflowsForOwner(ceo.id);
    if (r.results?.length) {
      seeded += r.results.length;
      console.log(ceo.id, JSON.stringify(r.results));
    } else {
      console.log(ceo.id, "skip (no prefab Maker/Checker agents)");
    }
  }
  console.log(JSON.stringify({ ok: true, ceos: ceos.length, workflows: seeded }));
}