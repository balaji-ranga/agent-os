# Efficiency controls

## Scope and UI

- Admin → Models & routing: utility policy, local model allowlist/default, hosted-fallback permission, queue/concurrency/deadlines, sanitized actual-model evidence, synthetic evaluations and explicit approval.
- CEO → Profile → Efficiency mode: existing Yes/No switch; separate company local-model and fallback preferences. Saving preferences does not silently enable the profile switch.
- CEO → Efficiency View → LLMOps: owner-scoped execution evidence, queue state and approved synthetic evaluation summaries. No infrastructure-cost or savings estimates are invented.
- Agent Chat working indicator: actual model, queue/processing/fallback state when owner + agent + client turn are correlated. Background calls without a turn remain visible in Efficiency View.

The ten existing utility jobs remain the complete allowlist. Main agent chat, semantic router, planner/maker/checker, steering validator, retrieval write-safety and trading authorizations are not moved to local models. Tool/action permissions and trading budgets are unchanged.

## Policy behavior

Default behavior preserves the existing opted-in workload list and permits fallback. Company local-only or an Admin prohibition prevents utility fallback to hosted providers. A local-only utility request fails closed if Admin disables its efficiency route. This is NOT a company-wide data-residency policy: other agent calls retain their configured provider.

Efficiency requests bypass the LiteLLM efficiency alias so a gateway-hidden fallback cannot defeat local-only preferences. Non-efficiency gateway routing and BYOK remain intact. Local models are restricted to private Ollama hostnames and non-cloud model tags; no credentials are accepted by the policy APIs.

Empty/truncated results, invalid JSON objects and supplied domain-contract validation failures can escalate once to the configured provider, if permitted. Existing COO tool-catalog and broadcast boolean contracts participate. Caller-side authorization, risk and result checks must still run. This is not a generic confidence/semantic correctness oracle.

Changing the local default or newly allowing a model requires a passing approved evaluation for its exact configured model. Existing defaults are retained for compatibility. The local reasoning route additionally requires an approved latest evaluation at runtime. New workloads cannot be added through policy; they require code, tests and review.

## Evaluation limits

Tests use synthetic read-only prompts for all ten workloads and never invoke agent tools. Optional hosted comparison must be explicitly selected by Admin and consumes API tokens. Evaluation results capture contract pass rate, latency and provider-reported tokens; they are smoke evidence, not comprehensive quality certification. Local hardware cost and comparable provider pricing are still required for a credible total-cost/savings comparison.

## Capacity and observability

The queue bounds efficiency inference and evaluation calls in ONE backend process. It does not constrain inference made separately by OpenClaw. Multi-replica deployment requires distributed leases before claiming a fleet-wide limit. Queue wait and local inference have separate deadlines; inference abort signals propagate to HTTP requests. Leases release in `finally`. Running/queued counts are process-local; persisted historical statuses may remain interrupted after a restart, and must not be treated as live capacity counts.

Only private efficiency requests use Ollama's native `/api/chat` transport. `OLLAMA_EFFICIENCY_THREADS` (default 2; 1–16) sets per-request CPU threads to avoid oversubscription on the shared two-CPU Ollama service. It does not change global Ollama settings, main chat/gateway routing or context size. Text-only input, JSON mode, output budgets, abort deadlines, provider token accounting and fail-closed validation remain enforced; context truncation is explicitly disabled. Align this value with the actual Ollama quota before raising concurrency. API reference: https://docs.ollama.com/api/chat

Routing events never contain prompts, provider error bodies, keys or owner IDs in public projections. CEO reports resolve the authenticated root company rather than accepting another owner's ID. Actual-model reporting uses provider response metadata where available; unknown gateway models remain unknown, rather than being inferred from an alias.

New tables are additive: `efficiency_control_settings`, `efficiency_preferences`, `efficiency_calls`, `efficiency_evaluations`. They initialize lazily; no destructive migration is required. Full-access company permissions protect preferences/report endpoints; Admin role is required for control-plane writes and evaluations.

## Local verification

Run from backend:

    npm run test:efficiency-controls
    npm run test:model-routing
    npm run test:llm-cross-provider-fallback
    node scripts/test-llm-efficiency-mode.js
    npm run test:chat-live-activity
    npm run test:goal-plan-quality
    npm run test:work-steering
    npm run test:quant-skill-router-contract

Run from frontend:

    npm run test:efficiency-controls
    npm run test:chat
    npm run build

The efficiency harness uses disposable SQLite data, mocked providers and loopback HTTP only. It does not contact VPS or inference APIs. A real model evaluation is a separate deployment/acceptance step, not evidence provided by the mock harness.

`test-efficiency-ollama-utilities.mjs` is a legacy real-inference harness, not a mock regression: it requires an accessible Ollama endpoint. Use the explicit VPS acceptance harness below for controlled production validation instead.

## Approved VPS rollout and acceptance

The owner approved deployment on 11 October 2026. First compare all feature files against main, VPS source and the running image. Preserve unrelated source overlays and parallel releases. The existing backend/frontend Dockerfiles copy the complete feature; no extra service, dependency, key or plugin is required.

For the focused CPU-transport correction, use `backend.efficiency.Dockerfile` and `vps-deploy-efficiency-focused.sh` with the reviewed immutable `EXPECTED_BACKEND_IMAGE` and tested `RELEASE_REVISION`. It builds from that exact running image, runs isolated no-network regression gates, takes a restricted online SQLite backup and recreates only backend using the operator's Compose overlays. Nginx is reloaded after health succeeds; OpenClaw, frontend, bridges, trading settings and other services remain unchanged. Concurrent image changes abort the release. Failed health restores the captured image, not an old database over ongoing company writes.

Run `EFFICIENCY_LIVE_ACCEPTANCE=1 node scripts/vps-test-efficiency-controls-live.mjs` in the backend container after deployment. It tests public HTTPS Admin/CEO authorization, rejected policy widening, fixture preference isolation, real local-only JSON inference, correlated actual-model evidence and all ten local synthetic evaluation cases. It never changes platform policy, existing companies, trading, or model approvals. Exact synthetic users/sessions/preferences/telemetry are cleaned up afterward. Completed unapproved evaluation fixtures are removed after their sanitized results are printed. A failed model quality case is not a passing evaluation and is not automatically approved.

The explicit `--warm-local` and `--cpu-diagnostic` modes use only synthetic text for bounded latency diagnosis, with no company data or hosted fallback. They do not change persisted policy. Do not treat a warm-model smoke result as a continuous availability or performance guarantee.

### Verified release: 11 October 2026

- GitHub main reconciled at `eef7a1847fe9339dc8a0a23dd2d5c8074cb638c5`; the narrow CPU transport correction, regression tests and focused release tooling ship together in this repository and VPS source.
- Focused release `eef7a184-efficiency-cpu1`: backend image `sha256:ffbccf814487b338ec66e6a1aa2bc54735cf8d8c7d0983c4469cf19aa7f02761`. Backend health and public HTTPS health returned healthy/200; unchanged frontend and other services were checked. Changed runtime source hashes exactly match the image.
- Offline release gates passed: native transport, 61 efficiency control assertions, model routing, all five focused router/planner files, steering queue/completion, chat activity and isolated dual-BYOK contracts. Local cloud-fallback, 25 efficiency-mode checks, goal checker, frontend rendering/chat and production frontend build also passed.
- Live public-API acceptance passed 38 checks, including authorization, company isolation, actual-model/turn correlation and failed evaluation approval denial. Real local-only JSON completed in 6177 ms, without hosted fallback; the prior default-thread path timed out at 30 seconds. Exact temporary fixture users, sessions and their evidence were removed.
- Both the API evaluation and a separate Admin UI-triggered evaluation completed **8/10**, with no hosted comparison or automatic approval. The UI run averaged 2847 ms per case. `brain_history` failed with incomplete output; `summarize_url` failed the fixture's content contract. This is an explicit remaining local-model quality limitation, not a passing ten-workload benchmark. The retained UI evaluation is unapproved. Existing model defaults, company preferences, trading, main routing and validation gates were not changed.
- Queue bounds/deadlines and correlated Chat indicator rendering have deterministic regression coverage; no claim is made of a fleet-wide limiter or a long-running production load test.
