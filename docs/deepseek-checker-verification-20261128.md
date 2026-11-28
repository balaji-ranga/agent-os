# Passive DeepSeek checker recovery — 28 November 2026

## Root cause

The configured DeepSeek credential was rejected with HTTP 401 `authentication_error`. The authenticated model catalogue and an isolated synthetic checker completion both failed. This was an authentication failure before plan evaluation, not an insufficient-balance, prompt, timeout or model-compatibility failure. The managed gateway allowed the passive DeepSeek route to fall back to the active OpenAI deployment, explaining successful checker records attributed to OpenAI.

The operator replaced the credential directly in the VPS `.env`; no secret was provided through the development chat. The replacement passed catalogue validation and a no-fallback checker completion. The configured `deepseek-v4-flash` identifier was accepted by the provider and did not require changing.

The scoped reload also uncovered existing deployment drift: the VPS Compose configuration omitted the embedding environment entries required by its LiteLLM config, and an older backend override retained the previous primary credential. The missing entries were restored from the existing versioned Compose configuration. The final backend override uses environment-variable references, so the backend and model gateway load the current key rather than a captured credential value. Secret backups remain private on the VPS.

## Retry correction

The shared completion transport now preserves HTTP status and provider error code on failures. Goal-plan rounds stop on permanent HTTP 401, 402 and 403 failures rather than regenerating the maker plan up to three times. The result remains `GOAL_PLAN_UNVERIFIED`, retains the candidate for review, identifies the failing stage, and records zero business steps executed. Provider error text is not copied into the permanent planning-failure explanation. Transient failures and semantic plan corrections retain their bounded retry behavior.

## Verification

- The goal-plan contract regression passed, including first-round termination on permanent checker failures, retention of the candidate, zero executed business steps and recovery from a transient failure.
- The complete 36-script FloAssist regression suite passed in an isolated container without network access.
- The normal configured maker/checker routes completed a synthetic read-only goal in two calls.
- A separate no-fallback run confirmed OpenAI `gpt-4o-mini` as maker and DeepSeek `deepseek-v4-flash` as checker: 120 maker tokens, 276 checker tokens, 3.161 seconds total. The production goal-plan round controller approved the candidate. No business steps were executed.
- DeepSeek rejected an intentionally incorrect candidate (four invoices instead of three): 68 tokens, 0.44 seconds, no fallback.
- An invalid synthetic credential stopped the live test at the checker after one round: one maker request, one rejected checker request, no repeat maker request, zero business steps executed.
- The corrected key matches the running backend and model gateway configuration. The active OpenAI selection, user model preferences, monthly budgets, recurring schedules and WhatsApp gateway were unchanged. The backend and model gateway were the only application services recreated; the WhatsApp gateway remained healthy and its model-free RPC health check passed.

These are bounded transport and synthetic plan-controller acceptance tests. They do not certify every business workflow, and ordinary configured gateway fallback remains enabled.
