# Kanban, standups, Broadcast, notifications

## Kanban (`/kanban`)

Board of tasks by agent and status — shared for agent work, workflow steps, and pipeline tasks.

- Open a card for detail, **task chat**, artifacts, and workflow run links.
- Tasks appear when the COO delegates specialty work, when you create tasks, or when workflows / pipelines create step tasks.
- **CEO Approval** workflow nodes (and similar awaiting-confirmation cards) pause here until you approve or reject (with optional comment).
- Reopen a task if work must continue. After reopen, the next agent reply moves the card to **in_progress**. Cards in **awaiting confirmation** stay there until **you** confirm — the agent will not auto-advance them. COO/tool-created cards (including assigned ones) start as **open**; the assigned agent moves them to awaiting confirmation only when they need your input.
- **Agents own card status** for research/build work: they move to `in_progress` when they start, `awaiting_confirmation` when they need you, `completed` only after a real deliverable, or `failed` only when they could not produce the main deliverable at all. Optional side steps (e.g. saving to a missing Master Data table, notify, email) must **not** flip a good deliverable to `failed`. If an agent only posts “marked completed” with no answer, the platform keeps the card **in progress** and **auto-retries the same agent once** (you do not need to nudge).
- Short clarification Q&A on an already-open card may auto-complete; longer research/implementation stays **in_progress** until the agent finishes the deliverable (or you close it).
- Kanban task chat with an assigned agent is also mirrored into that agent’s **Dashboard chat** (tagged `[Kanban #id]`) so you can see the same exchange there. OpenClaw still keeps a per-task session for isolation.
- **Archiving an agent chat never empties a card.** The card's **Activity** tab reads the linked agent-chat turns straight from chat history, so work done in a chat that was later archived still shows (each turn is tagged `archived` with the archived chat's title). When a card genuinely has no delegation exchange, task chat, or linked chat, Activity says so instead of rendering blank.
- **COO tool `kanban_get_task`:** returns the same content the board shows — status, description, task messages, **`deliverable` / `delegation_response`**, and agent-chat turns — so the COO can summarize what a completed card produced without guessing from the title.
- **All dates on the board and in cards use the platform timezone** (`PLATFORM_TIMEZONE`, else the server `TZ`) — never raw UTC. The board header shows which zone is in effect, e.g. "Times in Asia/Singapore".
- Board filters: **All** (default — every card of any age), Daily, Weekly, Monthly, or a custom date range. **status_checker / COO status reports always count All** (open / awaiting / in progress / failed of any age). If you delete only what Weekly shows, older awaiting/failed cards still appear in the status report — switch to **All** before Select all → Delete.
- **Orphan watcher** (every 5 minutes, also on the delegation cron and when you run status checker): if a specialty card is stuck `in_progress` because the agent run died mid-`processing` (e.g. after a restart), or the linked run is missing/failed transiently, the platform re-pends or reinitiates the same ask with that agent (capped retries). **Assigned `open` cards** (including ones you **Reopen** or drag back to Open after a completed run) are re-queued with the assigned agent — Reopen/drag-to-Open starts work immediately; the watcher also picks open cards without waiting the usual 3-minute cool-off. CEO-approval cards (`awaiting_confirmation`) and budget blocks are **not** auto-retried — those wait on you (Reopen / Approve). **External / A2A leaf cards** are reconciled the same pass: Kanban moves to **completed** or **failed** from the A2A task / workflow run status (so a successful ops desk invoke no longer stays in progress forever).
- Job profile setup and pipeline runs live under **Job profiles** / **Job workflows** — Kanban itself stays a generic task board.
- Dashboard chat alone: agents should **not** invent Kanban cards unless you asked to track the work.

## Standups (on Dashboard)

1. **Create standup** for a check-in thread with the COO.
2. Chat in the standup; ask the COO to collect updates or delegate.
3. Use **Get work from team** / **Run COO summary** when available.
4. Use **Run status checker** to open a CEO status report popup (awaiting you, failed, in progress, open, recent completions) and post the digest into standup chat. Counts include **every** open/failed card of any age (Kanban **All** view) — not only the Weekly filter. The HTML email is sent only by the daily batch cron — not from this button or the COO tool.
5. Watch the **bell** for delegated agent replies.
6. Daily standups can also run on a schedule when your admin configures standup cron.

Standups are **owner-scoped** — only your CEO’s standups appear.

## Data retention (Dashboard + Profile)

- Set **Data persistence** on **Profile** to 30 / 60 / 90 / 120 / 365 days (**default 90**).
- After that window, agent chat turns, standup **messages**, and workflow run/step records are **permanently deleted** (Kanban cards, Master Data and API keys are untouched).
- A daily retention job runs automatically; you can also **Purge** from the Dashboard or Profile.
- Schedules, defaults, and what each job touches: [19-scheduled-jobs-and-crons.md](./19-scheduled-jobs-and-crons.md).

## Broadcast (`/broadcast`)

1. Write a message for multiple agents (status check, announcement).
2. Optionally ask each agent to **notify you** when finished (bell).
3. Review results in each agent chat and in the bell.
4. COO is often excluded by default so you do not spam the coordinator.

## Notifications (bell)

Sources include:

- Agents calling **`notify_ceo`**
- Standup / delegation completion items
- Platform alerts (including some Kanban create events)

Actions: hover for full text, open linked chat/Kanban, clear/dismiss. Clear/dismiss keeps the shared feed tidy across platform + agent items.

### When agents should (and should not) ring the bell

Specialists follow shared ops rules (`AGENT-OS-OPS.md`):

| Do notify | Do **not** notify |
|-----------|-------------------|
| You explicitly asked to be reached / notified / pinged (including “notify me when done”) | Ordinary replies in the Dashboard chat you already have open |
| A true blocker while you are **not** in that agent’s chat | Finished a normal research/recipe answer in the same thread with no “notify me” |
| You (or the COO) asked a **specialist** to contact you — **that specialist** calls `notify_ceo` with a link to **their** chat | The **COO** notifying on behalf of a specialist (COO should hand off so the specialist notifies) |
| | Spam / every tiny status tweak — one clear notify per ask |

Creating a Kanban card may also raise a platform bell. Status moves alone do **not** replace `notify_ceo` when you asked to be reached.

**Ops Reporter / scheduled rollups** use `notify_ceo` → **bell only**. They do **not** send email unless you separately grant and prompt `email_send` with SMTP configured. See [30-content-creator-ops.md](./30-content-creator-ops.md).

## COO specialty routing

When you chat with the COO (web Agent Chat):

- Specialty asks match agent **purposes** from org docs (intent classification — not crude keywords only).
- Clear **multi-intent** asks (e.g. recipe **and** deep research) can route to **up to two** specialists, each with a split task + Kanban card.
- The COO starts Kanban card(s) and tracks work.
- Before hard-delegating, the platform checks **intent against COO content tools**. Org / Kanban / A2A **status updates**, status reports, and “run status checker” style asks stay with the COO (`status_checker`) — they are not handed to an ops/specialist leaf.
- Other COO-native asks (list/trigger workflows, Kanban tools, standups, simple email via `email_send`) also stay with the COO.
- Product how-to can be answered by **Platform Help** or via Master Data RAG (`master_data_rag`).
- “Have **X** reach / contact / notify me” → COO hands off to **X**; **X** rings your bell (not the COO).

WhatsApp (and other OpenClaw channels) already go straight to the COO agent, so the same tools apply without the web hard-delegation step.
