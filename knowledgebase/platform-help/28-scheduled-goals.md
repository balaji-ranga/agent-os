# Scheduled goals (recurring CEO prompts)

## What it is

A **scheduled goal** is a prompt you write once that Flolah runs automatically on a cadence — every day, weekdays only, or weekly — and delivers to your **COO** or another **AI employee**.

You do **not** open Workflow Builder or type cron expressions. Chat the COO in plain language, or use the **Scheduled goals** page.

Related operator detail (platform timers, retention): [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md).

## Why use it

Examples:

- Every weekday at 09:00, have the COO prepare market insights for blog + LinkedIn + Facebook.
- Every Monday, ask the research agent for a weekly industry digest.
- Daily checklist prompt for ops status (until a fixed end date).

The schedule is **durable**: if you **pause** or **delete** a goal, it stays off after backend restarts. Active goals only fire.

## Where

| Surface | Path | Role |
|---------|------|------|
| **Scheduled goals** page | `/scheduled-goals` | List all goals: agent, schedule, perpetual vs end date, status, last run; create, pause, resume, run now, delete |
| **COO chat** | Home chat or `/agents/balserve/chat` | Create / list / pause / delete / run now in plain language |
| Agent chat | Target employee chat | Automatic runs land as normal chat turns (tagged as scheduled goal) |

## Create via COO (recommended)

1. Chat the **COO**.
2. Say what should happen, how often, and who should own it. Examples:
   - "Every weekday at 9, prepare a fresh market-insights pack for blog, LinkedIn, and Facebook. Do not repeat the same angle."
   - "Daily at 07:30, ask TechResearcher for a short AI news briefing. Perpetual."
   - "Every Monday at 10 for the next three months, and then stop."
3. The COO uses tools (`scheduled_goal_create`, etc.) and confirms in plain English: what, who, when, perpetual or end date.
4. Open **Scheduled goals** anytime to verify the row is **active**.

Optional defaults: target agent = COO; cadence = daily; time = 09:00 (company timezone, usually `PLATFORM_TIMEZONE` / Profile region clock on the server).

## Create / manage on the page

1. Open **Management → Scheduled goals**.
2. **New scheduled goal** — title (optional), prompt, who runs it, cadence (daily / weekdays / weekly), time, optional end date (empty = **Perpetual**).
3. Actions per row:
   - **Pause** — stops automatic runs immediately; status stays **paused** after restart.
   - **Resume** — turns the schedule back on.
   - **Run now** — fires the same prompt immediately (does not wait for the clock).
   - **Delete** — removes the goal permanently from the schedule.

## Cadence and end date

| Field | Meaning |
|-------|---------|
| **Daily** | Once per local day at the set time |
| **Weekdays** | Mon–Fri only at that time |
| **Weekly** | One weekday (Sun=0 … Sat=6) at that time |
| **Ends** | Calendar end date, or **Perpetual** until you pause/delete |
| **Status** | `active` (fires), `paused` (off), `completed` (auto after end date) |

## What the AI employee receives

On each automatic (or Run now) fire, the target employee gets a system packet including:

- Your original prompt
- Goal title, schedule label, perpetual vs end
- CEO / owner scoping so tools stay on your tenant

They should execute autonomously with their tools (and COO may still **delegate** specialty work when the prompt says so). Summaries appear in that employee chat history.

## COO tools (for agents)

| Tool | Use when |
|------|----------|
| `scheduled_goal_create` | CEO wants something always / every day / weekly |
| `scheduled_goal_list` | What schedules do I have? |
| `scheduled_goal_update` | Change prompt, time, agent, pause (status: paused), resume (status: active) |
| `scheduled_goal_delete` | Cancel forever |
| `scheduled_goal_run_now` | Fire immediately |

## Isolation and entitlements

- Goals are **CEO-owner-scoped** (`owner_user_id`). Other CEOs never see your schedules.
- Target agent must be available to your company (or COO).
- Unauthenticated API calls return 401/403.

## Tips

- Prefer one clear durable instruction per goal over vague handle-content requests.
- For social publish approval, say so in the prompt and keep **Policies** / management style in mind.
- Use **Run now** once after create to spot-check wiring.
- Platform operators: cron id `scheduled_goals` (`SCHEDULED_GOALS_CRON`, default every minute dispatcher). Pause goals in the UI — not only Admin Crons — to turn a CEO schedule off.

## Related

- Standups / Kanban day-to-day: [04-kanban-standups-broadcast.md](./04-kanban-standups-broadcast.md)
- Clocks and other platform crons: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md)
- Policies: [10-policies-guardrails.md](./10-policies-guardrails.md)
