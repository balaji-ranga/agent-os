# Gateway configuration recovery — 23 October 2026

The gateway restart loop was caused by six synthetic acceptance-test runtime IDs longer than OpenClaw's 64-character limit. It exited with code 78 and had restarted 7,974 times; Docker reported no OOM kill. At diagnosis the eight-vCPU VPS had about 20 GiB available RAM, load below 0.5, and 198 GiB available disk. Resource exhaustion was not the cause. Successful model-backed probes after recovery also establish that both tested CEO routes could use their provider credentials.

Only the six exact test registrations were quarantined, with a protected VPS backup at `incident-backups/gateway-recovery-20261023T142034Z` inside the shared OpenClaw home. Workspaces, histories, credentials and real agent registrations were preserved. The active roster has 399 valid agent IDs.

Deployed `20261023-config-guard-d` changes only backend and gateway images. It adds atomic guarded publication, rejects invalid IDs/tool policies, discards failed batches, protects native plugin-tool protocol selection, shortens test fixture IDs and cleans their exact runtime registrations. Setup, restore, deployment and gateway startup use the installed-runtime schema gate. Unknown enabled plugins fail that gate even when OpenClaw labels them warnings; explicitly disabled missing plugins remain disabled. The complete schema validator remains authoritative beyond the narrower synchronous guards.

Evidence:

- `installed-schema-regression.json`: six isolated installed-runtime checks passed, including unknown enabled plugin and preservation of the live read-only source configuration.
- `ceo-probes.json`: both real backend-to-gateway CEO chat probes passed after deployment (7,772 ms and 3,637 ms), with tools and other actions prohibited by the test prompt.
- `activation-result.json`: backend/gateway healthy, unrelated container IDs preserved.
- `post-deployment.json`: current health, restart counts, OOM flags, valid roster, validated snapshot/plugin inventory and resource availability.
- The Linux publication contract (17 assertions), existing no-op writer regression, five agent-activation checks, three seed checks and shell syntax checks also passed during image preparation. Protected build/test logs remain in `/opt/flolah-gateway-recovery/releases/20261023-config-guard-d` on the VPS; no private config or credentials are in this evidence directory.

This evidence covers gateway recovery and configuration prevention. It is not a claim of full browser/device Digital Adoption certification. Cold startup remains slower with hundreds of agent stores; this rollout reached health without a restart in under the 240-second readiness allowance.
