# Copilot guided autofill — single-phase implementation

## Scope and release boundary

Deliver a natural-language, icon-launched assistant for guided, autofill and hybrid journeys. Preserve existing screen validation, tenant permissions and configuration. Local tests precede deployment; VPS deployment requires explicit user confirmation.

## Implementation

1. Merge current main into the isolated Copilot worktree after checkpointing local work. Preserve competing changes and exclude private implementation-status documents.
2. Form definitions are authoritative for suggested values: field purpose, type, limits, enums, required fields and dependencies. DOM inspection locates visible controls; it must not invent a schema or relax permissions. Missing definitions mean guidance-only until a tested definition is supplied.
3. Add schema-backed DOM bindings or prefabricated recipes for eligible forms. Bind actions to the current route and fresh field identity, reject stale controls and preserve user edits. Never accept arbitrary model JavaScript, API URLs or unrestricted selectors.
4. Guided journeys propose and fill reviewed fields incrementally, highlight the current field and ask for missing inputs in chat. Autofill reviews a batch. Preserve supported non-sensitive drafts across navigation and return to the origin. Saves, sends, account linking, permissions and destructive actions remain user-controlled; auto-saving controls require an explicit write warning before field application.
5. Inspect CRM/ERP embedding. Same-origin access is not assumed. Cross-origin forms require an authenticated, narrowly scoped integration bridge with explicit origin checks and matching schemas; otherwise provide truthful guided handoff.
6. Keep the launcher icon-only with accessible name, tooltip, keyboard focus and mobile sizing. Keep conversational guidance primary; hide technical metadata from ordinary users.
7. Update source-controlled Platform Help templates and help documentation to match actual supported behaviour.

## Acceptance

- Enumerate every inventoried screen as tested autofill, tested guided-only, human-required or blocked; inventory presence alone is not acceptance.
- Test native and controlled inputs, selects, dependent options, validation, stale proposals, navigation, cancellation, draft expiry and manual edits.
- Verify no secret fields or unrelated record content reach the model. Test tenant/role boundaries, hidden fields, disabled controls and unsupported iframe origins.
- Verify exact agent-chat draft handoff without sending; test call handoff without claiming microphone/audio acceptance.
- Run backend contracts, HTTP harness, frontend build and interactive local browser journeys. OAuth and real voice acceptance remain explicitly human-required until performed.
- No UAT-ready claim until the coverage matrix and test evidence support it. VPS deployment was explicitly authorized on 13 October 2026.

## Reusable capability direction

Separate the schema/proposal contract, DOM field driver, conversation/session and host bridge. An eventual third-party scriptlet must register a trusted application origin and schema, use exact parent/child origin checks, and enforce its host's authentication. Do not enable arbitrary origins or model-generated JavaScript. Current deployment targets Flolah and its configured CRM/ERP frames only.
