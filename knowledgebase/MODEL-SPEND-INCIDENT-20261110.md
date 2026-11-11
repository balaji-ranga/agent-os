# Model spending incident — 10 November 2026

Status: OPEN. Do not describe the DeepSeek charge as explained or the weekly-focus UAT as passed.

## Evidence and accounting boundaries

The owner supplied a DeepSeek hourly usage/cost ZIP and an OpenAI daily completions CSV. Raw exports and credential identifiers remain outside version control. Provider usage is authoritative for billed volume; application estimates are not a substitute. OpenAI daily buckets are UTC; the DeepSeek export explicitly uses UTC+08:00.

DeepSeek, 22:00–23:00 SGT:

- Flash: 2,117 requests; 256,285,696 cached input tokens; 50,947,946 uncached input tokens; 1,954,608 output tokens; USD 9.583813788.
- Pro: 33 requests; 1,714,944 cached input tokens; 588,449 uncached input tokens; 18,240 output tokens; USD 0.462220308.
- Total: 2,150 requests; 311,509,883 input-plus-output tokens; USD 10.046034096.
- The morning 08:00–09:00 SGT bucket also contains 1,038 requests and USD 5.370081378.
- The export's masked key identity matches the configured primary key's visible prefix/suffix. The user states this key was not used outside Flolah.

OpenAI, 10 November UTC, supplied completions export:

- GPT-5.5: 63 requests; 2,719,832 input tokens, including 1,790,848 cached; 24,344 output tokens.
- GPT-4o-mini: 291 requests; 10,168,906 input tokens, including 7,110,784 cached; 50,699 output tokens.
- This CSV contains no dollar amounts or embedding usage. It does not independently establish the reported USD 7.50 total or the exact time of embedding calls.

The native ledger contains 63 GPT-5.5 admissions that day: 61 completed with reported usage and two errored with estimated usage. Completed calls total 2,691,753 input and 24,293 output tokens. Repeated acceptance/BYOK runs therefore account for substantial real consumption; quoting only the final 201,375-token successful run concealed cumulative retesting volume. The remaining provider-versus-completed-ledger difference is not assigned to specific errors without request-level evidence.

## Confirmed defects and corrective work

### Native memory selected an unintended embedding model

Knowledge/OpenSearch retrieval was configured for Qwen, but native OpenClaw had no top-level `memory.search` configuration. The installed runtime documents an implicit OpenAI provider and `text-embedding-3-small` default when OpenAI credentials are available. Native memory status independently confirms COO's existing 78,405-chunk index was built for that model.

The backend safe writer now derives native memory's embedding destination/model/credential from the same embedding configuration as knowledge retrieval. It explicitly selects `openai-compatible`, disables fallback and remote batch API use, and discards stale destination headers. Disabled or refused cloud configuration selects `none` rather than implicitly inheriting chat credentials. Existing source/scope settings are preserved.

The candidate passed installed OpenClaw schema validation. Backend image `agent-os-backend:spend-guards-20261110` was deployed without replacing the gateway or unrelated services. The live route resolves to local Qwen and `fallback: none`. A local derived-index rebuild is in progress; source memory and transcripts are preserved. Successful HTTP 200 embedding requests from the gateway to the Qwen service were observed. Do not mark vector migration complete until the index identity and search verification pass.

### Automation state removed native per-request limits

`admitNativeModel` loaded request limits only from an active FloAssist profile. A stopped or absent profile removed call/token caps on explicit native requests. The fix reads preferences independently of automation state and applies existing bounded defaults when no valid preference exists. Primary, secondary and compaction share the same run allowance. This is a confirmed protection defect, not a proven explanation for the DeepSeek volume.

### Live retesting lacked a cumulative spend gate

Repeated paid acceptance attempts replayed conversation/source context across many test runs. A per-run improvement did not limit total validation expenditure. Further paid retests were stopped. Persistent repository guidance now requires a shared persisted test allowance and cumulative reported usage across the test batch, with offline reproduction before any paid run. Existing native test-budget primitives can enforce a batch across sessions; the latest acceptance runs had not been bound to one. Do not claim a completed end-to-end cumulative-budget fix merely from written guidance.

### Proxy streaming accounting remains under investigation

Primary and secondary proxy calls were recorded as estimated usage, unlike direct GPT-5.5 calls. A pending configuration change explicitly requests streaming usage for model entries using the configured LiteLLM origin. Its pure configuration test passes, but actual installed-transport and provider-usage verification is still required. This setting does not explain thousands of additional calls.

## Platform-wide trace of the DeepSeek hour

The audit covered all owners in token usage, native admissions, route events, scheduled goal runs, goal runs and workflow runs. It also checked all native agent session indexes, container logs, host/container credential consumers, local Docker and the independent adoption model gateway.

- One goal run was created at 22:44:23 SGT; its scheduled-run record is explicitly `triggered_by: run_now`, not a scheduled backlog replay. It failed at 22:50:08.
- COO's interrupted weekly-focus native run has five primary admissions, totaling 212,968 estimated tokens, including its compaction call.
- There were no newly started workflows in the incident hour. Two old `running` workflow records were last updated in July and October; their status alone is not evidence of activity in this hour.
- No model activity from other owners appeared in the audited ledgers or updated native session indexes during that hour.
- LiteLLM has 27 completed chat-completion access records across the entire 22:00–23:00 SGT hour. This count excludes requests that started but never completed and does not itself count internal retries.
- The installed router defaults are two retries and five maximum fallbacks. An isolated network-disabled reproduction of the configured circular primary/secondary fallback under repeated HTTP 500 failures made four upstream HTTP attempts. That reproduction does not establish the cause of 2,150 billed requests.
- Native dreaming is explicitly disabled. Only COO's main session and the observed goal session were updated in the incident period.
- The laptop has only Home Assistant in Docker, not another Flolah model gateway.
- The separate adoption gateway has a copy of the primary key in its configuration but no incident-hour request logs. Its existence is not attribution of the charge.

The Pro requests and the scale discrepancy remain unexplained. Do not infer key sharing, compromise, a provider billing bug, or a compaction loop without evidence. Do not equate access-log absence with proof that a process made no upstream calls.

## Containment and validation

The platform was returned to secondary; gateway/proxy were temporarily stopped under the owner's approval. The owner revoked the DeepSeek key. Services were restored after revocation. No further paid acceptance calls have been intentionally initiated during this investigation.

Offline checks passed: native budget reservations/accounting/tenant boundaries/compaction caps, stopped-profile and no-profile limits, memory-route reconciliation, safe configuration no-op/preservation, 17 configuration publication contract checks, and employee-specific model preference regression. Builds ran with networking disabled. Windows configuration tests encountered sandbox rename restrictions and were subsequently run successfully in the isolated Linux build.

Additional installed-runtime verification: `test-native-model-budget-runtime.mjs` passed against `agent-os-openclaw:source-focus-20261110` in a new container with `--network none`, no mounted user state and fake provider/admission responses. It invoked the actual installed compaction `generateSummary` function and verified that it used the same admission wrapper as ordinary generation. Exhausted admission prevented provider invocation. This validates the current code path, not historical attribution of all billed requests.

At 23:55 SGT, Qwen migration remained in progress: the embedding cache had 5,815 entries, the local embeddings service was computing, and the existing index still reported the old model identity. Do not interpret a successful Qwen HTTP response as a completed migration or run another concurrent rebuild.

Remaining closure requirements: reconcile the DeepSeek provider request spike; enforce and demonstrate cumulative live-test limits; validate streaming usage through the installed transport without paid discovery runs; finish local Qwen index migration and verify native retrieval; reconcile OpenAI dollars with its billing report; run only a bounded, explicitly budgeted acceptance test after incident attribution and safeguards are established.
