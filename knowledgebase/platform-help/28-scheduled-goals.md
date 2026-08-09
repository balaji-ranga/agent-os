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

**Does hourly mean every minute?** No. Hourly fires **once per hour** at the chosen minute (`time_local` minutes; the hour part is ignored). Default is on the hour (`:00`). Token cost rises with hourly checks — use for watchers (e.g. price dip notify), not for heavy work.

**Does it survive restarts?** Yes. Status is in the database (`active` / `paused` / `completed`). Only **active** goals fire on the platform tick `SCHEDULED_GOALS_CRON` (default every minute dispatcher).

**Is this the same as Admin Crons?** No. Admin → Crons is platform-wide. Scheduled goals are **per-CEO**.

Related operator clocks: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md).

## What it is

A **scheduled goal** is a durable CEO instruction on a cadence (hourly / daily / weekdays / weekly; perpetual or end date). Each fire sends your prompt to the target AI employee as a chat-style run.

For "alert me when..." market conditions, combine hourly (or weekdays) + tools (web search or quote) + `notify_ceo` only when the condition holds. There is no continuous real-time market feed — polling is intentional.

**Content ops pack:** a **Weekly ops rollup for CEO** goal (Ops Reporter) is not email. Each fire chats Ops Reporter; the agent should call **`notify_ceo`** so you see the summary in the **bell**. Use **Run now** to test. Full path: [30-content-creator-ops.md](./30-content-creator-ops.md).

## Where

| Surface | Path | Role |
|---------|------|------|
| Scheduled goals page | `/scheduled-goals` | Create, **edit**, list, pause, resume, run now, delete |
| COO chat | `/` or `/agents/balserve/chat` | Plain-language create / list / update / pause / delete / run now |
| Target employee chat | `/agents/:id/chat` | Automatic and Run now replies appear here |

## Create via COO (recommended)

1. Chat the **COO**.
2. Say what should happen, how often (hourly / daily / weekdays / weekly), and who should own it.
3. COO tools: `scheduled_goal_create`, `scheduled_goal_list`, `scheduled_goal_update`, `scheduled_goal_delete`, `scheduled_goal_run_now`.
4. Confirm the row is **active** under Management → Scheduled goals.

Defaults when unspecified: target = COO; cadence = daily; time = 09:00 (or `:00` for hourly).

## Create or edit on the page

1. **Management → Scheduled goals**.
2. **New scheduled goal** or row **Edit** — title (optional), prompt, who runs it, cadence, time, optional end date (empty = perpetual).
3. Optional **Enrich with AI** before save.
4. Row actions: Edit, Pause, Resume, Run now, Delete.

## Cadence fields

| Field | Meaning |
|-------|---------|
| **Hourly** | Once every local hour at the minute from `time_local` (e.g. 00:15 → :15 past every hour). At most one automatic fire per hour slot. |
| **Daily** | Once per local day at full `time_local` HH:MM |
| **Weekdays** | Mon–Fri only at that HH:MM |
| **Weekly** | One weekday (Sun=0 … Sat=6) at that HH:MM |
| **Ends** | Calendar end date, or perpetual until pause/delete |
| **Status** | `active` (fires), `paused` (off), `completed` (auto after end date) |

## COO tools

| Tool | Use when |
|------|----------|
| `scheduled_goal_create` | CEO wants something on a repeating schedule |
| `scheduled_goal_list` | What schedules do I have? |
| `scheduled_goal_update` | Edit prompt, cadence, time, agent, pause or resume |
| `scheduled_goal_delete` | Cancel forever |
| `scheduled_goal_run_now` | Fire immediately |

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
