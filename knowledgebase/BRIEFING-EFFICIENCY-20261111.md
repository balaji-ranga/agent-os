# Briefing efficiency investigation — 2026-11-11

## Latest acceptance result

Production run `sgr-c3eb99bce5a64f82` passed after the routing deployment: **74,323 input + 839 output = 75,162 tokens**, 84.53% below the 486,000 baseline and below the 243,000 target. It used three native model calls, one bounded source-evidence review and one local utility call. Native calls used the configured secondary slot through LiteLLM; saved model preferences were not changed. Full structured results and coverage are retained in `scheduled_goal_runs.result_json`; history uses the bounded preview and owner-scoped usage aggregate.

The final result reported no calendar events for that day, retained an account-security check conditionally, and excluded promotional and optional-volunteering proposals. Those proposals from the first model were rejected by the independent source-grounded review. This proves the tested source set, not perfect classification on every future message.

Earlier passing run `sgr-493a3f56284241a6` used 78,054 tokens. Its stored result was queued once without another model/source fetch; delivery key `ceo-bala:sg:sg-f4098f732edd497d:sgr-493a3f56284241a6` reached `sent`. The final post-routing run was validation-only and did not send a duplicate. No new user-side receipt confirmation is claimed.

The chronological investigation below preserves failed tests and the deployment incident. Earlier pending statements are superseded by this section and the routing release update.

## Acceptance criteria

Do not treat isolated regression tests or a token-budget stop as a successful briefing. Require current source coverage, a useful grounded result, delivery, and recorded token totals. User target: below half the earlier 486,000-token baseline (243,000 tokens).

## Observed production evidence

- User Run Now `sgr-dcb6dc4015364637`: 27 completed calls, 1,064,884 input + 10,251 output = 1,075,135 tokens; context overflow. Compaction executed, but continued raw-source accumulation filled context again.
- Briefing lacked an explicit source assignment and inherited Drive. A single document consumed at least 32 advancing pages. Pagination worked mechanically but did not control cumulative model context.
- Initial prompt carried 18,418 characters of historical memory. The custom bootstrap hook used an obsolete global registration mechanism. Changing registration alone was insufficient: the installed loader also required startup activation metadata.
- Run `sgr-465913a02b0c4077`: 86,811 input + 768 output; failed. The hook was still not activated. No delivery success claimed.
- Run `sgr-07db74f67d704bc7`: 198,506 input + 858 output = 199,364 tokens, five completed calls; stopped at its 200,000-token test budget. Native logs verified hook invocation, but the legacy reloader expanded the native file set with ORG/OPS documents. This is a failed acceptance test, not an efficiency pass.

## Changes under verification

- Briefing sources limited to selected email/calendar services plus existing tracked obligations. Deadline checks retain document support. Refresh generated source clauses in saved prompts at runtime.
- Refresh only files chosen by the native bootstrap loader. Fresh-source checks omit historical MEMORY preload while retaining policy, identity, preferences and stored memory on disk.
- Remove redundant execution-envelope schemas and nested JSON escaping in model input without changing source bodies, cursor/tracking IDs, coverage or persisted audit.
- Goal History aggregates owner/run-scoped input/output totals from the usage ledger, including estimated-record markers. Missing telemetry is not presented as zero usage.
- Trusted goal execution timestamps establish a shared fetch deadline. HTTP, MCP and export reads use the remaining deadline; pacing/retry waits cannot renew it. Platform timeout settings expose the goal fetch window and individual connector-fetch timeout.

## Deployment incident

An efficiency overlay accidentally included a routes file referencing the not-yet-deployed model-egress helper. Backend startup failed with ERR_MODULE_NOT_FOUND. The overlay was rebuilt from the deployed routes file with only the fetch-context change; backend API responses recovered. Future candidate validation must include full service startup, not only isolated tests. LiteLLM routing deployment remains a separate unfinished requirement.

## Tests

Local tests passed: goal usage owner/run isolation; bootstrap registration/projection and no optional-file expansion; discovery/execution envelope preservation; source-reader pagination, provenance, owner scope, snapshot reuse and complete coverage; fetch-budget async isolation and refusal of retries exceeding deadline; connector execution error fidelity and write retry safety. Candidate-image versions of usage/projection/fetch-budget tests passed on VPS.

## Remaining

Complete successful bounded live briefing and delivery validation. Verify all execution paths retain deadlines across process boundaries/resume. Enforce provider-supported temporal filters and aggregate fetch limits beyond existing FloAssist source discovery. Complete generic progressive evidence retention/compaction verification. Complete remaining LiteLLM routing deployment and sanity checks, then commit/push validated changes.

## Continued validation, 2026-11-11

- Native token totals fell to 72,660–73,943 in repeated bounded runs versus the 486,000 target baseline (and the failing 1,075,135-token run). This is efficiency evidence, not a semantic acceptance pass.
- Runs e5680bf87b9a45ef and e7568ed571c24dc3 still misclassified optional volunteering as a personal obligation. Calendar prose also included email promotions. A structured agenda now requires calendar source IDs and owner-local date validation.
- A bounded independent action review is being validated. It uses persisted owner/run-scoped source excerpts rather than relying on a model's proposed rationale. At most 40 excerpts of about 6,000 characters are stored per run, with a one-day cleanup ceiling and inclusion in user retention policy. Review input is at most 16,000 characters and output at most 500 tokens; its usage shares the goal run ID. Missing evidence and provider-labeled promotions cannot be promoted to required actions.
- A saved-draft replay used 404 input + 60 output tokens. It established that reviewing a model-written rationale without source text is insufficient; no semantic pass was claimed.
- Validation-only runs suppress chat/channel delivery. Earlier live tests delivered poor summaries; those were not accepted as successful quality tests.
- The latest generic deadline revision anchors ordinary goal steps to the parent goal creation time, not each step's start. Child workflows inherit it; tests prevent later steps from resetting the fetch window.
- Network-disabled VPS HTTP test verifies a timed-out response body is disconnected. Local sandbox loopback is denied (EACCES), so that HTTP assertion is tested in the VPS fixture rather than falsely reported as a local pass.

Remaining: final source-grounded briefing acceptance, full routing deployment including Realtime/BYOK and non-chat transports, final sanity and main push. Do not interpret the deployed efficiency backend as deployment of the separate model-egress candidate.
