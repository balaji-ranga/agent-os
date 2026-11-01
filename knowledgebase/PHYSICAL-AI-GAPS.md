# Physical AI — engineering gaps and acceptance registry

Internal engineering knowledge base. Public docs describe capabilities, supported boundaries and how to use them; track defects, test history and implementation work here.

Recorded 1 November 2026. These are additive enhancements to Flolah's existing company OS. Code, documentation or simulator tests alone do not close a hardware or live-agent acceptance gap.

## Decision: server-managed configuration, lightweight edge

Flolah should own versioned device definitions, operation/input schemas, approved app catalogs, site/hub assignments, adapter bindings, expected observations and policy. Deliver only the configuration relevant to each authenticated hub over its existing outbound connection.

The edge should retain a validated configuration cache, curated protocol adapters, local credential references, a small durable operation journal and local safety enforcement. Secrets remain local. Server configuration references local credential aliases, not secret values. Agents consume public registered capabilities; they do not need YAML, package IDs, LAN addresses or credentials.

Adding a device or operation supported by an installed adapter must become a server configuration change. A new protocol still requires a reusable reviewed adapter release. Configuration must never supply arbitrary executable code, shell commands or module paths.

**Suite 0.3.0:** supported HA device/operation mappings can be staged from Flolah, validated by the selected hub, durably cached and rolled back. Adapter endpoints, credentials and legacy native wake bindings remain local. The managed editor supports approved app catalogs and fixed HA scripts/buttons with independent feedback. New protocols and native wake binding management are outside this first managed binding version.

## Priority 1: generic configuration and execution

### PHY-G01 — Central, versioned device/operation bindings — IMPLEMENTED FOR PHASE 1 HA TRANSPORTS

Move non-secret mappings into company/site/hub-scoped server configuration. Validate installed adapter and schema versions before atomic activation; retain the last valid cache. Bind commands to approved capability/configuration versions and fail closed on stale or incompatible configuration.

Acceptance: add a second device and an operation using an existing adapter entirely through Flolah, without rebuilding or editing edge source/files. Test cross-tenant and wrong-hub rejection, interrupted delivery, invalid bindings, offline cache and rollback. New operations remain prohibited until explicitly reviewed; configuration cannot silently grant authority.

### PHY-G02 — Administrator mapping UI and discovery — IMPLEMENTED FOR PHASE 1 HA TRANSPORTS

Add forms driven by adapter schemas to discover/select local integration entities, define operations and friendly inputs, and bind independent feedback. Normal users register/select devices and issue commands without JSON or package IDs. The existing registration dashboard reviews discovered capabilities; it is not a mapping editor.

Acceptance: onboard media and non-media devices; add, disable, update and roll back an operation using the same UI. Reject unsupported bindings and unobservable completion contracts. Use **Physical AI → Device mappings** for supported managed bindings. Local-file configuration remains a compatibility path for existing deployments.

### PHY-G03 — Grounded LLM tool selection — IN PROGRESS

Provide explicit tool envelopes and current owner-scoped device schemas to entitled agents. Preserve discovery/invoke/status tools in bounded sessions. A registered-device command must not become desktop browser navigation merely because an application also has a website. New requests need fresh idempotency keys; retries retain the original key.

Evidence: an authorized employee discovered Netflix/YouTube with `physical_entities_list` and prepared correct `physical_invoke` arguments. A retry incorrectly selected `browse_task_start`; that is a failed route, not TV success. Owner-scoped device context, exact-route tool isolation and explicit model-visible tool envelopes are now deployed. A post-update employee-originated YouTube request now passed company and device human approvals, completed through the laptop edge and HA, returned fresh matching app-state evidence, and was visually confirmed by the user. Coverage for every authorized employee and negative/retry cases remains required. Do not treat a selected route alone as executed control.

Acceptance: ordinary commands through each authorized employee select the real asset/action and friendly input, respect approvals and report matching operation evidence. Test ambiguous sites, prohibited/unknown operations, unavailable devices and retries without browser substitution or invented commands.

### PHY-G04 — Executable arguments — VALIDATION IMPLEMENTED; LIVE EMPLOYEE COVERAGE REQUIRED

An executable step must contain resolved, schema-valid arguments, not placeholders or invented actions. Discovery/resolution must complete first. One device command need not become a goal plan solely because approval is required.

Evidence: COO's preparation test produced unresolved device/action placeholders. The approval gate blocked execution; that test plan was cancelled. Acceptance requires a bounded direct flow or a properly grounded delegation/plan, with placeholder rejection before execution.

### PHY-G05 — Concrete and coherent approvals — EXPLICIT TWO-GATE REVIEW IMPLEMENTED

Display device, site/hub, action and allowed input values in company approvals. Physical company tasks now include the registered asset, device title, site, hub, action and bounded input summary; operation cards display exact input arguments. Explain company Action Control versus device operation approval; preserve payload hashes, one-use authority and expiration.

Explore a single coherent review only when explicitly bound to the same owner, action, arguments and policy/configuration version. Do not weaken either gate. Agents cannot self-approve. Acceptance includes review without database inspection, changed-argument rejection, expiry/replay protection and scoped cleanup of abandoned tests.

### PHY-G06 — Device readiness and recovery — IMPLEMENTED; STABLE DOWNSTREAM ADDRESSING REQUIRED

Separate an online hub from an available device. Surface HA unavailability/stale observations before dispatch and recover after device power cycles. Agent replies must label cached observations with their timestamps rather than presenting them as current; this reporting gap was observed in the live capability-discovery test. Acceptance must cover disconnect/reconnect, fresh feedback, no false success and no delayed replay of expired work.

Evidence: an approved pilot operation reached the edge while the TV/stick were powered off and expired as uncertain. The user then powered them on; a HA refresh restored Fire TV Home. The expired result remains uncertain and was not replayed. DHCP address churn then made the saved Fire TV endpoint unreachable. Updating the existing HA integration preserved pairing identity and entity IDs; a fresh approved operation completed afterward. Recommend router DHCP reservations for pilot devices. Generic recovery must resolve stable device identity to its current address, reject identity mismatches, and reconnect the HA adapter after an HA restart without restarting the edge. The edge now reconnects HA, reports per-device readiness, rejects unavailable dispatch and labels old observations. Downstream DHCP churn remains an integration/deployment responsibility: use a router reservation or an integration-supported stable hostname. The edge deliberately does not scan arbitrary LAN devices or edit HA private storage.

### PHY-G07 — Finer user/employee resource entitlements — IMPLEMENTED

Explicit per-asset discovery/read and action grants now apply to user, agent and workflow principals. The asset fixes its site/hub scope. Human API, agent tools and workflow execution check resource authority; owner/delegate administration and approval remain separate. New assets start without member/agent grants. Legacy agent tool access is preserved until explicitly scoped; legacy assets do not automatically grant ordinary human members access. A general invoke-tool grant is not an asset-specific entitlement.

Acceptance: users/employees with different resource grants discover and operate only permitted resources. Owner/delegate administration, revocation and cross-company isolation apply consistently to chat, UI and workflows.

## Priority 2: device outcomes and runtime lifecycle

### PHY-G08 — Actual screen-power feedback — OPEN

Native Windows/edge Wake-on-LAN woke the PRISM TV, confirmed by the user; HA container wake was intermittent. Packet dispatch and network reachability do not prove screen power. Cloud wake remains prohibited pending a truthful completion contract.

Acceptance: use independent power-state feedback, or explicitly label a supported human-attested/uncertain outcome without calling it automatic verified completion. Preserve historical evidence rather than rewriting the earlier network-only result.

### PHY-G09 — PRISM TV power-off — OPEN / HARDWARE COMPATIBILITY

Fire TV sleep, injected power keys and CEC tests did not switch off the PRISM screen. The final active-source/automatic-TV-off test slept the stick only; the user confirmed the TV stayed on. The ineffective setting was restored and the temporary device-side CEC probe removed.

Acceptance: repeatedly verify an authorized supported TV-off path on this actual model. A physical remote button working does not establish a replayable network command. Do not advertise or grant TV-off based on stick sleep.

### PHY-G10 — Real visual and semantic evidence — OPEN

Bounded private capture support exists, but no usable real-TV image source is configured. Simulator snapshots are synthetic; a black Fire TV capture is not displayed-content proof.

Acceptance distinguishes active-app evidence, a screen image and semantic verification. App launch does not establish playback, profile selection or screen power. Missing required evidence fails the workflow step.

### PHY-G11 — Minimal production edge distribution — OPEN

Separate the production runtime from optional simulator/lab/test dependencies and protocol bundles. Device instances and supported operations must be configuration, not vendor branches in core code. Keep command transports and observation providers composable: Home Assistant is one optional integration, not a universal requirement for all physical devices. MQTT is required only for mappings that use it, not for every hub.

Acceptance: install only selected adapters/dependencies; add a configuration-supported operation without a core rebuild; test resource use, startup, credentials and journals on Windows/Linux. Android APK delivery remains outside Phase 1.

### PHY-G12 — Rollout and compatibility — IMPLEMENTED FOR MANAGED CONFIGURATION; GENERAL CLEANUP FOLLOW-UP

Add compatible configuration/adapter versions, staged activation, health checks and rollback. Preserve local secrets and outstanding-operation journals. Provide supported scoped controls for retiring credentials and cancelling abandoned pending tasks; the pending browser-task cleanup gap surfaced during this pilot.

Acceptance: update one hub without affecting another or the existing digital platform; recover from incompatible config, interrupted upgrade, revoked hub and failed adapter startup. Never reroute an offline site's operation to another location.

## Verified foundations

- Additive Physical AI menu, registration, multiple site/hub identities and generic workflow contracts exist.
- File-based credentials and a curated generic action-binding registry are implemented.
- The installed edge launched Netflix using friendly input `netflix`; HA reported the app and the user confirmed it visually.
- Edge suite 0.2.1 is published with 40 passing software tests. This does not close untested hardware or live-agent acceptance gaps.

Related: [Implementation plan](PHYSICAL-AI-IMPLEMENTATION-PLAN.md), [Onboarding](../docs-site/docs/systems/physical-ai-onboarding.md), [Architecture](../docs-site/docs/systems/physical-ai.md).


## Priority closure verification — 2 November 2026

Suite 0.3.0 adds a data-only managed binding contract, server revision history, hub-local validation and atomic acceptance, last-valid cache, scoped rollback, action-authority invalidation, HA reconnect, device readiness/stale labels, explicit resource grants and concrete two-gate approval summaries.

Local acceptance: 45 edge checks passed, including real HTTP/WebSocket/MQTT simulator round trips and two hubs at one site. Additional API tests verify human resource isolation and owner-only mapping/grant/approval administration. Existing workflow runner and Action Control regression suites passed. HA protocol fixtures are explicitly simulated and do not substitute for hardware acceptance.

Real post-release agent and Fire TV acceptance must be recorded separately. PRISM power-off, actual screen-power feedback and useful visual captures remain open. Router reservations are a deployment prerequisite for IP-only integrations, not an automatic discovery feature delivered by this release.


## Live release acceptance — 2 November 2026

- Backend/frontend priority release is healthy; the gateway image and its existing fixes were preserved. Edge suite 0.3.0 is installed on the laptop.
- Fire TV mapping was entered in Flolah, accepted by the intended hub, and survived an edge restart after removal from active local device configuration. Local credentials and HA pairing were retained.
- Explicit Fire TV discovery/app grants preserve the previously authorized employees. Company and device approvals remain required.
- The deployed virtual TV app operation completed with matching observed state and a clearly labelled simulator snapshot.
- A real Netflix baseline operation completed. A subsequent real YouTube request through Flolah completed with fresh `app=youtube` at 00:51:20 Singapore time; the user confirmed YouTube worked.
- An earlier already-active YouTube request expired without fresh feedback and remains uncertain. Do not rewrite that history as success. Same-state HA operations need an independently fresh read contract if they are to complete without a state transition.
- COO discovered the correct capability but made two unnecessary operation-status lookups with invalid IDs; requests were rejected. Keep model argument/retry reliability in progress. A subsequent COO preparation produced resolved device/action/input arguments. Its unused company approval was rejected through Kanban without device execution.
- PRISM screen power-off and actual visual evidence remain unverified; no additional TV commands are required for this documentation change.
