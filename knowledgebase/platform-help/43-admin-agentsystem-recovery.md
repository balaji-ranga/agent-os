# Admin: AgentSystem recovery

**Audience:** platform admins. CEOs do not use this screen.

When Agent Chat **queues then fails**, the AgentSystem gateway lane is usually saturated by feeder work (delegations, goal-plan recovery, scheduled goals, browser tasks) — not a missing Control UI. Admins recover from **Admin → AgentSystem recovery** (`/admin/openclaw-recovery`). There is **no** AgentSystem Control UI link.

## Privileged OTP session

Drain, restart, repair, session reset, and kill-switch are **privileged**. After a successful OTP (authenticator if enrolled, otherwise email), the admin has **30 minutes**. After that a new OTP is required. The same privileged-session manager is used for future admin privileged pages (`ADMIN_PRIVILEGED_SESSION_TTL_MS`, default 1800000).

## What to do

1. Open the page (status is visible before OTP). Pick the CEO whose lane is busy.
2. Unlock with OTP.
3. **Unblock lane** — fails open delegations and looping goal runs, cancels Goal recovery Kanban, pauses scheduled goals, cancels browser tasks, optionally **restarts** the gateway container (needs `docker.sock` via `docker-compose.docker-tools.yml`).
4. If chat is **404 / Unknown model**: **Repair gateway config** (restores AgentSystem gateway + catalog + channel routing). Restart if the catalog was empty.
5. **Heal workspaces + allowlists** if agents reply “No response from AgentSystem.”
6. **Clear chat session** or **Reset native session store** for one CEO + agent when a thread is corrupt.
7. **List / remove gateway crons** for leftover Kanban-watch jobs (this is **not** Admin → Crons).
8. **Disable recovery Kanban** kill-switch if goal-plan failure cards keep re-feeding the lane (overrides `GOAL_PLAN_FAILURE_KANBAN` via platform setting).

Pause platform feeders without OTP from **Admin → Crons** (`delegation_queue`, `scheduled_goals`, `kanban_orphan_watcher`).

Gateway restart needs the Docker tools overlay (socket mounted on backend). Config repair uses the shared AgentSystem volume and does not need the socket.
