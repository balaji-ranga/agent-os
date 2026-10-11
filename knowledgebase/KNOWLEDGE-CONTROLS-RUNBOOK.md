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

Use `deploy/scripts/vps-deploy-knowledge-hardening.sh` with a reviewed patch against captured deployed source. Existing Dockerfiles copy the added modules and run the Knowledge harness before cutover. No new dependencies, secrets or environment variables are required. The release affects backend, frontend and Knowledge worker only; OpenClaw setup is unchanged.

Retain the script's image tags and database backup. Roll back those service images if needed. New SQLite tables/columns are additive; do not restore an old database over subsequent user activity without a separate recovery decision.
