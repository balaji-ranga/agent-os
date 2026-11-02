# Virtual room camera / brain / TV workflow

## Scope

The user authorized a separate simulator-only implementation while real PRISM standby-off remains unresolved. No real camera, TV, Fire TV or HA device is controlled by this workflow. The room is a deterministic rendered still-image harness, not CCTV footage; video streaming is not implemented or advertised by this camera profile.

The registered camera and TV use the existing enrolled laptop hub and authenticated MQTT simulator adapter. Capturing the camera reads the linked virtual TV's state only to render pixels. The vision model receives the PNG pixels with a neutral filename, with no state hint, text metadata or simulator state in its prompt. This verifies image reasoning on rendered fixtures, not accuracy on real CCTV.

## Manual workflow

`Virtual Room - Camera Brain TV Off`, definition `virtual-room-camera-brain-tv-off-mvz8tp4k`.

1. Ad hoc trigger, with no schedule or chat trigger.
2. Governed camera `capture`, with a fresh private SHA-verified 640×360 PNG.
3. Existing configured vision model inspects the image. Strict JSON schema requires `tv_state: on|off|unknown`, confidence 0–1 and a visible reason.
4. Continue without actuation unless state is on and confidence is at least 0.85.
5. Time-window node uses `Asia/Singapore`, 13:00 inclusive–18:00 exclusive.
6. Within hours, invoke registered virtual TV `set_power {"on":false}`; company and device approvals remain required.
7. Capture the linked room again after the observed TV-off outcome.

All physical steps enforce `requireSimulated:true`. The optional `simulation_time` input accepts an ISO timestamp with a timezone only when every physical target is a fixed registered simulated asset with no device-ID override. Omit it for the actual server clock. This override cannot be used to run against real devices. Test input: `{"simulation_time":"2026-11-02T14:00:00+08:00"}`.

Assets: camera `e8357797-7142-4870-8cd6-60097ca4b650`; TV `e0ae2a03-326d-45ee-a372-43a850e879a4`; hub `35af8723-cff8-4d4a-863d-2c8be247d403`, site `home-laptop`. Device policies require approval. No new agent or member access was granted.

## Verification

- All 46 edge checks pass, including authenticated MQTT camera capture, matching TV-state pixels, obscured scene, durable frame replay and single side effect.
- Isolated full workflow runner passes positive, outside-hours, off, unknown, low-confidence and malformed model response branches. The isolated test explicitly uses a mock vision HTTP endpoint; it is not evidence of live model inference.
- Strict 13:00 / 18:00 boundary checks pass. A real device or dynamic device target rejects a simulation clock; simulated-only physical steps reject a real device before dispatch.
- Private image references reject another owner, an unentitled member, absent images and captures older than 60 seconds.
- Actual configured model preflight (`gpt-4o-mini`, platform effective secondary) classified rendered on/off/obscured images correctly. This uses real image inference independently of the mocked runner regression.
- First UI run 4073 failed before dispatch: editor defaults copied trigger text into optional physical asset/arguments inputs. Fixed new optional input defaults to static and made the template's empty overrides explicit; regression passes with the JSON trigger payload. Retain the failed run as history.
- Live corrected workflow acceptance: pending normal UI sign-in and rerun. Do not report this pending acceptance as complete.

## Deployment

Backend/frontend release `virtual-room-1793622680` passed API/pagination/existing physical-runner and new virtual-runner tests, with both services healthy and gateway unchanged. Backend input-default correction `virtual-room-input-1793623147` is healthy; frontend/gateway were retained. Laptop edge installed suite source 0.3.2 with protected credentials, managed mappings and durable journals retained. Downloadable Windows/Linux edge suite includes the virtual camera; Android APK is not part of this change.

The real PRISM screen standby-off gap remains open pending a proven control path and independent physical feedback. Virtual evidence cannot prove physical screen power or close that gap.
