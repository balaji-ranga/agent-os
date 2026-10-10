# Knowledge Auto-Indexing, OpenSearch Graph RAG and Device Automation

Date: 2026-10-10

Status: Agreed implementation plan; this document does not claim implementation, deployment or test completion.

## Release objective

Deliver one coordinated release covering automatic source indexing, OpenSearch-based Graph RAG, Windows native automation and managed Android automation. Reuse Flolah connectors, vault credentials, workflow execution, agent tool grants and paired-worker infrastructure.

The principal acceptance scenario connects CRM, ERP and Knowledge documents and demonstrates that an agent retrieves related information with evidence. Neo4j is not required for this release. The separate `knowledgeGraph.md` proposal concerns agent-behavior intelligence and is not replaced by this business-knowledge plan.

## 1. Checkpoint and compatibility

- Create a rollback checkpoint and back up relevant configuration and persistent-state schemas before implementation/deployment.
- Pull latest main and implement in an isolated worktree; reconcile concurrent changes before pushing.
- Use additive schemas and independent feature flags for source synchronization, Graph RAG and device automation.
- Preserve existing RAG tool contracts, workflow runners, browser workers and OpenClaw setup.
- Keep Classic and Immersive experiences functionally equivalent.
- Keep source, Docker, setup and deployment files aligned.

## 2. Connector and source integration

Reuse existing connector authentication, vault credentials and user-scoped access. Add **Use in Knowledge** to supported connectors without creating a duplicate OAuth connection.

Initial adapter scope:

- CRM and ERP records from the configured providers.
- Google Drive and OneDrive/SharePoint documents.
- Gmail/Outlook messages and selected attachments.
- Approved local folders on paired desktops.

Each adapter supports discovery, incremental changes, content fetching/export and permission resolution. Explicitly identify missing provider operations or account scopes during setup.

Track owner, connection, source, object ID, revision/content hash, permissions and synchronization cursor. Handle initial import, full pagination, updates, deletes, duplicate/out-of-order events, expired cursors, rate limits and reconnects. Persist discovered work before advancing its cursor. Combine notifications with periodic reconciliation; do not infer deletion from incomplete listings.

## 3. Knowledge UX

### Connectors

Connectors remain the place to connect and authorize providers. **Use in Knowledge** opens source configuration using the existing authorized connection.

### Knowledge tabs

- **Ask & Search:** one question box with **Auto**, **Documents** and **Connected information** modes.
- **Sources:** configure scope, synchronization, retention and optional relationship indexing.
- **Documents:** inspect extracted content, versions, processing status and original source references.
- **Relationships:** readable relationship lists with an optional interactive graph.

Source setup:

`Choose connection -> Select scope -> Configure sync -> Enable relationships -> Review -> Start`

Users select folders, mailbox labels, supported business-record scope or approved desktop directories; included content; initial import range; sync frequency; and retention. **Connect related information** enables graph extraction per source.

Show **Syncing**, **Up to date**, **Needs attention** and **Paused**, with last success, pending/indexed counts, individual failures and **Sync now**, **Pause**, **Edit** and **History** controls. Distinguish **Searchable** from **Relationships processing**.

Answers include citations, freshness and an expandable **Sources and evidence** panel showing passages, source links, relationships followed and live source lookups. Missing or incomplete evidence is explicit.

Clicking a relationship shows its evidence, source version and last update. Ambiguous identity matches appear as suggestions for review, not established facts.

### Agent and workflow UX

Agent Workspace gains **Knowledge access** for permitted collections and retrieval modes, consistent with existing tool grants. Workflow knowledge nodes gain source/collection selectors. Chat and goal traces show sources and relationships actually retrieved.

Connectors manage access, Knowledge manages indexed content, and agent/workflow permissions control use.

## 4. Durable document processing

Processing stages:

`Discover -> Fetch -> Extract -> Chunk -> Embed -> Publish revision -> Update relationships`

- Persist ingestion jobs with durable content references rather than complete documents in memory.
- Stream downloads, process large documents incrementally and resume interrupted work.
- Use structure-aware chunks retaining headings, page/sheet references and source links.
- Support existing document formats and scanned-document OCR. Audio/video transcription is outside this release.
- Build new document revisions separately and activate only after successful indexing. Retain the current searchable revision during processing.
- Remove deleted or access-revoked content from retrieval eligibility promptly; invalidate dependent graph evidence and caches.
- Keep failed/unsupported items visible with specific reasons and retry controls.

## 5. OpenSearch Graph RAG

Retain current document/vector indexes and add entity and relationship indexes. Every entity/relationship includes tenant scope, source-system IDs, original record references, relationship type, supporting record/chunk references, source revision and timestamps.

Establish relationships from:

- Native CRM/ERP relationships.
- Explicit cross-system ID mappings.
- Document references to business records.
- Evidence-backed extraction when structured references are unavailable.

Names alone must not establish identity. Prefer stable business identifiers; unresolved mappings require review. Keep inferred relationships distinguishable from authoritative source relationships.

Verify the installed OpenSearch version and native graph traversal support. Otherwise implement bounded traversal through successive searches behind the same retrieval interface.

Retrieval combines keyword/vector search, relevant relationship expansion and supporting passages. Fetch changing values such as balances/payment status through authorized source APIs when needed, and expose freshness.

Apply caller, agent and source permissions before retrieval and at every traversal step. Relationships never grant access to their targets. Invalidate affected edges, evidence and caches on deletion or permission changes. Broad corpus-wide community summaries are outside the initial release.

## 6. Agent and workflow contracts

Extend the existing knowledge tool with optional retrieval mode and collection scope while preserving current inputs/outputs. Add structured citations, source freshness and relationship evidence.

The agent interprets evidence and produces the answer. Retrieved content is data and cannot grant permissions or override instructions. Credentials remain in the vault and are never embedded into documents, graph records or prompts.

## 7. Windows and Android automation

Extend the paired worker with Windows UI Automation for native apps and Appium/UiAutomator2 for registered managed Android devices. The mobile UI can also start and monitor paired-desktop jobs.

Support application/window or screen observation, accessible element discovery, data entry, clicking/tapping, navigation, screenshots and artifact capture. Prefer application APIs, then accessibility selectors; use observed visual interaction where required.

Expose capabilities through existing agent grants and workflow nodes. Provide device selection, permitted applications, live progress, cancellation and a local stop control.

Return observed outcomes and evidence for each step. Serialize foreground actions per device/session. Recover from verified checkpoints and inspect uncertain side effects before repeating writes.

Android setup requires registered devices and appropriate developer/debugging configuration. Show offline/locked-device states and recovery instructions. Unrestricted autonomous Accessibility automation in a public mobile app and iOS native automation are outside this release.

## 8. Performance and resource controls

- Separate interactive retrieval from ingestion and graph-extraction capacity.
- Replace the shared long query-embedding wait with a short configurable deadline and visible lexical-search fallback.
- Bound relevance checking and answer generation; distinguish retrieved candidates from validated answer evidence.
- Persist background jobs with configurable parallelism, checkpoints, backoff and provider retry-after handling.
- Cache embeddings by content hash and model version.
- Reprocess changed content and affected relationships only.
- Bound graph depth, expanded records, evidence size and total query duration.
- Apply worker/container CPU and RAM limits; measure memory, throughput, queue age, latency and failure rate.
- Execute one foreground job per desktop session/Android device; independent devices may run concurrently.
- Capacity limits defer processing into durable jobs rather than holding large payloads in RAM.

Set measurable latency, throughput and memory acceptance thresholds from a baseline before release testing. Do not claim capacity without measurements. Retrieval eligibility checks must exclude revoked content even when background cleanup is pending.

## 9. Mandatory CRM + ERP + Knowledge acceptance test

Use an isolated test user with real configured test connectors and controlled records:

- CRM customer, account contact and project.
- Corresponding ERP customer and overdue invoice.
- Knowledge contract linked to that customer/project and renewing next month.

Through the UI, enable both connectors, select indexing scope, add the contract source and enable relationship indexing. Establish cross-system relationships using supported mappings and source evidence, not hidden test-only injection.

Test prompt:

> Which customers have overdue invoices and contracts renewing next month? Show the account contact, project, outstanding amount and renewal terms, with supporting sources.

Required outcomes:

1. Identify the expected customer through established relationships.
2. Correctly combine CRM contact/project data, ERP invoice data and contract passages.
3. Show citations, relationship evidence, source freshness and any live connector calls in the UI/trace.
4. Require no manually injected answer or hidden test-only relationship.
5. Reflect an updated invoice and revised contract in subsequent answers.
6. Avoid duplicate entities/relationships after replayed synchronization.
7. Avoid joining different customers with identical/ambiguous names.
8. Prevent a second user from retrieving these records or graph evidence.
9. Exclude evidence after source deletion or access revocation.

Additional synchronization tests cover pagination, out-of-order events, expired cursors, worker restart, interrupted indexing, rate limits and reconnects.

## 10. Regression, VPS validation and completion

Run local harness tests for synchronization, graph retrieval, permissions, recovery and performance. Validate existing document uploads, RAG tools, browser workers and workflow execution.

Repeat the mandatory CRM/ERP/Knowledge scenario interactively on VPS using the isolated test user. Demonstrate one real Windows task and one managed Android task with evidence, cancellation and recovery checks. Required devices and authorized connectors must be available; missing prerequisites must be reported rather than counted as passing tests.

Deliver commit/deployment identifiers, test record IDs, prompts, actual outputs and execution-trace references. Completion requires the end-to-end CRM -> ERP -> Knowledge query to pass, plus the declared device tests; successful indexing or individual tool calls alone are insufficient.

Deploy workers separately from the request-serving backend. Rollback disables the new features/workers without deleting current indexed documents or changing existing workflow contracts.

## Reference documentation

- [Google Drive change tracking](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Microsoft Graph drive delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta)
- [OpenSearch graphLookup](https://docs.opensearch.org/latest/sql-and-ppl/ppl/commands/graphlookup/)
- [Windows UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview)
- [Appium drivers](https://appium.io/docs/en/2.17/ecosystem/drivers/)
- [Android AccessibilityService policy](https://support.google.com/googleplay/android-developer/answer/10964491)
