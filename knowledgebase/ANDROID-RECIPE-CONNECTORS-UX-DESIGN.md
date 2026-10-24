# Android recipe inventory and coaching UX design

Date: 2026-10-24

Status: Proposed implementation design; the described controls are not claimed as shipped.

## Connectors entry point

Extend Connectors with an Android recipes inventory alongside browser and standard recipes. Retain current connector navigation and deep links; support equivalent Classic and Immersive flows. Use the existing Connectors page as the integration point, with recipe management and paired devices linked from the Android inventory.

The inventory is a real sortable, paginated table. Its primary columns are app code, app name, supported app versions, recipe/capability name, recipe version, access mode, publisher, validation status and customer connection status. Show region/language and last validation in expandable details; allow them as filters. Package/signing identity, exact tested version codes and runtime requirements are available in details, not hidden assumptions.

Search app/recipe names and codes; filter by app, capability, version compatibility, publisher, validation, enabled state and read-only access. Row actions are View, Validate, Enable, Disable and Coach variation, subject to permissions. Display global release status separately from this user's device compatibility. No row can be labelled ready solely because it is in the catalog.

## Initial catalog entries

Seed SCB / Standard Chartered SC Mobile Singapore / Read credit-card bills / Read-only, and DBS / DBS digibank Singapore / Read credit-card bills / Read-only. Both start pending device validation with no invented package identity, supported version or success timestamp. SCB and DBS are proposed Flolah app codes, not asserted Android package names.

Show pending validation entries for discovery but disable activation until an eligible release and a compatible customer device exist. Label publisher provenance as Flolah, organization or community; none implies bank endorsement. Pilot publishing is restricted to authorized Flolah recipe maintainers.

## Onboarding

`Select recipe -> Pair/select phone -> Check installed identity/version -> Review permissions and residency -> Authenticate locally -> Supervised compatibility validation -> Enable`

Permission review lists the exact capability, allowed actions, inherited read-only restrictions, result location and transient metadata fields sent to Flolah. Device-private mode is the default. Phone authentication uses the source app's UI; Flolah never asks the user to type bank credentials into its own form. Selecting an app or pairing a device does not grant all recipes.

Validation states distinguish offline, locked, needs authentication, unsupported version, protected screen, bank security restriction, unknown layout, policy denied and compatible. Explain the actionable next step. No automatic fallback to another device, account, recipe release or server-controlled app session.

## Coaching and publication

`Name capability -> Review capture consent -> Demonstrate permitted route -> Mark output fields -> Review graph -> Supervised replay -> Save draft -> Validate -> Publish`

Every usable recipe is coached and validated, either before distribution or by the customer. Ready recipes avoid mandatory repeat teaching; customer onboarding still checks actual compatibility. Coaching a new capability does not expand inherited policy. Pause capture for authentication, show recording state and provide pause/discard/delete controls. Raw coaching evidence stays local.

Review uses recognizable screen landmarks, target controls, expected destination and field semantics rather than fixed coordinates. Allow additional known branches and variable card selection. Preview the sanitized structural recipe before export; personal values and screenshots cannot enter a public release by default. A customer variation creates a scoped draft without modifying the shared release.

## Run and result presentation

Show task, selected device, bank/app, pinned recipe release, read-only badge, current step, authentication handoff and pause/cancel controls. Keep the stop control on the phone available independently of server connectivity. Unknown screens pause for coaching; the UI must not suggest unrestricted model improvisation.

Private results open on the authorized phone and contain per-bank/card fields, distinct balance meanings, currency, retrieval time and completeness. Server chat displays only completion/progress and a local result reference; do not populate server UI with financial previews. Desktop-to-phone handoff identifies the device and opens an authenticated local result; it is not a public result URL.

Optional Share selected summary opens a local field/value preview with recipient, purpose and expiry. Explain that approved values will leave the device. This is a separate grant, never a default onboarding checkbox. Durable export requires a separate explicit destination/retention decision.

## Changes and recovery

App version or screen mismatch marks the binding revalidation required. Do not mutate or silently replace the pinned recipe. New actions/permissions require review; revocation disables future execution within the authorization lease bound. Show what completed, what remains unknown and whether the local result is partial before offering resume.

Device management provides last seen, pairing revocation, local storage controls and active task state. Revocation messaging explains the bounded offline lease. Delete local results/coaching and delete transient server memory are distinct operations with clearly stated effects.

## UX acceptance

Verify keyboard/screen-reader support for inventory and details, responsive phone layouts, accessible status announcements and identical authorization behavior across Classic/Immersive. Exercise both seeded bank rows, incompatible versions, coaching variations, authentication handoff, unknown screens, partial results and cancellation. Verify displayed readiness is backed by real validation rather than seeded sample data.

Architecture, security contracts, delivery work packages and real-device pilot gates are defined in the [Android implementation design](ANDROID-CONNECTOR-IMPLEMENTATION-DESIGN.md).
