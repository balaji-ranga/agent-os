# Android connector implementation and architecture design

Date: 2026-10-24

Status: Agreed direction and implementation design. No companion, bank compatibility, published recipe or passing pilot is claimed by this document.

## Core objective

Build the Flolah Android companion and adaptor as a reusable connector runtime for supported Android apps. Instructions originate from Flolah's LLM through the authenticated Flolah control plane. Execution and raw source data reside on the device. The server receives only transient, allowlisted compacted context and compacted action memory by default. Pre-coached recipes make supported capabilities selectable during onboarding; user coaching covers missing routes and variations.

This uses the browser automation pattern of remote planning and local interaction, but adds an explicit Android privacy contract. It does not assert that every existing browser execution path already provides this residency guarantee. App permission and coaching cannot overcome source-app or Android protections.

Parent: [release plan](KNOWLEDGE-RAG-AUTOINDEX-DEVICE-AUTOMATION-PLAN.md). Product flow: [Connectors and coaching UX](ANDROID-RECIPE-CONNECTORS-UX-DESIGN.md).

## Architecture and ownership boundaries

```text
Flolah LLM -> policy and job service -> signed task envelope
                                           |
                                   Android companion
                         local authorization and outbound filter
                                           |
                           recipe runtime and local journal
                                           |
                         permitted Android interaction driver
                                           |
                                SCB / DBS / other apps

Android -> filtered compact context and action outcomes -> Flolah planner
Android -> private structured result -> local result viewer
```

The server owns recipe metadata/releases, grants, device public identities and short-lived orchestration state. The companion owns device keys, local consent, encrypted results and journals, screen matching, extraction, aggregation and result presentation. The interaction driver must execute on-device for production. Managed Appium/UiAutomator2 is a feasibility/test option, not evidence that an on-device production driver or compliant distribution model is solved.

Known recipe transitions run locally within an LLM-issued scoped task. The device does not independently expand the goal. Unsupported states return a compact blocker or ask for coaching; no unrestricted scripts, arbitrary shell commands or model-generated coordinate sequences are accepted.

## Instruction provenance and authorization

The LLM produces a typed proposal; the Flolah service validates and signs the authorized instruction. A signature proves control-plane origin and authorization, not that arbitrary model output is safe. Each envelope binds tenant, user, agent/workflow, device, job, capability, recipe release/hash, policy epoch, mode, sequence, nonce, issue time and expiry. Use authenticated encrypted transport and device-held keys, supporting rotation and revocation.

The device checks signature, destination, freshness, replay protection, app identity/version, current screen and local authorization before every transition. Effective permission is the intersection of platform policy, user and agent grants, device consent, binding scope and recipe permissions. Local deny and stop always win. Screen text is untrusted data, never an instruction source.

Require an active bounded authorization lease. Disconnect, lease expiry, revocation, app identity mismatch or incompatible recipe halts new actions. Bound offline execution by the lease and report the maximum revocation delay; do not promise instantaneous remote revocation without connectivity. After reconnection inspect the local journal before resuming; no automatic stale queue replay.

## Data residency and server memory

Default device-private mode keeps raw hierarchies, screenshots, OCR text, coaching captures, account identifiers, balances, statements, transactions and detailed traces local. Credentials, OTP and biometric flows remain exclusively in the bank's local authentication UI. Suspend recording and observation during authentication; redact or discard sensitive captures before persistence. Use Android Keystore-backed encryption, user-scoped storage, retention/deletion controls and backup exclusions for sensitive files.

Local deterministic compaction emits a schema allowlist: opaque job/step IDs, recipe release, known screen-state ID, completed transition IDs, outcome codes, permitted next transitions, blocker codes and opaque local checkpoint/result references. Exclude arbitrary screen text and identifiers from errors, telemetry and summaries. Treat even compact metadata as sensitive. Compaction is not anonymization.

Proposed pilot transient-state default: expire 30 minutes after last activity, with a hard 24-hour lifetime from creation; delete on task end or cancellation. Enforce deadlines at read and write, run cleanup and verify deletion. Keep this state outside durable chat, analytics payloads, Knowledge/RAG, prompt traces, provider request logs and backups. If the existing orchestration stack cannot enforce that separation, block private mode release until it can. Document provider-side retention before claiming end-to-end transience; otherwise keep that memory out of external model requests. Durable audit stores only approved minimal authorization/recipe/timing/outcome metadata under an explicit separate retention policy.

The authoritative local journal stores ordered action intents, receipts, verified destinations, checkpoints and unresolved outcomes. Server compaction never determines whether an action should be repeated. Enforce per-device foreground serialization and idempotent job/sequence processing.

## Result modes

Device-private is the pilot default: local extraction, arithmetic and template-based summary; an on-device model is optional, not required. A server chat can acknowledge completion and offer an opaque device result reference, but cannot display financial values without a sharing grant. Opening a private result must resolve locally on its authorized device; no automatic server upload or cross-device access.

Approved summary mode requires a separate grant specifying fields, recipient/agent, purpose and expiry. Preview the outgoing values locally. It permits named financial fields to reach Flolah transiently and visibly changes residency. No automatic sharing with accounting, workflows, Knowledge or another agent. Generic error strings, notifications and chat transcripts must not retain the shared payload. If a durable exported answer is requested, treat it as a separate explicit export with stated destination and retention.

## Recipes and registry contracts

Use additive database-backed definitions, immutable releases and tenant/user/device bindings; app names and agent identities are configuration, not core-code constants. Store app code, display name, Android package/signing identity, tested version codes/names, region, locale, minimum runtime/Android compatibility, capability, action classes, publisher, release hash, validation date and evidence reference.

A release contains screen fingerprints, selector priorities, navigation graph, preconditions/postconditions, extraction schema, authentication handoffs and permitted recovery branches. Prefer stable observed selectors; ambiguity fails closed. Coaching captures stay local; publishing exports only reviewed sanitized structural definitions. Test that sample values and selector text cannot leak personal data. Integrity-sign releases and pin bindings to a hash. Expanded permissions or incompatible changes require review and revalidation. Revoked releases cannot start or continue new transitions after revocation is learned/lease expires.

Separate release lifecycle (draft, coached, validated, published, deprecated, revoked) from binding state (unvalidated, ready, needs authentication, running, paused, incompatible, revalidation required, disabled). Global catalog access never grants execution against another user's device or accounts.

Proposed service contracts: catalog list/detail; release validation/publication/revocation; pair/revoke device; create/validate/disable binding; dispatch/cancel task; compact event ingestion. Raw result/evidence upload is absent from private-mode contracts. Expose scoped business capabilities to agents rather than a general tap tool. Reuse existing connector execution policy and action grants after auditing their payload persistence behavior.

## SCB and DBS read-only pilot

Assume Standard Chartered SC Mobile Singapore and DBS digibank Singapore, English locale, personal credit-card accounts. Corporate banking and other regional editions need separate recipes. Seed catalog definitions for each bank's read-credit-card-bills capability as pending validation; discover and verify actual package/signing identities and tested versions on authorized physical devices before publishing.

Task: summarize pending credit-card bills across both banks. Extract masked card identifier, currency, statement period/balance, current outstanding separately, minimum due, due date and explicitly displayed remaining due/payment status, with local provenance and timestamps. Missing values are unknown, never zero. Separate currencies and avoid double counting supplementary cards or repeated screens. Do not calculate remaining due from statement balance alone. Results declare per-bank and per-card completeness.

Allow only validated launch, navigation, scrolling, card selection, field reading and local summarization transitions. Payments, transfers, submissions, card controls, settings changes and unknown targets are denied. This is enforced by the recipe engine, not by assuming the bank session is read-only. The pilot excludes downloads/shares that introduce additional effects unless separately designed and authorized. Authentication always hands off to the human.

Compatibility is a first milestone. DBS documents access restrictions for screen sharing and certain accessibility-enabled apps. Validate SCB independently; do not generalize DBS behavior. Stop on protected content or security blocks without bypasses. User-provided statement import is an explicit alternative and cannot pass the native-app automation gate.

## Implementation work packages

1. **Feasibility, mobile engineering and QA:** obtain consenting users/devices, verify identities and Android/app versions, test observation/action mechanisms and distribution constraints, and record per-bank pass/block outcomes. Decide production driver before committing to broad rollout.
2. **Registry, backend and Connectors UI:** additive schema, release integrity, catalog table, filters, details, bindings, compatibility checks and policy integration. Preserve existing browser and standard recipe flows in Classic and Immersive experiences.
3. **Runtime, mobile and backend:** pairing/keys, typed signed envelopes, foreground leases, local matcher/extractor/journal, encrypted results, authentication handoff, stop/revoke and schema-filtered compact events.
4. **Coaching, mobile and recipe tooling:** consented local capture, editable navigation graph, field mapping, sanitized export, supervised replay, publication and version invalidation.
5. **Pilot, recipe authors and QA:** coach SCB/DBS on proven configurations, validate multiple cards and partial results, publish two eligible read-only releases and enable onboarding selection.
6. **Privacy and release verification, QA and platform:** outbound/log/provider-retention inspection, isolation/replay/revocation tests, fault injection, packaging, rollback, and physical-device UAT evidence.

Audit relevant integration points before coding: `frontend/src/pages/Connectors.jsx`, `backend/src/services/browser-recipes.js`, `backend/src/services/connector-execution-policy.js`, `backend/src/services/connector-action-grants.js` and existing pairing/worker transport. Reuse compatible contracts without changing browser data behavior implicitly. New Android endpoints and migrations remain implementation work, not existing API claims.

## Acceptance and rollout

- Both recipes onboard from Connectors and pass on declared physical-device/app configurations. Unsupported configurations remain visibly ineligible.
- Every displayed amount/date matches its source; ambiguous and absent fields remain labelled. Test no cards, multiple cards, partial bank failures, changed layouts and session expiry.
- No forbidden transition occurs in policy-denial, unknown-screen, injected-screen-text, replay, wrong-tenant, wrong-device, altered-release or stale-command tests.
- Capture controlled traffic and inspect backend/model/log/analytics/backup paths to prove raw data and financial values stay local in private mode. Verify compact-state expiry, deletion, cancellation and sensitive local backup exclusions.
- Test crash after action/before receipt, duplicate delivery, app switching, lock/offline state, cancellation and revocation; reconcile from local evidence without blindly repeating actions.
- Measure completion rate/time, authentication handoffs, extraction correctness and compact payload size on actual devices. Set performance budgets from the feasibility baseline; publish no unsupported reliability claims.

Use independent flags for Android catalog, pairing, execution and summary sharing. Rollback disables dispatch and activation, expires leases and preserves local user results for explicit deletion/export. Do not disrupt existing browser/standard connectors. Pilot completion requires both real bank routes; synthetic tests and fallback import are insufficient.

## External constraints

- [SC Mobile Singapore](https://www.sc.com/sg/bank-with-us/mobile-banking-services/standard-chartered-mobile/)
- [DBS digibank Singapore](https://www.dbs.com.sg/digibank)
- [DBS anti-malware and access restrictions](https://www.dbs.com.sg/personal/support/general-digibank-security-malware-jailbroken-device.html)
- [Google Play AccessibilityService policy](https://support.google.com/googleplay/android-developer/answer/10964491)
- [Android sensitive activity protection](https://developer.android.com/security/fraud-prevention/activities)

Recheck current platform policies and bank behavior during feasibility. Private/managed distribution does not establish technical compatibility or permission to bypass protections.
