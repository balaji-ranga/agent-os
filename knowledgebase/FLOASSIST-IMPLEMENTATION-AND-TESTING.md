# FloAssist implementation and verification

Updated 24 October 2026. This describes the working branch, not a production deployment.

## Implemented journey

FloAssist appears on the static home page and Free Tools page at `/free-tools/floassist/`. The page uses the Flolah light/dark palette, the same primary/secondary button pattern, 44px primary controls, responsive layout, accessible field labels, progress and inline error feedback.

1. Enter an email, personal WhatsApp number and launch country; accept terms and messaging consent. Enter the email code. Existing accounts retain their identity and effective TOTP requirement. The limited setup token cannot log into the platform. Refreshing the verification screen preserves the pending step.
2. Select Gmail, Google Calendar, Outlook Mail, Microsoft Calendar, Google Drive or OneDrive. Connect selected apps using Flolah's owner-specific OpenConnector OAuth flow. Connections open in a separate tab; return and check connections. No connector is required for reminders or general assistance. Advanced preferences contain the five proactive responsibilities, timezone, briefing time, quiet hours and autonomy settings.
3. Scan the native Flolah WhatsApp channel QR with a **separate dedicated number**. Flolah's existing COO channel routes messages; FloAssist does not introduce a shared public service number. The page reads the actual linked account number and prevents activation when it equals the personal recipient number. A missing credential identity remains pending. Activate, then open the dedicated number in WhatsApp from the personal phone.

The personal number is an owner-authorized allowlist entry; QR pairing proves control of the dedicated channel, not possession of the personal recipient number. Existing profiles must use their already registered personal number. No shared-service phone challenge is claimed.

Everyday usage is WhatsApp. Full Flolah login is optional. Users created without a password can use the existing Forgot password flow on their first optional dashboard visit. The existing public registration endpoint still requires a strong password; only the server's verified-email onboarding call can create the disabled password sentinel.

## Integration and preservation

- `backend/src/services/floassist/core.js` owns short-lived email challenges, hashed restricted sessions, consent, profile validation, provisioning locks and activation gates. It derives owner/agent identity server-side.
- `platform.js` resolves the owner's single granted COO using `is_coo`, appends an owner-specific assistant skill and reuses native WhatsApp, connectors, policy and scheduled-goal services. Existing skill pins, enablement, priorities, connections and policies are preserved. Explicit policy changes update only this owner's COO scope.
- The Advisory preset permits read/research, requires approval for internal writes, and prohibits external publishing and financial/destructive actions. Managerial permits internal work and requires approval for publishing. Administrative additionally permits financial/destructive actions under the selected prohibited/approval/autonomous setting. The underlying effective policy, including more specific overrides, remains authoritative.
- Activation creates the five selected monitoring schedules through `scheduled-goals.js`. Unselected responsibilities and responsibilities without selected apps remain inactive. Monitoring polls connected sources through those existing jobs; it does not add a second webhook/subscription pipeline.
- `runtime.js` adds owner-scoped one-time/recurring reminders, stable request-key deduplication, quiet-hour gating and a proactive notification outbox. Reminder sends and notification sends claim before dispatch; uncertain sends are not blindly replayed. Pending proactive output expires after 24 hours, delivered content is removed, and delivery metadata is removed after 30 days. User-authored recurring reminder text persists while the reminder is active. Up to 50 reminders may be active per owner; the existing platform usage controls continue to apply to COO execution.
- New reminder/status/control tools run inside the existing tool-owner and action-policy middleware. Browser work, bookings, purchases and provider handoffs use existing COO/browser tools, their durable tasks and policy enforcement. The assistant skill instructs continuation of the existing task, provider-side reconciliation and no duplicate uncertain purchase. No separate payment processor, checkout ledger or dedicated handoff UI is introduced.
- Pausing stops FloAssist's proactive checks/reminders. Stopping also disables a WhatsApp channel created by FloAssist. An existing independent COO channel is never disabled or force-repaired by onboarding. A pre-existing channel must already have the personal number as its sole allowlisted DM sender and groups disabled; conflicting settings are reported, not overwritten.
- The generic connector-grant and financial-policy engines were left unchanged. The shared changes are the internal verified-email registration option, a read-only linked-phone helper, two source-scoped scheduling/delivery hooks, tool/API route registration and the reminder/outbox cron.

## Prerequisites by test class

### A. Local deterministic tests

Requires Node 22+, backend dependencies including better-sqlite3, and a writable temporary directory. No account credentials, real email, browser, gateway, connector service, or external network are required. Time, owner identities, OTP responses and provider status are injected. Tests use in-memory databases and never read the deployment's `.env`.

Run from `backend`: `node scripts/test-floassist.mjs`.

Coverage: input validation; country/consent gates; SMTP failure cleanup; short-lived hashed session handling; OTP attempts and MFA; existing user reuse; changed-phone rejection; cross-owner isolation; existing preferences and policies; disconnected/incorrect QR gates; selected connector ownership; failed provisioning; pause/resume; quiet-hour boundaries; one-time and recurring reminders; cancel isolation; payload-bound idempotency including retries after due time; uncertain sends; deferred notification delivery; deduplication and content cleanup. Latest execution: **77 checks passed**.

### B. Isolated platform integration tests

Requires class A plus permission to create, atomically rename and delete temporary OpenClaw fixture files. On Windows the filesystem sandbox can reject an atomic rename; running this test with approved temporary-file access resolves that restriction. All external fetches are mocked; unknown external requests fail the test.

Run: `node scripts/test-floassist-platform.mjs`.

Coverage: actual Flolah schemas/services, owner-specific credential-directory selection, no credential leakage, data-driven COO resolution, connected-app catalogue, additive skill installation, preservation of disabled/pinned prior assignments, other-owner isolation, native schedule creation, repeat activation without duplicate schedules/skills, preserving a borrowed channel on stop, explicit autonomous finance, public-password-registration protection and internal passwordless signup. It also checks cross-owner same-number conflicts and refreshing the native main session while retaining ongoing task sessions. Latest execution: **26 checks passed**.

### C. Browser and HTTP tests with synthetic providers

Requires classes A/B dependencies, Chrome (or a supported Playwright browser channel), Playwright and localhost networking. If Playwright is not installed in the backend, set `FLOASSIST_PLAYWRIGHT_MODULE` to the installed `playwright/index.mjs` path; optional `FLOASSIST_BROWSER_CHANNEL` selects the installed channel. Tests launch a temporary browser context and an ephemeral localhost server. They send no real email, pair no real phone and authorize no provider account.

Run: `node scripts/test-floassist-browser.mjs`, or `npm run test:floassist:browser`.

Coverage: real Free Tools navigation, desktop/mobile rendering, form actions, recoverable mail/code failures, verification refresh, six app choices, popup connection flow, advanced autonomy controls, QR polling, premature activation prevention, linked-number WhatsApp URL, pause/resume button state, ready-state refresh, sign-out, dark theme, overflow and browser errors. Latest execution: **16 checks passed**. Screenshots and machine-readable results are written to `test-results/floassist/`. The QR screenshot is explicitly a synthetic image, not evidence of a successful WhatsApp pairing.

### D. Existing-platform regressions

Use the existing scripts with their isolated fixtures. The two HTTP suites need localhost access; agent-skill tests need writable temporary workspaces. Do not point smoke scripts at production to replace these fixtures.

Executed successfully:

- `test-action-policy-autonomy.mjs`: read, approvals, prohibited effects, autonomous financial actions, scoped overrides, replay and owner isolation.
- `test-tool-tenant-boundaries.mjs`: **75 checks**.
- `test-notify-approval-lifecycle.mjs`: **60 checks**.
- `test-channel-user-kanban-actions.mjs`: existing channel identity and owner-scoped actions.
- `test-agent-channel-announce.mjs`: existing message/media helper behavior.
- `test-agent-skills-e2e.mjs`: registry, owner isolation, tool readiness, runtime contracts and workspace materialization.

These results are regression evidence, not a guarantee that every existing platform feature was exercised. The 100 original acceptance scenarios are specifications and have not all run end to end.

### E. Live provider acceptance — requires deployment and user-controlled fixtures

Requires deployed backend/static files, working SMTP, valid published terms/privacy pages, a seeded/granted COO, configured OpenClaw gateway/admin RPC with native WhatsApp support and a writable account credential store. The user must have both a personal number and a separate dedicated WhatsApp number. Actual QR scanning requires the user controlling that phone. Each OAuth provider requires its Flolah/OpenConnector platform app, approved scopes/callbacks and disposable test mail/calendar/file accounts. Browser/provider actions require the existing configured browser execution service. Real purchases require an explicitly authorized test merchant or sandbox and provider-side evidence.

Required live scenarios:

Provider IDs were checked against the VPS OpenConnector catalog on 2026-10-24. FloAssist keeps stable selection IDs, with `provider_id` in its product catalog mapping `google_calendar` to `googlecalendar`, `google_drive` to `googledrive`, and `onedrive` to `one_drive`. Both OAuth initiation and connected-state validation use the provider ID. Scheduled instructions include the selected label and provider ID. Two platform regression checks cover this mapping and reject false authorization based only on the logical selection ID.

At that preflight, Gmail's platform OAuth client was configured. Google Calendar, Google Drive, Outlook and OneDrive were present but their OAuth clients were unconfigured. The callback reported by the installed service is `https://flolah.cloud/openconnector/oauth/callback`. Microsoft Calendar (`outlook_calendar`) was absent from the OAuth catalog; verify/install a suitable provider before selecting it. Do not substitute Outlook Mail: its advertised scopes do not include calendar access. These observations establish configuration presence, not successful end-user OAuth consent or delivery.

1. New signup in SG, IN and ID; existing account with email MFA; existing account with TOTP; optional password setup and dashboard login.
2. New dedicated-number scan; expired QR refresh; credential identity pending; same personal/dedicated number rejection; disconnect/reconnect; gateway restart; no cross-owner session fallback.
3. Each of the six OAuth providers: connect, declined consent, failed callback, expired/revoked token, reconnect, correct owner/account selection and no false connected indication.
4. Personal-number inbound prompt and reply; blocked unallowlisted sender; blocked groups; two simultaneous owners; real one-time and recurring reminder delivery.
5. All five proactive checks with actionable and unchanged fixtures, quiet-hour deferral and idempotent delivery after restart. Verify configured timezone, including Indonesian zones.
6. Advisory, Managerial and Administrative actions against disposable records, including autonomous finance where explicitly configured, approval rejection and prohibited action attempts.
7. Booking/purchase browser handoff, provider authentication, return to the same task, success verification, provider cancellation and uncertain-charge reconciliation without resubmission.
8. Existing COO skills, policy, scheduled work, connected apps and channels before/after uplift, pause and stop.

These live cases have **not** been executed in this implementation session.

## Deployment and privacy limits

The current nginx apex `/free-tools/` static location and `/api/` backend proxy already cover FloAssist. Deploy both backend changes and `deploy/static/flolah-home` together; no new public provider webhook or secret is required. `platform_settings.floassist_config` can disable new enrollment with `{"enabled":false}`; `floassist_management_url` optionally supplies the existing Flolah login URL. Existing gateway/SMTP/OAuth configuration remains the source of truth.

End-to-end transient-only processing is **not implemented** by this native-channel integration. WhatsApp, OpenClaw conversation sessions, task/history records, tool audit and upstream connectors retain data under their existing settings. The skill avoids copying raw connector bodies to long-term memory, and the FloAssist outbox cleans its own content, but neither guarantees deletion in downstream systems. The UI states this limitation rather than advertising zero retention. The original transient-processing acceptance target requires a separately validated runtime retention implementation before it can be claimed.

No production deployment, live provider authorization, real WhatsApp scan, payment or booking was performed by these tests.
