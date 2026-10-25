# FloAssist gaps backlog

Updated: 25 October 2026 (Asia/Singapore).

This backlog records observed gaps, not implemented capabilities. Related scope: [implementation and testing](FLOASSIST-IMPLEMENTATION-AND-TESTING.md).

## FA-GAP-001 — Durable alert determination and re-alert filters

Priority: High. Status: Open.

Observed: two manual priority checks 26 seconds apart alerted on the same Gmail message with different wording. Current delivery deduplication hashes notification text; it cannot reliably identify the same source item across runs. Prompts request meaningful new findings, but there is no durable per-item acknowledgement/resolution lifecycle.

Required behaviour:

- Key alerts by owner, connector account, source item/thread/event, and responsibility. Keep stable source identifiers and minimal state rather than raw email bodies.
- Persist first/last alert, relevant source version, deadline, delivery outcome, acknowledgement, snooze, resolution and the reason for each send/suppression.
- Apply explicit relevance filters: selected connected accounts, user priorities, tracked threads, meaningful changes, quiet hours and delivery preferences. Distinguish verified findings from unavailable sources or duplicate-blocked tool calls.
- Alert once for a new actionable item. Different generated wording must not bypass suppression.
- Distinguish acknowledged from resolved. Reading an email alone does not prove completion. Detect relevant replies or verified source changes; support WhatsApp done, dismiss and snooze commands with clarification when the target is ambiguous.
- Re-alert only on a meaningful change, snooze expiry or configured deadline escalation. Do not repeat hourly solely because an item remains unread or unresolved.
- Make re-alert intervals, escalation windows and limits configurable; define defaults before implementation. Preserve user timezone and quiet-hour rules.
- Claim pending deliveries atomically and reconcile uncertain sends. Concurrent/manual runs and retries must not duplicate the same alert.

Acceptance tests and prerequisites:

- Connected test mailbox and owner-scoped fixtures: repeat the same message across two runs with different summaries; exactly one alert is delivered.
- Two isolated owners/accounts: matching provider IDs never suppress another owner's alert or expose their state.
- Connector change fixtures: a material deadline change triggers one updated alert; unchanged content stays silent.
- Reply/completion fixtures: verified resolution stops escalation; read/unread changes alone do not resolve the task.
- WhatsApp session and controlled clock: done/dismiss/snooze act on the intended alert; snooze and configured escalation fire once at the right local time, respecting quiet hours.
- Delivery test double with timeout/concurrency injection: simultaneous runs do not double-send; uncertain outcomes are reconciled rather than blindly retried.
- Audit view/API: each decision exposes an understandable send/suppress reason without retaining unnecessary source content.

## FA-GAP-002 — Investigate duplicate manual run requests

Priority: Medium. Status: Open.

Two separate manual priority executions were recorded although the user reported clicking Run now once. The origin of the second request is not yet established. Trace UI/API request IDs and retries; add scoped request idempotency and an in-flight guard if missing. Do not infer that the user double-clicked.

Acceptance: one action or transport retry produces one execution; an intentional later run remains possible. Verify both direct and plan modes.

## FA-GAP-003 — Individual reminder administration

Priority: Medium. Status: Open.

Admin Cron controls shared workers, not individual reminder records. WhatsApp supports reminder list/cancel, but there is no dedicated per-reminder Admin reconciliation/retry view.

Acceptance: authorized owner-scoped listing, delivery status and cancellation; uncertain deliveries require reconciliation before retry, with an audit trail. No cross-owner access or automatic replay of sent reminders.

## FA-GAP-004 — Execution mode and direct-run visibility

Priority: High. Status: Delivered 25 October 2026; user UI acceptance pending.

Scheduled goals needs explicit Goal plan / Direct agent selection and run history independent of Goal plans. Goal plan is the default for COO schedules; existing FloAssist direct checks retain their mode. Existing approved plans must be reused without replanning; missing plans may be generated at execution. Retain Generate draft, Amend, feedback and approval controls.

Acceptance: persisted mode, preservation of saved plans on mode switches, direct runs visible with output/status, no planner call for approved saved plans, and unchanged owner isolation. Non-COO agents retain the existing direct-execution restriction.

Validation for FA-GAP-004: 46 platform integration checks and 86 FloAssist core checks passed; frontend production build and its required checks passed. Live FloAssist schedules retained Direct agent mode and prior statuses. Deployed backend/frontend images: `agent-os-backend:scheduled-modes-20261025` and `agent-os-frontend:scheduled-modes-20261025`. Saved-plan execution was verified without a planner request in an isolated fixture.
