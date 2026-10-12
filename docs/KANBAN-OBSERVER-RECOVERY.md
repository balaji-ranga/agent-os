# Kanban observer recovery

The observer covers only `in_progress` and `awaiting_confirmation` cards. It never revisits completed cards. A completed delegation means the turn ended, not that the task was fulfilled.

## Deadlines and model routing

Admin Models → Efficiency controls exposes `observer_timeout_ms` (default 30,000 ms; supported range 100–120,000 ms). Local inference also obeys the shorter `local_timeout_ms`. The observer retains existing owner-scoped efficiency, user BYOK, platform defaults and permitted hosted fallback. No new provider or paid entitlement is required. Capacity and the per-pass semantic-review limit remain bounded.

## Two distinct retry budgets

The company's Exception Policy `retry_limit` governs both budgets, but the counters are independent:

- Missing deliverables: system feedback and up to `retry_limit` agent re-nudges after the original attempt. Then await user confirmation.
- Semantic uncertainty: an initial review plus up to `retry_limit` additional reviews of the same objective/answer/evidence. Recheck no sooner than five minutes. Then await user confirmation with `observer_review_retry_limit`. Do not blindly replay agent actions.

Default `retry_limit=1` therefore permits two semantic reviews total, or one agent recovery retry. New evidence starts a fresh semantic budget; metadata-only changes do not. An authenticated user reply or explicit resume resets the review budget. Confirmation does not expand scope, approve protected actions or waive evidence requirements.

Timeouts, unavailable providers and malformed responses are technical failures, not semantic rejection. They retain the code-only result, do not increment the semantic/agent retry counters, are retried with a five-minute backoff, and do not stop other tasks. The 90% completion confidence requirement is unchanged.

## Evidence, scope and display

Observer state/audit store bounded sanitized model, fallback, confidence, reason, exact evidence excerpt and correlated receipt references. Historical reviews cannot recover scores/reasons that were never recorded. Ownership and execution correlation are required before tool receipts or access denials are considered; agent-supplied delegation IDs are not trusted evidence.

Tool authentication—not agent text—selects the owner. Kanban reads reject missing/foreign IDs identically before loading task content. Required correlated access denials stop recovery with a precise system blocker; they do not authorize impersonation or repeated attempts. All runtime role packs receive the default company/workspace scope policy while preserving custom identity.

Kanban and Live Operations expose display-only execution activity. Inactive in-progress cards show verification/recovery pending instead of claiming the agent is running. This does not force-complete or restart them.

## Local verification

Run from `backend/`:

- `npm run test:observer-uncertainty`
- `npm run test:kanban-task-observer`
- `npm run test:observer-recovery-completion`
- `npm run test:efficiency-controls`
- `npm run test:security:tenant-tools`

Then run `npm run build` from `frontend/`. Harnesses use disposable databases, mock providers and loopback HTTP; they do not modify VPS cards or call real paid models. Existing images package these source/templates; no extra container, dependency, secret or Docker topology change is needed. Deployment remains a separate authorized step.
