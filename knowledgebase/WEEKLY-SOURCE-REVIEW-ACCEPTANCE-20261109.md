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

## Funded-model comparison — 10 November 2026 SGT

The user authorized another already-configured funded model. The native catalog included openai/gpt-5.4-mini and openai/gpt-5.5. No permanent model configuration was changed.

Run d0db58eb-9d5f-4819-a161-78508a30983b requested gpt-5.4-mini and received gpt-5.4-mini-2026-03-17 (the receipt flags the canonical model-version difference as rerouted). It successfully called sources and correctly rejected the promotion as a work obligation, but stopped at partial Gmail coverage and asked permission to continue. This FAILS full task completion, though it establishes that this configured model can respond without the primary's balance error.

The gpt-5.5 exact-prompt runner ended at its timeout with exit 143 and no final response/terminal receipt. Its effective model and task outcome are unverified; do not count it as a successful comparison or infer an authorization failure. Timestamp-based live transcript progress counts were discarded because they could include concurrent sessions and re-recorded history. No such counts are acceptance evidence. No WhatsApp delivery was requested by either runner.

The weekly-focus acceptance remains FAILED/INCOMPLETE. Funding availability is not sufficient to establish correct source review. Further work must establish broad-source retrieval, pagination completion, relevant evidence-backed synthesis and reliable runtime completion.

## Runtime blockers isolated during retest — 10 November 2026

Run `ebe6478c-e442-4946-b3d0-7be426ca5b46` reached actual source tools but did not return within the 630-second runner deadline. Function-only CPU profiles identified repeated roster materialization during native harness discovery. A synchronous, traversal-scoped snapshot preserves policy results without retaining configuration across calls. The installed native regression fixture with 399 agents reduced roster reads from 1,205 to 1, with matching entries/list, provider/model/agent/default policy results, mutation visibility and exception cleanup. This is a performance regression result, not task acceptance.

After deploying that patch, run `37cff4d5-b848-4dc3-a872-679d3e7d90df` used `openai/gpt-5.5`, listed connectors and read Calendar for 10–17 November in Asia/Singapore. It then stalled. Two function-only CPU samples attributed approximately 97% of samples to `ftsUnchanged` deleting by an unindexed FTS ID. The previous memory-delta optimization therefore retained a serious per-chunk full-index scan. The correction deletes exact rowids from the already-loaded source snapshot, skips deletion for absent IDs, and repairs duplicate rows. Tests cover unchanged/changed rows, duplicates, foreign-source isolation, rollback, retention fences and degraded-vector fallback.

Gateway-only image `agent-os-openclaw:memory-rowid-20261110` includes both corrections. Backend and unrelated services were not recreated. Temporary container-loopback inspector configuration was removed by the deployment. Source-review, continuation contract, asynchronous-status and connector-context regression tests also pass. Startup migration/reconciliation remains slow; no claim is made that all gateway performance issues are resolved. The interrupted run is not a pass. Final post-correction acceptance is pending.

Fresh-session run `7e526c33-c522-4b66-afd6-21dd4a1e56b5` completed in 118,965 ms on `gpt-5.5-2026-04-23`, with delivery disabled and normal COO grants. It read Gmail/Outlook/Calendar and followed two continuation cursors. It still FAILS substantive acceptance: the answer prioritized an old explicit test email, and broad connector calls failed native schema validation. Exact-session tool errors show Gmail and Outlook input fields rejected as additional properties on the generic executor's `input` object, before connector execution. The shared JS/TS schema now explicitly allows dynamic input properties; the outer envelope remains closed and action-specific server enforcement is unchanged. Installed AJV tests cover Gmail/Outlook/nested payloads and rejection of unexpected envelope identity fields. Shared review guidance excludes unsupported current priorities inferred from test messages, promotions or expired events.

Image `agent-os-openclaw:connector-input-20261110` adds that correction. The existing main-session CLI replay separately returns a lifecycle admission conflict; history has not been reset or erased. Fresh-session success must not be conflated with repair of that route. Post-schema-fix acceptance is pending.

## Post-schema-fix bounded content acceptance

Run `ad4d6699-ecbb-461b-8d9f-972d4cf9abc4`, session `6ff290cf-83a1-4a53-8bb9-2b8b7cdfc4e8`, completed in 92,646 ms on `gpt-5.5-2026-04-23`, requested as `openai/gpt-5.5`. The receipt's rerouted flag reflects the canonical model-version suffix; it did not switch to the platform secondary. Delivery was disabled; ordinary COO grants were used.

The exact original prompt produced a grounded bounded review: 20 recent Gmail messages within 14 days, 20 latest Outlook messages, four Gmail thread-body reads, and the primary Calendar for 10–17 November SGT. Actual `connector_execute_action` calls succeeded for both mailbox list actions and all four thread reads. Exact-session source results corroborate the account-security and correspondence-follow-up recommendations; test/promotion/expired items were excluded. The answer disclosed its bounded coverage and primary-calendar scope. This passes bounded content acceptance, not exhaustive mailbox coverage or WhatsApp delivery acceptance. Two initial search calls supplied an unsupported app_id, then recovered through schema inspection and succeeded. The terminal receipt's successfulToolNames was empty, so the pass relies on correlated backend action records and exact-session tool results, not that incomplete receipt field.

The existing main-session no-delivery chat probe was admitted through normal chat ingress and performed restart recovery; it is not counted as a no-tool probe pass. Its actions were reads/blocked duplicates, with no recorded device or external-send action. After this, existing-session replay `058e03fa-59a6-40eb-9a7d-c2d0479454cc` was admitted with the funded model. Its completion remains pending. Persistent COO model selection has not changed; the user was asked whether to use the funded model for ordinary requests.
