# Phase 1 validation record — 31 October 2026

Source was reconciled with GitHub main before implementation; the fetched main and checkout had no divergence. Existing local architecture/testing-plan edits were retained.

## Passed locally

- `npm --prefix physical-edge test`: **23 passing checks**, including real HTTP/WebSocket/MQTT integration and explicitly identified Home Assistant protocol-fixture coverage.
- `node backend/scripts/test-physical-integration.mjs`: production route authorization, owner isolation, SQLite persistence, credential rotation, strict approval decisions and absence of agent self-approval.
- Existing company execution contract regression.
- Existing tenant-boundary regression: **75 checks**.
- Existing runtime-capability registry regression.
- Existing action-policy/autonomy regression, including human approval and tenant controls.
- Public-docs sensitive-content scan and help catalog checks.
- Static documentation production build.
- Browser verification of onboarding, explicit simulated-switch permission, requested action, independently observed completion, persisted result after local-lab restart and simulator controls.

The running lab uses only synthetic owner identities, generated local credentials and simulated equipment. Its files are under ignored `.local` directories. The cloud integration remains disabled in the deployed application. No existing Flolah application container was restarted or replaced.

## Real Home Assistant integration — passed

After explicit authorization, the test source was transferred to an isolated VPS release directory and the real Home Assistant container acceptance runner completed successfully. It verified:

- Fresh Home Assistant onboarding and authenticated MQTT integration.
- Discovery of simulated switch and temperature-sensor entities.
- Authenticated Home Assistant service calls and independent state observations.
- Successive operations without retaining a completed adapter lock.
- Complete cloud control plane → authenticated hub connection → edge gateway → Home Assistant → MQTT simulator → observed result → cloud completion.
- Sensor observations received in the cloud registry.
- Accepted-only commands remain unverified and expire as uncertain rather than completing falsely.

The fixture used private-network, resource-bounded containers with no published ports. Temporary containers and the network were removed, and the runner confirmed that the original running-container set was preserved. The deployed application was not enabled, rebuilt or restarted. Successful evidence is retained in the isolated release directory `physical-acceptance-5dd9503aa3`; local copies of the result and image identity are in ignored `.local/physical-ha-acceptance.txt` and `.local/physical-ha-evidence.json`.

The hardware-free Phase 1 integration gate, including a real Home Assistant instance, has passed. Docker/Mosquitto deployment packaging and Nginx configuration still require target-environment rollout validation before enabling the optional cloud feature in production; this acceptance run does not constitute a production deployment. Existing application behavior remains protected by the disabled-by-default feature boundary.

Hardware discovery, vendor compatibility, USB/radios, physical safety and real actuator behavior are deliberately deferred to the separately scheduled hardware pilot; simulator acceptance cannot certify them.


## Desktop Phase 1 rollout and TV simulator — 31 October 2026

The VPS backend and frontend were rebuilt from captured deployed sources with three-way reconciliation, then activated with health checks, a pre-rollout database backup and rollback images. The exact physical-hub Nginx route passed configuration validation. Only backend/frontend were recreated; OpenClaw and Ollama identities remained unchanged. The desktop-only package catalog is active; Android APK is outside Phase 1 and excluded from downloads.

26 source tests passed, including the virtual-TV power-on/app/channel/navigation/power-off sequence over real HTTP/WebSocket/MQTT, missing-evidence rejection, HA TV allowlists and observed-state mapping, and the prior policy/tenant/recovery gates. A native bridge fixture was used only for the separately retained experimental Android prototype; it is not Phase 1 Android acceptance.

The exact downloadable ZIP was extracted and installed independently on Windows (four simulator profiles discovered; PowerShell launcher parser passed). The Linux shell launcher and five-step TV sequence passed in a fresh resource-limited VPS container with no public ports or production account. The deployed backend image's real route/auth/SQLite harness verified authenticated ZIP download bytes and SHA-256, unauthorized/missing download rejection and desktop-only catalog entries in an isolated container. The static docs build and public content scan passed.

No privileged test identity was created in production: automatic review rejected that proposed access change, and isolated acceptance was used instead. Signed-in Connectors browser verification awaits the user's normal login. Actual PRISM+ TV power/wake/app/channel/navigation remains untested until Home Assistant and the laptop gateway are paired on the user's LAN. Existing Home Assistant switch/sensor live acceptance is recorded above and does not establish PRISM+ compatibility.
