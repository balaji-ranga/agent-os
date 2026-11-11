# Model egress enforcement — implementation in progress

User contract: non-Brain paid model requests from Flolah and OpenClaw must traverse LiteLLM. Workflow Brain nodes may retain independently configured endpoints and credentials, but every HTTP attempt must be metered. No paid acceptance testing during the spend investigation.

Implemented in the working tree:

- Shared Chat/Responses-compatible transport uses request-scoped LiteLLM routing, retains the selected provider/model/credential, and refuses direct paid submission when gateway configuration is missing. This layer adds no retries or cross-account fallbacks.
- Backend completion, vision and image-generation call sites use that transport.
- The installed native diagnostic-stream adaptation includes model egress for system and tenant agents; the existing tenant admission wrapper is retained. Responses uses SSE through the proxy.
- Workflow Brain retains its direct transport. Each attempt creates a model_route_events row, links token_usage.trace_id to that request ID, records measured or explicitly estimated token counts, and attributes the owner/run/node. Failed tool-loop rounds remain visible. The final aggregate is returned to the workflow without billing it a second time.
- Adoption provider transport requires the configured shared gateway for hosted models; its deployment environment contract has been added but not deployed or fully regression-tested.

Verified offline:

- Shared transport: original model/BYOK credential, tools, stream flag, abort signal, no direct fallback on proxy failure.
- Native transport unit checks for Chat and Responses; installed native ABI and compaction regression passed in the candidate image.
- Exact installed LiteLLM router accepted Chat and Responses with distinct fixture credentials and returned 11 input/3 output tokens for each, using only a loopback fake provider in a network-disabled container.
- Brain metering recorded three requests: two successes with measured usage and one failure with estimated usage, with owner/request correlation and no persisted prompts or credentials.
- Backend candidate regression suite passed, including existing fallback, native budget, config-publication and Brain attribution tests.

Not deployed. Candidate images are `agent-os-backend:egress-candidate-20261111` and `agent-os-gateway:egress-candidate-20261111`; subsequent small hardening/adoption edits require rebuilding. No production service was replaced for this change.

Remaining release blockers:

- Realtime voice has a distinct client-secret/WebRTC handshake. The installed LiteLLM endpoint reconstructs its request and does not retain request-body user_config, so the generic JSON routing mechanism is not sufficient. Use supported registered proxy deployments and preserve BYOK ownership; do not silently substitute platform credentials or leave direct fallback.
- Complete adoption transport regression and deployment credentials, full HTTP proxy/auth tests, and native SDK streaming verification (not merely fake stream wrappers).
- Check startup configuration/auth paths, other native model features, and non-chat transports for bypasses before claiming complete enforcement.
- Deploy scoped images only after those checks pass; verify routing without a paid test first.

The gateway routing change does not retrospectively reconcile the DeepSeek billing discrepancy.

## VPS verification update, 2026-11-11

- Adoption provider suite: 40/40 offline tests passed (model routing, maker/checker, checker reliability, goal schema).
- Full authenticated HTTP test against the installed LiteLLM image passed for Chat and Responses. The first run identified a required configuration flag: `general_settings.allow_client_side_credentials: true`. Candidate config includes it; production proxy has not yet been changed. Proxy master credential remains internal-only.
- Actual installed OpenClaw SDK Chat streaming test passed in a network-disabled candidate: one loopback request, original model, scoped BYOK credential, proxy authorization and 11 input/3 output usage preserved. See `backend/scripts/test-native-sdk-http.mjs`.
- Egress candidate images remain undeployed. The independently deployed briefing fix below does not activate these egress changes.

## Scheduled briefing incident, 2026-11-11

- Exact failed run: `sgr-fc1eff649b0d46a0`, created 00:11:49 UTC / 08:11:49 Asia/Singapore, `triggered_by=run_now`, manual run key. It was not the 09:00 scheduler tick.
- Originating WhatsApp request at 08:06:20 SGT: "How is the day schedule looks.for me". COO incorrectly invoked `scheduled_goal_run_now` instead of reading calendar sources, retried the same action (duplicate guard blocked repeats), and attempted a different historical test goal.
- Status classifier inspected unanchored phrases throughout executable prompt/recovery text and could misclassify source-review work as a read-only status enquiry. Classification now requires a leading status request; regression tests retain genuine observational protection and reject task/coverage-envelope false positives.
- FloAssist's final narrowed catalog omitted `tool_execution_status` while the guard explicitly instructed the model to call it. The required-tool list now includes it, still intersected with agent grants.
- Routing guidance now explicitly separates a calendar enquiry from an explicit request to run a saved responsibility, and prohibits unrelated test goals as recovery.
- Deployed scoped backend and gateway images: `agent-os-backend:briefing-fix-20261111`, `agent-os-openclaw:briefing-fix-20261111`. Production health HTTP 200, both containers running, loaded extension files verified. Candidate and deployed status tests passed; tool catalog regression passed including full grant catalog and tenant/scope isolation.
- No model-backed briefing was rerun in this investigation; end-to-end content/delivery acceptance is NOT yet established. Guidance alone is not proof that the model will always select the correct tool.
- Gateway recreation interrupted the separate long-running local Qwen reindex. Its persistent volume/cache was retained; completion/resumption still needs checking. Do not report reindex complete.

## Release boundary clarification

The user's target is all non-Brain model traffic through LiteLLM, not only paid chat traffic. The current helper still treats explicitly configured private local endpoints as a direct exception. Review/remove that exception for LLM inference, and inventory speech, native auxiliary features and all other model call sites before declaring the contract complete. Local Qwen embedding configuration remains explicit with no cloud fallback; it must not be silently changed to OpenAI embedding during this work.

## User-requested live briefing retest, 2026-11-11

- Run `sgr-4bc1a09ba27b4d65`, explicit manual test at 08:42:11 SGT; schedule/model settings unchanged.
- Test budget: at most 8 calls and 120,000 admitted tokens, expiring after 8 minutes. No automatic increase/retest.
- Result: FAIL, gateway HTTP 500. Gateway log identifies underlying cause: "The token allowance for this request has been reached."
- Native ledger: 3 completed calls via `flolah-platform-secondary`, 72,700 input + 721 output = 73,421 tokens. No started reservation remained at inspection. A subsequent request could not reserve its estimated input plus output within the remaining allowance.
- This is not end-to-end acceptance of the briefing. Budget-failure propagation must return the actionable reason rather than a generic gateway 500; briefing context/tool-output efficiency still needs improvement. No successful briefing delivery is claimed.
- The previously fixed status classifier/catalog regression tests pass, but those isolated passes do not establish the entire briefing succeeds.
