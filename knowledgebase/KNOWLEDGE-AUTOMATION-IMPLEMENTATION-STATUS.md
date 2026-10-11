# Knowledge automation implementation status

Updated: 2026-10-11 (Asia/Singapore)

This is a work-in-progress checkpoint, not a completed release or acceptance report.

## Checkpoints

- Implementation base: `264f4766a03f52ed54890bf176348a15fb4ac4d2`.
- Published rollback tag: `checkpoint/knowledge-automation-20261011`.
- Isolated branch: `codex/knowledge-automation`.
- VPS backend/frontend image rollback tags: `rollback-knowledge-20261011`.
- Restricted VPS source/config archive exists; no production application restart or replacement was performed.
- The VPS checkout has extensive existing uncommitted deployment changes. Preserve these and establish release provenance before deployment.

## Implemented foundation

- Source contracts for configured CRM, ERP and Flolah content.
- Persistent source/job/mapping state, job leases and idempotent enqueue.
- Versioned OpenSearch entity/chunk/relationship projection with publication after successful synchronization.
- Native relationship references and explicit cross-system mappings; no joins on names alone.
- Owner-filtered, bounded relationship retrieval and source eligibility checks.
- Additive source management/search/relationship UI, gated by `KNOWLEDGE_SYNC_ENABLED`.
- Optional separate worker compose overlay; not deployment-validated yet.
- Shorter configurable query embedding deadline; ingestion keeps its existing longer budget.

## Validation completed

- `npm run test:knowledge`: contract and lifecycle harnesses pass. Lifecycle tests use mock source/search adapters and in-memory SQLite; these are not end-to-end acceptance tests.
- Frontend production build passes with existing large-bundle warnings.
- Isolated VPS adapter probe using an existing demo user: CRM returned 67 records, ERP returned 27 records, Flolah content returned 0 eligible records. This only validates adapter reads; it does not prove the mandatory cross-system answer.
- No application deployment or full graph acceptance test has completed.

## Remaining release gates

1. Real OpenSearch integration tests, concurrent lease/snapshot publication tests, retention cleanup, connector pagination and revocation tests.
2. Controlled CRM/ERP/content fixtures and the exact mandatory overdue-invoice/renewing-contract query with actual answer synthesis, citations, edits, duplicate sync and second-user isolation.
3. Full source lifecycle: incremental cursors, per-object jobs/history/retry, large-file extraction/OCR, embedding reuse, source-boundary revalidation and live changing-value lookups. The initial content adapter exposes a visible large-file limitation and must be replaced before release.
4. Complete four-tab UX, document/revision view, friendly relationship selectors/evidence, connector entry points, agent knowledge grants and workflow integration.
5. Cloud-file/email source adapters and their harnesses; account authorization and real provider tests deferred to the final human interactive stage.
6. Windows native UI and Android adapters, device permission/cancellation/recovery UX and device tests.
7. Compose/configuration validation and measured resource/latency thresholds.
8. Reconcile latest main and deployed sources, back up persistent state, deploy validated images, and repeat the full acceptance scenario interactively.

Do not enable the feature in production or describe the planned release as complete based on these foundation tests.
