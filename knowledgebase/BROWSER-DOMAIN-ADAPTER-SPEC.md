# Flolah Browser Domain Adapter Specification

**Status:** Canonical implementation specification  
**Audience:** Flolah platform engineers, Workflow Builder, browser-runtime maintainers, adapter authors, reviewers, and certification operators  
**Applies to:** Browser Session autonomous tasks, saved-recipe replay, Flolah Chrome extension, Desktop Browser Worker, and managed-browser fallback  
**Primary concern:** Reliable, governed, exactly-once external actions on websites whose final interaction and success evidence differ by domain

## 1. Purpose

This document defines the standard contract for adding a new website/domain adapter to Flolah Browser Session.

A domain adapter is a thin, versioned description of how a website exposes one or more effects such as publishing, sending, submitting, purchasing, or deleting. It connects the generic browser runtime to observable, domain-specific UI states without duplicating transport, policy, approval, retry, audit, or task-management logic.

This specification exists to prevent:

- domain-name or keyword patches scattered through the browser runtime;
- unverified claims that an external action succeeded;
- duplicate submissions after slow or ambiguous website responses;
- website-specific behavior being added to the Chrome extension unnecessarily;
- adapters bypassing Action Control, scoped overrides, URL policy, or user-authorized tabs;
- recipes silently becoming production-grade adapters without certification.

## 2. Design principles

1. **Generic primitives, domain-specific observations.** Opening, focusing, snapshotting, clicking, typing, uploading, waiting, and cleanup belong to the generic executor. The adapter identifies observable states and controls for one domain.
2. **Effects, not transport names.** Policy is resolved from the requested effect (`read`, `social_publish`, `external_message_send`, `payment`, and so on), never from the fact that a browser tool is used.
3. **Structured intent is authoritative.** A structured operation contract overrides free-form keyword inference. Contradictory input fails closed.
4. **Exactly once means one submission attempt.** Uncertain confirmation must not trigger another submit.
5. **No success without durable evidence.** A click receipt or a closed dialog is not sufficient by itself.
6. **Read-only is a hard boundary.** Read tasks must not activate composers, type, submit, react, follow, message, upload, or change settings.
7. **Accessibility and observable state first.** Prefer roles, names, enabled state, dialog scope, editable state, URL transitions, visible confirmation, and stable provider IDs. CSS selectors are bounded fallbacks.
8. **Data-driven before bespoke code.** A manifest and reusable adapter hooks are preferred. Custom code requires review and documented justification.
9. **Executor portability.** The same adapter contract must declare and test support for each permitted executor.
10. **No secrets in adapter packages.** Credentials, cookies, tokens, account IDs, personal data, captured page content, and production URLs containing secrets must never be committed.

## 3. Architectural boundary

### 3.1 Generic browser core

The core owns:

- task creation, persistence, status, cancellation, and recovery;
- executor discovery, capability negotiation, pinning, fallback, and exclusion;
- owner-authorized tab discovery and focus;
- URL allow/deny policy and navigation;
- structured snapshots, current-generation element references, and screenshots;
- generic actions: open, click, type, press, scroll, wait, inspect, upload, and cleanup;
- exact input substitution and sensitive-field redaction;
- Action Control, approval grants, scoped overrides, and audit logs;
- attempt budgets, timeouts, single-submission enforcement, and idempotency;
- evidence normalization and terminal result persistence;
- read-only enforcement;
- package/protocol compatibility checks.

No adapter may reimplement or bypass these responsibilities.

### 3.2 Domain adapter

The adapter owns only domain-specific knowledge:

- supported hosts and start URLs;
- supported operations and content types;
- authentication/readiness observations;
- recognition of the target page and account context;
- composer/form activation observations;
- editor, attachment, audience, and submit-control observations;
- domain-specific preconditions;
- durable success, failure, and ambiguity evidence;
- safe cleanup observations;
- bounded domain-specific recovery that does not resubmit.

### 3.3 Executor packages

The Chrome extension and Desktop Browser Worker implement generic primitives and report capabilities. They must not contain separate hard-coded LinkedIn, Facebook, Instagram, or other domain workflows unless a platform limitation makes a generic primitive impossible.

A new domain alone is not a reason to release a new executor package. A package update is required only when the adapter needs a missing generic capability, such as:

- governed file upload/file chooser handling;
- multi-file or directory selection;
- downloads with artifact receipts;
- cross-frame or shadow-root interaction not represented by snapshots;
- browser permission mediation;
- durable network/provider receipt capture;
- a newer structured-snapshot protocol.

## 4. When an adapter is required

An adapter is not required for ordinary read-only navigation, search, inspection, or summarization when the generic browser loop can complete the task safely.

An adapter should be created when any of the following applies:

- the final action communicates externally or changes third-party state;
- a task needs exactly-once submission guarantees;
- success must be proven from domain-specific evidence;
- a generic recipe is repeatedly used in production;
- the site uses a non-standard editor, uploader, modal, or staged submission flow;
- the consequence of clicking the wrong control is material;
- the site frequently invalidates recorded element references;
- an existing recipe has failed certification or produced ambiguous outcomes.

### Recipe-to-adapter promotion

A saved recipe is suitable for discovery and low-risk repeatability. It must be promoted to an adapter when it becomes a recurring or consequential production path.

Promotion requires:

1. extracting input placeholders and observable states from the recipe;
2. replacing recorded coordinates and stale references with current-state resolution;
3. declaring the operation effect and policy tier;
4. adding single-submission and durable-verification contracts;
5. certifying supported executors;
6. versioning and publishing the adapter manifest;
7. retaining the recipe only as a test fixture or user-facing shortcut where useful.

## 5. Adapter lifecycle

Every adapter has one lifecycle state:

- `experimental`: development only; cannot execute consequential production effects;
- `candidate`: allowed in paper/test mode with explicit operator acknowledgement;
- `certified`: may execute the declared effects under Action Control;
- `suspended`: temporarily disabled because the website or evidence contract changed;
- `deprecated`: retained for migration/audit but cannot start new tasks.

Certification is per adapter version, operation, content type, and executor. Certification of a text post through Desktop Browser Worker does not certify media publishing or the Chrome extension route.

## 6. Canonical adapter manifest

Adapters must expose a serializable manifest. The example below is illustrative; production schemas may add fields but must preserve these semantics.

```json
{
  "schema_version": 1,
  "adapter_id": "example-social",
  "adapter_version": "1.0.0",
  "display_name": "Example Social",
  "lifecycle": "candidate",
  "hosts": ["example.com", "www.example.com"],
  "start_urls": {
    "social_publish": "https://www.example.com/feed/"
  },
  "operations": {
    "social_publish": {
      "risk_tier": "R2",
      "action_family": "communicate_external",
      "content_types": ["text", "image", "video"],
      "max_submissions": 1,
      "requires_durable_confirmation": true,
      "required_inputs": ["body"],
      "optional_inputs": ["media", "audience"]
    }
  },
  "required_capabilities": {
    "text": ["open", "snapshot", "act", "wait", "task_cleanup"],
    "image": ["open", "snapshot", "act", "file_upload", "wait", "task_cleanup"]
  },
  "supported_executors": {
    "chrome_extension": ["text"],
    "playwright_chrome": ["text", "image", "video"],
    "managed": []
  },
  "evidence_contract": {
    "success_requires": ["submission_count_one", "composer_closed", "provider_or_feed_confirmation"],
    "click_receipt_is_success": false
  },
  "data_handling": {
    "stores_credentials": false,
    "redact_fields": ["session_token", "password"],
    "retention_class": "browser_operations"
  }
}
```

### Manifest requirements

- `adapter_id` is stable, lowercase, and globally unique.
- `adapter_version` follows semantic versioning.
- Hosts must be exact or explicitly bounded subdomain patterns; broad wildcards require security review.
- Every operation declares its Action Control risk tier and action family.
- Supported content types and executors are explicit allowlists.
- Missing executor capabilities fail before opening or mutating the page.
- An empty executor list means unsupported, not automatic fallback.
- The adapter may not downgrade the risk tier supplied by the platform registry.

## 7. Runtime interface

The implementation should conform to a common interface equivalent to:

```ts
interface BrowserDomainAdapter {
  manifest: BrowserDomainAdapterManifest;

  recognize(context: AdapterContext): Promise<RecognitionResult>;
  checkReadiness(context: AdapterContext): Promise<ReadinessResult>;
  openOperation(context: AdapterContext): Promise<TransitionResult>;
  resolveInputs(context: AdapterContext): Promise<InputTargetsResult>;
  prepare(context: AdapterContext): Promise<PreparationResult>;
  validatePreparedState(context: AdapterContext): Promise<PreparedStateEvidence>;
  submitOnce(context: AdapterContext): Promise<SubmissionReceipt>;
  verifyOutcome(context: AdapterContext): Promise<OutcomeEvidence>;
  recoverEvidence(context: AdapterContext): Promise<OutcomeEvidence>;
  cleanup(context: AdapterContext): Promise<CleanupResult>;
}
```

The runtime, not the adapter, invokes these methods in the governed order. `submitOnce` must be unreachable until policy authorization and prepared-state validation succeed.

## 8. Structured operation contract

Agents and workflows must send structured intent. For social publishing:

```json
{
  "operation": "social_publish",
  "platform": "example-social",
  "body": "Exact unmodified post body",
  "media": [
    {
      "artifact_id": "artifact-owner-scoped-id",
      "media_type": "image/png",
      "sha256": "expected-content-hash"
    }
  ],
  "audience": "preserve_current",
  "constraints": {
    "max_submissions": 1,
    "preserve_audience": true,
    "require_exact_editor_value": true,
    "require_durable_confirmation": true
  }
}
```

Rules:

- The body is preserved byte-for-byte unless the user explicitly requests transformation.
- Artifacts are referenced by owner-scoped IDs, never arbitrary local paths from prompts.
- File hashes are checked before upload when supplied.
- `max_submissions` for consequential actions is normally `1` and cannot be increased by an adapter.
- `read_only=true` combined with a mutating operation fails closed as read-only or is rejected before execution.
- Free-form intent inference is compatibility behavior only and must not be the certified path.

## 9. Governed execution state machine

The standard sequence is:

```text
RECEIVED
  -> CONTRACT_VALIDATED
  -> POLICY_AUTHORIZED
  -> EXECUTOR_SELECTED_AND_PINNED
  -> TARGET_TAB_AUTHORIZED_AND_FOCUSED
  -> READINESS_CONFIRMED
  -> COMPOSER_OR_FORM_OPENED
  -> INPUTS_PREPARED
  -> PREPARED_STATE_VERIFIED
  -> SUBMISSION_ISSUED_ONCE
  -> OUTCOME_OBSERVATION
  -> VERIFIED | AMBIGUOUS | FAILED_BEFORE_SUBMISSION
  -> CLEANUP
```

### Hard invariants

- No mutation occurs before `POLICY_AUTHORIZED`.
- The selected executor and tab remain pinned for the task.
- Input validation occurs immediately before submission.
- The runtime persists a pre-submission checkpoint.
- `SUBMISSION_ISSUED_ONCE` is durable and monotonically recorded.
- After submission, all recovery is read-only evidence collection.
- `AMBIGUOUS` never automatically retries submission.
- Cleanup must not erase evidence required for audit.

## 10. Control resolution

Adapters resolve controls from a fresh structured snapshot. Preferred resolution order:

1. unique current-generation accessible reference;
2. unique role + accessible name within the expected dialog/form scope;
3. observable structural relation, such as the only enabled primary button in the verified composer;
4. adapter-owned bounded selector scoped to the verified container;
5. stop with `CONTROL_AMBIGUOUS`.

Adapters must not:

- choose the first matching button across the whole page;
- use screen coordinates as a certified selector;
- treat unrelated dialogs as the composer;
- use prompt keywords to choose controls;
- type into an arbitrary editable element;
- fall back from one domain to another domain's adapter;
- click a disabled submit control;
- retry submit because confirmation is slow.

The adapter must verify the transition after activating the composer or form. Valid transition evidence includes a newly opened dialog, a newly appeared editable target, a focused verified editor, or another adapter-declared non-mutating state change.

## 11. Prepared-state validation

Immediately before submission, the adapter must prove:

- current host and account context match the requested target;
- the expected composer/form is open;
- there is exactly one selected editor/field set;
- the editor contains the exact requested body where required;
- selected media count, type, and hash/preview match the request;
- audience/privacy settings satisfy the contract;
- submit control is present, uniquely scoped, visible, and enabled;
- no website validation error is visible;
- submission count is zero;
- the approval or override still authorizes the exact immutable payload.

Any mismatch returns to a non-submitting correction state or terminates safely.

## 12. Submission and idempotency

The runtime creates an idempotency record before invoking `submitOnce`:

```json
{
  "task_id": "bt-...",
  "adapter_id": "example-social",
  "operation": "social_publish",
  "payload_hash": "sha256-of-immutable-operation",
  "submission_count": 0,
  "submission_state": "prepared"
}
```

When the final action is dispatched, the record changes atomically to `submission_state=issued` and `submission_count=1`. A crash, timeout, disconnected executor, or missing acknowledgement after this point results in `AMBIGUOUS`; it does not permit another submission.

Retries are allowed only for pre-submission observations or non-destructive activation steps with bounded attempt budgets.

## 13. Durable outcome evidence

A transport acknowledgement, DOM click result, missing dialog, or agent statement is not durable publication evidence.

An operation is `VERIFIED` only when its evidence contract is satisfied. Evidence may include:

- provider-generated post/message/order ID;
- canonical permalink matching the target domain;
- provider success event or response correlated to the payload hash;
- success notification plus composer closure;
- exact content or unique fingerprint visible in the user's own feed/activity/outbox;
- stable account history entry created after the submission timestamp;
- domain-specific confirmation page with immutable reference.

Evidence records must include source, timestamp, executor, tab/URL, and redacted observation. When evidence conflicts, the task is `AMBIGUOUS` and reports the conflict.

The adapter should implement delayed read-only observation windows because modern sites update asynchronously. These waits must never include a second submission.

## 14. Read-only behavior

Read operations normally use the generic runtime and do not require a domain adapter. If an adapter supplies read accelerators, they must declare `R0/read` and obey these restrictions:

- do not open composers or forms;
- do not type or paste;
- do not submit through clicks or keyboard activation;
- do not react, follow, connect, message, upload, or change settings;
- do not reuse a mutating accelerator merely because it can also expose text;
- treat negative constraints in the goal as restrictions, not requested actions.

Structured `read_only` metadata is authoritative over free-form text classification.

## 15. Media and file upload

File upload is a generic executor capability, not a separate implementation for every website.

The governed upload primitive must:

- accept only owner-scoped artifact IDs resolved by the backend;
- enforce allowed media type and size before exposing the file to the executor;
- bind the upload to the active task, adapter, domain, and input control;
- prevent arbitrary filesystem-path injection;
- record filename, media type, size, and hash without storing secret paths;
- support a dry-run capability check;
- return an upload receipt and observable preview state;
- clean temporary files according to retention policy;
- require confirmation under the same effect policy as the eventual submission.

An adapter requiring upload cannot be certified on an executor that does not advertise the governed upload capability.

## 16. Policy, approvals, and scoped overrides

The adapter declares the minimum risk tier; Action Control determines the effective mode.

- R0: read/research.
- R1: internal writes with no external communication.
- R2: external messages, comments, reactions, forms, and publishing.
- R3: financial, destructive, account, permission, or similarly high-impact actions.

The approval artifact binds:

- owner and initiating employee;
- adapter ID/version and operation;
- exact payload hash;
- target host/account context;
- executor restrictions where requested;
- maximum submissions;
- expiry and maximum uses.

A scoped override is evaluated by the platform before adapter execution. The adapter cannot create, widen, renew, or consume an override itself. Any material payload or target change requires re-evaluation.

## 17. Authentication and user intervention

Adapters never store credentials or automate password, MFA, CAPTCHA, or account-recovery secrets.

Readiness may return:

- `ready`;
- `login_required`;
- `permission_required`;
- `captcha_required`;
- `account_selection_required`;
- `unsupported_account_state`.

The task pauses before mutation and reports a precise recovery instruction. Resumption must preserve the original immutable operation and revalidate policy, executor, tab, account context, and prepared state.

## 18. Error taxonomy

Adapters use platform error codes rather than site prose as control flow:

- `ADAPTER_NOT_CERTIFIED`
- `OPERATION_UNSUPPORTED`
- `CONTENT_TYPE_UNSUPPORTED`
- `EXECUTOR_CAPABILITY_MISSING`
- `EXECUTOR_OFFLINE`
- `TARGET_TAB_NOT_AUTHORIZED`
- `TARGET_HOST_MISMATCH`
- `LOGIN_REQUIRED`
- `ACCOUNT_CONTEXT_MISMATCH`
- `CONTROL_NOT_FOUND`
- `CONTROL_AMBIGUOUS`
- `EDITOR_NOT_VERIFIED`
- `EXACT_VALUE_MISMATCH`
- `UPLOAD_REJECTED`
- `AUDIENCE_MISMATCH`
- `SUBMIT_DISABLED`
- `FAILED_BEFORE_SUBMISSION`
- `SUBMISSION_ISSUED_OUTCOME_AMBIGUOUS`
- `DURABLE_EVIDENCE_MISSING`
- `WEBSITE_CHANGED`
- `CLEANUP_INCOMPLETE`

Unknown website behavior fails closed. Repeated control-resolution or evidence failures should automatically suspend the affected certification tuple without disabling unrelated domains or executors.

## 19. Security and privacy requirements

- Enforce owner isolation for tasks, recipes, artifacts, approvals, tabs, and evidence.
- Validate URLs against SSRF and browser URL policies.
- Never log cookies, authorization headers, passwords, MFA codes, private messages, full page dumps, or unrestricted user-generated content.
- Redact sensitive inputs before storing step traces.
- Store only the minimum evidence necessary under the user's retention policy.
- Do not commit real account names, IDs, screenshots, tokens, posts, or production payloads as fixtures.
- Test fixtures use synthetic domains, accounts, content, and IDs.
- Adapter code cannot execute arbitrary prompt-supplied JavaScript.
- DOM evaluation functions are source-controlled, bounded, and reviewed.
- File upload must never expose arbitrary server or desktop filesystem paths.

## 20. Observability

Every run records:

- adapter ID, adapter version, manifest hash, and certification state;
- operation, action family, risk tier, and policy decision ID;
- task, goal/workflow, agent, owner, and trace IDs;
- selected executor node, driver, worker version, and protocol version;
- authorized target tab and normalized host;
- state transitions and bounded attempt counts;
- pre-submission validation evidence;
- immutable payload hash;
- submission count and timestamp;
- outcome evidence and verification decision;
- cleanup result;
- failure code without sensitive content.

Metrics should distinguish pre-submission failure, verified success, ambiguous outcome, policy denial, user-input wait, executor failure, website change, and cleanup failure.

## 21. Certification test matrix

Certification requires automated harness tests plus a controlled live test for every supported tuple.

### Contract tests

- manifest schema and semantic-version validation;
- exact host allowlist behavior;
- unsupported operation/content/executor rejection;
- risk tier cannot be downgraded;
- structured payload survives routing unchanged;
- contradictory read-only/mutating input fails closed;
- secrets and sensitive page fields are redacted.

### Resolver tests

- one unique composer trigger;
- duplicate, hidden, disabled, and stale controls;
- unrelated dialogs and editors are ignored;
- localization or missing accessible labels fails safely;
- navigation replaces the document and invalidates old references;
- selected tab remains pinned across steps.

### Prepared-state tests

- exact editor value succeeds;
- missing, truncated, duplicated, or transformed content fails;
- wrong account, audience, attachment, or target fails;
- disabled or ambiguous submit control fails;
- expired approval or changed payload fails.

### Submission tests

- exactly one submit action is emitted;
- delayed confirmation never causes a second submission;
- disconnect immediately before submission remains retryable;
- disconnect immediately after submission becomes ambiguous;
- task resume cannot resubmit an issued operation;
- duplicate task/replay cannot reuse a consumed one-shot grant.

### Verification tests

- provider receipt/permalink verifies success;
- success toast plus durable feed/outbox evidence verifies success;
- dialog closure alone does not verify success;
- click receipt alone does not verify success;
- conflicting evidence becomes ambiguous;
- delayed evidence is observed within the bounded window;
- absence after the evidence window is reported honestly.

### Executor tests

Run applicable tests separately for:

- `chrome_extension`;
- `playwright_chrome` Desktop Browser Worker;
- managed browser, only when explicitly supported.

No fallback executor may be used during a certification test unless the test is specifically validating fallback.

### Policy tests

- R0 read runs without R2 approval and never mutates;
- R2 publishing creates an approval when required;
- exact approval resumes the original immutable operation;
- altered body, media, audience, domain, or executor constraint is rejected;
- scoped override precedence, permitted domain, expiry, and maximum uses are enforced;
- prohibited actions do not open or prepare a composer.

### Cleanup tests

- extension-owned authorized tabs are preserved and task pins released;
- task-created desktop/managed tabs follow configured cleanup behavior;
- open drafts are not accidentally submitted during cleanup;
- discard/leave dialogs are handled without claiming success;
- cleanup failure does not erase the terminal operation result.

## 22. Live certification procedure

1. Use a designated test account and clearly identifiable synthetic content.
2. Confirm the executor version and adapter version.
3. Run a read-only readiness task first.
4. Verify effective Action Control and any bounded test override.
5. Execute exactly one consequential test operation.
6. Inspect the external site independently for the durable result.
7. Compare external evidence with the stored task evidence and submission count.
8. Exercise a negative case without submitting: wrong audience, disabled button, missing media, or stale control.
9. Exercise the approval/resume path where applicable.
10. Record certification tuple, time, evidence summary, reviewer, and expiry/review date.
11. Remove the synthetic content only through a separately authorized delete operation.

## 23. Versioning and deployment

### Adapter version

- Patch: selector/evidence refinement with unchanged contract.
- Minor: new operation, content type, optional input, or supported executor.
- Major: incompatible manifest, evidence, input, or behavior change.

### Executor/protocol version

Increment the executor package and/or protocol only when a generic capability changes. Adapter-only changes should normally require only a backend release.

The backend must reject an adapter run when the selected executor does not meet its declared minimum capabilities or protocol version. It must provide an actionable package-update message rather than attempting an unsafe legacy path.

### Deployment requirements

- source, tests, package metadata, Docker build context, and deployment scripts stay synchronized;
- no VPS hotfix-only source;
- never overwrite production `.env` files;
- create a rollback checkpoint before service replacement;
- deploy the narrowest affected services;
- health-check before traffic validation;
- run one read-only smoke before any live consequential test;
- retain the previous certified adapter version for rollback.

## 24. Adapter implementation template

Each adapter proposal must answer:

### Identity

- Adapter ID and display name:
- Exact hosts:
- Start URLs by operation:
- Adapter owner/team:
- Lifecycle state and version:

### Supported effects

- Operations:
- Action family and minimum risk tier per operation:
- Content types:
- Required and optional inputs:
- Explicitly unsupported actions:

### Executors

- Chrome extension support:
- Desktop Browser Worker support:
- Managed-browser support:
- Required generic capabilities and minimum versions:
- Whether an executor package change is required, and why it is generic:

### Observable state model

- Logged-in/readiness evidence:
- Correct account/target evidence:
- Composer/form trigger evidence:
- Editor/input evidence:
- Attachment evidence:
- Audience evidence:
- Submit-control evidence:
- Success evidence:
- Failure/ambiguity evidence:
- Cleanup evidence:

### Safety

- Immutable payload fields:
- Idempotency key and payload hash inputs:
- Maximum submissions:
- Pre-submission validations:
- Allowed pre-submission retries:
- Post-submission read-only evidence recovery:
- Sensitive fields and redaction:
- Retention class:

### Testing and operations

- Unit/contract fixtures:
- Harness scenarios:
- Live test account and synthetic payload policy:
- Certification tuples:
- Website-change detection:
- Suspension/rollback criteria:
- Monitoring and alert thresholds:

## 25. Instagram application example

Instagram recognition in a platform registry is not equivalent to a certified publishing adapter.

A complete Instagram feed-post adapter would normally require:

- an `instagram` manifest with exact hosts and `social_publish` R2 effect;
- declared content types such as image, carousel, or video plus caption;
- a generic governed `file_upload` executor capability;
- create-control and file-input observations;
- media preview/count verification;
- caption editor and exact-value verification;
- audience/account verification;
- one final Share submission;
- durable evidence from a permalink, own-profile/feed entry, provider acknowledgement, or correlated success state;
- certification separately for Chrome extension and Desktop Browser Worker;
- explicit rejection of unsupported text-only feed posts or unsupported media types.

The Instagram adapter should reuse generic upload, snapshot, editor, submit-once, policy, and evidence primitives. It should not add an Instagram-only upload implementation to each executor.

## 26. Definition of done

A new domain adapter is complete only when:

- its manifest and implementation conform to this specification;
- the requested effect is structured and policy-classified;
- unsupported capabilities fail before mutation;
- exactly-once submission is enforced durably;
- success requires adapter-declared durable evidence;
- read-only behavior is proven non-mutating;
- every claimed executor/content/operation tuple is certified;
- policy approvals and scoped overrides are tested;
- security, privacy, retention, and logging requirements pass review;
- source, tests, build, deployment, and rollback artifacts are committed;
- live certification evidence is recorded without sensitive data;
- the adapter can be suspended or rolled back independently of unrelated domains.

