# Knowledge Efficiency monitoring

Efficiency View → Knowledge (`/efficiency?tab=knowledge`) uses the existing Efficiency theme, cards, tables and date-range selector. Sources, run history and ranked agent usage are paged on the server (20 rows). Select a source or agent from its row to filter; clear the filter to return to the company view.

## Authorization and data

The read-only `/api/efficiency/knowledge` endpoint requires authenticated full company access. Tenant identity comes from the authenticated context; query owner selectors are not accepted. Admin must use an authenticated company user-view context. There is no all-company endpoint or agent bypass. Each SQL and OpenSearch query scopes to the resolved tenant; a foreign source filter fails closed.

Sync figures reuse retained job history. Inventory counts aggregate only published source revisions, with zero document bodies returned. Inventory is unavailable rather than zero if OpenSearch fails. Paused sources may still have a published index. Index counts are connected-source inventory, not the separate legacy raw upload corpus.

Agent `master_data_rag` calls record mode, agent identifier, outcome, returned record count, returned relationship count, source IDs and elapsed milliseconds. Prompts, document text, raw error messages and credentials are not recorded. Evidence is deduplicated within a call; it is not deduplicated across calls and is not a measure of final-response citations. Built-in Help can contribute to ordinary RAG counts. Telemetry failures never change a tool result or suppress the original tool error. Knowledge-management list/browse calls are excluded. Direct UI searches and other RAG tools are not counted as agent calls.

Records start at rollout; no invented historical agent usage. Profile retention cleanup removes the telemetry with the same company cutoff. SQL uses owner/time indexes and server aggregates; no content scans or embeddings run for this dashboard. Source filters apply only where returned evidence identifies the source, not denied attempts. Agent filters do not filter source synchronization. Provider totals/coverage gaps, final citations, extraction/embedding timing, attributed cost and unique records across calls are explicitly not recorded. Latency includes the whole agent tool, including optional summary generation.

## Validation and deployment

Local backend harness: `cd backend && npm run test:knowledge-efficiency`, followed by `npm run test:knowledge`. The harness covers isolation, source-filter rejection, paging, metrics, filters, p95, retention, content-free telemetry, original-error preservation and search downtime.

Local UI fixture: run frontend Vite on loopback and open `/scripts/knowledge-efficiency-harness.html`; `?scenario=empty` and `?scenario=error` exercise empty/error states. It uses synthetic data and makes no backend calls. Run `npm run build` for production validation. Stop the local server after testing.

No new service, package, environment variable or OpenClaw change is required. The telemetry table and indexes are additive/lazy-created; the standard source-copy Docker builds include them. The Knowledge release image runs the new harness before cutover. Rollback can retain the unused telemetry table. VPS deployment requires separate user approval.
