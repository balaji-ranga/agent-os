# Physical command rejected while laptop edge slept — 5 November 2026

## Evidence and cause

WhatsApp's agent selected the registered BroadLink entity and `send_power_toggle` correctly. Physical tool logs 44527 and 44529, at 15:22:51 and 15:24:18 Singapore time, report `Device unavailable; no command queued`. Attempt 44530 was blocked as a duplicate. These errors occurred before an operation was created/dispatched, not from malformed action arguments. An earlier status lookup used an entity ID as an operation ID and returned Not found; that is not evidence of a dispatched toggle.

Windows Kernel-Power events show Modern Standby entry at 11:09:15 SGT and exit at 19:19:21 SGT. The failed commands fall within that standby interval. The edge process survived and reconnected when the laptop resumed. Local authenticated diagnostics subsequently showed both cloud and HA connected, no pending evidence, and BroadLink `remote.bala` available. The server reported the PRISM IR device available with a fresh report. The separate native-TV and Fire TV integrations were unavailable; their availability is not the BroadLink path's availability.

## Changes

- Laptop plugged-in sleep timeout changed from 10,800 seconds to zero. Battery timeout remains 600 seconds. Display and lid/manual sleep settings were not changed. A sleeping/off laptop cannot serve as an available edge; keep it plugged in and awake for remote automation.
- Generic server heartbeat detects a silent connection and removes it after three missed heartbeat periods (15 seconds each, checked on the next tick). This prevents a dead transport remaining classified as connected.
- Pre-dispatch errors now distinguish an offline edge hub (site and last contact included) from a connected hub reporting a device unavailable. Both explicitly state that no command was queued/sent, direct the agent to refresh inventory after recovery, and forbid automatic replay of a toggle.
- Rejected pre-dispatch actions now persist a reason-specific audit entry.
- Duplicate protection remains enforced; its explanation now says “attempted”, not “ran”, and tells the agent to inspect the prior failure rather than imply execution.

## Validation

Seven managed Phase 1 tests passed, including silent-heartbeat disconnection, distinct no-dispatch errors, zero operation creation on rejection, two-hub isolation, and HA reconnect without action replay. Tool-execution governor/duplicate-scope tests passed. Candidate image passed the existing physical API authorization integration test.

Backend-only release: `agent-os-backend:edge-health-20261105`, layered on the current retention release after an exact-image concurrency check. Gateway image/configuration was not changed. No real TV toggle was issued during diagnosis or these tests; transport readiness is not a claim of actual screen state.
