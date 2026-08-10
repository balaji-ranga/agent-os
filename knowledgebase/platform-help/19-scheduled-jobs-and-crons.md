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
| `COO_STATUS_CHECKER_CRON` | `0 9 * * *` (09:00 daily) | **COO status checker** digest | For each enabled CEO: builds that CEO's Kanban/A2A digest, posts it into their standup chat, **and emails the HTML report** (email only on this batch path). Counts are **all ages** (same as Kanban **All** view — not the Weekly filter). |
| `DATA_RETENTION_CRON` | `15 3 * * *` (03:15 daily) | **Data retention purge** | For each enabled CEO: deletes data older than **that user's** `data_retention_days` (Profile setting) |
| `KANBAN_ORPHAN_WATCHER_CRON` | `*/5 * * * *` (every 5 min) | **Kanban orphan watcher** | Re-pends specialty delegations stuck in `processing` (after OpenClaw fetch timeout + ~60s, or `DELEGATION_SPECIALTY_PROCESSING_TIMEOUT_MS`), requeues status-only cards, reinitiates orphan `open`/`in_progress`/`failed` specialty cards, then **immediately kicks the pending delegation worker** so Admin "Run now" does not wait for the minute cron. Caps retries via `KANBAN_ORPHAN_MAX_RETRIES`. |
| `SCHEDULED_GOALS_CRON` | `* * * * *` (every minute) | **Scheduled goals** dispatcher | For each enabled CEO: fires **active** scheduled prompts to the chosen AI employee when local `time_local` matches. **Paused** / **deleted** goals never fire (DB status only — survives restarts). |
| `CRM_TLS_WORKSPACE_CERT_CRON` | `40 * * * *` (hourly) | **CRM workspace TLS SANs** | Compares ACTIVE Twenty workspace hosts (`{sub}.crm.*`) to the LE fullchain. **No-op** when all are already on the cert. If any SAN is missing (and public DNS resolves to the VPS), runs `vps-ensure-crm-workspace-dns-cert` → brief nginx stop for TLS-ALPN expand. Same job can **Run now** under **Admin → Crons** (`crm_tls_workspace_certs`). New workspace create also **debounces** this after ~45s (`CRM_TLS_WORKSPACE_CERT_AUTO=0` turns that off; `CRM_TLS_WORKSPACE_CERT_CRON=off` disables the schedule). Prerequisite: DNS A `*.crm.<apex>` (or per-workspace) → VPS. Manual UI: **Admin → TLS certs**. |

Admin operators can **list / pause / resume / Run now** every platform cron under **Admin → Crons** (`/admin/crons`). Pause state persists across restarts.

**Timezones.** Cron expressions are evaluated in the backend container's clock timezone (`TZ`, UTC
when unset). Dates *shown to you* (Kanban cards and task chat, status reports) use
`PLATFORM_TIMEZONE` when set, otherwise `TZ` — so the UI never displays raw UTC. On this deployment
both are `Asia/Singapore`.

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
| **Scheduled goals** (`/scheduled-goals`) | Active goal + cadence | Saves a CEO prompt that auto-fires to an AI employee (**hourly** / daily / weekdays / weekly). Create and **edit** in UI or COO chat. Pause/delete off across restarts. Full guide: [28-scheduled-goals.md](./28-scheduled-goals.md) |
| **Workflows** → editor → trigger | `schedule_cron` + `schedule` trigger mode | Your workflow starts when its cron is due; pause removes it from the registry |
| **Job workflows** → profile | `workflow_schedule` = hourly / daily / weekly | Discovery + pipeline stages run at that cadence |
| **Profile** → Data persistence | `data_retention_days` = 30 / 60 / 90 / 120 / 365 (**default 90**) | Nightly purge window for your chat turns, standup messages and workflow runs |

Manual equivalents (no waiting for the clock):

- **Scheduled goals → Run now** — fire a saved goal immediately (or ask the COO).
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

Set **Profile → Data persistence** to 30, 60, 90, 120 or 365 days (**default 90** if you never
changed it). Every night the retention job permanently deletes, for your tenant only, anything
older than that window:

- Agent chat turns (`chat_turns`) — the chat history itself
- Standup **messages** (the standup records stay; their aged messages go)
- Workflow run instances and their step records
- **Content Explorer media** — aged **uploaded** files under `inbound/attachments/` (and the workflow-fs mirror) and aged **generated** files under `media/generated/<you>/` (by file mtime; hard delete from disk)

Deletion is permanent — there is no undo and no archive copy. Kanban cards, Master Data documents and
tables, API keys, workflows and agent configuration are **not** touched by retention (Master Data
has its own purge). Manual deletes: [26-content-explorer.md](./26-content-explorer.md).

The **Efficiency View → Org** tab shows **Storage (MB)** so you can see the effect: it sums your
chats, standups, workflow runs, Master Data **document files**, **per-tenant OpenSearch RAG indices**
(meta + search/vectors), Content Explorer media, OpenClaw tenant workspace files (including inbound
uploads), and `media/generated/<you>/`. Click the **i** next to Storage (MB) for a component
breakdown. Run a purge and the number drops on the next refresh (RAG index size drops only after
Master Data document delete / purge, not retention purge alone).

---

## 5. Where to check that a job ran

- **Standup chat** — status checker posts its digest there each morning.
- **Bell / notifications** — delegation callbacks and `notify_ceo` pushes.
- **Kanban** — cards move as delegation and workflow ticks progress.
- **Efficiency View → Org** — workflow run success/fail counts and Storage (MB).
- **Backend log** (operator) — every schedule prints on startup, and each job logs a one-line result
  per pass (`[coo-status-checker]`, `[data-retention]`, `[agent-workflow-scheduler]`).
