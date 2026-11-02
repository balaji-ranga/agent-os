# Flolah Physical AI — Phase 1 laptop pilot

This opt-in implementation adds a tenant/site-scoped physical capability layer and curated edge adapters. Existing Flolah behavior stays disabled-by-default for this extension. No robot, Raspberry Pi, Arduino or other equipment purchase is required for the simulator acceptance environment.

## Run the hardware-free lab on Windows

Prerequisite: Node.js 22 and the repository's backend dependencies. No Docker, Home Assistant, Android bridge or VPS deployment is required for the first lab.

From the repository root:

```powershell
npm --prefix backend ci
npm --prefix physical-edge ci
npm --prefix physical-edge run lab
```

The command prints two loopback-only URLs: the physical onboarding dashboard and the local simulator. Generated credentials are saved in `physical-edge/.local/physical-lab/access.json` when run through npm's package script. They are not printed or placed in URLs. Open that protected file locally: use `sessionToken` on the cloud-pilot dashboard and `localToken` on the simulator screen. Tokens remain in browser memory; lab controls do not save them to browser storage.

The lab uses a **test-only local cloud control plane**, the real gateway, WebSocket connection, an authenticated Aedes MQTT broker and the real simulator. Its synthetic owner is not a production Flolah session. It does not turn on the feature on the VPS or touch production data. The production backend uses existing Flolah sessions, CEO/delegate permissions and SQLite storage; its authorization is tested separately.

1. Click **Connect / refresh** in the cloud-pilot dashboard. The lab has already enrolled its hub; discovery must show the switch, sensor and robot profiles.
2. Choose the switch's `set_state` policy, then **Register selected candidate**. Register the sensor, which has read-only properties. Register the robot only if testing future task contracts.
3. Request `set_state` with `{"on":true}`. Refresh after execution and inspect the operation's correlated `evidence`; an acknowledgement alone never completes it.
4. In the simulator screen, change temperature or select a fault mode: offline, accepted-only, lost acknowledgement, stale evidence or failure. Request an action and inspect the resulting exception or uncertainty.
5. Robot tasks always require a human approval. Approve/reject from the cloud dashboard; agents have no approval endpoint. Cancellation is available for supported tasks.
6. Use Ctrl+C for a graceful shutdown. Journals persist; restarting with the same data directory preserves hub identity and local test credentials. A journal lock is reclaimed only if its owning process is demonstrably dead; never remove a live process's lock.

The lab UI is not automatically refreshed; **Connect / refresh** retrieves current observed state and outcomes. Keep the laptop awake during tests.

## Production cloud integration — opt in explicitly

Build the backend normally with the changed source and lockfile. Add `deploy/docker-compose.physical.yml` to the existing complete Compose chain and set `FLOLAH_PHYSICAL_ENABLED=1` only for the intended pilot. With the variable absent or `0`, no physical API routes, schema creation, physical tool seeds, hub jobs or WebSocket listener are activated.

The Nginx configurations add only an exact `/api/physical/hub` WebSocket location, leaving every other API location unchanged. Validate Nginx configuration before a rollout. Production gateway connections require WSS; plain WS is accepted only for explicit loopback test configurations.

Open `/api/physical/ui` on the signed-in application origin and click **Connect / refresh**. It can use the application's existing session token on that origin, or accept a session token entered in memory. All data/management endpoints enforce existing authentication and CEO/delegate authority. Admin use requires explicit owner impersonation.

Enroll a hub for a site, save its returned credential once, and configure the laptop gateway. Hub credentials are stored hashed in the cloud. They can be rotated or revoked from the dashboard; old credentials stop working. Device credentials belong in the protected local config, not in Thing Descriptions or telemetry.

The pilot physical state table is created lazily in the existing database only when enabled. Phase 1 assumes the current single backend process owns this extension. Before horizontal multi-writer deployment, replace snapshot-state persistence with transactional per-record storage and a distributed hub routing design.

## Connect a laptop gateway to the actual cloud

Create a protected JSON config for `npm --prefix physical-edge start -- <config-file>`. The file contains:

- `dataDir`: private persistent local journal directory.
- `hub`: `cloudUrl` (WSS `/api/physical/hub`), `hubId`, `siteId`, and the enrollment `token`.
- `adapters`: approved named adapters. `mqtt` configuration uses `type`, `url`, `username`, `password`, `tenantId`, `siteId`, `hubId`; optional `entityIds` restricts discovery/events to an explicit device-ID allowlist.
- `localToken`: a random secret of at least 24 characters for browser controls; `uiPort` is optional and `uiBind` defaults to loopback.
- Optional `simulator`: the MQTT config and `devices` with configured IDs and `switch`, `sensor` or `robot` profiles.

Only curated `mqtt` and `home-assistant` adapter types are loaded. Device discovery cannot load code, grant authority or enable actions. Descriptions are normalized WoT profiles with Flolah identity/task extensions. Registered capabilities are versioned by hash; a changed adapter description requires onboarding review rather than silently widening access.

Use **Review current adapter capabilities** after an adapter/profile change. Revalidation retains asset identity but disables the asset and clears its action grants and offline authority. Review the new description, choose explicit permissions and enable the asset again. Pending work becomes uncertain and is never replayed under the new policy automatically.

## Home Assistant adapter stage

Use the same simulator and MQTT broker. The simulator publishes MQTT discovery for switch and sensor entities, with an independent state topic and **optimistic mode disabled**. On Windows, use Home Assistant OS in an appropriate VM or an existing installation; the first MQTT-only lab does not require HA.

1. Configure HA's MQTT integration with the same broker's address and its scoped HA credential. Windows, containers and a VM do not necessarily share localhost. Restrict broker access to the required local addresses.
2. Confirm the simulated switch and temperature sensor are visible in HA and report actual MQTT state.
3. Add a `home-assistant` adapter: `url`, protected `token`, and explicit `entities` entries containing `id`, `haEntityId`, `profile` and `simulated:true` for test assets. Only switch and sensor mappings are supported in Phase 1. Robot tasks use the simulator adapter.
4. Exclude the equivalent device from the direct MQTT adapter's `entityIds` allowlist before registering its HA mapping; the gateway rejects ambiguous IDs across adapters. An empty `entityIds` array disables direct discovery for all MQTT devices while leaving HA integration available. No workflow should dispatch both paths to one physical device.
5. HA actions use authenticated service calls; observations come from authenticated WebSocket events. Unknown, unavailable or `assumed_state` observations are not completion evidence. A device must expose independent observed state; pure optimistic integrations are unsuitable for this acceptance gate.

An unresponsive HA connection leads to uncertainty/timeouts, never automatic replay. Restart/reconnect the gateway to re-establish HA subscriptions after a sustained HA outage. The MQTT client and cloud connection reconnect automatically.

## Docker packaging and dedicated Linux deployments

`physical-edge/compose.yml` is separate from the existing cloud stack. `scripts/setup.mjs` reads enrollment/cloud settings from a protected file, generates per-service secrets, explicit Mosquitto ACLs and configuration, then hashes the password file using `mosquitto_passwd` in a temporary official container. Never start a broker if setup failed part way through. Do not expose plaintext credential files or commit `.local` output.

```powershell
node physical-edge/scripts/setup.mjs <protected-enrollment-config.json>
docker compose -f physical-edge/compose.yml --profile simulator up -d --build
```

Enrollment config fields: `tenantId`, `siteId`, `hubId`, `token`, `cloudUrl`. Generated configs are in `physical-edge/.local/config`. Docker UI ports bind only to host loopback; local tokens remain required. On Linux ensure the non-root container user can read its protected config files and write its named journal volume.

The optional `homeassistant-linux` profile uses host networking and is intended for a dedicated Linux host. Broker publication defaults to host loopback. For a separate HA VM, choose an explicit local interface with `PHYSICAL_MQTT_BIND` and firewall it to that VM; never bind it publicly. Review HA credentials and exact discovery ACL topics whenever adding devices. Avoid deploying another broker if a correctly scoped one already exists. Pin validated image digests before a broader release.

## Authority and recovery behavior

- An unregistered candidate has no authority. Newly registered actions default to prohibited unless explicitly configured.
- Effective action permission is bounded by both company action-family policy and the physical asset policy. Company prohibition blocks work; company or asset approval requirements create a human gate.
- Agent-facing tools are seeded without automatic grants to any named agent. Owners grant the tools using existing employee permissions. Existing Tools middleware continues to enforce tool grants and policy. Scoped company rules may further restrict these tools; the physical gate cannot relax them.
- Gateway commands require an authenticated enrolled connection, matching capability/policy versions, local authority and a bounded deadline. Device-specific payloads never bypass the adapter framework.
- Cloud and gateway journal operation IDs before dispatch. Repeated requests return the same operation or reject changed inputs. A reconnect replays evidence and queries durable outcomes, not actuator commands. Exactly-once physical actuation is not promised.
- An API acknowledgement cannot complete an action. Observations must match the expected property/value, device, operation, policy version and time window. Late evidence can reconcile uncertainty only when it was observed inside the original deadline and remains within the freshness window.
- During cloud loss, the local control endpoint can run only a human-configured, autonomous routine with fixed arguments, an expiry and a bounded use count. The gateway policy lease expires after 60 seconds without renewal, even if the routine grant lasts longer. This limits stale/revoked offline authority. Full offline AI chat is not provided.
- A new policy version invalidates prior pending authority. Credential revocation closes the cloud connection; disconnected cached authority lasts at most its lease. Hardware interlocks and emergency stops remain independent of Flolah.

## Validation

```powershell
npm --prefix physical-edge test
node backend/scripts/test-physical-integration.mjs
```

The edge suite uses real HTTP, WebSocket and authenticated MQTT services, persistent journals and simulated equipment. It covers onboarding, two device types, observed-state completion, tenant/topic isolation, human approval, cancellation, explicit denial, malformed inputs, stale evidence, accepted-only responses, failures, cloud outage, bounded offline execution, restart recovery, revoked credentials and expiry. HA wire-contract tests use an explicitly identified HA protocol fixture plus real MQTT; they are not a substitute for a real HA integration run.

`test/ha-live.mjs` implements real Home Assistant onboarding, MQTT integration/discovery, switch actions, sensor observations and accepted-only failure verification against a **fresh disposable HA instance**. Never point it at an existing HA installation. `test/run-ha-container.py` provisions and removes private-network, resource-bounded test containers with no published ports and checks that existing containers are preserved. Running this on another host requires authorization to transfer the test source there.

Simulator acceptance does not establish real vendor compatibility, radio discovery, USB behavior, mechanical safety or physical readiness. Those remain a separately scheduled hardware pilot.

## Download suite and TV / Android pilot (0.2.0)

Connectors → Physical AI serves SHA-256-checked Windows/Linux ZIP downloads, hub enrollment/config download and the physical dashboard. Extract the ZIP completely. With Node.js 22 installed, run `physical-edge/run.ps1` on Windows or `sh physical-edge/run.sh` on Linux for a local lab. Launch against your company using the gateway mode and an absolute private-config path. Empty `adapters` starts an authenticated loopback broker plus virtual TV/switch/sensor/robot, connected to your enrolled cloud hub. No equipment is controlled by that mode.

The HA adapter supports a `tv` profile with a remote entity, optional media entity, explicit `apps` catalog (`activity` plus independently observed `observedActivity`) and approved `channels`. Power/app/channel actions need corresponding observed feedback. Navigation keys are bounded, but no independent key-result evidence exists in HA, so navigation remains uncertain. Never equate acceptance with physical success. Consult the public onboarding guide for the full JSON mapping.

Outside Phase 1, an experimental Android APK prototype is a debug-signed, foreground-only pilot using the same bundled gateway contracts/journal logic, native authenticated WebSockets and private atomic storage. It supports a virtual TV or HTTPS HA adapter, requires WSS for cloud, pauses when the app is left, and does not embed MQTT/HA servers. Build using `node physical-edge/android/build-js.mjs` and the documented Android Gradle project; the isolated build script uses Android SDK 35/Gradle 8.9/JDK 17. Preserve the pilot signing key for updates; use a reviewed production-signing process before broad distribution. APK compilation is not Android device/lifecycle acceptance. No real PRISM+ hardware has been tested remotely.

Phase 1 package generation excludes Android. An explicit `--include-android` build flag is reserved for a future separately reviewed Android release.

## Operation evidence

Success requires matching observed state. ACK alone is not success. Optional HA mapping `evidenceCameraEntityId` names an existing `camera.*` source on the same instance. Capture occurs after feedback (3-second timeout, PNG/JPEG, 256 KiB maximum). Revalidate changed descriptions and explicitly review permissions. Flolah stores captures privately with operation/source/time/SHA-256. Without capture, state evidence is retained. TV Remote alone is not a universal screenshot API.

TV simulator images are labelled `simulator_snapshot`, representing synthetic state. Agents retrieve authorized captures using `physical_evidence_get`; generic workflows can require an image. Company visual storage is bounded to 64 MiB; capture reports unavailable at capacity. No automatic deletion occurs in this pilot.

## Standard deployment files

Extract the private enrollment ZIP downloaded from Connectors → Physical AI. It contains:

- `config/gateway.json`: deployment settings and credential file paths, with no inline tokens.
- `config/credentials/hub.token`: one-time company hub credential.
- `config/credentials/local-ui.token`: local simulator/control UI credential.
- `config/credentials/home-assistant.token`: add this yourself when authorizing an HA adapter.

Set `hub.tokenFile`, top-level `localTokenFile`, and HA adapter `tokenFile`. MQTT adapters also accept `passwordFile`. Paths resolve relative to the JSON configuration file, on Windows and Linux; absolute paths are supported for container secret mounts. Credential files contain a single UTF-8 token. Empty, multiline, oversized, symlinked or non-regular files fail closed. Specifying both an inline credential and its file is rejected. Existing inline-only deployments remain compatible for migration.

Restrict the credential folder to the edge's Windows service/user account and SYSTEM. On Linux use directory mode 700 and credential mode 600. The loader rejects group/other-readable credential files on Linux. Never commit credential files or the private ZIP. Credentials are loaded only into process memory at startup; rotate the file and restart the edge to apply a new token. Journal/data folders are separate and must be retained.

Example launch: `./run.ps1 -Mode gateway -Config C:/FlolahEdge/config/gateway.json`, or `sh run.sh gateway /opt/flolah-edge/config/gateway.json`. `config/gateway.example.json` provides the non-secret structure.

### Explicit HA script/button capabilities

The `ha-capability` mapping accepts a normalized `description`, fixed `actionBindings` to `button.press` or `script.turn_on`, and typed `observationBindings` to allowlisted HA sensor states. Every declared action needs a matching evidence property. Mapped script/button actions take no runtime arguments; configure separate explicit HA scripts for their supported operations. Unknown/unavailable/assumed state is not completion evidence. `includeSimulator: true` retains simulator profiles alongside actual adapters on an existing hub.

For a host whose native LAN route supports Wake-on-LAN while HA's container route does not, an action binding can instead use `{"transport":"wake-on-lan","mac":"02:00:00:00:00:01","address":"192.168.1.255","port":9,"count":3,"intervalMs":200}`. Replace the example with operator-configured local device values. The edge host sends the packets directly; runtime action inputs cannot change the destination. Only literal local IPv4 destinations are accepted, with at most five packets. No shell or arbitrary command execution is involved.

Packet dispatch emits only an acknowledgement. Completion still needs the action's independently observed HA property. A network-reachable sensor is not TV screen-power evidence: some TVs retain network services in standby. Keep a power action prohibited until a suitable actual power-state source is mapped and hardware acceptance passes. This transport does not implement power-off.

### Friendly app catalogs

For an HA ADB media-player entity, use a `home-assistant-app` binding with a fixed `entityId` and `sources` map from friendly app IDs to installed package IDs. Its normalized action accepts exactly `app`, enumerating the approved map keys. Observe `app_id` on that media-player entity using an observation binding with `attribute: "app_id"`; map package IDs back to the friendly app IDs. Other attributes are not accepted.

Only an administrator configures package IDs. Agents discover the declared `launch_app` schema and invoke a friendly value; they cannot choose arbitrary packages, HA services, addresses or commands. An HA service acknowledgement does not complete the operation: a fresh, independently reported matching app ID is required. This proves the active application, not playback, profile selection or TV power.


### Managed mappings (suite 0.3.0)

Install the reusable HA adapter and its protected endpoint/token once. Device/action mappings can then be staged from Physical AI → Device mappings. Only data for this hub is delivered. Supported managed transports are a fixed HA script/button and an approved media-player app catalog, with independently bound typed observations. Secrets remain local. MQTT canonical devices continue discovering their declared capabilities through their existing adapter.

Accepted revisions are durably cached; invalid revisions retain the last valid cache. Changed bindings do not inherit old action permissions. HA reconnects automatically; commands are not replayed on reconnect. Use stable DHCP reservations/hostnames in downstream integrations rather than treating an IP address as device identity.

### Virtual room camera

The simulator includes a still-image room camera linked to its virtual TV. `capture` emits a fresh 640×360 PNG without TV-state metadata. Change the virtual TV power or select the camera’s `linked`, `on`, `off`, or `unknown` scene in the authenticated local simulator UI. This is a rendered test harness, not CCTV footage or a live-video adapter. Workflow image analysis uses the configured vision LLM on the captured pixels.

### Device-defined workflow outputs

An action may declare `output: {version, schema, bindings}` in its registered Thing Description. Output schemas are bounded typed objects, including nested objects and arrays. Declarative bindings select the matching observation value/time, a validated device result path, or a protected captured-image reference; they cannot execute code. The virtual camera declares `frame` (image reference) and `captured_at`; virtual TV power declares `power_state` and `reported_at`. Flolah validates required outputs before completing an operation. Workflow consumers pin the selected contract hash and version; changed contracts need review. Operations without a declaration retain legacy behavior. Video/stream schemas do not by themselves implement video transport or model support.
