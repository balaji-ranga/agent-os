# Scheduled goals (recurring CEO prompts)

## Quick answers (Platform Help / CEO FAQ)

**What is a scheduled goal?** A prompt you write once that Flolah delivers automatically every day, on weekdays, or weekly to your COO or another AI employee — without Workflow Builder and without typing cron expressions.

**Where do I manage scheduled goals?** Management left nav → **Scheduled goals** at route `/scheduled-goals`. You can also chat the **COO** in plain language.

**How do I schedule a goal with the COO?** Example: Every weekday at 9am, prepare market insights for blog, LinkedIn, and Facebook. Do not repeat the same angle. The COO calls `scheduled_goal_create` and confirms the schedule.

**How do I list my schedules?** Ask the COO "What scheduled goals do I have?" or open `/scheduled-goals`.

**How do I pause or stop a schedule?** On the Scheduled goals page use **Pause** or **Delete**, or ask the COO to pause/delete. **Paused** and **deleted** goals do not fire after backend restarts.

**How do I run a goal right now?** **Run now** on the page, or ask the COO (`scheduled_goal_run_now`).

**Does it survive restarts?** Yes. Status is stored in the database (`active` / `paused` / `completed`). Only **active** goals fire on the platform tick `SCHEDULED_GOALS_CRON` (default every minute).

**Is this the same as Admin Crons?** No. Admin → Crons pauses platform-wide jobs. Scheduled goals are **per-CEO** prompts. Pause goals in `/scheduled-goals` to stop yours.

Related operator clocks: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md).

## What it is

A **scheduled goal** is a durable CEO instruction on a cadence (daily / weekdays / weekly / perpetual or end date). Each fire sends your prompt to the target AI employee as a chat-style run tagged as a scheduled goal.

## Where

| Surface | Path | Role |
|---------|------|------|
| Scheduled goals page | `/scheduled-goals` | List, create, pause, resume, run now, delete |
| COO chat | `/` or `/agents/balserve/chat` | Plain-language create / list / pause / delete / run now |
| Target employee chat | `/agents/:id/chat` | Automatic and Run now replies appear here |

## Create via COO (recommended)

1. Chat the **COO**.
2. Say what should happen, how often, and who should own it.
3. COO tools: `scheduled_goal_create`, `scheduled_goal_list`, `scheduled_goal_update`, `scheduled_goal_delete`, `scheduled_goal_run_now`.
4. Confirm the row is **active** under Management → Scheduled goals.

Defaults when unspecified: target = COO, cadence = daily, time = 09:00 in the platform/company timezone.

## Create on the page

1. **Management → Scheduled goals**.
2. **New scheduled goal** — optional title, prompt text, target AI employee, cadence, local time, optional end date (empty = perpetual).
3. Row actions: Pause, Resume, Run now, Delete.

## Cadence fields

| Field | Meaning |
|-------|---------|
| Daily | Once per local day at `time_local` |
| Weekdays | Monday–Friday only |
| Weekly | One weekday (Sun=0 … Sat=6) |
| Ends | Calendar end date or perpetual |
| Status | `active` fires; `paused` off; `completed` after end date |

## Isolation

Goals are CEO-scoped (`owner_user_id`). Other CEOs never see your schedules. APIs require login (401/403 without access).

## Related

- Platform timers: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md)
- Company first-run: [29-company-setup.md](./29-company-setup.md)
- Kanban / standups: [04-kanban-standups-broadcast.md](./04-kanban-standups-broadcast.md)
