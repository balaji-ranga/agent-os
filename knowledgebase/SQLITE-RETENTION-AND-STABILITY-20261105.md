# Company SQLite retention and gateway validation — 5 November 2026

## Policy contract

The existing CEO/company retention setting remains authoritative (30, 60, 90, 120 or 365 days). Company employees inherit that scope. No retention duration was shortened. The existing daily data-retention cron remains in place (default 03:15 server timezone; this deployment uses Singapore time).

Backend SQLite tables are explicitly classified in `backend/src/services/retention-policy-registry.js` and `retention-coverage.js`. History is deleted in bounded transactions; retained replay receipts have their expired payloads redacted. Active work, configuration, credentials, registrations, reference data, deduplication keys and synchronization authority are not treated as disposable history. Unknown tables produce an incomplete result rather than inferred deletion authority. Platform-wide records without company ownership cannot be deleted under one company's policy.

The shared platform and company SQLite stores are both covered. Child deletion checks company ownership and active status; unhandled foreign-key dependents block deletion. Physical history uses its live control-plane adapter, preserving registered devices and operation replay protection. Existing media and OpenSearch cleanup remains separate.

Native agent SQLite cleanup is queued by company and executed in a separate gateway child process. It validates agent identity and schema 19. Expired message/custom/compaction payloads are redacted through OpenClaw's exact-row rewrite API, preserving event IDs, branches and tool-call/result structure. Associated search/vector copies are removed. Persistent pending-cleanup markers recover interrupted runs; a mutation fence rejects stale queued index snapshots. Active sessions defer cleanup and are reported as incomplete. Native operational state and structural identities are retained, not indiscriminately deleted.

The retention API now includes the latest native cleanup status. Native completion is asynchronous: a backend job being successful does not imply the native worker has already finished. No live VACUUM or forced full checkpoint is introduced.

## Verification

- Backend fixtures: ownership boundaries, active/recent preservation, bounded batches/event-loop yielding, transactional rollback, redacted replay receipts, unknown-table preservation, physical payload cleanup.
- Production database copy: eligible company history removed; foreign-key violations remained zero; other companies' chat counts unchanged. The disposable copy was removed.
- Installed native schema/SQLite-vector/FTS fixture: canonical redaction, preserved identities, removed derived copies, retry after an interruption following canonical commit, idempotent rerun.
- Installed native memory writer: stale pre-retention snapshot rejected; fresh snapshot accepted; unchanged vectors/FTS not rewritten.
- Existing physical API authorization, owner isolation, SQLite reopen, native prompt handoff and FloAssist reply-hook regressions passed in candidate builds.
- Live asynchronous **read-only** worker job `3f002ab8-3836-40b9-961b-77b1d2175317`: completed, 45 company agent databases, 1,150 eligible expired payloads, zero errors. No production payloads were deleted by this test.

## Deployment and performance evidence

Backend and gateway retention release deployed as `retention-sqlite-20261105`. Both containers became healthy; WhatsApp resumed listening. Only these two services were recreated, using their existing image bases and compose configuration, guarded against concurrent image changes.

Isolated native writer benchmark, 10,000 chunks × 1,536 embedding dimensions: unchanged reconciliation reduced from approximately 7,518 ms to 2,331 ms; changed reconciliation from 7,691 ms to 2,241 ms. The implementation scans vector IDs once, reuses embedding serialization and prepares native insert statements once per transaction. These are fixture timings, not an end-to-end WhatsApp latency guarantee.

Deployment exposed repeated config-validation restarts while backend publication was in progress. The gate now retries validation of the latest revision up to three times without repeating container setup. Continuous changes and invalid configurations still block startup; last-good configuration is not replaced by either. The isolated convergence test passed. The corrected gate is included in the release image and installed in the running gateway for its next startup, without another restart.

## Remaining limits

Cold gateway startup still logged a slow native database open, and synchronous index transactions still take seconds on large fixtures. Overall gateway stall elimination is **not** established by these results. The large COO store had no expired payloads under its current 90-day policy, so retention is not a substitute for further cold-open/indexing performance work.

The live worker test was a preview. Production deletion will use the configured maintenance run; this record does not claim that all production history has already been purged. Workflow/device actions and WhatsApp messages were not sent during these tests.
