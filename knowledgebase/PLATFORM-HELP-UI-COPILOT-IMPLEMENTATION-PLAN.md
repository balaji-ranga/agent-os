# Platform Help UI Copilot — Single-Phase Implementation Plan

Date: 2026-10-12 (Asia/Singapore)

Status: Implementation proposal. This document does not indicate implementation or deployment completion.

## 1. Objective and scope

Enhance Platform Help into a stateful, permission-aware UI copilot that understands Flolah screens, fills internal setup forms, guides external configuration, navigates between screens, and resumes the original task after prerequisite setup.

Replace the floating COO icon with Platform Help in Classic and Immersive designs. Retain COO through existing chat and organization screens. Reuse the current chat panel, form validation, backend APIs and call mechanisms. Workflow graph editing remains the responsibility of Workflow Builder.

Deliver one integrated release: comprehensive feature-menu navigation, explicitly registered internal setup forms, connector guidance, durable assistance sessions, authorization controls and acceptance tests. Do not promise unrestricted automation of every visible button; unregistered forms remain guidance-only until they implement the common contract.

## 2. Existing implementation foundations

- `frontend/src/components/CooAssistantWidget.jsx` embeds the reusable `AgentChatPanel` and opens through the `agent-os-open-coo` event.
- `frontend/src/App.jsx` mounts the floating widget and includes an Immersive COO entry point. Both entry points must be updated consistently.
- Workflow Builder already interprets structured agent actions into UI effects through `frontend/src/utils/workflowAgentUiEffects.js` and its workflow chat component. Reuse the pattern, not Workflow Builder's ownership of workflow edits.
- Platform Help workspace instructions currently define a guidance-only role, use built-in help-document RAG, and prohibit impersonating COO or CRM/ERP execution agents. Update these instructions to permit the new bounded UI assistance tools while preserving those role boundaries.

## 3. Interaction modes

### Guided

Explain the current screen, highlight the relevant control, provide the next action and wait for user participation.

### Autofill

Populate supported internal forms from the user's intent, resolve authorized options, validate values and show proposed changes. Filling a form is separate from submitting it.

### Hybrid — default

Autofill internal configuration; guide external authorization and sensitive actions. Changing modes must not weaken authorization or confirmation requirements.

## 4. Screen and action registry

Introduce a versioned registry consumed by both the UI and Platform Help. Each supported screen/form declares:

- Stable screen/form identifiers, purpose, route and required permissions.
- Fields, descriptions, types, allowed values, dependencies and validation constraints.
- Authorized dynamic option providers for agents, skills, tools, connectors and other resources.
- Current non-sensitive values, dirty state, record version and validation errors.
- Registered actions such as fill, validate, save draft, submit, navigate and test connection.
- Side-effect classification, confirmation requirements and user-only steps.

The model proposes structured actions. A deterministic dispatcher validates the contract and current entitlement before invoking existing application handlers and APIs. Do not execute arbitrary JavaScript, guessed API endpoints, unrestricted selectors or model-generated HTML.

Maintain an explicit supported-form inventory and acceptance case for every registered form. All feature-menu destinations should support permission-aware navigation; automation coverage is registered per form.

## 5. Internal form autofill and execution

For a request such as “Create a research employee with web-search access”:

1. Identify the appropriate registered setup form.
2. Resolve available roles, skills and tools from the authenticated user's authorized inventory.
3. Ask only for missing required choices or materially ambiguous intent.
4. Populate the actual form using its registered state interface.
5. Run existing client and server validation.
6. Show a before/after review and the actions that will occur.
7. Commit through the existing application action when authorized.
8. Confirm success using returned entity IDs, saved values or status—not the model's assertion that an action completed.

Autofill must not silently grant permissions, publish workflows, send messages, delete records or alter security settings. Preserve current approval policies. Platform Help configures the application; live CRM/ERP business operations remain with their existing authorized tools and agents.

## 6. External configuration guidance and watcher

For Gmail, Microsoft, MCP or other external connections:

1. Fill Flolah-owned non-secret settings where permitted.
2. Explain the next authorization/configuration step inline.
3. Hand login, consent, MFA, CAPTCHA and secret entry to the user.
4. Observe Flolah connection state and authorization callbacks.
5. Recommend the next step once the prerequisite is confirmed.

Use application state events and connector completion notifications. Where events are unavailable, use bounded status polling with backoff, timeout and cancellation. Do not continuously capture screenshots or invoke the LLM on every field change.

Flolah's page cannot inspect an arbitrary external browser tab. External progress is established through connector callbacks/status or explicit user confirmation. Do not introduce another connector or authentication implementation when an existing connector flow supports the requirement.

Watchers should pause when the assistance session is cancelled or no longer relevant, recover on reconnect, and avoid duplicate subscriptions across tabs. Never mistake a click or an opened OAuth window for successful authorization.

## 7. Durable assistance session and drafts

Persist a session scoped to both tenant and initiating user containing:

- Original request, selected mode and originating screen.
- Current screen, pending steps and prerequisite dependencies.
- Completed action receipts and created/configured entity references.
- Draft references and non-secret field values.
- Outstanding questions, confirmations and approval scope.
- Record versions, timestamps, expiration and cancellation state.

Example sequence:

Save Knowledge-source draft → open Connectors → wait for Gmail authorization → return to the original draft → select the authorized connection → validate → review and save.

A draft is not an active configuration. Reuse existing draft facilities. If a form has no draft facility, retain an assistance-session draft without creating an incomplete production object.

Support browser refresh, disconnect/reconnect, pause, resume and cancel. Recheck permissions and record versions before resuming. Do not overwrite later user edits; show conflicts for review. Persist state outside the LLM conversation so context compaction cannot lose execution state. Apply retention and cleanup to expired sessions; never persist plaintext secrets in session state.

## 8. Navigation, agent chat and calls

Register bounded actions to:

- Open the correct authorized screen, tab or record.
- Highlight a field or control and explain its purpose.
- Open an entitled agent's chat.
- Prepare a message for review without sending it automatically.
- Start the existing agent-call flow following an explicit request and required browser permissions.

Navigation must preserve dirty forms or offer a draft/save choice. Opening a chat is not authorization to send a message. Reuse existing call and delegation mechanisms; do not introduce a second orchestration system.

## 9. Entitlement, safety and audit

Every action must enforce authenticated user/company ownership, existing RBAC, feature entitlement and resource permissions. Tenant identity comes from trusted backend context, not a model-supplied owner ID. Agent tools must not expose a cross-tenant bypass. Admin-only actions remain restricted to explicitly authenticated Admin contexts.

Additional controls:

- Reauthorize immediately before executing or resuming an action.
- Use idempotency keys and action receipts to prevent duplicate submissions.
- Check record versions to avoid concurrent-edit overwrites.
- Bind confirmations to the exact action and values; materially changed values require renewed confirmation.
- Keep secrets out of prompts, model context, session history and logs. Use vault references and user-only secret fields.
- Treat retrieved documents and visible screen content as untrusted data, not instructions that can authorize actions.
- Keep an audit trail of proposed, approved, executed, failed and cancelled actions with redacted parameters.
- Provide cancellation and rollback/compensation only where the underlying operation supports them; never claim an irreversible action is undoable.

## 10. End-user experience

The floating Platform Help panel should use existing Flolah components and theme tokens, with responsive layout, keyboard navigation and accessible focus handling.

Display:

- What I am helping you do.
- Current step and progress.
- Proposed field changes and validation issues.
- Apply fields, Save draft, and Review & save controls.
- Waiting for you, stating the exact required action.
- Resume, Cancel, and Return to original screen controls.

Provide verified success/failure feedback after each action. Preserve drafts after recoverable failures and explain the recovery step. Keep guidance visible while the user works on the underlying screen without blocking essential controls.

## 11. Agent instructions and tools

Update the Platform Help source templates, skills where applicable, tool descriptions and access registration consistently. Retain built-in help RAG for product explanations. The screen registry is the authoritative source for actionable routes, fields and currently available actions.

Expose only scoped assistance capabilities: read registered screen context, propose form patches, validate, manage assistance drafts, request navigation, observe prerequisite status and execute approved registered actions. Do not grant unrestricted shell, filesystem or external browser control.

Apply the instruction/tool changes through the normal agent provisioning/update mechanism, including existing Platform Help agents. Preserve company-specific workspace content and configuration; do not replace entire workspaces to install this capability.

## 12. Acceptance gates

Run deterministic local harness tests, UI tests and relevant existing regressions before VPS rollout. Then validate the deployed flow with an authorized test tenant and interactive user participation where external authorization is required.

Required cases:

1. Internal setup autofill: required fields, dynamic options, validation and verified save.
2. Connector detour: preserve draft, guide authorization, detect completion and return to origin.
3. Refresh/reconnect recovery with durable state and no duplicated action.
4. User-edited fields and concurrent changes are preserved or explicitly reconciled.
5. Confirmation is required for applicable side effects and cannot be reused for changed values.
6. Cross-tenant resources, forged owner IDs and permission revocation fail closed.
7. Secret fields and hostile document/screen content cannot leak data or authorize actions.
8. Navigation, agent chat preparation and call initiation respect entitlement and user intent.
9. Watcher timeout, cancellation, duplicate events and callback failure are recoverable.
10. Classic, Immersive, mobile and keyboard usability remain consistent.
11. COO chat, Workflow Builder and existing form submission flows remain functional.
12. Agent templates, existing-agent updates and tool registration match the deployed implementation.

## 13. Single-phase release sequence

Within one integrated delivery:

1. Pull and merge current main; capture rollback checkpoints.
2. Inventory screens/forms and define registry contracts and permission requirements.
3. Implement action dispatch, durable sessions, draft management and event watchers.
4. Register supported forms, navigation, chat and call actions.
5. Replace the floating widget and update Platform Help instructions/tool access.
6. Run local harness, UI, entitlement and regression gates.
7. Build through versioned source/config/setup/Docker/deployment paths.
8. Deploy with rollback support and verify end to end on VPS, including human-assisted authorization.

No runtime-only hotfixes. Preserve unrelated concurrent work and existing OpenClaw setup. The release is complete only when registered-form acceptance cases and the required safety/regression gates pass; document unsupported forms explicitly rather than implying universal automation.
