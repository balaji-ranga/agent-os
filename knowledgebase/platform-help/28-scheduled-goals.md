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

**How do multi-intent scheduled goals work?** Creating a schedule from the CEO UI first builds a **draft execution plan** (workflow steps, specialty tasks for N specialist intents, notify). You can regenerate with feedback, **Save draft**, then **Approve plan & schedule** to make it **active**. Until approved, status is **draft** and tick/Run now are blocked. COO/chat tools default to an approved plan so plain-language schedules still activate immediately.

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
| **Scheduled goal fire (chat fallback)** | Possible (LLM) | If the fire does not use durable plan mode, OpenClaw chat uses a stable `sched-...` session; MEMORY/session reuse heuristics can apply. Prefer approve-plan schedules for multiphase CRM/ERP. |

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
3. **Generate draft plan** → review steps → optional feedback/regenerate → **Save draft** or **Approve plan & schedule**.
4. Optional **Enrich with AI** on the prompt text.
5. Row actions: Edit, Approve plan (draft), Pause, Resume, Run now (active only), Delete.

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

**Async ack (major goals):** `agent_goal_create` returns immediately with `async:true`, `goal_run_id` (`agr-...`), and plan steps. The COO should quote the plan and end the turn; platform advances remaining steps when each child workflow/specialty reaches terminal (runner plus watch callbacks). Status callbacks and CEO notifications name the **goal plan id + title** when bound (not only workflow run numbers).
