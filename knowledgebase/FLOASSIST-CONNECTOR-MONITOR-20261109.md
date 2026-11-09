# FloAssist independent connector monitoring — 9 November 2026

Connector monitoring is a deterministic platform job, not an LLM goal. New FloAssist registrations receive the preference; checks start after enrollment. Existing accounts retain legacy behavior until explicitly opting in. Only owner-selected connectors are probed through existing grants and policy checks. The default owner interval is 60 minutes, configurable from 15 to 1440 minutes.

## Controls and notification behavior

- Company Tools → FloAssist → Preferences: independent health-monitor checkbox and interval. Turning it off suppresses health checks and pending health alerts without disabling explicit connector requests.
- Admin → platform crons (`/admin/crons`): **FloAssist connector health**, job `floassist_connector_health`. Pause suppresses automatic checks and health alerts globally; resume restores the job. Task goals retain their independent lifecycle.
- Healthy checks and recovery are silent. One alert is queued per continuous failure episode; changes in error classification do not repeatedly notify. Recovery clears the episode, permitting a new alert on a later failure. Delivery uses the existing idempotency key and uncertain-delivery protection.
- Quiet hours apply. No token, provider error body or mailbox content is persisted in health records. Unsupported probes are reported as unverifiable, never healthy.
- Task notifications retain existing repeat/day limits. Empty/no-new-task prose is suppressed both at scheduled delivery and when draining old queued notifications. Mixed text containing a real failure is not classified as empty.

The shared job runs every minute, claims at most ten due owners, and uses persisted conditional claims to prevent concurrent duplicate probes. The last-check table is covered by the owner retention registry. No LLM call is needed for these health checks.

## Verification

Full FloAssist regression suite passed, including Outlook transport simulation, permissions, lifecycle and notification tests. The added monitor test covers paused/stopped accounts, onboarding exclusion, disabled owners, owner/admin pause, interval persistence, concurrent claims, once-per-episode delivery, silent recovery, and old queued empty-message cancellation. Physical single-dispatch, speech routing, async-status and SQLite-retention tests passed. Frontend build and its prebuild checks passed after regenerating the copilot field inventory. The live UI asset contains the new preference controls.

Live read-only COO tests after owner reconnection:

- Gmail run `63e3de74-00f5-417e-9c6a-c7b363017cc7`: messages retrieved. Connector access recovered. Importance classification remains a separate quality issue: promotional messages were over-classified, so this is not recorded as a successful important-mail review.
- Calendar run `b9a1e427-268a-4acf-bc51-7ef0fddc773e`: completed the 9 November SGT calendar query; returned no appointments.
- Independent live probes: Gmail, Google Calendar and Outlook available; Google Drive authorization failed, correctly recorded as an exception rather than healthy.

## Deployment and owner activation

Frontend image: `agent-os-frontend:connector-monitor-20261109`.
Backend image: `agent-os-backend:connector-monitor-silence-20261109`.
Scoped releases under `/opt/agent-os-releases/connector-monitor-20261109` and `/opt/agent-os-releases/connector-monitor-silence-20261109` contain rollback image/compose metadata. The gateway container was not replaced by these deployments.

The owner explicitly changed the earlier pause instruction to **Resume task checks and connector health**. Activation used the existing FloAssist service, preserving policy and connector checks. Result: profile active, five configured task schedules active, three historical schedules completed; connector monitoring enabled at 60 minutes. Saved task settings: unchanged/overdue repeat 24 hours, three notifications per task per day maximum, five alert-delivery days, five-minute grouping, quiet hours 22:00–08:00 Asia/Singapore. These are caps, not a promise to send three alerts daily. Closed/stopped tasks and other eligibility rules remain enforced.

Outstanding broader issues are not claimed resolved by this release: importance classification in ad-hoc email summaries and intermittent gateway handshake latency documented in the compaction investigation.
