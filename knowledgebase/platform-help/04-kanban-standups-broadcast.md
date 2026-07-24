# Kanban, standups, Broadcast, notifications

## Kanban (`/kanban`)

Board of tasks by agent and status — shared for agent work, workflow steps, and pipeline tasks.

- Open a card for detail, **task chat**, artifacts, and workflow run links.
- Tasks appear when the COO delegates specialty work, when you create tasks, or when workflows / pipelines create step tasks.
- **CEO Approval** workflow nodes (and similar awaiting-confirmation cards) pause here until you approve or reject (with optional comment).
- Reopen a task if work must continue. After reopen, the next agent reply moves the card to **in_progress**. Cards in **awaiting confirmation** stay there until **you** confirm — the agent will not auto-advance them.
- **Agents own card status** for research/build work: they move to `in_progress` when they start, `awaiting_confirmation` when they need you, `completed` only after a real deliverable, or `failed` only when they could not produce the main deliverable at all. Optional side steps (e.g. saving to a missing Master Data table, notify, email) must **not** flip a good deliverable to `failed`.
- Short clarification Q&A on an already-open card may auto-complete; longer research/implementation stays **in_progress** until the agent finishes the deliverable (or you close it).
- Kanban task chat with an assigned agent is also mirrored into that agent’s **Dashboard chat** (tagged `[Kanban #id]`) so you can see the same exchange there. OpenClaw still keeps a per-task session for isolation.
- Job profile setup and pipeline runs live under **Job profiles** / **Job workflows** — Kanban itself stays a generic task board.
- Dashboard chat alone: agents should **not** invent Kanban cards unless you asked to track the work.

## Standups (on Dashboard)

1. **Create standup** for a check-in thread with the COO.
2. Chat in the standup; ask the COO to collect updates or delegate.
3. Use **Get work from team** / **Run COO summary** when available.
4. Watch the **bell** for delegated agent replies.
5. Daily standups can also run on a schedule when your admin configures standup cron.

Standups are **owner-scoped** — only your CEO’s standups appear.

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

## COO specialty routing

When you chat with the COO:

- Specialty asks match agent **purposes** from org docs (not crude keywords only).
- Clear **multi-intent** asks (e.g. recipe **and** deep research) can route to **up to two** specialists, each with a split task + Kanban card.
- The COO starts Kanban card(s) and tracks work.
- COO-native asks (list/trigger workflows, Kanban tools, standups, simple email via `email_send`) stay with the COO.
- Product how-to can be answered by **Platform Help** or via Master Data RAG (`master_data_rag`).
- “Have **X** reach / contact / notify me” → COO hands off to **X**; **X** rings your bell (not the COO).
