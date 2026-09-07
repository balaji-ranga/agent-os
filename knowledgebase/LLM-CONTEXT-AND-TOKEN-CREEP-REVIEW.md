# LLM Context and Token Creep Review

## Scope and metering contract

Flolah records attributable model calls in `token_usage`. Provider-reported input and output tokens are preferred; otherwise the row is marked as estimated. These records power Efficiency → LLMOps, budgets, and estimated cost. They are operational telemetry and are not a provider invoice.

The context controls below preserve this contract. They reduce redundant input before the model call and add metadata-only warnings for oversized prompts; they do not suppress successful usage records or log prompt content.

## Safe controls implemented

- Model context now selects the newest bounded chat turns and returns them in chronological order. UI history pagination remains unchanged.
- Router capability descriptions are transmitted once in a shared catalogue. Each agent references capability names, preserving the complete routing evidence without repeating the same descriptions for every roster member.
- Router adjudication no longer sends both parsed and raw copies of a valid candidate decision. Raw output remains available when parsing fails.
- Feedback-learning comments, Kanban notes, and topic focus are bounded before entering a prompt.
- Direct platform LLM calls and OpenClaw gateway calls emit a rate-limited warning at `LLM_CONTEXT_WARN_CHARS` (default 80,000 characters). The warning contains counts, roles, source, tool, and agent identifiers only—never prompt text.
- Repeated agent reconciliation no longer rewrites an unchanged `agent-tool-allowlists.json`, avoiding unnecessary OpenClaw reload work.
- The OpenClaw container health check now fails until `/health` responds instead of reporting success while the gateway port is unavailable.
- `npm run audit:token-context -- 7` reports token totals by source, the largest metered calls, and the largest stored chat sessions. It is read-only.

## Changes requiring explicit design approval

The following may save more tokens or memory but can alter behavior, continuity, or recovery guarantees and were not implemented:

- Remove explicit conversation history from internal/delegated calls that also use stable OpenClaw sessions. This could break delegated-task and channel continuity.
- Remove `sessions_history` or memory instructions from standup, delegation, workspace, and blueprint templates. These instructions overlap in places but are also part of established agent behavior and governance.
- Reduce router/adjudicator output limits. Earlier providers have consumed the available JSON budget with hidden reasoning, so a lower cap can cause invalid route contracts.
- Centrally truncate planner, goal-plan, workflow, or RAG evidence. A generic cap could discard user constraints or proof required for validation.
- Narrow the COO tool allowlist or switch to lazy tool exposure. This changes the platform capability contract and requires tool-by-tool regression tests.
- Split the shared OpenClaw gateway into per-tenant processes. This is an architectural isolation change, not an operational patch.
- Apply a Node heap ceiling or Docker memory limit to OpenClaw. Without workload sizing this converts future growth into OOM kills and interrupted chats; use only as an approved safety fuse with restart and queue recovery tests.

## Verification

From `backend/`:

```bash
npm run test:chat-work-units
npm run test:router-contract
npm run test:openclaw-config-noop
npm run audit:token-context -- 7
```

For production, also validate `docker compose config --quiet`, wait for both backend and OpenClaw to become healthy, inspect recent logs for `[llm-context] oversized prompt`, and compare Efficiency → LLMOps usage before and after representative agent chats.
