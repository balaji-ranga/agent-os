# CRM & ERP Maker/Checker coordination (Option 1)

## Purpose

Keep **risk control** without hard CRM tool locks (v1). ERP already has a **hard submit gate** (only ERP Checker may `erp_submit_doc` / `erp_cancel_doc`). CRM high-risk work uses **Kanban as the case file**; optional workflows **automate** the runbook.

**Org sync** (`crm_sync_org` / `erp_sync_org`) is **optional** directory bootstrap (Flolah departments + AI employees → CRM people / ERP departments). Skip unless you need that roster in the desk.

## Roles

| Role | ERP | CRM (Twenty or ERPNext Sales) |
|------|-----|-------------------------------|
| **Maker A/B** | Draft create/update (quotes, invoices, stock, …). **Never submit/cancel.** For ≥5% discount / policy gates signal `needs_ceo` in end JSON — **do not** invent free-form CEO Kanban. | Day-to-day pipeline create/update. High-risk / discount → `needs_ceo` or Checker Kanban; never free-form CEO HITL cards. |
| **Checker** | Review drafts; **only role with submit/cancel**. Kanban approve or reject with findings. | Review high-risk CRM proposals; reject with findings or approve Maker to apply / confirm quality. |
| **COO** | List/get/report (read-only entitled tools). Create/route Kanban; **async** `agent_workflow_trigger` (confirm run_id, end turn — no blocking poll). No submit. | Same |
| **CEO** | Policy, exceptions; resume **workflow CEO Approval** Kanban Approve/Reject (not free-form “Approved” comments). Desk SSO when preferred | Same |
| **Platform Help** | Product how-to from RAG only — never live books | Same → ask COO/CRM/ERP agents for data |

## Kanban protocol (control plane)

One **card per business object** (e.g. doctype + name, or CRM opportunity id) for **Checker** handoff.

1. **Maker** drafts (ERP tools / CRM tools).  
2. Ready for gate → **`kanban_create_task`** assigned to **Checker**  
   - Title: `[ERP] Submit SI-…` or `[CRM] Review high-risk …`  
   - Description: object id, summary, risks, draft evidence.  
3. **Checker** reviews with list/get tools.  
   - **Approve ERP:** `erp_submit_doc` / cancel as needed; move card completed.  
   - **Reject:** comment `FINDING: …`; reassign or create card for **Maker**.  
4. **Maker** fixes → reassign Checker.  
5. **Max ~3** reject cycles → `notify_ceo` / reassign COO.

**CEO policy HITL (e.g. 5% discount):** Only via the Maker/Checker **workflow CEO Approval node**. Maker ends with  
`{"decision":"needs_ceo","gate":"discount_5pct",...}` → runner creates an `awaiting_confirmation` card (`created_by=agent_workflow_ceo`). CEO uses board **Approve/Reject**. Free-form chat “Approved” on inventend Kanban **does not** resume runs.

High-risk CRM examples (process gate): stage **Won** over a large amount; merge/delete company; bulk stage change; “create ERP customer + quotation from this opp”.

Low-risk CRM: notes, early-stage updates — Maker may finish without Checker.

## Optional workflow templates

**Source in git (clean redeploy):** `backend/src/services/company-blueprints/standard/` — agent packs + full CRM/ERP graph JSON next to industry `packs/`. Lean platform employees (COO / Workflow Builder / Platform Help) are catalogued in `platform-agents.json`; IBKR seed scripts in `trading/ibkr-workflows-manifest.json`.

When Profile **CRM** or **ERP** is set to a platform provider, Flolah **creates Maker/Checker AI employees for that CEO** and **publishes** the matching workflow under `crm-mc-*` / `erp-mc-*`.

Published per company after Business Core prefab agents exist:

| Workflow | Chat phrase (example) | What it does |
|----------|----------------------|--------------|
| **ERP: draft → CEO gate → check → post** | `run erp maker checker` | Maker drafts; if Maker signals `needs_ceo`, **ceo_approval** node blocks for CEO; then Checker reviews/submits; 1 fix cycle on reject. |
| **CRM: draft → CEO gate → check** | `run crm maker checker` | Same shape for CRM high-risk / commercial gates (no ERP submit). |

### COO multi-phase goals (plan → execute)


> 

<!-- async-goal-ack -->

### New plan vs reuse (ad-hoc vs scheduled)

- **Chat:** each new multiphase CEO ask → new `agent_goal_create` / new `agr-...` unless the CEO says status/continue on a named plan. Session history can tempt the COO to reuse; SOUL/AGENTS require create by default.
- **Scheduled (plan mode):** each fire → new `agr-...` via platform `createAndStartGoalRun`; approved `plan_json` is only the **step template**. Not the chat reuse trap.


**Async ack (major goals):** `agent_goal_create` returns immediately with `async:true`, `goal_run_id` (`agr-...`), and plan steps. The COO should quote the plan and end the turn; platform advances remaining steps when each child workflow/specialty reaches terminal (runner plus watch callbacks). Status callbacks and CEO notifications name the **goal plan id + title** when bound (not only workflow run numbers).

**Workflow run vs goal plan:** an `agent_workflow_trigger` **run_id** (integer) is only a single agent-workflow execution. Durable multi-phase tracking (Digest, Goal Plan panel, step ladder) requires **`agent_goal_create`** → **`goal_run_id`** (`agr-…`). If the COO triggers multi-phase CRM+ERP language without an agr- id, the platform may auto-upgrade that trigger into a goal plan.

Multi-intent goals (CRM then ERP O2C, or any multi-workflow chain) use a **durable goal plan** (`agent_goal_runs` / `agent_goal_steps`), not ad-hoc chat memory:

1. **Plan** — `agent_goal_create` (or scheduled goal fire) builds ordered steps from the CEO prompt (phrases like `run crm maker checker` / `run erp maker checker`, or explicit `steps[]`).
2. **Execute** — Platform starts the first open step. `workflow_trigger` steps call `agent_workflow_trigger` async and bind the child `run_id`.
3. **Advance** — On workflow **terminal**, platform completes that step and starts the next (generic for any owner/agent; not BrightBox-only).
4. **CEO HITL** — Still only via workflow **CEO Approval** nodes between maker and checker.

**Step kinds:** `workflow_trigger` (published WF by chat phrase—must keep the exact phrase when the plan is saved), `specialty_task` (residual multi-intent / Platform Help / research), `agent_continue` (wake the goal’s owning agent once), `notify_ceo`. Specialty makers/checkers for CRM/ERP run **inside** child workflows; plan-level `specialty_task` is for residual specialists outside those graphs.

**Inspect a plan:** CEO API `GET /api/agent-goal-runs` and `GET /api/agent-goal-runs/:id` (login, owner-scoped). COO tools **`agent_goal_list`** / **`agent_goal_status`**. **Chat** shows a live Goal Plan panel when the assistant mentions `agr-…` or tools `agent_goal_*`. **Scheduled goals → Last plan** expands step progress + workflow run links. **Digest** shows the **2** most recent goal plans for the selected week; **View all plans** lists every plan in that week (`/goal-plans?offset=`).

COO `agent_workflow_trigger` alone remains for **single-workflow** fires. Optional bind: `goal_run_id` + `step_id` when executing a plan step.

`agent_workflow_trigger` returns **immediately** (`async: true`, `run_id`, or **`upgraded_to_goal_plan` + `goal_run_id`** when multiphase language is upgraded). COO **must** confirm the real id to the CEO (`agr-…` for plans, integer `run_id` only for single workflows) and end the chat turn. Platform still notifies on **CEO wait** and **terminal**. Do **not** re-chain freeform ERP `agent_workflow_trigger` after CRM unless you are on a goal plan path.

Tools are granted to COO/Workflow Builder allowlists and registered in the OpenClaw content-tools plugin contracts (`agent_goal_*`).

Workflows **complement** Kanban: schedule, batch, max loops, audit trail. They do **not** replace the board as source of truth for “who owns SI-42.”

Max reject rounds in-graph: **1 fix cycle** then escalate CEO (keep cost bounded). Hand-driven Kanban still allows longer back-and-forth.

## COO readonly

COO may call company-scoped **list/get/report** CRM and ERP tools (and optional org sync). COO **must not** create invoices/submit books. Use Kanban or workflows to hand off to Maker/Checker.

## What Option 2 would add later

Hard-deny high-risk CRM write tools on Makers (Checker-only apply). Ship only if Option 1 is skipped in practice.

## Related

- Business Core setup: [32-business-core-crm-erp.md](./32-business-core-crm-erp.md)  
- Workflow certify analogy: [13-workflow-autonomous-certify.md](./13-workflow-autonomous-certify.md)  
- Tier A product help excerpts: [39-erpnext-help-tier-a.md](./39-erpnext-help-tier-a.md), [40-twenty-crm-help-tier-a.md](./40-twenty-crm-help-tier-a.md)

## Multi-specialty hybrid goal plans

In addition to CRM/ERP maker-checker workflow steps, residual speciality work in the same goal (research, design, copy, multi-step same agent, **more than two intents**) becomes `specialty_task` steps. Hybrid goals keep workflows **and** speciality residue. Parallel specialty steps share a `parallel_group` and advance when all group members finish. Scheduled goals store the plan as draft until CEO approve (CEO UI); COO tools auto-approve. See [28-scheduled-goals.md](./28-scheduled-goals.md).

## Regression

CEO multiphase chat does not auto-start a single workflow when both CRM and ERP phrases appear (avoids unbound ERP before plan CRM). Adhoc CRM then ERP + Platform Help specialty + `notify_ceo`: `cd backend && npm run test:e2e:goal-plan` (also full pack `tests/regression-full.js`). See help **28** and `tests/REGRESSION.md`.
