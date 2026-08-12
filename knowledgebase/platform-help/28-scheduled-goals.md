# Scheduled goals (recurring CEO prompts)

## Quick answers (Platform Help / CEO FAQ)

**What is a scheduled goal?** A prompt you write once that Flolah delivers automatically on a cadence — **hourly**, daily, weekdays, or weekly — to your **COO** or another **AI employee**, without Workflow Builder or cron expressions.

**Where do I manage scheduled goals?** Management left nav → **Scheduled goals** (`/scheduled-goals`). You can **create, edit, pause, resume, run now, and delete**. Chat the **COO** in plain language for the same actions.

**How do I schedule a goal with the COO?** Examples:
- Every weekday at 9am, prepare market insights for blog and LinkedIn.
- Every hour, check MAGS vs previous close; if down 2% or more, notify me; otherwise stay quiet.

The COO uses `scheduled_goal_create` (and related tools) and confirms the schedule.

**How do I edit a scheduled goal?** On the Scheduled goals page click **Edit**, change prompt/agent/cadence/time/end, and **Save changes**. Or ask the COO to update it (`scheduled_goal_update`).

**How do I list my schedules?** Ask the COO "What scheduled goals do I have?" or open `/scheduled-goals`.

**How do I pause or stop a schedule?** **Pause** or **Delete** on the page, or ask the COO. Paused/deleted goals stay off after backend restarts.

**How do I run a goal right now?** **Run now** on the page, or COO tool `scheduled_goal_run_now`.

**Last run stuck on “running” / no COO reply?** Morning schedules claim `running` then call OpenClaw (or a durable `agent_goal_run`). If OpenClaw hangs or the backend restarts mid-flight, the row can stay `running` with no assistant chat turn. Platform tick now **reconciles** stuck runs (marks `ok` when the linked goal plan finished, or `error` after ~30 minutes with no plan). COO empty replies (“No response from OpenClaw.”) were also caused by stripped runtime tools (`sessions_history` / `read`) — fixed by always merging those into allowlists. Use **Run now** after a heal/deploy if today’s fire never produced a digest.

**Do schedules block each other?** No. Each due scheduled goal is launched **independently in parallel** on the minute tick, with its **own OpenClaw session/context** for that agent (even when several goals target the same COO). A hung digest cannot delay a market report at 9:05, and long-running fires do not hold the cron (so later minutes still fire). Steps *inside* one goal still run in plan order.

**How do multi-intent scheduled goals work?** Creating a schedule from the CEO UI first builds a **draft execution plan** (workflow steps, specialty tasks, notify). Review the step list, then **Amend plan manually** if intent→step mapping is wrong (or **Build plan manually** from empty). Optional regenerate-with-feedback re-plans via LLM. **Save draft**, then **Approve plan & schedule** to make it **active**. Until approved, status is **draft** and tick/Run now are blocked. COO/chat tools default to an approved plan so plain-language schedules still activate immediately.


**COO prompt (critical for specialty steps):** Call gent_goal_create with the CEO multiphase message **verbatim** as prompt. Do not rewrite a hybrid ask down to CRM+ERP only — residual **Platform Help** (and other specialty) language must remain in prompt so plan storage includes specialty_task. The planner also merges explicit Platform Help from the full stored prompt as a safety net.

**Intent classification (goal plans):** The durable plan is built by **catalog + LLM hybrid intent classification** (`goal-plan-intent.js`): (1) **workflows** — match published tenant `chat_trigger_phrase` values present in the goal (order of appearance); (2) **specialty** — residual text vs org AGENTS.md roster (Platform Help etc.); (3) **self tools** — orchestrator tool grants + Tools-registry names/display + LLM multi-label enum (not product CRM/ERP keywords). Lanes: `workflow_trigger`, `specialty_task`, `agent_tool` (self-execute list/email/market data/…), `notify_ceo`, `agent_continue`, or skip (meta create-goal / compliance). Same engine for ad-hoc `agent_goal_create` and scheduled plan-mode. Acceptance: `node scripts/test-goal-plan-intent-classify.mjs` and `node scripts/test-goal-plan-tool-args.mjs` (backend container).

**agent_tool args vs chat (important):** Free-form **chat** fills tool parameters inside the OpenClaw agent loop (same agent model as your COO chat). **Goal-plan data `agent_tool` steps** (market_*, status_checker, list workflows, …) resolve args like chat: (1) heuristics expand baskets (MAG7 / MAGS / Magnificent 7) and tickers; (2) owner-aware LLM fill when still sparse; (3) multi-ticker tools invoked **once per symbol**. **Agent interpretation (generic):** compositional outbound tools such as **`email_send`** that follow data/workflow/specialty steps are rewritten to **`agent_continue`**. When a prior tool already produced **HTML/markdown** (status digest, week digest, …), the **platform sends that artifact once** via `email_send` (correct `html=` + markdown body) and the agent must **not** invent a short plain-text substitute or call `email_send` again. Chat-synthesis goals still run OpenClaw after delivery for a brief confirm. Prompts that say **do not call notify_ceo** skip the notify step.

**Session / memory on scheduled + goal-plan fires:** Standup/delegation prompts historically wrapped OpenClaw turns with “read MEMORY.md / sessions_history; if you already did this today, ask whether to redo.” That **dedupe hint confuses scheduled goals** (and goal-plan `agent_continue`): the COO may reuse an earlier digest narrative or invent a short email instead of executing this fire’s tools. Scheduled + goal-plan paths now use a **fresh-run** wrapper and disable session-history injection. Standup/delegation still use the memory dedupe helper.

**Which LLM?** Plan **intent classification** and **tool-arg fill** use backend `chatCompletions` (`goal_plan_intent` / `goal_plan_tool_args`) — owner BYOK or platform default, optional Tools-menu model override. **`agent_continue` / specialty** use the **OpenClaw agent model** when a free-form turn is still needed. Dry data `agent_tool` HTTP invoke does **not** use the chat tool-loop once args are resolved.

**Failure recovery Kanban:** When a goal plan reaches **failed**, platform creates **one** recovery Kanban + pending delegation for the owning agent (specialty agent if that step failed, else COO). The card body is wrapped `[SYSTEM goal_plan_recovery]` with the **verbatim CEO goal** and a **step ladder** (completed / failed / pending + errors). Rules: **do not** call `agent_goal_create` (no new `agr-…`); finish via normal **Agent Chat tools**. Disable with `GOAL_PLAN_FAILURE_KANBAN=0`. Idempotent via `context_json.failure_recovery_kanban_at`. CEO also still gets the terminal completion chat nudge.

**Specialty vs workflow steps:** Workflow maker-checker phrases become `workflow_trigger` steps (phrases survive plan storage—renormalizing step specs is idempotent). Remaining multi-intent work (research, design, copy, Platform Help how-to, etc.—not limited to two) becomes `specialty_task` steps (parallel when multiple). Explicit “via Platform Help …” is always a specialty step. Plan orchestration leftovers (`notify_ceo`, `agent_goal_create`) are stripped before specialty classification so they cannot erase residual specialists. A single specialty with lettered/numbered parts can expand into multiple sequential specialty steps on the same agent. Hybrid prompts keep both (CRM→ERP plus residual speciality work is not dropped).



## How the plan is derived (mental model)

1. **Workflows (phrase bind)** — Known chat triggers (`run crm maker checker`, `run erp maker checker`, …) become ordered `workflow_trigger` steps so published runs match by phrase.  
2. **Specialty intents (LLM)** — After those phrases are removed, the **residual** text is classified with the CEO’s `AGENTS.md` via intent allocation (LLM). That produces `specialty_task` steps (research, design, Platform Help how-to, …). Lettered lists like `A) … B) …` may be split before classification; plain “and / also” stays one residual for the model.  
3. **Notify** — A final `notify_ceo` step is added if missing.  

Orchestration words (`agent_goal_create`, `notify_ceo`, “include the goal run id”) are **not** specialty work. If the model returns no specialists but residual still asks for Platform Help, a single help specialty is still planned. Do not invent random specialists when the residual is only workflow glue.


**Multi-phase goals (CRM then ERP, multiple workflows, multi-specialty hybrid)?** Ordered workflow phrases or clear CRM→O2C intent plan to durable **`agent_goal_run`** steps (`workflow_trigger`, optional parallel `specialty_task`, `notify_ceo`). Platform advances when each child workflow or specialty-delegation reaches terminal. Ad-hoc COO chat should call **`agent_goal_create`** (returns `goal_run_id` like `agr-…`). If the COO fires **`agent_workflow_trigger`** with multi-workflow language and no plan id, the platform **auto-upgrades** that call into a goal plan. A numeric workflow **`run_id` is not a goal plan** (no Digest ladder / Goal Plan panel). Inspect: **`agent_goal_list`** / **`agent_goal_status`**, Digest, `/goal-plans`. See [38-maker-checker-coordination.md](./38-maker-checker-coordination.md).

<!-- plan-reuse-scheduled -->

## New plan vs reuse (scheduled vs chat)

| Path | Reuse trap? | What is reused |
|------|-------------|----------------|
| **Ad-hoc COO chat** | Yes (LLM) | Session history / MEMORY may quote an old `agr-...` and skip `agent_goal_create` unless the CEO asks for status/continue. Backend create always inserts a **new** row when the tool is called. |
| **Scheduled goal fire (plan mode)** | **No LLM reuse of `agr-...`** | Each tick / Run now calls `createAndStartGoalRun` to a **new** `agr-...` every fire. If the schedule has an **approved** plan, the **step template** (`plan_json`) is reapplied; executions are still new. Cadence dedupe (`already_ran_this_hour` / today) skips a whole fire — not "same agr". |
| **Scheduled goal fire (chat fallback)** | Isolated per fire | Each fire uses a unique `sched-{goal}-{run}` OpenClaw session (not shared with other schedules on the same agent). Prefer approve-plan schedules for multiphase CRM/ERP. |

**Implication:** Daily/hourly multiphase schedules do **not** get stuck on yesterday's `agr-...` in plan mode. Ad-hoc chat still needs new-plan defaulting (COO AGENTS/SOUL). Clearing chat memory is for COO chat tests — not required for scheduled plan-mode fires.


**Does hourly mean every minute?** No. Hourly fires **once per hour** at the chosen minute (`time_local` minutes; the hour part is ignored). Default is on the hour (`:00`). Token cost rises with hourly checks — use for watchers (e.g. price dip notify), not for heavy work.

**Does it survive restarts?** Yes. Status is in the database (`active` / `paused` / `completed`). Only **active** goals fire on the platform tick `SCHEDULED_GOALS_CRON` (default every minute dispatcher).

**Is this the same as Admin Crons?** No. Admin → Crons is platform-wide. Scheduled goals are **per-CEO**.

Related operator clocks: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md).

## What it is

A **scheduled goal** is a durable CEO instruction on a cadence (hourly / daily / weekdays / weekly; perpetual or end date). Each fire either:

1. **Goal plan mode** — when the approved/plan stores workflow or specialty steps (`workflow_trigger` / `specialty_task`), create/start an **`agent_goal_run`** and advance on terminals (L2C, multi-specialty hybrid, multi-step specialty), or  
2. **Chat mode** — single simple continue when the plan is only agent_continue + notify (classic COO turn).

For "alert me when..." market conditions, combine hourly (or weekdays) + tools (web search or quote) + `notify_ceo` only when the condition holds. There is no continuous real-time market feed — polling is intentional.

**Content ops pack:** a **Weekly ops rollup for CEO** goal (Ops Reporter) is not email. Each fire chats Ops Reporter; the agent should call **`notify_ceo`** so you see the summary in the **bell**. Use **Run now** to test. Full path: [30-content-creator-ops.md](./30-content-creator-ops.md).

## Where

| Surface | Path | Role |
|---------|------|------|
| Scheduled goals page | `/scheduled-goals` | Create, **edit**, list, pause, resume, run now, delete |
| COO chat | `/` or `/agents/balserve/chat` | Plain-language create / list / update / pause / delete / run now |
| Target employee chat | `/agents/:id/chat` | Automatic and Run now replies appear here; multi-intent plans show as Goal Plan panel when `agr-…` id is present |
| Digest | `/this-week` | **2** most recent **goal plans** for selected week; **View all plans** → `/goal-plans` for full week list |
| Goal plans page | `/goal-plans` | Paginated week list of `agent_goal_runs` (`from`/`to` or week start/end query) |
| API | `GET /api/agent-goal-runs` (± `from`/`to`) and `GET /api/agent-goal-runs/:id` | CEO owner-scoped list/get of durable plans |

## Create via COO (recommended)

1. Chat the **COO**.
2. Say what should happen, how often (hourly / daily / weekdays / weekly), and who should own it.
3. COO tools: `scheduled_goal_create`, `scheduled_goal_list`, `scheduled_goal_update`, `scheduled_goal_delete`, `scheduled_goal_run_now`.
4. Confirm the row is **active** under Management → Scheduled goals.

Defaults when unspecified: target = COO; cadence = daily; time = 09:00 (or `:00` for hourly).

## Create or edit on the page

1. **Management → Scheduled goals**.
2. **New scheduled goal** or row **Edit** — prompt, agent, cadence/time/ends.
3. **Generate draft plan** → review the step list (this is your dynamic goal workflow: intent → step).
4. If the draft does not match what you meant → **Amend plan manually**:
   - Map each intent to a step type (`workflow_trigger`, `specialty_task`, `agent_continue`, `notify_ceo`, `agent_tool`).
   - Use quick intents (CRM/ERP maker-checker, Platform Help, Notify) or add a custom step; reorder, edit labels/phrases/agents.
   - Or **Build plan manually** without generating first, then baseline steps yourself.
5. Prefer **Amend** for precise changes. Optional **Regenerate with feedback** re-runs the planner and can overwrite manual edits.
6. **Save draft** or **Approve plan & schedule** stores `plan_json` as the baseline for every fire (`amended_manually` when you edited steps in the UI).
7. Optional **Enrich with AI** on the prompt text.
8. Row actions: Edit, Approve plan (draft), Pause, Resume, Run now (active only), Delete.

### Manual plan baseline (goal-plan schema)

Treat the execution plan like a small **dynamic workflow**:

| Step type | Maps to | Typical fields |
|-----------|---------|----------------|
| `workflow_trigger` | Published workflow by chat phrase | `phrase`, optional `phase` (crm_phase / erp_phase / …) |
| `specialty_task` | One specialty AI employee | `agent_id`, `message`, optional `parallel_group` |
| `agent_continue` | Schedule owner agent turn | optional `message` |
| `notify_ceo` | In-app bell when prior steps finish | optional title/body |
| `agent_tool` | Named platform tool on schedule agent | `tool_name` (self-invoked as the plan’s orchestrator agent id so COO-gated tools work like chat) |

Quick intents add common CRM/ERP maker-checker and help steps without writing raw JSON. After approve, each fire replays this step template as a new `agr-…` run.

## Cadence fields

| Field | Meaning |
|-------|---------|
| **Hourly** | Once every local hour at the minute from `time_local` (e.g. 00:15 → :15 past every hour). At most one automatic fire per hour slot. |
| **Daily** | Once per local day at full `time_local` HH:MM |
| **Weekdays** | Mon–Fri only at that HH:MM |
| **Weekly** | One weekday (Sun=0 … Sat=6) at that HH:MM |
| **Ends** | Calendar end date, or perpetual until pause/delete |
| **Status** | `active` (fires), `draft` (plan not approved yet—does not fire), `paused` (off), `completed` (auto after end date) |

## COO tools

| Tool | Use when |
|------|----------|
| `scheduled_goal_create` | CEO wants something on a repeating schedule |
| `scheduled_goal_list` | What schedules do I have? |
| `scheduled_goal_update` | Edit prompt, cadence, time, agent, pause or resume |
| `scheduled_goal_delete` | Cancel forever |
| `scheduled_goal_run_now` | Fire immediately |
| `agent_goal_list` / `agent_goal_status` | Inspect durable multi-intent **goal plans** (steps, child workflow run ids, status). Quote `agr-…` to the CEO so chat shows the Goal Plan panel. |
| `agent_goal_create` | Ad-hoc multi-phase plan from chat (same plan engine as scheduled plan mode). Prefer this over sequential freeform `agent_workflow_trigger` for CRM→ERP. |
| `agent_goal_complete_step` | Complete an `agent_continue` plan step (workflow / specialty steps auto-complete on terminal). |
| Multiphase `agent_workflow_trigger` | When message plans **≥2** workflows (or mentions `agent_goal_create`) and no `goal_run_id`, platform returns **`upgraded_to_goal_plan`** + `agr-…` instead of a single workflow run. |

## Plan API (CEO UI)

| Method | Path | Role |
|--------|------|------|
| POST | `/api/scheduled-goals/plan-preview` | Build draft plan from prompt + optional feedback |
| POST | `/api/scheduled-goals/:id/plan` | Update draft plan / feedback; optional approve |
| POST | `/api/scheduled-goals/:id/plan-approve` | Approve stored plan → active |

Env: `GOAL_PLAN_MAX_SPECIALTY` (default 8) caps specialty intents on a plan (chat one-shot specialty still max 2).

## Isolation

Goals are CEO-scoped (`owner_user_id`). Other CEOs never see your schedules. APIs require login (401/403).

## Tips

- Prefer clear durable instructions; for watches, name the **condition** and when not to notify.
- Hourly + expensive tools can consume tokens — use weekdays or fewer runs when possible.
- **Run now** after create/edit to spot-check.
- Platform operators: cron id `scheduled_goals` (`SCHEDULED_GOALS_CRON`). Pause goals in UI to turn CEO schedules off.

## Home OEI and “goal runs”

Home **Operational Effectiveness (OEI)** counts **scheduled goal runs** in 14 days from run history (each automatic fire and **Run now** when recorded). It does **not** report “1 forever” for a single daily goal. See [36-operational-effectiveness.md](./36-operational-effectiveness.md). Daily COO **status checker** email is a separate platform cron ([19](./19-scheduled-jobs-and-crons.md)).

## Related

- Platform timers: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md)
- OEI: [36-operational-effectiveness.md](./36-operational-effectiveness.md)
- Company first-run: [29-company-setup.md](./29-company-setup.md)
- Content ops rollup / publish: [30-content-creator-ops.md](./30-content-creator-ops.md)
- Kanban / standups / bell: [04-kanban-standups-broadcast.md](./04-kanban-standups-broadcast.md)

## Regression / e2e

Ad-hoc multiphase L2C + Platform Help + notify:

```bash
cd backend && npm run test:e2e:goal-plan
# full pack (VPS): bash deploy/scripts/vps-regression-full.sh
```

See `tests/REGRESSION.md` and `knowledgebase/TESTING.md`.



<!-- async-goal-ack -->

**Ad-hoc chat vs scheduled (duplicate workflow runs):** CEO chat auto-match will **not** free-fire a single maker-checker when the message contains **two or more** published chat phrases (CRM + ERP phrases). That prevents an unbound ERP run racing ahead of a durable goal plan. Multiphase ad-hoc asks must use `agent_goal_create` (COO) or multiphase `agent_workflow_trigger` upgrade. Scheduled plan-mode fires never use CEO chat phrase matching.

**Async ack (major goals):** `agent_goal_create` returns immediately with `async:true`, `goal_run_id` (`agr-...`), and plan steps. The COO should quote the plan and end the turn; platform advances remaining steps when each child workflow/specialty reaches terminal (runner plus watch callbacks). Status callbacks and CEO notifications name the **goal plan id + title** when bound (not only workflow run numbers).

**Completion chat nudge (once):** when a goal plan reaches **completed** or **failed**, the platform runs a **once-only** completion watcher (`nudgeCooOnGoalPlanTerminal`, idempotent via `context_json.coo_completion_nudge_at`). It posts a final **assistant** chat turn on the orchestrator (ladder summary; optional short COO LLM wording with timeout fallback) and reinforces a CEO **bell** notification with chat deep-link. The CEO should not need to re-enquire for plan status after finish. Env: `GOAL_PLAN_COO_COMPLETION_NUDGE` (default on), `GOAL_PLAN_COO_NUDGE_TIMEOUT_MS`. Operator control: **Admin → Crons** → `goal_plan_completion_nudge` (pause kill-switch / Run now backfill / schedule `GOAL_PLAN_COMPLETION_NUDGE_CRON`). Open chat also soft-polls history while an `agr-…` id is visible so the completion bubble appears without refresh.
