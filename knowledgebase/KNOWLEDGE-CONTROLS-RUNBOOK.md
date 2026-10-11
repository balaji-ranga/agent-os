# Knowledge selection and retrieval controls

## Source selection

Edit a Knowledge source and open **Content selection**. Add AND/OR conditions, select fields, and preview the first 100 normalized records. The preview is read-only, returns at most 10 samples, and is not a total count. Dynamic Knowledge-table fields use `fields.<column>`; the preview supplies observed field names. Missing fields do not match value conditions.

Empty field selection retains the existing safe adapter projection. An explicit field list replaces the indexed body with selected values. Include `text` only when the complete message/document body is intended. Stable record IDs and freshness metadata remain. Native relationships are retained only where their reference values are included.

Filters are membership rules, not incremental cursors. Provider-native Gmail query and Outlook folder scope remain available. Safe ERP numeric AND predicates are pushed to the provider with tenant constraints preserved; other conditions run after authorized fetching. Therefore filtering does not always reduce fetch costs. Relative-date conditions reevaluate membership each sync, even without provider changes.

Changing selection invalidates the old searchable snapshot until a successful new publication. Filter exits remove indexed copies; source business records are never deleted.

## Independent controls

- **Pause sync / Resume sync:** control scheduling and cancel active jobs when paused. Retrieval visibility remains unchanged.
- **Hide from search / Show in search:** control user and agent retrieval. Scheduling remains unchanged.
- Existing legacy enabled API retains its combined pause/hide behavior for compatibility.
- Previously disabled sources are not automatically exposed by this release.

## Relationships

New model links carry both endpoint content fingerprints. Unrelated source revisions do not invalidate these links. Changed, excluded, hidden or deleted endpoints cannot contribute stale links to retrieval. Legacy links without fingerprints retain conservative source-revision checks until regenerated.

The worker revisits relationship candidates after changed sources publish. Unchanged source/candidate fingerprints reuse previous inference; user rejection persists across revisions. Human-confirmed links are not demoted by automatic generation. Field rules resolve against the current index. Native references remain tied to the source record.

## Quality and feedback

Connected search includes a feedback form for wrong evidence, missing evidence and helpful results. Feedback is company-scoped, paginated and subject to configured Knowledge-history retention. It does not automatically retrain the model or modify indexed evidence.

Local gate: `npm run test:knowledge`, including `test-knowledge-controls.mjs`. Existing answer tests cover valid citations, insufficient evidence and failed generation. Real-index gate: `scripts/test-knowledge-opensearch.mjs`; it uses an isolated disposable synthetic index.

BrightBox gate: run the packaged `scripts/test-knowledge-controls-brightbox-live.mjs` with the explicit demo owner. It creates four retained acceptance sources over existing CRM, ERP, content and Knowledge fixtures; validates projection, reuse, pause, hide/show and filter exit/restore; leaves these sources sync-paused but searchable. It does not mutate provider records or the original demo source configuration.

## Deployment and rollback

### Agent RAG access

`master_data_rag` now enforces Workspace Knowledge source grants for ordinary company-document retrieval as well as connected retrieval. Ordinary document search reads only published, visible `knowledge` sources containing the `documents` collection, with no graph expansion. Source filters, field projection and record exclusions remain effective. Explicit document IDs cannot bypass these checks. Grant or visibility changes are rechecked after retrieval and optional summarization.

Built-in Platform Help remains platform-document-only and does not require a company source grant. Specialists may still receive public Flolah Help alongside authorized company evidence. Without company grants, ordinary mode returns help-only with an explicit company-access status; connected mode returns `knowledge_access_required` (403), not misleading empty evidence. Direct table tools, document listing/indexing, UI owner search and workflow queries are unchanged by this narrowly scoped fix.

For an existing company, configure a Knowledge source containing documents, index it, make it visible, and grant it in the employee workspace alongside the RAG tool grant. No automatic grants are created. Keep sync paused if only the last published snapshot is required. Local guard: `test-rag-knowledge-access.mjs`; real-index coverage runs in `test-knowledge-opensearch.mjs`; read-only BrightBox live guard: `KNOWLEDGE_TEST_OWNER=ceo-demo-brightbox-744921 node scripts/test-rag-access-brightbox-live.mjs`. The live guard needs the user-approved original Knowledge source visible and granted to COO, and the negative-control CRM employee ungranted.

The release runs `migrate-knowledge-object-id.mjs` before cutover to add searchable object IDs to existing snapshots. It reindexes stored copies in throttled batches without fetching provider records or regenerating embeddings; an unfinished migration blocks cutover. The new mapping remains backward-compatible on rollback.

Knowledge UI pagination audit: document lists and table rows already use server limit/offset; connected record browsing uses server cursors; connected evidence/relationships/citations use owner-bound result pages; rule/advice lists use server cursors. Ordinary document RAG excerpts now use `/rag/page`, five excerpts per server page, in both legacy Ask and unified Auto/Documents views. Ranked retrieval remains bounded to 20 excerpts, not an exhaustive match listing. Snapshot tokens expire after five minutes and reject cross-owner access or changed/deleted documents. No repeated model calls occur when changing pages.

Use `deploy/scripts/vps-deploy-knowledge-hardening.sh` with a reviewed patch against captured deployed source. Existing Dockerfiles copy the added modules and run the Knowledge harness before cutover. No new dependencies, secrets or environment variables are required. The release affects backend, frontend and Knowledge worker only; OpenClaw setup is unchanged.

Retain the script's image tags and database backup. Roll back those service images if needed. New SQLite tables/columns are additive; do not restore an old database over subsequent user activity without a separate recovery decision.
