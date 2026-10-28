# Local DeepSeek checker evaluation — 28 October 2026

**Outcome: replacement not accepted.** The current paid maker/checker baseline is recorded, the local secondary route is implemented and regression-tested, and the requested local-model experiment was run. Local DeepSeek did not match the paid checker's success rate or performance. The production secondary was therefore left on gpt-4o-mini. Resource tuning was reversed and the deployed environment matches the original backup byte for byte. No backend, gateway or model-gateway rollout was performed.

## Configuration and backup

The active maker was deepseek-v4-flash and the checker was gpt-4o-mini, with the primary slot active. The host has eight logical CPUs, approximately 31 GiB RAM and no observed GPU device; the local model ran at 100% CPU placement. About 12.9 GiB RAM was available before testing. The original Ollama CPU quota was four cores.

The private VPS backup is `/opt/agent-os-backups/checker-local-20261028T121200Z/`. It contains `deploy_.env`, captured backend/gateway/Ollama/model-gateway configuration and private test logs. The directory is mode 0700 and environment/inspection files are mode 0600. Secrets and environment contents were not copied into development output or sent to a model. The checked-in result artifacts contain only synthetic test data and metrics.

## Comparable model-backed cases

Eight fixed synthetic cases cover a valid Singapore deadline, an incorrect UTC conversion, completed-task suppression, latest incoming reply suppression, Advisory no-send policy, embedded source instructions, account isolation and a complete read-only plan. Two positive candidates were generated once by the actual maker. Both checkers received the same recorded candidates; no paid maker calls were repeated for local trials. No tools, connectors, goals, emails or WhatsApp deliveries were executed. There was no implicit provider fallback.

- Paid baseline: 8/8 passed (100%); median 1,159 ms; p95 2,374 ms; aggregate checker request time 11,160 ms.
- Initial local profile, 32K context and six threads under a six-core quota: 3/8 passed (37.5%); median 33,895 ms; p95 47,244 ms. This initial trial used strict raw JSON parsing; it is retained as historical evidence, not the final application-equivalent quality estimate.
- Registry-template local profile with the application's existing structured-object parser: 6/8 passed (75%); median 31,688 ms; p95 38,146 ms; aggregate request time 256,748 ms. This was about 27.3 times slower at the median and 16.1 times slower at p95 than the paid baseline. The timezone and complete-plan cases failed to return acceptable complete verdicts within the matched 500-token bound.
- Targeted retest of those two failures through the actual new secondary resolver, with a 1,024-token output allowance and 120-second request deadline: timezone passed in 30,389 ms; complete-plan still failed in 85,223 ms. This is a separate 1/2 targeted retest, not an 8/8 result or a successful full-corpus retest.

The local model is the existing deepseek-r1:8b Q4_K_M deployment, reported as Qwen3 architecture with 8.2B parameters, running under Ollama 0.32.1. Its 32K resident allocation was about 6.8 GB. The first cold warmup took 47,474 ms; cold load is recorded separately from the warm-case comparison. Installed-template inspection showed a stale Jinja role template rather than the registry's thinking-aware template. Template and inference controls were corrected experimentally without changing model weights or weakening the semantic validators. A custom intermediate template failed and was stopped; its partial results remain in the private backup. The corrected registry template improved results but did not satisfy parity. This is inference/template tuning, not a trained weight fine-tune.

The registry thinking template and local-model behavior were checked against [Ollama's DeepSeek template](https://ollama.com/library/deepseek-r1:8b/blobs/c5ad996bda6e), [thinking controls](https://ollama.com/blog/thinking) and [concurrency/context memory guidance](https://docs.ollama.com/faq). More context and longer timeouts cannot be reported as equivalent speed; malformed, truncated or missing verdicts remain failures.

## Ordinary and critical regressions

The initial current-image isolated run passed six of seven suites. Action Policy failed because the disposable harness lacked its required synthetic internal-auth token. After supplying that test-only token, the suite passed; production policy and secrets were not changed. Original timings and the explicit retest are retained separately.

The completed candidate passed all ten critical suites in disposable VPS containers with `--network none`, source mounts read-only, synthetic authentication and no production database or volume mounts:

- FloAssist full suite: 5,694 ms.
- Maker/checker typed contracts: 791 ms.
- Tenant/tool isolation: 1,722 ms.
- Action policy: 1,074 ms.
- Model routing: 1,103 ms.
- Router/planner: 2,661 ms.
- Steering completion: 556 ms.
- New local-secondary routing guard: 526 ms.
- Native local transport: 378 ms.
- Efficiency controls: 922 ms.

These are 10/10 passing **suite** outcomes, not counts of live model-backed cases. Their elapsed time includes container startup/cache effects and must not be used as a model inference speed comparison. Local Windows FloAssist, maker/checker contract, action policy, local routing and efficiency/transport checks also passed.

After a final compatibility refinement to avoid treating arbitrary loopback OpenAI-compatible servers as native Ollama, the affected FloAssist and model-routing suites were rerun on the VPS and passed in 5,990 ms and 529 ms respectively. Owner-specific dual-BYOK compatibility also passed in 576 ms. Those three runs are recorded separately in `final-compatibility.json`. Production backend, gateway and LiteLLM images were checked unchanged and healthy after restoration.

## Source changes and restoration

Explicit secondary requests whose configured endpoint is local Ollama now use the native text transport with bounded context, CPU threads, output, JSON format, no silent truncation and a thinking control. They do not silently obtain a paid approval through gateway fallback. Primary/main-chat routing is preserved. The selected model is not changed by this code. `OLLAMA_CHECKER_THREADS` and `OLLAMA_CHECKER_NUM_CTX` are documented in both environment examples and Compose; canonical Docker source copies already include the transport and tests.

The environment experiment set Ollama to six CPU cores, six checker threads and 32K context before local testing. After failed acceptance, only those experimental resource keys were restored, the original four-core Docker quota was reapplied, and all three newly created trial model aliases were stopped and removed. The pre-existing DeepSeek and Llama models were preserved. The restoration check reports exact equality with the original `.env`. The source-controlled Modelfile is explicitly an unapproved experimental profile, not an active production configuration.

A checker replacement requires a new passing actual-model evaluation, complete goal-plan acceptance and latency at least as good as the paid baseline. This run does not establish that a CPU-only 8B checker meets those requirements. Keep the paid correctness checker and the already implemented bounded local utility offloads until a candidate passes; do not relax plan/policy/source checks or hide failures behind a hosted fallback to claim parity.

Artifacts: [paid baseline](../test-results/checker-comparison-20261028/baseline.json), [final local corpus](../test-results/checker-comparison-20261028/local.json), [targeted resolver retest](../test-results/checker-comparison-20261028/local-output-budget-retest.json), [critical regressions](../test-results/checker-comparison-20261028/candidate-hermetic.json) and [restoration evidence](../test-results/checker-comparison-20261028/restore.json).
