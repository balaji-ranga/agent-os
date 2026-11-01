
# Physical AI — three-phase implementation plan

**Status: proposed, 29 October 2026.** This plan extends the existing Company OS. It reuses agents, workflows, knowledge, identity, digital integrations and governance, adding physical capabilities through the [proposed architecture](../docs-site/docs/systems/physical-ai.md). Phase gates establish readiness; no release dates or device compatibility are promised.

**Testing approach updated: 31 October 2026.** Initial Phase 1 validation uses a Windows laptop as the local Edge Hub and a reusable software device simulator. No purchase of robots, Raspberry Pi, Arduino or other physical equipment is required for this initial test environment. Simulator acceptance and real-equipment compatibility are separate gates.

### Phase 1 implementation status — 31 October 2026

An opt-in software implementation is available in the repository: the physical registry/API and authenticated hub channel, curated MQTT and Home Assistant adapters, durable gateway/simulator journals, switch/sensor/robot simulator profiles, human approval and local pilot screens. The existing Flolah backend keeps this extension disabled unless explicitly enabled for a pilot. No existing employee receives physical tool grants automatically.

The Windows-compatible local lab runs without Docker or hardware. It uses a separate synthetic cloud identity, authenticated MQTT and WebSocket services, and simulated equipment; it does not change a deployed company. Automated checks cover the real transports and production API authorization/SQLite persistence. In addition to protocol-fixture tests, a real Home Assistant container acceptance run passed the full cloud-to-edge-to-Home-Assistant path, sensor observation delivery and missing-evidence failure handling in an authorized isolated environment. Temporary test containers/network were removed and existing running containers were preserved. Real hardware compatibility and safety remain outside the simulator gate, and production rollout still requires explicit enablement and target-environment validation.

See `physical-edge/README.md` in the source repository for startup instructions, protected credential handling, adapter configuration, rollout boundaries and validation commands. Implementation does not announce general availability or imply a production rollout.

## Phase 1 — Foundation and safe local actions

**Outcome:** a person can authorize a physical capability and verify its observed result through Flolah's existing governance model, initially against simulated devices using the production capability contract.

**Deliverables**

- Define PhysicalEntity, PhysicalDevice and PhysicalAgent contracts, normalized capabilities, task semantics, ownership and household/business isolation.
- Define risk tiers, permissions, approval requirements, audit events and an adapter contract covering discovery, pairing, description, state, actions, events and optional tasks.
- Build the capability interface, registry and scoped agent tools alongside existing digital connectors.
- Develop and test a securely enrolled Edge Gateway on the Windows laptop, with MQTT event transport and a Home Assistant adapter. Use suitable local container/VM runtimes; Windows is the test host, while a dedicated Linux Edge Hub remains the reference deployment for a later site pilot. Choose one Home Assistant onboarding model: an existing installation or a managed test installation.
- Build one reusable Physical Device Simulator with switch/light, sensor and simulated robot profiles, browser controls, deterministic scenarios and fault injection. The robot profile exercises future task contracts without making real robot integration a Phase 1 prerequisite.
- Validate WoT descriptions and Flolah policy/task extensions. Publish the tested compatibility list and pairing requirements.
- Provide basic onboarding, authorization and observed status through the web experience; define offline permissions, credential protection and update handling.

**Exit criteria**

1. At least two simulated device types use the same capability contract; an authorized user can enroll the hub, register simulated assets, read state and perform a permitted action. Evidence must identify the assets and results as simulated. Real-equipment pairing is validated separately in a later hardware pilot.
2. An unauthorized user or another workspace cannot read or control those assets; approval-required and prohibited actions are enforced and audited.
3. Observed state confirms the action. Disconnects, stale observations, timeouts and duplicate requests cannot produce an unsupported success report or unsafe automatic retry.
4. A cloud outage permits only explicitly approved safe local actions, with buffered events reconciled on recovery.

### Phase 1 test environment — no equipment purchase

The Windows laptop hosts the local test services. Flolah's existing VPS remains the cloud control plane. No Android bridge is required, and the laptop need not run a local copy of the full Flolah cloud stack.

**Required components**

- **Flolah cloud additions:** hub enrollment and authentication, the tenant/site-aware PhysicalEntity registry, scoped capability operations, hub connection routing, authorization and operation/audit records.
- **Flolah Edge Gateway:** authenticated outbound cloud connection, adapter dispatch, local policy checks, bounded retries, deduplication, timeouts, durable operation/event journal and reconnect reconciliation.
- **One local MQTT broker:** for the simulator transport, with authentication and tenant/site/device topic boundaries. Reuse this broker for the Home Assistant integration; a second broker is unnecessary.
- **Physical Device Simulator:** one software service maintaining independent device state, publishing observations and responding to supported commands. Its browser panel changes readings and injects faults/delays without changing the gateway's decision logic; the task profile emits progress and terminal events.
- **Home Assistant:** required for the Home Assistant adapter acceptance stage, but not for the first direct MQTT transport test. On the Windows laptop it can run in a suitable VM, such as Home Assistant OS, while the gateway, broker and simulator run in their selected local runtimes.
- **Test configuration and evidence:** separate tenant/site identities, scoped credentials, capability descriptions, scenario fixtures, correlation IDs and a repeatable scenario runner.

Container/VM networking must let these services reach one another through explicit addresses and restricted ports. Do not assume that localhost is shared across Windows, a VM and containers. Keep the laptop awake during tests; allow required local traffic without exposing the broker, Home Assistant or simulator to the public internet. Persist simulator and gateway state so restart tests exercise recovery rather than silently resetting the scenario.

### One generic simulator, multiple profiles

- **Switch/light:** accept an on/off action, then emit observed state after a configurable delay. Test command acceptance separately from the state transition.
- **Sensor:** publish controllable temperature, motion or battery readings, including timestamps, stale values and offline status.
- **Simulated robot:** accept a named task and report progress, completion, cancellation or failure. Use it for task-contract tests; vendor robot adapters and physical task execution remain Phase 2 work.

Each profile uses the same normalized descriptions and capability contracts expected of real adapters. Mark every simulated asset, observation and test run explicitly. Do not count simulator results as a tested hardware/vendor compatibility entry.

### Test sequence and message paths

1. **Local transport and adapter contract:** run the broker, simulator and gateway on the laptop. Verify permitted reads/actions, observations, credentials and operation IDs before connecting the VPS.
2. **Cloud-to-edge integration:** enroll the laptop hub with Flolah, register simulated assets and execute through the real authorization and routing path. The path is human request → Flolah agent/workflow → cloud policy → enrolled hub connection → gateway policy → MQTT adapter → broker → simulator; observations return through the gateway to the cloud audit/UI.
3. **Home Assistant adapter:** expose the same simulated switch and sensor through Home Assistant's MQTT integration. Test Flolah → gateway Home Assistant adapter → authenticated Home Assistant API → MQTT broker → simulator, with state/events returning through Home Assistant to Flolah. Keep direct MQTT and Home Assistant mappings explicit to prevent duplicate dispatch or feedback loops.
4. **Failure and recovery acceptance:** run the scenarios below repeatedly from known fixture state, collecting results and verifying recovery after service restarts.

Home Assistant is therefore a separate adapter-validation stage, not a dependency of the first MQTT test. The simulator, broker, fixtures and capability contracts are reused across both paths.

### Required acceptance scenarios

1. **Authorized success:** an allowed action changes simulator state and produces a correlated observation; Flolah reports completion only after the required evidence arrives.
2. **Permission and approval gates:** denied actions and unapproved consequential actions are not dispatched; another tenant/site cannot read or control the asset or use its message topics.
3. **Accepted but unfinished:** the simulator acknowledges a command without changing state; Flolah times out or reports uncertainty rather than success.
4. **Delayed or stale evidence:** old readings, delayed acknowledgements and out-of-order observations cannot satisfy a newer operation incorrectly.
5. **Duplicate delivery:** repeat an operation ID and simulate a lost acknowledgement. Verify the declared deduplication behavior and avoid repeating a side effect; do not claim exactly-once physical execution.
6. **Disconnection during work:** disconnect the simulator, broker or hub at defined checkpoints. Surface an actionable exception and preserve uncertain operation state.
7. **Recovery after restart:** restart the gateway/simulator with durable journals intact, reconcile the last operation and observed state, and prevent blind replay of uncertain actions.
8. **Cloud outage:** verify only previously approved local routines with valid cached authority can execute. New cloud-driven commands cannot dispatch while disconnected, and events synchronize on recovery.
9. **Invalid or expired inputs:** reject malformed capabilities, unsupported actions, revoked credentials and expired authorization before execution; record the decision.
10. **Future task-contract coverage:** use the robot profile to exercise task progress, terminal outcomes, timeout and cancellation behavior. Record this as simulated contract coverage, not completion of Phase 2 robot integration.

**Evidence per run:** fixture and software versions, simulated asset/profile, tenant/site/hub IDs, operation ID, authorization result, dispatch and acknowledgement times, observed state/event timestamps, final status, expected versus actual assertions, and recovery history. Test logs must not contain credentials. Keep these protocol/policy assertions deterministic; assess any AI interpretation separately so a model response alone cannot pass a device test.

### What the simulator gate establishes

The initial gate validates contracts, orchestration, authorization, messaging, audit evidence and recovery using real services and simulated equipment. It does not validate radio discovery, USB access, vendor APIs, real actuator behavior, equipment safety or real-world performance.

A later, separately scheduled hardware pilot must validate those properties for the selected equipment before claiming device compatibility or production physical readiness. The initial Phase 1 test environment does not require buying that equipment. Preserve the same capability interface when replacing a simulator adapter with a real device adapter.

## Phase 2 — Shared human, digital and physical workflows

**Outcome:** pilot users complete an end-to-end routine with accountable actors and evidence across all three forms of work.

**Deliverables**

- Add one supported robot adapter and a PhysicalAgent wrapper with authorization, dispatch, acceptance, progress, final outcomes, cancellation where supported and reconciliation.
- Compose physical tasks with existing digital tools and assigned human steps. Record approval decisions, manual confirmations and exceptions in the workflow history.
- Pilot a Home routine such as preparing for guests and a Business routine such as closing a shop with permitted CRM/ERP or POS access and equipment actions.
- Add guided pairing, progress, notifications and approval experiences. Pilot an Android TV client on compatible existing equipment while retaining the separate Edge Hub.
- Validate consent, camera-data handling if cameras enter the pilot, bounded retries, manual override and clear recovery guidance.

**Exit criteria**

1. A nontechnical pilot user completes onboarding and a routine combining a human step, digital work and a supported physical task.
2. A cleaning task can be submitted, monitored and reconciled; cancellation is verified when supported and limitations are shown when it is unavailable.
3. An obstruction, offline robot, rejected approval or missing human confirmation produces an actionable exception and prevents false completion.
4. A shop-closing pilot produces an auditable record of digital results, observed physical outcomes, staff confirmations and unresolved work.

## Phase 3 — Validated expansion and operational readiness

**Outcome:** expand supported homes and SMEs with repeatable onboarding, reliable operations and evidence of customer value.

**Deliverables**

- Add a second vendor through the capability contract, then prioritize direct Matter, camera, robot or SME protocol adapters according to pilot demand.
- Evaluate a dedicated industrial gateway only when a real SME protocol requirement warrants it. Keep gateway responsibilities clear.
- Establish compatibility certification, adapter versioning, secure updates, recovery, diagnostics, support and fleet health monitoring.
- Package reusable Home and Business skills with declared permissions, safety boundaries and outcome evidence.
- Validate licenses, vendor terms and applicable hardware certification before distributing managed hardware. Consider branded HDMI hardware only after the software and Edge Hub pilots establish demand and support feasibility.

**Exit criteria**

1. A second vendor passes capability and policy checks without rewriting the business workflow.
2. Pilot operations demonstrate recovery after network loss, hub restart and update failure without unsafe replay or false-success reporting.
3. Product and engineering owners agree measurable launch thresholds and confirm pilot results meet them before broader release.
4. Compatibility, limitations, onboarding, support and rollback procedures are documented for the release scope.

## Measurement and release decisions

Track activation-to-first-authorized-action time, pairing success by tested device, task completion, timeout and reconciliation rates, false-success incidents, manual setup effort, adapter effort for a second vendor, time saved and support burden. Establish baselines in Phase 1, assess usefulness in Phase 2 and use agreed thresholds for Phase 3 launch decisions.

Each phase needs product ownership for scope and pilot value, engineering ownership for contracts and reliability, security/privacy review of permissions and data handling, and operations ownership for onboarding and recovery. Phase 2 depends on the Phase 1 gate; Phase 3 depends on validated shared-workflow pilots. Hardware commercialization remains a separate decision.

This three-phase plan consolidates the supplied architecture proposal's contracts/local gateway, physical task/end-user experience, and SME/expansion stages. It is a delivery proposal, not a claim that these capabilities are already implemented.


### Connector downloads and first TV pilot — 31 October 2026

Connectors → Physical AI now includes checked desktop ZIP downloads, one-time hub config download and a dashboard link. PowerShell/shell launchers run either the hardware-free lab or an enrolled simulator/HA gateway. The shared TV profile and HA adapter support bounded power, approved apps/channels and navigation; actual navigation/channel evidence may be unavailable and must remain uncertain. Virtual TV round-trip tests and HA mapping/restriction tests cover software behavior; PRISM+ model compatibility, wake behavior and real channel/app outcomes require the user's local TV. Android remains outside Phase 1; an experimental APK prototype reuses gateway policy/journal logic with native WSS/private storage; compile/signature checks and a JS-native-bridge fixture are not Android device/background acceptance. No always-on Android service is claimed.

### Phase 1 workflow, multi-location and evidence acceptance

The additive Physical AI menu exposes registered devices, ad hoc actions, evidence, site/hub filters, embedded onboarding and downloads. Generic `physical_device` nodes select a registered asset and declared capability. Owner/delegate publication, company/device policy and human approval apply. Same-named devices at two hubs remain isolated; offline sites never fall back to another location.

Acceptance covers actual workflow progression only after observed feedback, no continuation after rejected/uncertain outcomes, stable retry idempotency, bounded private PNG/JPEG retrieval, required-image failures, optional HA camera-source capture and explicitly synthetic TV snapshots. Device state and contextual images are different evidence. Actual PRISM+ registration/pairing remains a local hardware acceptance test. Android APK delivery remains outside Phase 1.

### Generic implementation gaps — 1 November 2026

Track remaining acceptance work in the [Physical AI gaps registry](PHYSICAL-AI-GAPS.md). The target is server-managed, versioned device/operation bindings with a lightweight edge that retains protocol execution, local secret references and durable safety/journal state. Local hand-edited mappings are a pilot limitation. Registered operations must be discoverable to entitled agents as typed capabilities; unsupported operations cannot be invented. Phase 1 is not fully accepted while live agent routing, device readiness, trustworthy power outcomes and the recorded governance gaps remain open.


### Phase 1 priority completion increment (suite 0.3.0)

Supported HA mappings now have a server-managed form, versioned hub delivery, edge validation/cache and rollback. Device access grants scope users, agents and workflows; stale/readiness states and reconnect behavior are explicit. Simulator acceptance precedes real Fire TV app-launch acceptance. Refer to the gaps registry for exact supported transports and remaining hardware/deployment limitations. This extends the existing platform without changing existing digital workflows or approval requirements.


## Server-managed configuration storage

Administrators use Physical AI → Device mappings and choose a site/hub. The control plane persists the versioned document in `agent-os.db`, table `physical_control_state`, JSON `document.hubs[hubId]`: `managedPending`, `managedActive` and bounded `managedHistory`. `managedActive.document.mappings` contains the adapter ID, public device description, curated action bindings and independent observation bindings. Public descriptions and action permissions remain separate registered-asset records.

The authenticated outbound hub channel delivers only that hub's document. The edge validates the schema, installed adapter, document hash and device identities; an acknowledgement activates it on the server. The durable gateway store caches the accepted document. Binding changes disable affected action authority until reviewed; a rollback creates another activation rather than silently reusing old permissions.

The HA service URL and credential-file reference remain in protected local deployment configuration. HA retains its own downstream pairing and endpoint settings. The mapping editor does not create or reconfigure HA integrations and does not upload local secrets.


## Physical AI list pagination

`GET /api/physical/view` applies authenticated company ownership and resource grants before search, location filtering, counts and paging. Devices, operations and hubs use bounded pages (default 20, maximum 100), deterministic ordering and minimal location metadata. The registration dashboard uses bounded pages of 5 by default (maximum 20). Hub credentials, private managed documents and candidate inventories are excluded from the normal list view.

The browser debounces search, aborts superseded reads, ignores obsolete responses, prevents overlapping background polls and pauses polling while hidden. Mutation/approval APIs retain their existing authorization independently of list filtering.

The current control plane still uses a durable SQLite JSON document and in-memory collections. Server paging bounds network/UI work; it does not convert persistence into SQL row-level queries. A 10k-operation fixture exercises isolation and bounded response size. Consider normalized indexed projections before substantially larger multi-writer deployments; do not present the fixture timing as a production SLA.
