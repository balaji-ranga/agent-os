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

## Post-cutover native acceptance

The approved hook setting was verified true after startup; extension integrity passed; the gateway reached healthy and WhatsApp reported listening at 21:53:59 SGT. Backend logs now show the actual native hook calling physical-context (HTTP 200), rather than relying only on an isolated mock registration.

Three new sessions were restricted to physical discovery/status tools, with channel delivery disabled:

- c3fa1541-25f4-4826-8b73-5ff2427db8c7: approximate PRISM power request selected the BroadLink IR device and send_power_toggle, 10.9 seconds, one successful physical_entities_list call.
- 55b51801-61ea-4ae2-91e6-da4b8849086b: living-room streaming-stick/Netflix request selected Fire TV and launch_app with app schema, 5.5 seconds, one successful discovery call.
- aa310802-8d1b-49cd-bd90-9c280a7d9e0d: ambiguous device request listed authorized devices/actions/policies and explicitly asked which device and operation, 6.5 seconds, one successful discovery call.

No physical invocation occurred. These validate native routing/clarification, not real power execution or WhatsApp delivery. A fresh test from the user's actual WhatsApp conversation remains requested. Sustained production stability requires observing real traffic; the synthetic index timing reduction does not eliminate all synchronous work.

## Actual WhatsApp failure and catalog correction

The user's real retest at 22:00 SGT still failed with hypothetical hub advice. The saved model-input report for conversation hash `914c098bc164` contained 106 tools, but no physical tools. Runtime inspection found 174 COO grants, including physical_entities_list, physical_invoke and physical_operation_get, while the plugin's 96-content-tool cutoff selected none of them. The earlier tests used explicit physical-only session scopes and therefore did not reproduce the failure. They are not acceptance evidence for the normal channel.

The first narrow correction prioritized generic physical control-plane tools under the legacy budget. The user then required every granted tool to remain available within provider limits. The revised implementation uses the installed OpenClaw structured Tool Search catalog: tool_search, tool_describe and tool_call. When this native compaction mode is enabled, the plugin registers all grant/session-filtered descriptors rather than discarding the tail. Native compaction handles the model-facing schema surface. The legacy cap remains only for deployments without this rollout setting.

The rollout uses AGENT_OS_NATIVE_TOOL_SEARCH=1 and structured controls, not JavaScript execution. No device names, command mappings, agent names or company-specific identifiers are embedded in the selection implementation. Existing backend tool leases, device permissions, policy checks and session restrictions remain authoritative. Installed-runtime and real-conversation acceptance results follow when completed; enabling the configuration alone is not a test pass.

### Native full-catalog evidence

Installed runtime test `backend/scripts/test-native-tool-search-installed.mjs` passed: 174 synthetic granted tools were cataloged behind three structured schemas; the final catalog entry was searchable, describable and callable; unknown tools and invalid input were rejected before the fixture executor ran. Grant isolation and active session restrictions passed separately. Existing prompt hooks and device policy tests also passed.

Production run `95c5ed67-cc98-4c86-9981-b983a632da29` used the original conversation with no session tool override. The runtime cataloged 171 available tools and exposed five schemas (`read`, `sessions_yield`, `tool_search`, `tool_describe`, `tool_call`). This verified removal of the 96-tool cutoff, but the response still failed grounding: a broad lexical search returned physical_invoke without inventory discovery, and the model repeated hypothetical advice. This run is explicitly a failed behavioral test.

With the same normal-policy catalog, `08098b6b-cb97-49e3-a4ab-84e79be950f3` called physical_entities_list through tool_call and correctly found the Fire TV launch_app / app=netflix schema (32.4 seconds). `2f763799-51a7-4d31-97be-ee187eec169c` performed discovery and asked which device and operation to control (6.7 seconds). Neither invoked a device. The ambiguity reply's state wording did not consistently label cached observations, so it is not evidence of current device state.

The shared guidance was then tightened to read the known physical_entities_list tool directly through native tool_call rather than treating a broad tool search as inventory discovery, and to disregard unsupported prior assistant claims. No device-specific names or operations were introduced. Retest of the original conversation is pending below.

### Prompt-submission handoff defect

Content-free llm_input diagnostics for `1975e7f2-7e02-4f90-b143-b50198c2c4ce` showed the bounded inventory in current-turn context but absent from the reported system prompt. That turn still did not perform authoritative discovery and described a toggle as an off command; it is not accepted as a behavior pass. Merely adding current-turn context was insufficient.

The installed native runtime constructs `runEmbeddedAttemptPromptPhase` options before assembly. Its context object captured `sessionRuntimeState.systemPromptText` by value. Assembly then called `setActiveSessionSystemPrompt` with plugin system guidance, updating shared state, but prepareEmbeddedAttemptPromptContext read the old captured string. That stale string flowed into preflight, llm_input and submitEmbeddedAttemptPrompt. The narrow installer changes this one context property to a getter, so post-assembly context preparation reads the current shared system prompt. No model, channel, company, agent, device or command names are encoded in the patch. The installer refuses an unknown or ambiguous runtime call-site shape.

The installed regression evaluates the actual runtime context-object construction, changes shared state as prompt assembly does, and verifies the post-hook value reaches context preparation. It also reconstructs the former by-value property and confirms that the same assertion detects the old stale snapshot. The temporary duplicated full current-turn inventory was removed; bounded system guidance and a short generic discovery reminder remain.

The installed native prompt regression passed before cutover: `NATIVE_PROMPT_CONTEXT_REGRESSION_OK`, with the previous snapshot explicitly shown to fail. Existing profile/physical prompt-hook tests also passed. Final gateway image: `agent-os-openclaw:native-prompt-context-20261104`; backend: `agent-os-backend:discovery-grounding-20261104`. Rollback references are retained in their release directories. Real original-conversation acceptance is still pending the post-cutover test; repeated cold-start and configuration-reload stalls remain a measured stability limitation, not a resolved issue.

## Final discovery acceptance (normal tool policy)

On the final image, llm_input for run `1fad3db9-5953-4cd0-be52-b26de3c75417` reported 74,275 system-prompt characters with `physicalContext=true`, `inventoryFirst=true` and `nativeDiscovery=true`. Before the native handoff correction these flags were false and the system prompt had 68,459 characters. The full catalog remained 171 available tools behind five visible schemas. No session tool override was used.

- **Exact target and operation inference:** `c2c167df-8faa-4b86-9bca-5cab36e14982`, 6.0 seconds. The prompt described changing the power state of the living-room television without supplying a device ID or action name. The agent called physical_entities_list through tool_call, with zero tool failures, and returned entity `d36abe9b-7317-4c52-9ee3-624e425689a6`, title `PRISM E55 — BroadLink IR (delivery receipt only)`, action `send_power_toggle`, input `{}`, policy autonomous. It correctly explained that the toggle switches off only if the TV is on. The requested JSON-only format was not followed; identifier/action selection was correct.
- **Different device/capability:** `4054c359-c48c-4a2e-8485-f1b00c9ed40d`, 6.5 seconds. Fresh physical_entities_list discovery, zero failures, selected Living Room Fire TV / launch_app / app=netflix and identified the approval/readiness limitation.
- **Ambiguity:** `c628c53e-a9f0-4560-a824-576d55e0fa5a`, 5.7 seconds. Fresh discovery, zero failures, listed authorized choices and asked which device and operation. The clarification behavior passed. Its unqualified wording about cached device state remains a limitation; it is not live physical-state evidence.
- **Actual WhatsApp delivery:** User retested the original explanation-only request and pasted the received reply. The corresponding final-prompt diagnostic run `0c5c0c07-2d11-4a4c-a35d-34165e825eb7` had all three guidance-presence flags true. The delivered reply identified send_power_toggle and explicitly explained both on-to-off and off-to-on behavior, rather than recommending a hypothetical hub or browser. Its shortened display name was PRISM E55; the separate exact-target check above established the actual BroadLink registry entry.

Raw sanitized test outputs: [normal-catalog cases](evidence/physical-discovery-normal-catalog-20261104.json) and [exact-target case](evidence/physical-discovery-exact-target-20261104.json). They record run IDs, times, normal-policy/no-delivery flags, tool summaries and replies. No physical_invoke or power action was tested in this sequence. These results establish discovery, inference, ambiguity handling and actual WhatsApp explanation delivery; they do not certify hardware execution or sustained gateway performance.

**Remaining stability limitation:** cold startup/configuration reload and memory indexing still produced synchronous SQLite stalls, including delayed heartbeats and handshake timeouts. The earlier delta/reopen changes reduce work but have not eliminated those stalls. Do not mark SQLite performance or overall gateway stability fully resolved from these discovery passes.
