# Flolah Knowledge Management — Capability Review

Date: 11 October 2026 (Asia/Singapore)

Status: Review and recommendations only; not an implementation or deployment commitment.

## Scope

Identify missing core capabilities for efficient, trustworthy knowledge management. Additional source connectors are excluded: they can grow using the established connector pattern. Desktop and Android automation are outside this review.

The assessment is based on the local implementation reviewed on this date. It is not a fresh certification of the deployed VPS.

## Existing foundation

Flolah already has incremental indexing, source schedules, retries, indexed-record lifecycle actions, relationships and cited search. The next improvements should focus on controlling what becomes knowledge, keeping it trustworthy, and measuring retrieval quality—not replacing the existing architecture.

## 1. Source filters and field selection — highest priority

### Current state

Configuration supports collection selection, Gmail queries and Outlook folders. It does not provide a consistent schema-aware filter and field-selection builder across sources.

### Recommendation

Add a **Content to include** section to each source:

- CRM: active companies, selected countries or opportunity stages.
- ERP: selected document types, submitted invoices and date ranges.
- Knowledge: selected tables/documents, categories or tags where supported.
- Content: folders, file types and exclusions.
- Field selection: include useful business fields and exclude sensitive or irrelevant fields.

Expose only fields and operators supported by the source contract. Support AND/OR conditions and a preview of matching records. Do not accept arbitrary SQL or executable filter code.

Push filters to the provider where supported. Clearly indicate when filtering happens after fetching, since that does not reduce provider-fetch cost. Authorization constraints must always apply independently of user filters.

### Incremental behavior

Selection filters and incremental tracking are separate:

- Filters determine which records are eligible.
- Provider cursors, versions or change tracking determine which eligible records changed.
- Changing a filter must trigger membership reconciliation.
- Records that stop matching, including those leaving rolling date windows, must leave the searchable index and relevant relationships.
- Cleanup affects indexed copies only, never original business records.

A date filter alone is not a complete incremental mechanism: it can miss deletions and changes to older records.

## 2. Separate synchronization from search availability

### Current state

Pausing a source also excludes it from search.

### Recommendation

Provide independent controls:

- **Pause synchronization:** retain searchable knowledge and show its freshness.
- **Disable retrieval:** hide knowledge from users and agents.
- **Remove indexed content:** perform an explicit lifecycle action.

This separation supports maintenance and resource management without unnecessarily removing useful knowledge.

## 3. Version history and knowledge governance

### Current state

The current record view shows the current indexed version, not a usable historical revision browser.

### Recommendation

Add:

- Revision history and readable differences.
- Knowledge owner, review date and expiry.
- Published, outdated and superseded states.
- Duplicate and conflicting-record identification, with a preferred authoritative source.

Historical answers must distinguish what was known at a previous time from current facts. Historical retention must respect configured retention and access controls.

## 4. Relationship maintenance, not just creation

### Recommendation

Automatic mapping needs ongoing maintenance:

- Revalidate links when relevant fields change.
- Remove obsolete links when records disappear or leave scope.
- Avoid rerunning inference for unchanged records.
- Preserve human corrections across subsequent synchronization.
- Distinguish source-defined, model-inferred and human-confirmed relationships.

The current model-link eligibility uses source revisions. Record-level dependencies would reduce unnecessary invalidation of unchanged relationships and inference work.

Model confidence alone is not proof that a relationship is correct. Keep supporting evidence and provenance available, and apply tenant/access checks throughout retrieval and graph expansion.

## 5. Retrieval quality measurement and feedback

Successful indexing does not necessarily mean useful answers.

Add a repeatable acceptance suite covering:

- Correct record and relationship retrieval.
- Irrelevant-record exclusion.
- Citation accuracy.
- Appropriate insufficient-evidence responses.
- Retrieval latency and model cost.

Add wrong-evidence and missing-evidence feedback. Use measured results to decide whether reranking, chunking changes or relevance thresholds are needed, rather than adding these indiscriminately.

## 6. Generic freshness and live verification

Live verification should be an explicit capability supported by individual source adapters, rather than an ERP-specific checkbox.

For supported records, offer:

- Indexed snapshot only.
- Verify current values when available.
- Require current values and explicitly report unavailable verification.

Show which fields were verified and when. This is particularly important for balances, payment status, inventory and other changing values.

Live verification must be authorized and read-only. Unsupported sources must not imply that indexed snapshots are current live values.

## 7. Finer-grained access and processing controls

### Current state

Connected-knowledge access includes owner isolation and agent source grants. Source scheduling, retries and operational statistics already exist.

### Recommendation

Extend the foundation with:

- Record/document-level source permission propagation where available.
- Sensitive-field exclusion before embedding or model processing.
- Per-source workload budgets, backlog age and freshness targets.

These are extensions to the current controls, not a claim that scheduling or access control is absent.

## Recommended next implementation scope

Prioritize these four items together:

1. Source filters and field selection, including preview and membership reconciliation.
2. Independent synchronization pause and retrieval visibility controls.
3. Record-level relationship maintenance and preservation of human corrections.
4. Repeatable retrieval-quality tests and actionable evidence feedback.

These provide the largest immediate improvement while retaining existing connectors, indexing, graph retrieval and lifecycle architecture.

## Verification references

Implementation paths inspected or relevant to the review:

- `backend/src/services/knowledge-contract.js` — current source configuration contract.
- `backend/src/services/knowledge-agent-access.js` — agent/source access checks.
- `backend/src/services/knowledge-search.js` — indexed retrieval and graph data.
- `backend/src/services/knowledge-mapping-advice.js` — inferred relationship lifecycle.
- `backend/src/services/knowledge-live-values.js` — live-value verification.
- `backend/src/services/knowledge-record-management.js` — indexed-record lifecycle actions.
- `frontend/src/components/KnowledgeSources.jsx` — source controls and pause behavior.
- `frontend/src/components/KnowledgeRecordBrowser.jsx` — current record/version presentation.

No application changes are made by this review. This document is saved locally; publishing or pushing it requires a separate request.
