# Weekly source-review acceptance — 9 November 2026

User request: “Look at the real.email and calendars and generate a week focus areas for me. I don't need generic advice”. The 22:41 SGT WhatsApp answer substituted automation schedule descriptions and falsely characterized source retrieval as failing.

## Exact-turn evidence

Read-only transcript inspection returned tool arguments, schema failures and structured source metadata, excluding message bodies. At 22:41:02 and 22:41:10, six floassist_source_read attempts failed because the agent supplied an unsupported nested input object. At 22:41:13, Gmail successfully returned source content with coverage_complete=false and next_request; Drive returned discovery candidates; Calendar correctly required an explicit time window. At 22:41:17, Calendar returned successful complete source coverage after a window was supplied, while two further mail/file calls repeated the invalid input shape. At 22:41:21, three repeated starting reads hit duplicate protection. These are not evidence of disconnected Gmail/Calendar. No continuation cursor or discovered file ID was consumed in that turn.

## Correction under acceptance testing

Channel-independent source-review guidance requires schema inspection, top-level source-reader arguments, timezone-aware calendar windows, broad mailbox discovery for broad reviews, continuation handling and source-grounded synthesis. It distinguishes source coverage from connection health and forbids substituting schedule descriptions for evidence. Successful source-read responses now add native next_call envelopes and candidate read_call envelopes after owner-scoped source references are translated. Existing source bodies, next_request, authorization, duplicate protection and scheduling behavior remain unchanged. Explicit time windows are preserved in generated candidate reads.

The source-reader/provenance suites, full FloAssist suite and new continuation-contract tests pass. These are regression checks, not acceptance of the user task. Live acceptance requires the original prompt, normal COO grants, real source content, correct paging/coverage and a source-grounded final answer. A status:ok run alone does not pass. External message delivery is disabled during replay.

Deployment: backend source-review-window-20261109; gateway source-review-20261109. Scoped release folders retain rollback metadata. Final live result pending.

Run 3f1c6014-fb0b-41cc-9206-197536784cbf failed acceptance after the initial correction: only scheduled_goal_list and connector_list_apps were called, and the reply again substituted schedule descriptions. The installed prompt-handoff regression and source/runtime integrity both passed; these checks did not prove task success. Model metadata identified the configured platform-secondary route with normal grants. No model change was made.

A subsequent execution-level guard blocks schedule-list/run tools only for direct email/calendar analysis requests, leaving explicit schedule management/run requests and all authorized source tools unchanged. It is session-scoped with expiry/reset. The live acceptance result remains pending; this is not yet a proven resolution.

Run 713f2abf-4e43-4164-806b-18ffdc17afd0 after the guard used source reads instead of schedules, but FAILED the substantive acceptance: it treated a promotional email as a priority and an unrelated discovered document as an obligation, without adequate broad review or grounded relevance. No full-resolution claim is made.

Diagnostic run e5c12f95-7fcc-4558-9d10-c271041c2965 requested the already-configured primary model but its terminal receipt reported responseModel=flolah-platform-secondary and rerouted=true. It is not an independent primary-model test. A subsequent synthetic, no-user-data request to the configured primary model deepseek-v4-flash returned HTTP 402 with errorType=insufficient_balance_error. Secondary configuration is gpt-4o-mini. Restoring a funded primary is necessary for that comparison, but is not proof that task quality will pass. No permanent model setting was changed and no external test reply was sent. User input is pending on restoring primary balance or selecting a funded configured model.

Current deployed images: backend and gateway source-review-guard-20261109. Installed-plugin hook test verifies actual review blocking, source-tool allowance, and reset for an explicit morning-briefing run. Async status regression remains passing. The feature remains NOT accepted end-to-end.
