# Kanban, standups, Broadcast, notifications

## Kanban (`/kanban`)

Board of tasks by agent and status — shared for agent work, workflow steps, and pipeline tasks.

- Open a card for detail, **task chat**, artifacts, and workflow run links.
- Tasks appear when the COO delegates specialty work, when you create tasks, or when workflows / pipelines create step tasks.
- **CEO Approval** workflow nodes (and similar awaiting-confirmation cards) pause here until you approve or reject (with optional comment).
- Reopen a task if work must continue. After reopen, the next agent reply moves the card to **in_progress** (delegated or direct-assign). Cards in **awaiting confirmation** stay there until you confirm — the agent will not auto-advance them.
- Job profile setup and pipeline runs live under **Job profiles** / **Job workflows** — Kanban itself stays a generic task board.

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
- Platform alerts

Actions: hover for full text, open linked chat/Kanban, clear/dismiss. Clear/dismiss keeps the shared feed tidy across platform + agent items.

## COO specialty routing

When you chat with the COO:

- Specialty asks match agent **purposes** from org docs (not crude keywords only).
- The COO starts a Kanban card and tracks work.
- COO-native asks (list/trigger workflows, Kanban tools, standups, simple email via `email_send`) stay with the COO.
- Product how-to can be answered by **Platform Help** or via Master Data RAG (`master_data_rag`).
