---
title: Connect and register a physical device
description: Step-by-step Flolah and edge setup, device registration, permissions and verification, with a PRISM+ Smart TV pilot example.
---

# Connect and register a physical device

Use this guide for any **supported** physical device: a switch, sensor, Smart TV or task-capable robot. The onboarding sequence stays the same; the approved adapter, pairing method and available capabilities depend on the device.

The first real-device example is a **PRISM+ TV**: turn it on/off, open a supported app, select a supported channel and send navigation keys. Record the exact model and operating system first. The brand alone does not establish compatibility.

:::info Phase 1 pilot — 31 October 2026
**Connectors → Physical AI** now provides a Windows/Linux ZIP, hub enrollment/config download and a dashboard link. The desktop suite includes PowerShell and shell launchers plus virtual TV, switch, sensor and robot profiles. Node.js 22+ is a prerequisite; HA is installed separately.

The HA adapter now supports an explicit TV profile alongside switches/sensors. Power/app/channel completion still requires independent matching observations; navigation delivery alone does not prove the screen changed. Android Edge APK remains outside Phase 1. Actual PRISM+ model compatibility is a separate local acceptance gate.
:::

## Download and run from Connectors

1. Sign in to the Flolah application and open **Connectors → Physical AI**.
2. Download **Windows / Linux edge suite + simulator**. The browser checks its SHA-256 against the package catalog. Extract the entire ZIP.
3. Open the extracted `physical-edge` folder. Windows PowerShell: `./run.ps1`. Linux: `sh run.sh`. This starts a local-only lab with a virtual TV and other simulated devices; read the printed local URLs and protected credentials file.
4. To connect the simulator to your actual company, enter a site ID and hub name in the Connectors tab, then choose **Enroll and download private config**. Keep that credential file private.
5. With `adapters` empty, run `./run.ps1 -Mode gateway -Config C:/FlolahEdge/private/flolah-edge-private.json` on Windows, or `sh run.sh gateway /absolute/path/flolah-edge-private.json` on Linux. This starts an authenticated loopback broker/simulator behind the actual enrolled hub. It does not control real equipment.
6. Open **Physical AI dashboard**, refresh the online hub and follow steps 7–8 below to register a virtual device and verify its operations.
7. To use real equipment, stop the simulator hub, add the approved HA entity mappings to its config and restart. Keep its journal directory; register the intended new physical candidate explicitly.

### Android is a later phase

No Flolah Android Edge APK is included in Phase 1 downloads. A compatible Android/Google TV can be a controlled endpoint through the laptop hub and Home Assistant. This does not require a Flolah app on the TV. An experimental APK prototype is retained separately for future evaluation; it is not Phase 1 delivery or Android device acceptance.

## 1. Choose the device and the first outcome

**On the device / with its owner**

1. Record manufacturer, model, firmware/OS, room/site and accountable owner.
2. Choose one bounded first action and the observation that will prove it succeeded. For a sensor, start with a read; for a TV, start with standby power control.
3. Select an approved adapter that supports both the device interface and its capability profile. An MQTT connection alone does not provide a universal device command format.
4. Confirm pairing access and a supported local API. If no compatible adapter/profile exists, implement and validate that adapter before registration; do not modify company workflows for each device model.

**Success check:** the selected adapter has a documented command and independent feedback path. Unsupported capabilities stay unavailable.

A TV is normally a **PhysicalDevice**, used by an AI employee or workflow. Register a **PhysicalAgent** only when the supported profile provides delegated tasks, progress and outcomes. Naming a TV an agent does not add these abilities.

## 2. Prepare the edge host

**On your Windows laptop**

1. Keep the laptop awake and connected to the device network during the pilot.
2. Install Node.js 22 and extract the complete suite downloaded from **Connectors → Physical AI**. It includes `physical-edge/` and the shared `backend/` contracts. Do not copy only the gateway folder.
3. From the repository root, install the gateway dependencies:

```powershell
npm --prefix physical-edge ci
```

4. Choose the device transport. For Home Assistant devices, install Home Assistant OS in a suitable Windows VM, or reuse an existing HA server. For the MQTT simulator path, use the lab's broker. Do not install a second broker unnecessarily.
5. Confirm the gateway can reach HA/device services and the Flolah application's HTTPS endpoint. A VM/container's `localhost` is its own environment; use explicit reachable addresses.

Home Assistant and a broker are separate services. MQTT is needed only for adapters/devices that use it. The TV Remote path below does not require MQTT or a Flolah APK on the TV.

**Success check:** the selected local services are reachable from the gateway host; the device is reachable from the service that pairs with it.

### Optional: prove the shared flow without equipment

From the repository root:

```powershell
npm --prefix backend ci
npm --prefix physical-edge run lab
```

Open the two loopback URLs printed by the lab: **Physical AI pilot** and simulator controls. The lab has already enrolled a synthetic hub. Read its protected `physical-edge/.local/physical-lab/access.json` locally: use `sessionToken` on the pilot screen and `localToken` on the simulator. Do not share this file.

Click **Connect / refresh**, register the simulated switch using step 7, and verify an action using step 8. This lab uses a test cloud control plane, not your production company. Stop it with Ctrl+C when finished. Continue below to enroll a gateway against the actual Flolah application.

## 3. Enable the pilot in Flolah

**Flolah server operator**

1. Deploy the reviewed Phase 1 backend and its dependencies through the normal release process. Include the optional physical Compose overlay and set `FLOLAH_PHYSICAL_ENABLED=1` for the intended pilot only.
2. Validate the proxy's exact `/api/physical/hub` WebSocket route and TLS connection. Keep unrelated application services unchanged.
3. Confirm the intended company owner or authorized CEO delegate can open **`/api/physical/ui` on the signed-in Flolah application origin**. This is the current **Physical AI pilot** screen, not a page on the public marketing website.
4. Click **Connect / refresh**. If the screen requires authentication, use the existing application session; do not substitute a hub credential for a user session.

A 404 may mean the feature is disabled or not deployed. Ask the operator to check before creating local configurations. Phase 1 assumes a single backend writer for physical state.

**Success check:** the pilot dashboard loads the current company's hubs, candidates, registered assets and operations.

## 4. Enroll your edge hub

**In Flolah → Physical AI pilot → Enroll a hub**

1. Enter a stable **Site**, for example `home-living-room`.
2. Enter **Name**, for example `Windows living-room hub`.
3. Click **Enroll**.
4. Save the returned hub ID and one-time credential in a protected local configuration. Record the exact site ID. Treat the credential like a password.

Hub enrollment registers the gateway identity; it does **not** register or authorize every device on the network. Never put enrollment credentials in a public URL, screenshot, Git commit or device description.

**Success check:** the hub appears in **Hubs and discovered candidates**. It will be offline until the gateway connects.

## 5. Pair the device and configure its adapter

**On the edge / integration service**

1. Pair the device in its approved integration. For HA, use **Settings → Devices & services → Add Integration**, select the supported device integration and complete the owner pairing prompts.
2. Test a harmless action and its observed state in that integration before involving Flolah.
3. Obtain an HA access token from your HA profile's **Long-lived access tokens** section. Keep it on the edge host; it is different from the Flolah hub credential.
4. Add explicit entity mappings to the protected gateway config. The following is a **currently supported switch example**, not a TV mapping. Replace every placeholder with your actual values:

```json
{
  "dataDir": "C:/FlolahEdge/private/journal",
  "localToken": "REPLACE_WITH_RANDOM_SECRET_AT_LEAST_24_CHARACTERS",
  "hub": {
    "cloudUrl": "wss://YOUR_FLOLAH_APP_HOST/api/physical/hub",
    "hubId": "YOUR_ENROLLED_HUB_ID",
    "siteId": "home-living-room",
    "token": "YOUR_ONE_TIME_HUB_CREDENTIAL"
  },
  "adapters": {
    "site-ha": {
      "type": "home-assistant",
      "url": "http://YOUR_LOCAL_HA_HOST:8123",
      "token": "YOUR_HA_ACCESS_TOKEN",
      "entities": [
        {
          "id": "living-room-switch",
          "haEntityId": "switch.YOUR_ACTUAL_ENTITY",
          "profile": "switch",
          "simulated": false
        }
      ]
    }
  }
}
```

Use an actual lowercase HA entity ID. Restrict the configuration file to the gateway user and administrators. Use HTTPS for HA where available; keep any HTTP connection on the trusted local network. Use `simulated:true` for test assets. A sensor mapping uses profile `sensor` and currently represents temperature readings, not arbitrary sensor semantics.

Use the explicit `tv` profile below for TV entities; do not disguise a remote/media player as a switch. Do not expose one physical device through two simultaneously active adapter paths.

**Success check:** pairing works locally and the configured entity/profile is supported by the installed Flolah adapter.

## 6. Start the gateway and check discovery

**On the Windows edge host**, from the repository root:

```powershell
npm --prefix physical-edge start -- C:/FlolahEdge/private/gateway.json
```

Use the real path where you saved the configuration. The process prints a loopback local-control port; keep the process running and its journal directory persistent. This command starts the gateway, not HA or an external broker.

**In Flolah → Physical AI pilot**

1. Click **Connect / refresh**.
2. Find the enrolled hub and confirm **online**.
3. Check its discovered candidates. Match the intended device ID, capability description and real/simulated classification before continuing.

The hub initiates outbound authenticated WSS to Flolah. No public inbound port on your laptop is required. Discovery sends descriptions; it does not enable device actions.

**Success check:** the correct hub is online and the intended supported device appears as a candidate.

## 7. Register the physical device and grant permissions

**In Flolah → Physical AI pilot → Hubs and discovered candidates**

1. Find the candidate under the correct hub/site.
2. Set its action policy to **approval_required** for the first real-device test. Leave unrelated actions **prohibited**. Read-only sensors have no action policy selector.
3. Click **Register selected candidate**.
4. Find it under **Registered assets**. Verify its site, enabled status, observations and allowed actions. **Technical details** contains the assigned asset ID.

A registered device is bound to this company's hub/site and capability version. Company action policies can impose additional restrictions; asset permissions cannot override a company prohibition. Registration alone does not grant an AI employee tool access.

**Success check:** exactly one intended asset is registered with explicit permissions and the correct identity.

## 8. Request an action and verify the return path

**In Flolah → Physical AI pilot → Registered assets**

1. For a supported switch, enter `{"on":true}` in **set_state** and click **Request action**.
2. Under **Operations and human approvals**, review the operation and click **Approve** if required.
3. Click **Connect / refresh** after execution. The pilot screen does not automatically refresh.
4. Confirm the actual device state changed and that the operation shows **completed** with **Verified observation** and its timestamp.
5. Repeat with `{"on":false}`. Test both directions rather than assuming one successful command proves the entire integration.

The interaction is: human/AI request → Flolah registry and policy → approval → enrolled hub connection → edge policy/journal → adapter → integration/device → observed feedback → adapter → edge journal/buffer → Flolah evidence validation → operation/audit → human UI.

An accepted API call is not completion. If feedback is unavailable, stale or inconsistent, the result remains uncertain or times out. Do not repeatedly send commands to compensate for missing evidence.

**Success check:** both an allowed command and its correlated independent outcome are recorded. A read-only sensor instead passes when its fresh observed value appears; no actuation is required.

## 9. Let an AI employee use the registered capability

**In Flolah's existing employee tool-permission controls**

1. Grant only the required physical list/read/invoke tools to the intended employee. Tool metadata is seeded by the enabled module; grants are not automatic.
2. Ask the employee to use the registered asset and supported action. Keep the company and asset approval gates enabled during the pilot.
3. Verify the resulting operation through the same dashboard and evidence checks. The employee cannot approve its own human approval gate.
4. Add the capability to a broader workflow only after the direct action passes.

An employee does not need a new vendor-specific implementation for every device. It uses the common capability API; the approved adapter translates it. Natural-language requests do not make unsupported capabilities available.

## 10. Test failure, recovery and removal

1. Disconnect the device or integration briefly; request a controlled action and confirm Flolah reports failure/uncertainty rather than false success.
2. Restart the gateway using the same journal/config and confirm the hub identity persists. Reconnects forward evidence and reconcile outcomes rather than blindly replaying commands.
3. After a sustained HA outage, restart/reconnect the gateway to restore its HA subscriptions. Keep normal pilot operation online; offline routines require separate bounded authorization.
4. Use **Disable asset** to stop device use. Use **Revoke hub** to remove hub access; **Rotate credential** requires updating the protected gateway config.
5. After an adapter/capability change, use **Review current adapter capabilities**, review the new permissions and explicitly enable the asset again. Revalidation clears prior grants.

Keep a record of model/firmware, adapter version, site/hub/asset IDs, action, approval, observed outcome and failure results. Never include credentials in this record.

## Worked example: PRISM+ Smart TV

### Desired pilot outcome

“Turn the living-room TV on, open an approved app or choose an available channel, navigate with the remote keys, then put it in standby.” Off means **standby**, not unplugged power. A TV disconnected from mains power cannot receive a network wake command.

### A. Establish the exact compatibility

Record your PRISM+ model and **Settings → About** operating system. If it runs a compatible Android TV / Google TV system, evaluate Home Assistant's [Android TV Remote integration](https://www.home-assistant.io/integrations/androidtv_remote/). Confirm you can control the TV with the Google TV or Google Home mobile remote first. Other operating systems need their own supported integration.

### B. Pair and test in Home Assistant

1. Put HA and the TV on a reachable trusted network.
2. In HA, open **Settings → Devices & services → Add Integration → Android TV Remote**. Select the discovered TV or follow manual setup and complete the on-screen pairing prompts.
3. Record the resulting `remote.*` and `media_player.*` entity IDs.
4. Test standby off and wake separately. Wake support depends on the model's standby networking; test after both a short and a prolonged standby period. Do not assume a PRISM+ model supports Wake-on-LAN or a setting found on another brand.
5. Test one installed app using its supported deep link, then a second app. Test a known available channel in the correct tuner/source, and directional/select/back/home navigation keys.
6. Record which outcomes are independently observable. Power/current-app information is different from video playback or channel-content confirmation.

Home Assistant supports app/deep-link launching, channel requests and remote commands through this integration, subject to the target device/app. Its documentation notes app-ID launch reliability issues and recommends deep links where available; some apps restrict remote commands. Playback status is not provided by the Android TV Remote API. This is therefore **supported apps/channels**, not a guarantee of navigating every app or any arbitrary channel. See the [official capabilities and limitations](https://www.home-assistant.io/integrations/androidtv_remote/).

### C. Configure the shared Flolah TV adapter

Add this entity entry to the HA adapter configuration, using your actual entity IDs and validated app activity. It is a configuration example, not a claim that this unconfirmed PRISM+ model has passed:

```json
{
  "id": "living-room-tv",
  "profile": "tv",
  "haEntityId": "remote.your_tv",
  "mediaEntityId": "media_player.your_tv",
  "simulated": false,
  "apps": {
    "youtube": {
      "activity": "https://www.youtube.com",
      "observedActivity": "com.google.android.youtube.tv"
    }
  },
  "channels": [5]
}
```

`apps` is an approved destination catalog: each key is the Flolah app name, `activity` is the tested HA launch target, and `observedActivity` is the exact remote `current_activity` value observed after launch. No app catalog means no app action. `channels` is an explicit list of tested channel numbers; it also needs `mediaEntityId`. The adapter will not accept arbitrary unlisted app/channel inputs.

After discovery, use the same registration steps with explicit approval policies. Test `set_power` with `{"on":true}` and `{"on":false}`, `launch_app` with `{"app":"youtube"}`, `select_channel` with `{"channel":5}`, and `navigate` with `{"command":"DPAD_DOWN"}`. Supported navigation keys are up/down/left/right/center, back and home.

Power is observed through the remote entity; app completion requires a matching observed activity. Channel completion requires an independent numeric `media_channel` attribute, which the selected TV integration may not expose. Navigation keys have no independent key-result feedback in this adapter. In those cases operations remain uncertain rather than declaring completion. The virtual TV exposes synthetic observations for software testing; those do not validate the real TV. A future human-confirmed outcome path would require separate implementation.

**Recommended topology:** Flolah VPS → Windows Edge Gateway → Home Assistant → PRISM+ TV → HA feedback → gateway journal → Flolah audit/UI. No MQTT broker, Flolah Android APK or Android Debug Bridge is required for this selected Remote integration path. If compatibility requires a different adapter, reassess those dependencies explicitly.

### D. TV acceptance checklist

- Exact model/OS and adapter versions recorded; pairing survives a gateway restart.
- Power on and standby off pass, including wake after extended standby.
- Each approved app, channel/source and navigation key is tested individually.
- Missing feedback and offline TV produce an exception, not a completed operation.
- Human approvals, prohibited actions and disabled assets are enforced.
- One AI-initiated allowed action follows the same policy and evidence path.

The TV is ready only for the capabilities that pass on the actual model. Simulator acceptance does not replace these tests.

## If setup does not work

- **Pilot URL missing:** operator checks feature flag, deployed version and application origin.
- **Hub offline:** check WSS URL, proxy upgrade, credential, site ID and laptop connectivity; never disable TLS verification.
- **No candidate:** check pairing, adapter entity allowlist, supported profile and integration connectivity. For TVs, check the explicit tv profile and approved app/channel catalog.
- **Device registered but action denied:** check both company policy and asset policy, then employee tool permissions.
- **Action awaiting approval:** use the human approval card; an agent cannot clear it.
- **Command accepted but not completed:** inspect actual state and timestamps; do not use optimistic state as evidence.
- **TV will not wake:** verify model-specific standby networking and supported wake method before changing the Flolah workflow.

## Related guides

- [Physical AI architecture and scope](/systems/physical-ai)
- [Three-phase implementation and testing plan](/systems/physical-ai-implementation-plan)
- [Connectors and MCP](/systems/connectors-and-mcp)
- [Home Assistant on Windows](https://www.home-assistant.io/installation/windows/)
- [Home Assistant authentication](https://www.home-assistant.io/docs/authentication/)

## Physical AI menu, workflows and multiple locations

Open **Company Tools → Physical AI**. **Devices** lists registered assets and timestamped observations, filtered by site/hub. Select a declared action, enter schema-valid JSON and request the operation. **Operations & evidence** shows approvals and results. **Register & onboard** embeds the existing registration dashboard; **Downloads & setup** contains the Windows/Linux suite and simulator.

Enroll each edge installation separately with its site ID and private credential. Multiple hubs per site and multiple sites per company are supported. Same-named local devices have distinct registered asset IDs. Requests use the asset's bound hub; an offline site never reroutes to another location. Revoking one hub leaves other locations intact.

To automate a registered device:

1. Register it and explicitly authorize capabilities. Company policy remains enforced.
2. Add **Physical Device** in the workflow editor and connect it after a trigger/step.
3. Select site, hub, registered asset, declared action and JSON arguments. No robot-specific workflow code or credentials are required. **Read last observed property** returns cached state with its timestamp, not a fresh probe.
4. Optionally bind upstream outputs to `arguments` or `entity_id`. Selected site/hub constraints are enforced on the server. Set the operation/approval deadline (1–300 seconds).
5. Enable **Require visual evidence** for an invoked action only when its adapter supplies an image. Missing capture fails that step even if the observed state matches.
6. The company owner or CEO Delegate publishes the workflow. Run it; approve any request in **Physical AI → Operations & evidence**.
7. Use `status`, `operation_id`, `entity_id`, `site_id`, `hub_id`, `simulated`, `result` and `evidence` downstream. Only matching observed completion advances an action. ACK, uncertainty, failure and timeout cannot become success through a default timeout output.

Retries of the same run/node/iteration reuse the operation ID. A new run or iteration creates a new operation. Stopping cannot undo an already dispatched side effect; inspect its eventual result before further action.

## Evidence-backed agent operations

Successful actions record expected/observed property/value, observation time, operation, site, hub, adapter and simulated flag. This is device-reported state evidence; transport acknowledgement alone is insufficient.

Visual evidence is optional. On a Home Assistant adapter mapping, set `evidenceCameraEntityId`, for example `camera.living_room_view`, to an existing authorized camera/screenshot source on that HA instance. Rediscover and revalidate the changed asset, review it and explicitly restore action permissions. The gateway captures PNG/JPEG after matching state feedback. Images are stored privately with capture time and SHA-256, limited to 256 KiB each and 64 MiB per company. At capacity, capture reports unavailable while state evidence remains. This pilot does not automatically delete retained images.

The TV simulator supplies an explicitly labelled **simulator_snapshot** of synthetic state, never a screenshot of physical hardware. Android TV Remote does not universally expose screenshots. A camera mapping does not create a camera or bypass TV permissions. A captured image is visual context, not automatic semantic verification of displayed content. Channel/navigation actions without independent feedback remain unverified even when a camera exists.

Authorize employee content tools `physical_entities_list`, `physical_invoke`, `physical_operation_get` and optionally `physical_evidence_get`. Invoke returns an operation to poll; report success only after `completed` with evidence. `physical_evidence_get` takes `operationId` and optional `index`, returning `dataBase64`, MIME type, capture time, digest and simulated flag. Company/device policy applies to UI, agent and workflow requests. Agents cannot approve themselves or retrieve another company's evidence.

## Standard credential files

Keep hub, local UI and Home Assistant credentials in separate protected files referenced by the edge configuration. The enrollment ZIP provides `config/gateway.json`, `credentials/hub.token` and `credentials/local-ui.token`. Configure the HA token through its local credential-file reference. Do not paste credentials into device descriptions, agent prompts or operation mappings.

For an older PRISM E55, native YouTube and Fire TV app control are separate integrations. Select the registered asset for the path you intend to use. Enable only declared operations with suitable feedback. App-state evidence verifies the active application; it does not verify playback, profile selection or television screen power. Fire TV ADB control requires its approved debugging connection to remain enabled.

## Ask an agent to open an app

After an administrator maps and registers an app-capable device, an authorized employee can accept a request such as “Open Netflix on the living-room Fire TV.” The agent discovers the registered asset and its declared `launch_app` capability, selects the friendly app name `netflix`, requests the operation and waits for approval and matching app-state evidence. The user does not need YAML or Android package names. If more than one location matches, the agent must resolve the intended site/device before acting.

An administrator manages supported app catalogs in **Physical AI → Device mappings**. The reusable `home-assistant-app` transport translates approved friendly names into installed app sources for HA; its observation binding translates the active app back into a friendly value. Device mappings are delivered to the enrolled hub, while its endpoint and credentials remain local. Existing local-file mappings are also supported.

Employee access requires explicit assignment of `physical_entities_list`, `physical_invoke` and `physical_operation_get`; device/company policy and per-operation approval still apply. Available tools alone do not prove an employee's natural-language execution has been tested. A fresh matching active-app observation verifies app launch, not video playback, profile selection or screen power.

## Manage operations from Flolah

With edge suite 0.3.0 or later, open **Physical AI → Device mappings**. Select the company hub and its installed Home Assistant adapter. The discovered integration entities help identify the target and independent feedback source.

1. Enter a stable device ID and display title, or select an existing managed device.
2. Add operations using the approved app catalog or a fixed HA button/script. Use friendly app names; package/source identifiers are administrator mappings only.
3. Define the observed property and map the independent HA sensor state or media-player app ID into its normalized value.
4. Select **Stage and validate on hub**. Refresh to check acceptance or rejection. Credentials and adapter endpoints remain local; configuration cannot install arbitrary code.
5. For a new candidate, register it under **Register & onboard**. For an existing device, review current adapter capabilities. Binding changes disable affected operation permissions; explicitly review and re-enable the intended policies.
6. On the device card, expand **Resource access**. Grant discovery/read and specific operations to `agent:<agent-id>`, `user:<user-id>` or `workflow:<definition-id>`. New registrations start with no agent/member resource grants. Tool permissions and human approval policies apply in addition.
7. Request a simulator operation first. Check its location, arguments, requester, approval and independent evidence in **Operations & evidence**.

Revision history supports restoring an accepted document to the same hub using a fresh activation. Invalid/incompatible documents retain the last valid cache. Pending activations expire; expired device commands are never replayed. Other hubs are not configuration targets.

An online hub does not prove device availability. Device cards distinguish readiness and label old observations as stale. The HA adapter reconnects after an HA restart without reissuing earlier commands. For IP-based integrations such as Fire TV ADB, configure a router DHCP reservation or a stable integration-supported hostname: Flolah retains the HA entity identity, while HA owns the downstream connection and pairing. Flolah does not scan the LAN or rewrite HA's private storage automatically.

Company Action Control authorizes the exact agent tool request; device approval authorizes the resulting physical operation. Both may appear, and neither approval can be supplied by the agent itself.
