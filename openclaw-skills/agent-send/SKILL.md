---
name: agent-send
description: Send messages to other OpenClaw agents and read their session history (sessions_list, sessions_history, sessions_send).
metadata:
  {
    "openclaw": { "emoji": "📤" }
  }
---

# Agent-send skill

Use this skill to communicate with other agents in the same OpenClaw gateway.

## When to use

- **COO (BalServe)**: Delegate tasks to TechResearcher or ExpenseManager; send instructions and wait for replies.
- **Any agent**: Send a message to another agent’s session, read another session’s history, or list active sessions.

## Tools

- **sessions_list** — List active sessions. Parameters: `messageLimit` (0 = no messages), `activeMinutes`, `limit`, `kinds`. Use to discover other agents’ session keys.
- **sessions_history** — Read the transcript of one session. Parameters: `sessionKey` (required), `includeTools`, `limit`. Use when you need context from another agent’s conversation.
- **sessions_send** — Send a message into another session. Parameters: `sessionKey` (required), `message` (required), `timeoutSeconds` (0 = fire-and-forget; >0 = wait for reply). Use to delegate work or ask another agent a question.

## Session keys

- **Always use the full format:** `agent::<agentId>:main`. The gateway requires this exact format; passing only the agent id (e.g. `techresearcher`) will fail with "No session found".
- **Multi-CEO / tenant deployments:** Use **tenant runtime ids** from COO `AGENTS.md` / `ORG.md`, e.g. `agent::t-ceo-bala--socialasstant:main` — **not** bare `agent::socialasstant:main`. Tenant keys scope tools (e.g. **notify_ceo**) to the correct CEO.
- **Legacy single-tenant examples:** `agent::techresearcher:main`, `agent::expensemanager:main`, `agent::balserve:main` (lowercase agent id).
- **Your own session:** Use `agent::<your agent id>:main` with your id in lowercase.
- Get exact keys from `sessions_list` or the COO org session-key table when present.

## Guidelines

- **Delegated agents (TechResearcher, ExpenseManager, SocialAssistant):** Do not use sessions_send to delegate or forward the user's request. You execute the task yourself; use sessions_send only for narrow cases (e.g. asking another agent for a specific fact), not for passing the request along. The COO delegates; you respond.
- When COO asks a delegatee to **notify_ceo**, include `[ceo_user_id: …]` in the message and use that agent's **tenant session key**.
- Prefer `sessions_send` with `timeoutSeconds > 0` when you need a reply from the other agent.
- Use `timeoutSeconds: 0` for fire-and-forget notifications.
- Use `sessions_history` only when you need prior context; avoid unnecessary reads.
