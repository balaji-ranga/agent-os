# Scheduled jobs: platform crons, your own schedules, and data retention

Flolah runs work on a clock in two layers:

1. **Platform-level timers** — a fixed set of cron timers inside the backend process. One timer per
   job, per backend process, configured with environment variables by the operator.
2. **Your own (user-level) schedules** — rows you create in the UI (standup time, workflow
   `schedule_cron`, job profile cadence, data retention days). A platform timer wakes up, then loops
   over every enabled CEO and acts on **each user's own settings**.

So the answer to "is the cron per user or per platform?" is: **the timer is per platform, the effect
is per user.** There is no separate OS cron entry per CEO. Nothing from one CEO's tenant leaks into
another's — each pass is owner-scoped (`owner_user_id`).

---

## 1. Platform-level crons (operator-configured)

All keys are **optional** — each has a code default, so a fresh install schedules everything with no
`.env` changes. They are listed commented in `deploy/.env`, `deploy/.env.example` and
`backend/.env.example` for reference (`deploy/scripts/ensure-cron-env.sh` keeps `.env` in sync on
every deploy).

| Env var | Default | What runs on each tick | Per-user behaviour |
|---------|---------|------------------------|--------------------|
| `STANDUP_SCHEDULE_CRON` | `* * * * *` (every minute) | Dispatcher for **user-created standups** | Runs a standup only when its own `scheduled_at` hour:minute matches now, once per day, owner enabled |
| `STANDUP_CRON_SCHEDULE` | *(empty = off)* | Legacy auto-collect standup | Creates one standup per enabled CEO and runs COO collection |
| `DELEGATION_CRON_SCHEDULE` | `* * * * *` | Processes queued COO → agent delegation tasks | Loops CEOs; each pass claims only that CEO's `pending` tasks and posts callbacks to that CEO's standup |
| `AGENT_WORKFLOW_SCHEDULER_CRON` | `* * * * *` | Master tick for **custom agent workflows** | Starts a run only for definitions whose own `schedule_cron` is due, `schedule` trigger enabled, owner scoped |
| `JOB_PIPELINE_CRON_SCHEDULE` | `0 * * * *` (hourly) | Job Applicant pipeline tick | Checks every active job profile's own `workflow_schedule` (hourly/daily/weekly) |
| `COO_STATUS_CHECKER_CRON` | `0 9 * * *` (09:00 daily) | **COO status checker** digest | For each enabled CEO: builds that CEO's Kanban/A2A digest, posts it into their standup chat, **and emails the HTML report** (email only on this batch path) |
| `DATA_RETENTION_CRON` | `15 3 * * *` (03:15 daily) | **Data retention purge** | For each enabled CEO: deletes data older than **that user's** `data_retention_days` (Profile setting) |

Admin operators can **list / pause / resume / Run now** every platform cron under **Admin → Crons** (`/admin/crons`). Pause state persists across restarts.

Times are evaluated in the backend container's timezone (UTC on the VPS unless `TZ` is set).

Not a cron, but worth knowing: a **workflow timeout watchdog** runs on a 30-second interval to reap
workflow steps whose node timeout elapsed (covers restarts and lost timers), and COO delegation also
creates **one-shot OpenClaw Gateway cron jobs** per delegated task — these fire once and disappear,
they are not recurring schedules.

Setting an invalid cron expression disables that job with a warning in the backend log instead of
crashing the process; the startup log prints each active schedule.

---

## 2. User-level schedules (what you control in the UI)

| Where | Setting | Effect |
|-------|---------|--------|
| **Kanban / Standups** → standup | Scheduled time (`scheduled_at`) | Your standup auto-runs daily at that time and delegates outcomes via the COO |
| **Workflows** → editor → trigger | `schedule_cron` + `schedule` trigger mode | Your workflow starts when its cron is due; pause removes it from the registry |
| **Job workflows** → profile | `workflow_schedule` = hourly / daily / weekly | Discovery + pipeline stages run at that cadence |
| **Profile** → Data persistence | `data_retention_days` = 30 / 60 / 90 / 120 / 365 | Nightly purge window for your chats, chat history, standup chats and workflow runs |

Manual equivalents (no waiting for the clock):

- **Dashboard → Run status checker** — builds your report now, pops it up as an HTML page, and posts
  to the standup. Email is sent **only** by the daily batch cron (not by this button).
  COO-entitled (`status_checker` content tool), CEO-scoped.
- **Dashboard → Purge data older than N days** and **Profile → Purge aged data now** — run your own
  retention purge immediately.
- **Kanban / Standups → Run COO** — collect a standup on demand.
- **Workflows → Run** — start any workflow manually regardless of its schedule.

---

## 3. COO status checker (daily CEO report)

What the report covers, for the signed-in CEO only:

- **All open Kanban cards** of any age (open, in progress, awaiting your confirmation)
- **All currently failed cards** of any age — these are the ones that need your attention
- **Completed cards** from the recent window (last 7 days)
- **A2A / workflow sync state** per card: `a2a_task_id`, `workflow_run_id`, pending vs finished
- **Failure reasons**, human-approval waits, and reopen / rework feedback you left on cards

Delivery on each run:

1. **HTML report** — shown in the Dashboard popup when triggered manually (UI button / COO tool).
2. **Standup chat post** — a markdown summary lands in your standup so the thread has the history.
3. **Email** — **only from the daily batch cron** (`COO_STATUS_CHECKER_CRON`). The Dashboard button and the `status_checker` tool/API intentionally do **not** send email, even if `email: true` is passed.

Only a **COO** agent holds the `status_checker` tool grant, and the API resolves the owner from your
session — an agent cannot request another CEO's report.

---

## 4. Data retention purge

Set **Profile → Data persistence** to 30, 60, 90, 120 or 365 days. Every night the retention job
permanently deletes, for your tenant only, anything older than that window:

- Agent chat messages and chat history
- Standup conversations and their messages
- Workflow run instances and their step records

Deletion is permanent — there is no undo and no archive copy. Kanban cards, Master Data documents and
tables, API keys, workflows and agent configuration are **not** touched by retention.

The **Efficiency View → Org** tab shows **Storage (MB)** so you can see the effect: it sums your
chats, standups, workflow runs, Master Data rows and documents, and your OpenClaw tenant workspace
files. Run a purge and the number drops on the next refresh.

---

## 5. Where to check that a job ran

- **Standup chat** — status checker posts its digest there each morning.
- **Bell / notifications** — delegation callbacks and `notify_ceo` pushes.
- **Kanban** — cards move as delegation and workflow ticks progress.
- **Efficiency View → Org** — workflow run success/fail counts and Storage (MB).
- **Backend log** (operator) — every schedule prints on startup, and each job logs a one-line result
  per pass (`[coo-status-checker]`, `[data-retention]`, `[agent-workflow-scheduler]`).
