# Flolah Browser Automation Maturity Plan

**Status:** Proposed — review required before implementation  
**Product:** Flolah (repository/internal name: Agent OS)  
**Scope:** Browser automation Tracks 1–3  
**Decision owner:** Product owner / CEO  
**Implementation gate:** Do not implement or deploy until this plan is reviewed and approved.

## 1. Objective

Mature Flolah browser automation from a working but fragile collection of browser paths into one predictable, owner-scoped execution platform.

The target is not merely “control Chrome.” The target is:

- reliable observation, action, and outcome verification;
- safe use of a CEO's authenticated browser when required;
- efficient local execution with fewer cloud round trips;
- deterministic executor selection and recovery;
- complete tenant isolation, policy enforcement, and auditability;
- unchanged `browse_*` contracts for AI employees, recipes, and workflows;
- volume-safe deployment to the existing Dockerized VPS.

## 2. Product decision

Flolah will use three complementary browser tracks:

1. **Track 1 — Mature the existing Desktop Local Playwright worker.**
2. **Track 2 — Add a Flolah MV3 Chrome extension for the CEO's normal Chrome.**
3. **Track 3 — Preserve and improve managed Playwright for public and isolated tasks.**

These are executors behind one Flolah browser protocol. They are not separate agent tools or separate workflow products.

The agent-facing tools remain:

- `browse_session_status`
- `browse_task_start`
- `browse_task_status`
- `browse_snapshot`
- `browse_act`
- `browse_recipe_list`
- `browse_recipe_run`

Do not create site-specific tools such as LinkedIn Browser, JobStreet Browser, or Flow Browser. Site knowledge belongs in recipes, reusable task templates, or MCP/connector implementations built on the common protocol.

## 3. Current implementation baseline

### 3.1 Desktop Local worker

Flolah already ships a downloadable Windows Browser Session package from Connectors:

- source: `backend/local-browser-worker/`;
- headed by default;
- Playwright persistent context;
- installed Chrome channel supported;
- owner-scoped `bwk_...` token;
- outbound register, heartbeat, long-poll, and result calls;
- loopback API on `127.0.0.1:3020`;
- persistent cookies in a worker-owned profile;
- optional `BROWSER_CDP_URL` attachment to manually started Chrome;
- local worker preferred when online, managed browser used otherwise.

The current worker actions are `open`, `snapshot`, `act`, `status`, `evaluate`, `wait`, and `start`.

### 3.2 Managed browser

The VPS OpenClaw container provides managed Playwright/browser execution through the dedicated `browser-cdp` agent. It is appropriate for public pages, isolated browsing, and tasks that do not require the CEO's local authenticated session.

### 3.3 Legacy Client Chrome relay

OpenClaw Client Chrome uses one shared gateway pairing contract and an exclusive CEO lease. It cannot provide concurrent per-CEO Client Chrome sessions through the shared gateway.

It remains a compatibility fallback. Flolah will not build toward per-CEO OpenClaw WSS relay tokens or per-laptop OpenClaw nodes.

### 3.4 Existing control-plane tables

The current worker contract uses:

- `browser_worker_tokens`
- `browser_worker_nodes`
- `browser_worker_jobs`
- central `owner_ip_whitelists` with `apply_browser_worker`

The current `browser_worker_nodes.owner_user_id` primary key permits only one recorded worker per CEO. Jobs are owner-scoped but not node-addressed. This must change before the extension and Desktop worker can be online simultaneously.

## 4. Problems to solve

### 4.1 Authentication-sensitive sites

Google Flow and similar sites may reject a browser launched by Playwright, even when it uses installed Chrome and a persistent profile. Hiding `navigator.webdriver` or removing `--enable-automation` is not a reliable product solution.

The current CDP workaround improves the browser identity by attaching to manually started Chrome, but it requires a special launch script, debugging port, dedicated profile, and operator setup.

Track 2 addresses this by operating in the CEO's normally launched Chrome through an explicitly allowed extension tab.

### 4.2 Fragile observation and actions

The current Desktop worker returns an accessibility text tree without durable element references. Cloud decisions may return a `ref`, but the worker often interprets that value as visible text or a selector.

Other current limitations include:

- focus-dependent keyboard typing;
- one mutable global `page` handle;
- weak popup and tab identity;
- no navigation generation;
- no preconditions or postconditions;
- no business-outcome verification;
- generic errors instead of recoverable typed failures;
- one network round trip per small action;
- no standard trace or screenshot artifact on failure.

Track 1 fixes the shared protocol and local Playwright executor. Track 2 implements the same protocol through Chrome DevTools Protocol. Track 3 makes the managed executor conform to it.

### 4.3 Unsafe executor fallback

An authenticated extension tab, Desktop Playwright profile, and VPS Chromium do not share cookies or browser state. Silently changing executors during an interactive task can duplicate or corrupt side effects.

Executor selection must be explicit and pinned to the browser task.

## 5. Target architecture

```text
AI employee / workflow / recipe
              |
          browse_* tools
              |
     Browser Task Orchestrator
       | policy | entitlement
       | routing | audit | state
              |
       Browser Protocol v1
       /          |          \
Desktop Local  Chrome MV3   Managed VPS
 Playwright     extension    Playwright
```

### 5.1 Executor selection

Routing is based on task requirements and available capabilities:

1. Existing everyday-Chrome login explicitly requested or required → Chrome extension.
2. Local interactive/persistent profile requested and Desktop worker supports the task → Desktop Local Playwright.
3. Public, stateless, or isolation-preferred task → managed Playwright.
4. Legacy Client Chrome → explicit compatibility fallback only.

Availability alone does not determine routing.

### 5.2 Task pinning

At task start, Flolah records:

- selected executor node;
- selected driver mode;
- protocol version;
- capability requirements;
- tab/page identity when known;
- navigation generation;
- whether the task can be restarted safely.

The task remains on that executor until completion, explicit cancellation, or a classified recovery decision.

Do not automatically replay a side-effecting task on another executor when the result is uncertain.

## 6. Shared Browser Protocol v1

All three tracks implement one versioned protocol.

### 6.1 Capability advertisement

Example:

```json
{
  "protocol_version": 1,
  "driver_mode": "chrome_extension",
  "capabilities": {
    "open": true,
    "snapshot_version": 2,
    "action_batch": true,
    "screenshots": true,
    "downloads": true,
    "file_upload": false,
    "frames": true,
    "shadow_dom": true
  }
}
```

The orchestrator dispatches only jobs whose requirements are satisfied by the selected node.

### 6.2 Structured snapshot

A snapshot contains:

- page URL and title;
- executor page/tab ID;
- navigation generation;
- focused element;
- visible dialogs;
- frames;
- actionable elements;
- role, accessible name, text, state, and bounds;
- stable reference for the current generation;
- optional screenshot artifact reference;
- truncation and coverage metadata.

Example:

```json
{
  "page": {
    "page_id": "page-1",
    "url": "https://example.com/editor",
    "title": "Editor",
    "navigation_generation": 4
  },
  "elements": [
    {
      "ref": "g4-e19",
      "role": "button",
      "name": "Publish",
      "visible": true,
      "enabled": true,
      "editable": false,
      "frame_id": "main"
    }
  ]
}
```

References expire when navigation generation changes. A stale reference returns `NAVIGATION_CHANGED` or `STALE_REFERENCE`; it must never resolve silently to a different control.

### 6.3 Target resolution

Actions may supply multiple bounded target strategies:

1. snapshot reference;
2. role plus accessible name;
3. label or placeholder;
4. test ID or stable attribute when policy permits;
5. constrained selector for a trusted recipe.

Coordinates are a last resort and require a fresh viewport/screenshot context.

### 6.4 Batched action transaction

Example:

```json
{
  "idempotency_key": "task-123-step-4",
  "navigation_generation": 4,
  "actions": [
    {
      "kind": "click",
      "target": { "ref": "g4-e19", "role": "button", "name": "Publish" },
      "precondition": { "visible": true, "enabled": true }
    },
    {
      "kind": "wait",
      "until": { "url_matches": "/posts/", "timeout_ms": 10000 }
    }
  ],
  "stop_on_failure": true,
  "return_snapshot": "on_change"
}
```

Batches are bounded by action count and elapsed time. Destructive or externally visible actions remain separate approval-aware steps when policy requires.

### 6.5 Outcome states

An executor distinguishes:

- `command_received`
- `action_applied`
- `outcome_verified`
- `outcome_not_observed`
- `outcome_uncertain`

A successful click is not proof of a successful post, submission, purchase, deletion, message, or download.

### 6.6 Typed failures

Minimum failure taxonomy:

- `LOGIN_REQUIRED`
- `USER_INPUT_REQUIRED`
- `USER_PAUSED`
- `TAB_NOT_ALLOWED`
- `TAB_CLOSED`
- `PAGE_CLOSED`
- `EXECUTOR_OFFLINE`
- `DEBUGGER_DETACHED`
- `DEVTOOLS_CONFLICT`
- `CAPABILITY_UNAVAILABLE`
- `POLICY_BLOCKED`
- `URL_REDIRECT_BLOCKED`
- `TARGET_NOT_FOUND`
- `TARGET_AMBIGUOUS`
- `STALE_REFERENCE`
- `NAVIGATION_CHANGED`
- `ACTION_TIMEOUT`
- `DOWNLOAD_FAILED`
- `ACTION_OUTCOME_UNCERTAIN`

Every code defines whether it is safe to resnapshot, retry, request CEO input, restart from the beginning, or stop.

## 7. Control-plane schema evolution

### 7.1 Executor nodes

Replace the one-row-per-owner assumption with node identity.

Target logical model:

```text
browser_executor_nodes
- id / node_id primary key
- owner_user_id
- token_id
- device_name
- driver_mode
- protocol_version
- capabilities_json
- online
- last_heartbeat_at
- last_client_ip
- active_task_id
- worker_version
- browser_version
- created_at
- updated_at
```

Indexes:

- `(owner_user_id, online)`
- `(owner_user_id, driver_mode)`
- `(token_id)`

Every query and mutation includes `owner_user_id`. The node ID is never sufficient authorization by itself.

### 7.2 Jobs

Extend jobs with:

```text
- selected_node_id
- selected_driver_mode
- protocol_version
- capability_requirements_json
- idempotency_key
- attempt_number
- dispatch_deadline
- result_state
- failure_code
```

Only the selected node may claim a node-addressed job. Completion requires matching owner, node, job, and token authorization.

### 7.3 Migration strategy

The repository currently performs schema evolution in `backend/src/db/schema.js`; there is no separate migration framework.

Migration must be additive first:

1. Create new node-addressable schema or add compatible columns.
2. Backfill current node rows with generated node IDs.
3. Keep legacy worker registration functional during the compatibility window.
4. Deploy backend support before releasing new clients.
5. Upgrade Desktop worker and extension.
6. Remove the one-node claim behavior only after telemetry shows no legacy clients.

Never require destructive database recreation. The `agent_os_data` volume must survive every rollout and rollback.

## 8. Track 1 — Mature Desktop Local Playwright

### 8.1 Goals

- Make the existing downloadable worker predictable and diagnosable.
- Preserve headed persistent-profile behavior.
- Maintain the owner-scoped outbound-only security model.
- Support the shared protocol before introducing another executor.

### 8.2 Work packages

#### T1.1 Node identity and upgrade-safe registration

- Generate and persist a local node ID.
- Register device name, driver mode, protocol version, worker version, and capabilities.
- Preserve the node ID across restarts and package upgrades.
- Show the device in Flolah Tokens/Browser Session management.
- Revoke by token or individual node.

#### T1.2 Explicit page registry

- Replace the single mutable `page` global with a page registry.
- Assign stable local page IDs.
- Pin a task to one page.
- Record popup parent/child relationships.
- Do not let an unrelated popup silently become the active task page.
- Return a typed error when the pinned page closes.

#### T1.3 Structured observations

- Generate Browser Protocol v1 snapshots.
- Create generation-scoped references.
- Include state, bounds, focus, frames, dialogs, and shadow-root coverage.
- Support bounded screenshot artifacts for troubleshooting.
- Redact password and sensitive-input values.

#### T1.4 Deterministic actions

- Resolve refs to Playwright locators.
- Use `locator.fill()` for editable controls rather than global keyboard typing.
- Use locator actionability checks.
- Add explicit waits and postconditions.
- Add bounded action batches.
- Prevent action replay after uncertain side effects.

#### T1.5 Recovery and diagnostics

- Typed failure results.
- Trace events for snapshot, target resolution, action, navigation, and verification.
- Screenshot on failure when permitted.
- Resume polling after transient network loss.
- Recover unclaimed jobs after dispatch deadline.
- Do not reclaim a running side-effecting job without reconciliation.

#### T1.6 Package UX

- Preserve full and lite downloads.
- Add worker self-check and version display.
- Show profile path without exposing secrets.
- Explain normal persistent mode versus advanced CDP attach mode.
- Keep Google Flow CDP workaround documented until Track 2 is available.

### 8.3 Track 1 acceptance gates

- Current recipes and `browse_*` tools continue to work.
- Two tasks for one node do not control the same page concurrently.
- Popup creation does not change another task's page.
- Stale refs are rejected.
- Text enters the intended field after a rerender.
- A navigation invalidates old refs.
- Failure includes screenshot/trace when allowed.
- Worker restart does not create a second logical device.
- Owner A cannot see or claim Owner B jobs.
- Existing worker version remains usable during the compatibility window.

## 9. Track 2 — Flolah Chrome extension

### 9.1 Purpose

Track 2 enables Flolah to operate a CEO-authorized tab in normally launched everyday Chrome. It targets sites where Playwright-launched browsers or new profiles are blocked or inconvenient, including Google Flow.

It is not a replacement for managed or Desktop Playwright.

### 9.2 Extension architecture

- Chrome Manifest V3.
- `chrome.debugger` for DevTools Protocol commands.
- Background service worker.
- Popup and/or side panel for pairing, tab permission, pause, and status.
- `chrome.storage.local` for node identity, encrypted/OS-protected storage where available, allowed-tab metadata, and resumable non-secret state.
- Existing owner-scoped worker API with node addressing.
- No connection to a user-specific OpenClaw WSS.

### 9.3 Pairing

1. Logged-in CEO selects **Pair Chrome extension** in Flolah.
2. Backend creates a short-lived, single-use pairing code.
3. CEO confirms the code in the extension.
4. Extension exchanges it for an owner-scoped browser-worker credential.
5. Backend stores only the credential hash.
6. Extension registers its node ID and capabilities.
7. Flolah shows device, last activity, version, and revoke control.

Do not put long-lived tokens in query strings, browser page DOM, logs, or extension error reports.

### 9.4 Tab consent and control

- CEO explicitly selects **Allow Flolah on this tab**.
- Only locally allowed tab IDs may be attached.
- Badge clearly shows allowed, busy, paused, detached, or error.
- **Pause** detaches immediately and prevents new actions.
- **Stop all** detaches every allowed tab and cancels local claims safely.
- Navigation into a denied origin pauses before further action.
- Incognito is disabled by default and requires separate opt-in.
- Extension never scans or controls unrelated tabs.

### 9.5 MV3 lifecycle

The service worker may be suspended or restarted. Correctness must not require permanent background execution.

- Rehydrate node and allowed-tab state after wake.
- Reconcile actual debugger targets with stored attachment state.
- Use alarms/long-poll/push only as supported wake mechanisms.
- If later telemetry justifies WSS, connect extension directly to Flolah for job notification—not as an internet CDP relay.
- A restarted worker must not duplicate the last action.

### 9.6 CDP implementation

Initial domains/capabilities should cover:

- target/tab lifecycle;
- page navigation and lifecycle;
- DOM and accessibility observation;
- input dispatch;
- runtime evaluation under strict policy;
- screenshots;
- download observation where Chrome permits it.

The extension implements Browser Protocol v1. It does not expose arbitrary CDP commands to agents.

### 9.7 Security requirements

- Pairing and jobs always resolve owner from the worker credential.
- Node ID cannot select another owner.
- URL allow/deny policy applies before open and after redirects.
- Sensitive fields are identified and their values never returned.
- Clipboard access is not granted unless a reviewed feature requires it.
- Arbitrary JavaScript evaluation is denied by default and capability/policy gated.
- File upload requires explicit CEO confirmation and bounded file selection.
- Publish, send, submit, purchase, and delete actions honor Flolah approval policy.
- Extension telemetry excludes page bodies, credentials, cookies, and tokens.

### 9.8 Distribution

Stages:

1. Developer ZIP for internal alpha.
2. Unlisted/private Chrome Web Store beta.
3. Public Chrome Web Store release after permission and disclosure review.
4. Managed-enterprise distribution only when required by a customer.

The existing OpenClaw Chrome extension asset remains legacy and must not be confused with the Flolah extension.

### 9.9 Track 2 acceptance gates

- Two CEOs can be online simultaneously and receive only their jobs.
- One CEO can have extension and Desktop worker online without heartbeat overwrite or job races.
- A job is claimable only by its selected extension node.
- Unallowed tabs cannot be attached or controlled.
- Pause prevents new actions immediately.
- Token revocation prevents new claims promptly.
- Extension restart does not duplicate an action.
- DevTools/debugger conflict returns `DEVTOOLS_CONFLICT` or `DEBUGGER_DETACHED`.
- Tab close returns `TAB_CLOSED`.
- Redirect policy is enforced.
- Google Flow login and a non-destructive Flow navigation scenario work in a normal Chrome profile.
- No lease 409 is involved.

## 10. Track 3 — Managed Playwright and routing cleanup

### 10.1 Purpose

Managed Playwright remains the default for public, stateless, and isolation-preferred tasks. Track 3 brings it under the same protocol, clarifies routing, and removes legacy product messaging.

### 10.2 Work packages

#### T3.1 Protocol parity

- Adapt managed snapshots to Browser Protocol v1.
- Return the same failure taxonomy.
- Support action batches and postconditions where possible.
- Emit comparable trace metrics across executors.

#### T3.2 Requirement-aware router

Task requirement signals include:

- requires existing everyday login;
- requires local network/device identity;
- requires interactive CEO takeover;
- public/stateless;
- isolation preferred;
- expected capabilities such as downloads, file upload, frames, or screenshots;
- side-effect classification.

The selected route and reason are stored in the task audit.

#### T3.3 Safe fallback

Fallback is permitted automatically only before side effects or for explicitly restartable tasks.

After an uncertain side effect:

- stop;
- preserve evidence;
- notify the CEO;
- require reconciliation or explicit retry.

#### T3.4 Legacy cleanup

- Make Desktop Local and Flolah extension the documented client-browser paths.
- Mark shared OpenClaw Client Chrome pairing/lease as legacy.
- Keep it operational for a defined compatibility period.
- Stop teaching the shared pairing string in primary CEO guidance.
- Do not remove it until usage telemetry and a rollback window are complete.

### 10.3 Track 3 acceptance gates

- Public tasks run without requiring a client browser.
- Login-required tasks do not silently fall into a logged-out managed browser.
- Router decision and reason appear in audit data.
- The same recipe can declare capabilities and run on compatible executors.
- Managed and local results use compatible snapshot/action result shapes.
- Executor loss before side effects can restart safely.
- Executor loss after uncertain side effects does not replay automatically.

## 11. Cross-track observability

Collect tenant-scoped, privacy-minimized metrics:

- task count and success rate by driver mode;
- dispatch-to-claim latency;
- snapshot-to-decision latency;
- cloud round trips per completed task;
- actions per batch;
- target-resolution success rate;
- stale-reference rate;
- retry count and reason;
- login/input/approval wait frequency;
- debugger detach and DevTools conflict rate;
- outcome-uncertain rate;
- fallback count and reason;
- worker/extension version distribution.

Do not collect credentials, cookies, full private page text, or sensitive form values as telemetry.

Each browser task and job should carry a trace ID compatible with existing Flolah tool/workflow audit patterns.

## 12. Testing strategy

### 12.1 Unit and contract tests

- node registration and heartbeat isolation;
- targeted job claim authorization;
- token and node revocation;
- routing rules;
- capability matching;
- URL policy and redirect checks;
- snapshot reference lifecycle;
- idempotency and duplicate result handling;
- retry safety classification;
- sensitive-value redaction.

### 12.2 Multi-tenant tests

Required hard gate:

- Owner A cannot list, claim, complete, cancel, inspect, or receive Owner B nodes/jobs/tasks.
- Admin impersonation follows existing authenticated CEO resolution rules.
- Body-supplied `owner_user_id` never overrides authenticated worker ownership.
- One owner's online status never overwrites another owner or another node.

### 12.3 Executor conformance suite

Run the same scenarios against Desktop, extension, and managed executors where capabilities apply:

- open a public page;
- snapshot and locate controls;
- click, fill, press, scroll;
- popup/tab handling;
- navigation invalidates refs;
- redirect denied by policy;
- download observation;
- pause/cancel;
- executor disconnect;
- screenshot/trace on failure;
- verified versus uncertain outcome.

### 12.4 Site scenarios

Use non-destructive test accounts or fixtures:

- Google Flow: authenticate manually in normal Chrome, open Flow, enter a non-sensitive draft prompt, and stop before paid generation unless explicitly authorized.
- LinkedIn/Medium-style composer: fill a draft and stop before publish in routine tests.
- Public research page: complete through managed Playwright.
- OAuth popup: preserve task page identity.
- Local fixture site: deterministic forms, dialogs, shadow DOM, frames, downloads, and navigation races.

Production publishing tests require explicit CEO approval.

## 13. VPS deployment model

### 13.1 Confirmed production topology

Flolah is deployed at `/opt/agent-os` using Docker Compose. The live VPS currently runs Docker 29.6.2 and Compose 5.3.1.

Core services include:

- nginx;
- frontend;
- backend;
- OpenClaw;
- OpenSearch and Dashboards.

The live stack also includes optional MCP, OpenConnector, Ollama, embeddings, voice, Twenty CRM, and ERPNext services.

Production secrets remain in `/opt/agent-os/deploy/.env`; they are injected at runtime and must never be copied into source, images, logs, plans, tests, or Git.

### 13.2 Persistent state

Relevant named volumes include:

- `agent-os_agent_os_data`
- `agent-os_openclaw_home`
- `agent-os_workflow_fs`
- `agent-os_opensearch_data`
- `agent-os_openconnector_data`

Browser schema changes live in the `agent_os_data` volume. Browser implementation deployment must never delete or recreate this volume.

The Desktop worker profile and extension state stay on the CEO's computer and are not VPS volumes.

### 13.3 Deployment path

The current supported VPS path is:

1. Commit and push reviewed source to GitHub.
2. Sync repository build contexts to `/opt/agent-os` with `deploy/scripts/sync-to-vps.ps1` when VPS Git pull is unavailable.
3. Run `deploy/scripts/vps-deploy-latest.sh` with `SKIP_GIT=1` after sync.
4. Rebuild only affected services where practical.
5. Recreate services through Docker Compose.
6. Run health, smoke, OpenClaw parity, and platform verification.

For browser Tracks 1–3, expected VPS services are primarily:

- `backend` for schema, protocol, routing, package generation, and worker APIs;
- `frontend` for Browser Session/device/extension UX;
- `openclaw` only when managed-browser contracts or tool documentation change;
- `nginx` only if a new public extension artifact or endpoint requires routing.

The extension is not run in Docker. The Desktop Local worker is not run in Docker. Their packages are built into or served by the backend/frontend deployment as appropriate.

### 13.4 Deployment gates

Before every browser release:

- identify the exact Git commit;
- check working tree for secrets;
- verify `deploy/.env` is untouched;
- record current image/container state;
- verify named volumes exist;
- run backend browser contract and tenant-isolation tests;
- build affected images;
- start/recreate affected services without `docker compose down -v`;
- wait for backend/frontend/OpenClaw health;
- run browser-specific smoke tests;
- run existing `vps-verify-platform.sh` and relevant parity checks;
- inspect logs for errors without printing secrets.

### 13.5 Rollback

Each release must preserve:

- previous Git commit;
- previous image IDs/tags;
- additive/backward-compatible schema during the rollout window;
- compatible old Desktop worker behavior;
- managed Playwright fallback.

Rollback procedure:

1. Stop new browser task dispatch if data compatibility is uncertain.
2. Restore previous backend/frontend/OpenClaw images or source commit.
3. Recreate affected services without deleting volumes.
4. Verify health and tenant-scoped browser APIs.
5. Re-enable dispatch.

Do not restore an old SQLite volume merely to roll back application code unless a separately approved data-recovery event requires it.

## 14. Delivery sequence and review gates

### Phase 0 — contract preparation

- Browser Protocol v1 definitions.
- Additive node-addressable schema.
- Compatibility adapter for current workers.
- Requirement-aware task/executor fields.
- Typed failures.
- Tenant and claim-race tests.

**Review gate:** schema, security model, compatibility, and rollback approved.

### Phase 1 — Track 1 implementation

- Upgrade Desktop worker to Protocol v1.
- Structured snapshots and stable refs.
- Page registry and task pinning.
- Deterministic/batched actions.
- Outcome verification and trace artifacts.
- Release updated local package behind a feature flag.

**Review gate:** local conformance suite and two-CEO isolation pass.

### Phase 2 — Track 2 alpha

- MV3 extension.
- One-time pairing.
- Explicit tab Allow/Pause.
- Node-targeted open/snapshot/act.
- Internal ZIP distribution.
- Google Flow non-destructive scenario.

**Review gate:** permission/security review and alpha evidence approved.

### Phase 3 — Track 2 efficiency and beta

- Action batching.
- richer CDP snapshots;
- MV3 restart reconciliation;
- outcome verification;
- optional push notification only if measured polling latency warrants it;
- unlisted Web Store beta.

**Review gate:** reliability metrics meet thresholds.

### Phase 4 — Track 3 routing cleanup

- Managed executor protocol parity.
- Requirement-aware production routing.
- Safe fallback/reconciliation.
- Legacy Client Chrome de-emphasized.
- Documentation and Platform Help updated.

**Review gate:** production canary and rollback drill pass.

## 15. Feature flags

Suggested server flags:

- `BROWSER_PROTOCOL_V1_ENABLED`
- `BROWSER_MULTI_NODE_ENABLED`
- `BROWSER_EXTENSION_ENABLED`
- `BROWSER_ACTION_BATCH_ENABLED`
- `BROWSER_ROUTER_V2_ENABLED`
- `BROWSER_LEGACY_CLIENT_CHROME_ENABLED`

Flags default off during schema/backend preparation, then enable by test CEO or allowlist before broader rollout.

Do not put secrets or pairing credentials in feature-flag values.

## 16. Success metrics

Initial release targets should be finalized after baseline measurement. Proposed measures:

- no cross-tenant browser job access;
- no duplicate verified side effects in acceptance testing;
- at least 95% successful node-targeted job claim under normal connectivity;
- materially fewer cloud round trips per interactive task after batching;
- lower target-not-found rate than the current Desktop worker;
- extension and Desktop worker coexist for one CEO without races;
- public tasks continue successfully when no client executor is online;
- Google Flow accessible through explicitly allowed normal-Chrome extension tabs;
- rollback completes without volume restoration or tenant data loss.

## 17. Non-goals

- Per-CEO OpenClaw gateway or relay tokens.
- OpenClaw browser node on every laptop.
- Site-specific browser tools.
- CAPTCHA bypass.
- Credential extraction or automated password entry from Flolah.
- Hidden control of arbitrary everyday-Chrome tabs.
- Automatic replay of uncertain side effects.
- Replacing connectors/API integrations with browser automation when a reliable API exists.
- Removing managed Playwright.
- Removing the legacy path before a measured compatibility window.

## 18. Decisions required before implementation

The product owner should approve or amend:

1. Chrome extension as a complementary executor, not the sole/default executor for every task.
2. Explicit per-tab Allow/Pause consent model.
3. Multi-node schema and node-addressed job requirement.
4. Executor pinning and no silent cross-executor replay after side effects.
5. Additive migration and feature-flag rollout.
6. Internal ZIP followed by Chrome Web Store beta.
7. Google Flow testing boundary and whether paid generation is allowed in a controlled test.
8. Retention period for browser screenshots and traces, aligned with CEO data-retention settings.
9. Whether arbitrary evaluation remains disabled by default for extension tasks.
10. Reliability thresholds required before de-emphasizing legacy Client Chrome.

## 19. Implementation readiness checklist

Implementation may begin only when:

- this plan is approved;
- schema changes are reviewed for tenant isolation;
- Browser Protocol v1 JSON schemas are agreed;
- test fixtures and non-destructive site accounts are available;
- extension permission disclosure is approved;
- feature flags and rollback path are agreed;
- current VPS volumes and health are verified;
- no secrets are introduced into source or test fixtures.


