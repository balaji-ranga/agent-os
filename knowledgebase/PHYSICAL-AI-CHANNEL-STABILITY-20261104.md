# Cross-channel physical discovery and gateway SQLite — 2026-11-04

## Incident and root causes

The WhatsApp request to switch off a registered TV produced browser advice, then a hypothetical hub answer. Web chat had received physical capability context, but native channel turns lacked it. The native plugin hook was also blocked by OpenClaw because `plugins.entries.agent-os-content-tools.hooks.allowConversationAccess` was absent. A mock hook test or a successful tool-restricted native test alone does not prove production hook registration. The user explicitly approved enabling this setting on 4 November; device permissions and Actions Policy remain unchanged.

Structured production diagnostics captured a 30,980 ms synchronous transaction inside memory-core `writeChunks`. The COO agent database was approximately 1.4 GB, with an approximately 547 MB WAL at inspection. Its largest WhatsApp shared-main transcript had 80,070 events. Reopens additionally ran full SQLite integrity checks even after the same process had validated the database. Delayed heartbeats and WhatsApp 408 reconnects were observed. No historical transcript was deleted or truncated.

## Implementation

- Web chat and the native gateway consume the same `physicalAgentInstructions` contract. Discover authorized devices first; inspect device/site descriptions, actions, input schemas, expected effects and policies; infer intent; clarify ambiguous matches; copy exact discovered IDs; never substitute browser control or hypothetical equipment. Existing approval, resource and company controls remain authoritative.
- A broker-authenticated, private-service-only physical-context endpoint resolves the owner and agent from a tenant-bound session. It reuses permission-filtered asset discovery, accepts no model-supplied owner, and sends no credentials to the LLM.
- Native hooks put physical context in system context. Requests are bounded to three seconds, without cross-session caching; failed context reads instruct authorized discovery and a clear failure response rather than silent retry.
- Validated database reopens retain owner/schema/index-contract checks while avoiding redundant full integrity scans. First opens, pending migrations, invalidated caches and changed file identities retain full checks. Installers fail on unknown runtime code shapes.
- Memory indexing retains unchanged vector/FTS rows and deletes obsolete rows within the existing transaction. Chunk metadata, source records and cache updates retain native handling. Changed/empty embeddings, missing vectors, changed search content, rollback and degraded-vector fallback are tested. This reduces work but does not move all indexing off the gateway thread.
- Content-free slow-transaction call-site diagnostics identify the blocking writer without recording SQL parameters or message contents.

## Validation

Passed local tests: physical native context (grant gate, bounded responses and failure guidance), shared physical context, physical policy context, profile timezone, native budget concurrency, and memory delta rollback/source isolation.

Installed gateway fixture tests passed with no network or production volumes: actual prompt-hook composition and scope restrictions; SQLite initial/reopen/migration/owner checks; real sqlite-vec and FTS memory writer initial/repeated/changed writes with consistent row counts.

Synthetic benchmark, 10,000 chunks with 1,536-dimensional embeddings: baseline repeat/one-change writes 13,990 / 14,312 ms; candidate 8,033 / 8,001 ms. These measurements are not production latency guarantees, and first ingestion still performs substantial work.

Before the hook permission was enabled, a separate native read-only run completed in 9.2 seconds using physical_entities_list and correctly identified the IR toggle. The user's actual WhatsApp test still produced hypothetical advice, exposing the blocked hook. Do not count that earlier isolated run as end-to-end WhatsApp acceptance.

Deployed images: `agent-os-backend:whatsapp-stability-20261104` and `agent-os-openclaw:whatsapp-stability-20261104`, layered on captured live images with concurrent-deployment guards. Rollback manifests reside in `/opt/agent-os-releases/whatsapp-stability-20261104`. Only backend/gateway were recreated. Production hook activation, live channel clarification and post-cutover stability observation are pending final verification.


## Deployment configuration correction

The configurator previously rewrote allowConversationAccess from the marketing-attribution flag alone on every startup, undoing the approved CLI change. It now preserves explicit approval and supports AGENT_OS_CONVERSATION_CONTEXT_ENABLED=1 (explicit 0 revokes). The approved production gateway override uses 1; no new default grant is introduced for unapproved installations. Startup policy tests cover preservation, explicit enable and explicit revoke. The final gateway image is agent-os-openclaw:whatsapp-hook-20261104.

## Channel integration contract

Every channel must enter either the common web executor context or the native prompt hook with an authenticated tenant/agent/session. Future channel adapters must not construct their own device-specific prompts. Physical discovery is grant-filtered; operation descriptions, schemas, policy modes and evidence requirements remain server-managed. Ambiguity requires clarification rather than arbitrary target selection. This is shared runtime guidance, not a PRISM-specific skill or list of hardcoded verbs.
