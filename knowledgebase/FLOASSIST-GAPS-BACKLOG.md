# FloAssist gaps backlog

Updated: 27 October 2026 (Asia/Singapore).

This backlog records observed gaps, not implemented capabilities. Related scope: [implementation and testing](FLOASSIST-IMPLEMENTATION-AND-TESTING.md).

## 25 October evening validation update

The first live multi-module test failed experience acceptance: overlapping tasks, stale thread interpretation and individual low-context messages. Successful transport was not successful semantic validation. Do not treat the earlier green run statuses as proof of coverage.

The revised implementation requires distinct responsibilities: Priority identifies urgent/high-impact action now; Deadlines identifies explicit dated commitments; Follow-up identifies unanswered outgoing requests after a default 48-hour wait or an explicit elapsed reply deadline. Gmail observations require a current complete thread read, and follow-up verifies the latest message is outgoing. Earlier messages superseded by replies must not become separate follow-up tasks. Calendar appointments are excluded from automatic mail tracking.

Verified findings now carry thread context, next action and why an alert is needed. Stable source/obligation identity is shared across responsibilities. Default delivery groups up to six task findings after a five-minute collection window, with bold headings and task references. Unchanged findings have a shared 24-hour reminder interval; verified deadline changes or crossing the deadline can escalate sooner. This supersedes the earlier requirement below to repeat every open task at every check. Completion, stop, snooze and quiet hours still apply.

Delivery status as of this update:

- FA-GAP-001/010: contextual rendering, current-thread checks, shared cooldown and grouping implemented; controlled live semantic retest in progress. Legacy ambiguous provenance requires explicit reconciliation, never title-based bulk closure.
- FA-GAP-002: durable owner/request idempotency, running-work guard and UI action guard implemented and harness tested.
- FA-GAP-003: owner-scoped reminder/delivery administration and audited uncertain-send reconciliation implemented; UI inspected. Cross-owner admin management remains out of scope of this panel.
- FA-GAP-005: trusted FloAssist scope enforced in connector execution/retries and propagated to supported workflow/delegation paths. Comprehensive alternate/native/MCP path validation remains open.
- FA-GAP-006: Microsoft Calendar action catalogue dependency still unavailable.
- FA-GAP-007: silent productivity/ICS substitution blocked in FloAssist scope. Explicit approved ICS fallback routing remains open.
- FA-GAP-008: selected Drive/OneDrive quota monitoring implemented; 90% threshold, silent normal/recovery, 88% reset, two-percentage-point worsening or 24-hour reminder. Storage-full error ingestion and broader provider coverage remain open.
- FA-GAP-009: verified WhatsApp provenance and conservative explicit-urgency inclusion implemented; richer priority/deadline metadata and live ad hoc task acceptance remain open.

Validation: isolated Linux harnesses passed 65 backlog, 57 platform, 86 core, 68 tracking and 46 connector-health checks; frontend build passed. Tests cover owner separation, current-thread incoming-reply suppression, module exclusions, grouping, cooldown, storage and delivery reconciliation. Live WhatsApp content acceptance is separate from these harness results. Existing schedules remain paused during controlled retesting, and temporary quiet-hour changes must be restored.

## Active completion scope — 27 October 2026

User-approved scope: **FA-GAP-011 → FA-GAP-005, plus FA-GAP-001**. Complete source-content reliability, execution-level connector isolation, and the Kanban-backed alert lifecycle together. Deploy only affected services/assets; no full deployment. Keep recurring schedules paused and restore quiet hours after any approved live test.

FA-GAP-001 implementation in progress adds owner-configurable normal/overdue intervals, pre-deadline escalation, per-task daily limits, per-app intervals/muting, and an owner-visible decision history. Kanban remains authoritative for completion. The closure endpoint independently re-reads the exact stored mail source: verified deletion may close only a FloAssist-created task; access errors cannot close it, and a present source with uncertain external fulfillment requests clarification. Similar titles and linked user tasks are never sufficient closure evidence.

Local validation: full FloAssist regression suite and real-browser onboarding/preferences harness passed, including the new source-reader and alert-lifecycle tests. VPS rollout and live acceptance of this revision remain pending; these results do not claim production completion.

## FA-GAP-001 — Durable alert determination and re-alert filters

Priority: High. Status: Kanban-backed lifecycle delivered 25 October 2026; broader automatic escalation/filter configuration remains open.

Implemented scope: verified priority/deadline/follow-up findings link to owner-assigned Kanban tasks using stable account/source/obligation identity across responsibilities. Existing tasks can be linked, including completed tasks. Native user-confirmed Kanban completion is authoritative for subsequent scans and pending delivery. The tracking list includes closed records and pagination independently of source filters. Acknowledgement, timed snooze, verified deadline changes and one-time clarification after an uncertain direct source check have durable metadata and audit reasons. Scheduled replies for these three responsibilities cannot bypass the task notification queue. Uncertain sends are not automatically replayed. Quiet hours, pause, selected-source preferences and owner isolation remain enforced.

Validation: tracking harness 36 checks; platform harness 54 checks including actual Kanban user-action completion/audit and direct-schedule prompt compatibility. VPS isolated image harnesses passed. Live synthetic completed task #17291 suppressed priority and deadline observations with zero notifications. See implementation/testing notes for deployment and native-runtime verification.

Delivered follow-up: matching open obligations can alert once per validated owner schedule run; explicit stop/resume and origin-protected mail orphan closure with exact stored account/source/obligation and recorded provider evidence. Linked tasks are excluded from orphan closure. Source evidence interpretation is agent-mediated, not independently fetched by the closure endpoint.

Remaining scope: configurable automatic escalation rules beyond explicit snooze and verified deadline changes; richer per-source relevance settings and a dedicated notification-reconciliation UI. Source interpretation, correlation of ambiguous legacy tasks and deciding whether provider evidence proves completion remain agent work; the tools enforce persisted task state, identity-based suppression and delivery claims. Old conversation-only acknowledgements cannot safely be bulk-migrated without identifying their source/task. Existing source/action authorization policies still apply; internal tracking writes require the effective write policy to permit them.

Observed: two manual priority checks 26 seconds apart alerted on the same Gmail message with different wording. Current delivery deduplication hashes notification text; it cannot reliably identify the same source item across runs. Prompts request meaningful new findings, but there is no durable per-item acknowledgement/resolution lifecycle.

Required behaviour:

- Key alerts by owner, connector account, source item/thread/event, and responsibility. Keep stable source identifiers and minimal state rather than raw email bodies.
- Persist first/last alert, relevant source version, deadline, delivery outcome, acknowledgement, snooze, resolution and the reason for each send/suppression.
- Apply explicit relevance filters: selected connected accounts, user priorities, tracked threads, meaningful changes, quiet hours and delivery preferences. Distinguish verified findings from unavailable sources or duplicate-blocked tool calls.
- Alert once for a new actionable item. Different generated wording must not bypass suppression.
- Distinguish acknowledged from resolved. Reading an email alone does not prove completion. Detect relevant replies or verified source changes; support WhatsApp done, dismiss and snooze commands with clarification when the target is ambiguous.
- Updated user policy (25 October): re-alert on each scheduled check when the exact source still matches an open tracked obligation. Deduplicate tool retries within a run and outstanding deliveries. Explicit stop tracking, completion and snooze suppress alerts; acknowledgement alone does not.
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

## FA-GAP-005 — Enforce selected connector access during execution

Priority: High. Status: Open.

Observed: the inspected COO has no connector-action allowlist and therefore retains legacy broad connector execution access. FloAssist's selected-app preferences guide prompts and schedule eligibility, but do not enforce an app restriction at connector execution. If Gmail and Outlook are connected under the same owner, selecting only Gmail in FloAssist does not itself block Outlook actions. Owner-specific credentials and connection-alias checks are separate existing controls; this finding is not evidence of cross-owner mailbox access.

Required behaviour:

- Enforce FloAssist's selected apps at execution time using trusted owner and work-context identity, not model-supplied claims or prompt compliance.
- Intersect the selected apps with authorized owner connections, agent/action grants, provider scopes and effective action policy. Selection must never grant new credentials or override a denial.
- Propagate the restriction through delegated agents, scheduled runs, retries and equivalent connector entry points. Unknown or missing authorization context must not silently broaden access.
- Preserve the existing COO's separately authorized non-FloAssist work. Avoid changing shared agent grants globally to implement one user's preferences.
- Apply selection changes to subsequent actions and record clear denial reasons without leaking connection secrets or another owner's data.

Acceptance tests and prerequisites:

- Owner with test Gmail and Outlook connections: select Gmail only; Gmail reads succeed when permitted, while Outlook reads and writes are rejected before provider execution, even if explicitly requested in a tool payload.
- Delegated-agent and scheduled-run fixtures: the same restriction survives delegation, retry and alternate connector routes; caller-supplied owner/app/context fields cannot bypass it.
- Two isolated owners using the same agent template: each owner's selections and credentials remain independent; cross-owner connection substitution is denied.
- Policy fixtures: selecting an app does not override Advisory restrictions, prohibited actions, revoked authorization or missing agent grants.
- Change selection during a workflow: subsequent actions against the removed app are denied. Adding an app permits only actions otherwise authorized.
- Existing non-FloAssist COO workflow: unrelated authorized connector use remains functional, with no global grant mutation.


## FA-GAP-006 — Microsoft Calendar active health probe

Priority: Medium. Status: Open; dependency unavailable.

Active probes cover Gmail, Outlook Mail, Google Calendar, Google Drive and OneDrive. The installed Microsoft Calendar catalogue currently contains no actions. Add/enable the actual connector, inspect its read-only action schema and configure a minimal safe probe. Until then, report unsupported health checking rather than implying verified connectivity. Validate owner isolation, permissions, revoked-token detection and recovery with a test Microsoft Calendar account.

## FA-GAP-007 — Enforce connector priority and explicit calendar fallback

Priority: High. Status: Partially delivered; connector routing enforced, explicit ICS fallback pending.

Observed: COO used the separate productivity calendar tools and ICS subscriptions despite a connected Google Calendar, then incorrectly described a missing productivity binding as a disconnected OAuth connector. The updated FloAssist skill prefers the selected provider connector, and a fresh COO read succeeded. This preference is not yet a backend-enforced routing rule and can be undermined by stale conversational context.

Required behaviour:

- Resolve the explicitly requested app/account first, within the owner's selected and authorized sources. Otherwise use the relevant selected connector; clarify ambiguity when multiple accounts or providers could satisfy the request. Do not impose a blanket Google-over-Microsoft priority.
- Discover and execute the actual provider action and schema. A missing productivity binding must not be interpreted as missing OAuth authorization or trigger silent ICS substitution.
- Use ICS only when explicitly requested or approved as a fallback. Identify it as a read-only mirror and expose source freshness and coverage limitations. A scheduled run without approved fallback must report the blocked source rather than silently switching.
- Report actual provider failures, such as disabled API, insufficient scope or expired authorization. Refresh connection state before claiming an app is disconnected; old conversation summaries must not override current evidence.
- Enforce the same source resolution in WhatsApp, direct scheduled goals, goal-plan steps, delegation and retries. Record the selected account, route, fallback consent and failure reason in owner-scoped execution history.
- Routing must respect FA-GAP-005 execution restrictions, agent grants and action policy. Preserve explicitly configured ICS workflows and unrelated non-FloAssist COO work.

Acceptance tests and prerequisites:

- Owner with connected Google Calendar and an ICS fixture: a Google Calendar request executes the Google connector, even when productivity bindings are absent and stale conversation history claims it is disconnected.
- Google and Microsoft calendar fixtures with multiple accounts: explicit account selection wins; ambiguous requests require clarification instead of arbitrary provider selection.
- Provider error fixtures: disabled API, revoked token and insufficient scopes produce accurate errors with no silent account/provider/ICS fallback.
- Explicit ICS request and approved fallback fixtures: reads use only the approved source and clearly label mirror freshness and partial coverage; no calendar writes are attempted through ICS.
- WhatsApp, direct-run, goal-plan and delegated-run fixtures: the same routing decision and authorization checks apply after retries and selection changes.
- Two isolated owners and existing ICS workflows: source credentials, consent and audit records remain owner-scoped; existing authorized workflows are unchanged.

## FA-GAP-008 — Source storage capacity in priority alerts

Priority: High. Status: Partially delivered; quota reads implemented, provider-error coverage remains open. Scope: FloAssist priority alerts.

Monitor storage usage and quota-related failures for the owner's selected, authorized connectors. Warn at 90% or more of the actual allocated storage; do not assume a fixed allowance such as 100 GB.

Required behaviour:

- Discover provider-supported read-only quota actions and required scopes. Read used and allocated bytes, account identity and measurement time; calculate utilization only when a valid finite quota is available.
- Group services sharing the same verified storage pool (for example Gmail and Drive for the same Google account) into one owner-scoped alert. Do not combine different accounts or assume all services share a quota.
- Alert at utilization >=90%, and on provider storage-full/quota errors that block email receipt, uploads or saving even if a quota percentage cannot be obtained. Distinguish storage exhaustion from API rate limits and request quotas.
- Keep normal readings and recovery silent. Persist the incident and delivery state; suppress duplicate observations within a run or shared pool. Re-alert on worsening utilization or a configured unresolved-incident reminder interval, respecting quiet hours and pause/stop settings. Define worsening thresholds, reminder defaults and reset/hysteresis rules before implementation.
- State the affected account/source, used versus allocated storage, percentage, observed impact and suggested next action. Suggestions must not perform cleanup; deletion and other mutations remain subject to existing user authorization and action policy.
- If quota data is unsupported, unavailable, unlimited or missing, show coverage limitations in status/run history rather than claiming healthy storage or inventing a percentage. Deduplicate actionable monitoring failures and coordinate them with connector-health alerts.
- Retain minimal owner-scoped quota/incident metadata and traceable send/suppress decisions. Use existing notification delivery safeguards; do not modify another owner's sources or unrelated scheduled goals.

Acceptance tests and classified prerequisites:

- **Unit/contract fixtures (no live provider):** below 90%, exactly 90%, above 90%, full, zero/missing/unlimited allocation, large byte counts and stale readings. No normal/recovery success alerts; invalid quotas never produce fabricated percentages.
- **Provider integration prerequisites:** selected OAuth-connected Google account and OneDrive/other supported test accounts, enabled provider APIs, confirmed quota-action schemas and sufficient read scopes. Verify actual allocation and distinguish supported quota reads from unavailable coverage; do not fill a real account to test the threshold.
- **Isolation/shared-pool fixtures:** Gmail and Drive referencing the same verified account/pool produce one incident; different pools/accounts and two owners remain separate. Deselected or unauthorized connectors are not read.
- **Failure fixtures:** storage-full responses raise an exception without a quota reading; rate limiting is not mislabeled as storage exhaustion. Revoked grants, insufficient scopes and unsupported actions report accurate limitations without duplicate connector-health alerts.
- **Delivery prerequisites:** fake sender and controlled clock for repeat suppression, worsening usage, configured reminder intervals, recovery/reset, concurrent runs, quiet hours, paused profiles and uncertain delivery. Live WhatsApp testing requires an explicitly authorized test incident.
- **Policy/regression fixtures:** monitoring performs read-only actions under the effective policy; cleanup suggestions never trigger deletion. Existing priority email/task alerts, connector-health checks and unrelated scheduled goals retain their behavior.

## FA-GAP-009 — WhatsApp ad hoc Kanban tasks in priority reporting

Priority: High. Status: Partially delivered; provenance and explicit urgency implemented, richer priority metadata pending.

Include the owner's ad hoc tasks requested through WhatsApp and stored by the COO in Kanban in priority evaluation, even when there is no email or other connector source.

Required behaviour:

- Persist explicit WhatsApp-to-COO provenance, owner, originating request/session reference and canonical Kanban task ID. Do not infer origin or ownership from similar titles.
- Evaluate eligible open tasks using priority relevance, urgency, deadlines and user instructions. An open task is a candidate, not automatically urgent. Respect completion, explicit stop tracking, snooze, quiet hours and paused FloAssist status.
- Reuse canonical tasks and existing lifecycle metadata across sessions and scheduled runs. Include qualifying tasks outside connector search filters; coordinate overlapping priority, deadline and follow-up checks to avoid duplicate notifications for the same finding.
- Keep WhatsApp-origin tasks separate from connector-origin tasks. Missing/deleted email and connector orphan-closure logic must never auto-close a WhatsApp-origin task.
- Record inclusion, suppression and delivery decisions with task and scheduled-run references. Preserve owner isolation, existing action policy and unrelated COO/Kanban workflows.

Acceptance tests and classified prerequisites:

- **Task/provenance fixtures:** owner-scoped WhatsApp-origin tasks, connector-origin tasks and unrelated tasks with identical titles; include only eligible owner tasks and never duplicate or misclassify provenance.
- **Priority/lifecycle fixtures:** urgent versus nonurgent, dated versus undated, open/completed, stopped and snoozed tasks; verify expected inclusion and suppression, including after a new WhatsApp session.
- **Scheduling/delivery fixtures:** controlled clock and fake sender for quiet hours, pause, retries and overlapping priority/deadline/follow-up runs; verify coordinated delivery and audit reasons.
- **Integration prerequisites:** authenticated WhatsApp-to-COO channel, durable request-to-Kanban linkage and enabled Priority alerts. Create an authorized test task through WhatsApp, confirm it is considered in a run, then complete/stop it and verify suppression. Email deletion must leave it unchanged.

## FA-GAP-010 — Identify the responsible module in WhatsApp notifications

Priority: Medium. Status: Labels, context and grouped delivery implemented; live semantic acceptance pending.

Clearly identify which handler or scheduled responsibility produced each FloAssist WhatsApp notification, such as `FloAssist · Priority alerts`, `FloAssist · Follow-ups` or `FloAssist · Deadline tracking`.

Required behaviour:

- Derive the user-facing label from trusted execution/notification metadata for the actual responsible handler, not guessed message content or all categories associated with a task.
- Apply labels consistently to task findings, clarification messages and applicable connector-health/storage exceptions, plus other proactive responsibilities such as briefing and calendar conflicts. Distinguish ad hoc task responses from scheduled checks.
- Preserve task references and concise actionable content. Keep internal goal/run IDs in traceability history rather than exposing them in the WhatsApp message.
- When multiple checks identify the same finding, coordinate one notification with truthful origin attribution and retained history references. Labels must not change source identity or bypass deduplication.

Acceptance tests and classified prerequisites:

- **Rendering/metadata fixtures:** each responsibility, ad hoc replies and missing/legacy metadata; correct labels or an honest generic FloAssist fallback, without invented origin or internal run IDs.
- **Lifecycle/concurrency fixtures:** one task shared by priority/deadlines/follow-ups, retries, snooze and clarification; retain task reference, avoid duplicate sends and attribute the actual producer.
- **Integration prerequisites:** enabled test responsibilities, persisted notification-origin metadata and fake delivery for harness checks; an authorized WhatsApp test verifies readable labels and correlation to run history. Existing non-FloAssist messages remain unchanged.

## 26 October production-readiness checkpoint

Deadline Tracking remains under acceptance testing. Model-generated source-ID errors persisted despite valid Gmail/Drive reads. Backend revision b0b37c4f now supplies short run-scoped source references and resolves canonical provider IDs server-side; freshness/full-thread checks remain mandatory. Full local and isolated VPS regression suites pass. Repeat live validation of this latest fix is pending a quiet-hours test window. Four other responsibilities passed earlier controlled live runs, but this does not close broad provider, semantic-accuracy or handset-acceptance gaps. See the dated implementation/testing checkpoint for run IDs and deployed versions. Do not mark FloAssist production ready or resume schedules based on harness results alone.

### Final recovery retest, 26 October 23:05 SGT

The blocking repeat-Deadline regression passed twice on revision d40388f6 after requiring source-check evidence in the scheduled reconciliation schema. All five responsibilities passed live with zero unresolved verification errors, and native COO chat passed a synthetic probe. See the implementation/testing record for run IDs. User confirmed earlier notification content and requested formatting improvements, now deployed. This supersedes the earlier failed-run checkpoint for the repaired execution paths; broader provider, semantic and rollout acceptance gaps remain open. Recurring schedules remain paused.

## FA-GAP-011 — Verified source content and native read reliability

Priority: Critical. Status: partly repaired, live production acceptance open (27 October).

Ensure task provenance survives every Kanban/COO read; do not describe Drive media as email/calendar. Metadata, filenames, snippets and created/modified timestamps must not independently become deadlines. Unknown actions and invalid IDs must be reported as tool failures, not invented privacy restrictions or successful reads. A successful chat reply is not proof that the requested source content was retrieved.

Delivered in e9dc3b9d / 672a420e: structured owner-scoped task provenance, mandatory native routing guidance, native error signaling, bounded Drive deadline discovery and exact transient Gmail passage/date checks. The erroneous video-derived January task was paused and its unsupported due date removed with an audit note.

Open acceptance:
- Native WhatsApp consistently discovers valid actions and reads complete requested content using real provider IDs, including follow-up turns and new sessions.
- Provider-specific full-content verification for Outlook, Drive and OneDrive; the current new deadline verifier supports Gmail only and fails closed for other sources.
- Broader date-language/timezone parsing, explicitly confirmed old obligations, and meaningful clarification for unsupported or ambiguous sources.
- No notification can imply successful content verification from a listing or failed tool result.

Test prerequisites: synthetic metadata/body/invalid-ID fixtures for harness tests; authorized owner connections and token-bounded reads for live tests; original source retained; configured COO model and native WhatsApp tool path; notification testing only in an approved window with quiet hours restored. Preserve stopped/completed tasks, owner isolation and existing action policies. Current recurring schedules remain paused.

27 October live retest: native full Gmail retrieval now has tool-record proof (one nonempty body), and task provenance was correctly reported as Drive in a fresh session. One invalid action was attempted before recovery; native consistency and broad provider-content acceptance remain open. Runtime extension integrity and health checks pass. Quiet hours and five paused schedules were preserved.


### 27 October 2026 — lifecycle completion acceptance
Implemented configurable task_alert_max_days (5 successful distinct owner-local delivery days, 0 unlimited), due_soon_hours (72), include_due_this_month, briefing_overdue_high_priority and discovery_lookback_days (7). Delivery-day records survive notification cleanup, group delivery counts each task once per day, and the delivery gate rechecks the cap. Quieting never completes a task and ad hoc lists retain it. Source-backed priority/rationale is retained with the canonical task, explicit owner priority is locked against scans, and old dates alone do not confer high priority. New follow-up candidates with latest messages outside the configured window are excluded; existing tracked sources are reconciled separately. Current-month priority remains subject to verified deadline evidence and thread state.
Local acceptance: complete FloAssist harness and 26 browser/HTTP checks passed. New lifecycle fixtures cover timezone month boundaries, red/orange/green thresholds, successful-day idempotence, five-day cap precedence over changed deadlines and Briefing, durable retention, explicit priority override and completed-task delivery cancellation. VPS acceptance remains pending until recorded below; this entry does not close the blocker gaps.


### Company Tools management — 27 October
Added FloAssist with Connections, WhatsApp, Reminders & deliveries and Preferences submenus. Signed-in owners use their existing Flolah identity; registration email/phone is not asked again. Management uses the existing FloAssist connector and QR services and the existing audited reminders/delivery controls. New management endpoints require authenticated owner access; caller-supplied owner fields cannot select another account. Responsive synthetic Chrome tests cover all four panes at 1280/390px, OAuth popup continuity and QR polling. Preference changes now preserve explicitly paused schedules; only explicit activation resumes enabled responsibilities.
Current live acceptance before the management release: repeated native draft requests passed twice in one session (9.7s and 6.9s; verified bodies, zero errors); Priority sgr-95824e755ee9434a, Follow-up sgr-c3aaef5a7b3547cb, Conflicts sgr-86884060de6c465d and Briefing sgr-cdd25bdce3a1402b passed with zero unresolved tool errors. Deadline sgr-863b540f3c28484a failed because stale task dates and invented excerpts were submitted without fresh reading. The next fix bounds scheduled task listing, supplies identity/lifecycle only, and offers at most one read-only reassessment per source/run for missing deadline evidence. Rejected mutations remain unapplied. Final acceptance is still pending; do not mark blockers closed on the basis of these four green runs alone.


### Final bounded-reader and loop acceptance — 27 October
The four non-Deadline checks passed again on management release 931fbbe2: Priority sgr-6c72867e9e5d42ad, Follow-up sgr-a340c679eccd4549, Conflicts sgr-7fc16398384944d9, Briefing sgr-9c70544786ca45be. Deadline sgr-3d5f2645d99c499e had one remaining size-limit failure. Private VPS metadata inspection measured the affected Drive text at 237,905 characters (242,861 bytes); no document contents were emitted to the development chat.
The next reader revision supports up to 1,000,000 source characters in 12,000-character pages, with a two-million-character global transient snapshot cap and five-minute expiry. Continuations copy a versioned next_request; source pages cannot cross owner/run/snapshot boundaries. Every cached page rechecks selected apps, grants and action policy. Downloading/exporting is not repeated for each page. Coverage remains false until all ranges were returned; oversized byte/text limits remain explicit failures.
A configurable tool_call_budget (default 80 Flolah tool API calls, range 10–256) applies to one WhatsApp request or the complete scheduled run across native retries. The governor records one refusal and stops further execution; it does not claim unreviewed work complete. Native no-progress detection remains enabled separately. Trusted FloAssist run scope also supplies action-ledger correlation when the in-memory native session mapping is unavailable. Owner preference changes, pauses and quiet hours remain independent of this cap. Source-controlled tests cover unique-call exhaustion, retry aggregation, new-run reset and metadata correlation.
Final VPS acceptance is pending the release containing these changes. Source/model safeguards are not bypassed to turn an incomplete run green.


### Final coverage audit — 27 October
Release 0cebafbf produced zero tool errors in all five live goals, but ledger inspection found that Deadline run sgr-7ec0ca51ec054298 had not consumed the remaining pages of two Drive documents. Therefore those green statuses are insufficient to close FA-GAP-011. The corrected backend persists metadata-only per-source coverage, refuses task observations on partial sources, and performs at most two continuation passes under one absolute time budget and the existing per-run tool-call cap. If pages remain, run history stays incomplete/error and no successful whole-review outcome is delivered. Isolated HTTP gateway tests verify completion on the second call and failure after the fixed continuation bound. The explicit-owner/run audit maintenance script corrects the earlier run status without changing Kanban tasks or sending messages.
Native ad hoc task-source validation also passed: actual owner task #17312 used kanban_get_task followed by floassist_source_read, with verified nonempty Gmail content, zero errors and a final reply (21.6 seconds). Final live acceptance of the coverage-completion guard remains pending below.


### Evidence-reference reliability — 27 October
The first coverage-guarded live run started during a platform permission-metadata hot reload and retained one malformed Gmail deadline excerpt. The source reader now returns short owner/run/app/source-bound evidence references and verified date suggestions for actual action/date passages on each page. The existing deadline_excerpt field accepts these references as aliases for the exact cached passage; date/time, full-review, selected-app and historical-confirmation checks still run. References from other sources/owners/runs cannot substitute evidence. Original literal passages remain supported. Source passages are omitted from the execution ledger; references/date receipts remain traceable. A recoverable rejected observation no longer prevents the separate bounded completion of outstanding source pages; unresolved failures still fail final acceptance.

### Latest checkpoint — 27 October

Company Tools management is deployed and production-navigation verified. Every new registration receives the tested server-side preference defaults; activation automatically grants reminder create/list/cancel and provisions WhatsApp delivery with Flolah history. Fresh-owner fixtures cover Singapore, India and Indonesia defaults, reminder grants and delivery destinations. Existing preferences and explicit connector consent remain preserved.

Backend v36 fixes stopped/closed records being exposed again by the scheduled tracking-list tool. Live metadata proves the retired synthetic/legacy records stay out of scheduled candidates while remaining in ad hoc history. All four non-Deadline responsibilities pass on v36. FA-GAP-011 acceptance remains open because the secondary model's context compaction fails with `429 insufficient_quota` / no credits; the user elected to retain that model and replenish credits. No model override was applied. Deadline must be retested after credits are available; incomplete/error runs must not be relabelled as successful. See implementation/testing notes for exact revisions and run IDs.
