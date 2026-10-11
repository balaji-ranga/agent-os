# Efficiency controls (local implementation; deployment requires owner confirmation)

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

The efficiency harness uses disposable SQLite data, mocked providers and loopback HTTP only. It does not contact VPS or inference APIs. A real model evaluation is a separate deployment/acceptance step, not evidence provided by the mock harness. Do not deploy, restart services or push these changes until the owner confirms the next step.
