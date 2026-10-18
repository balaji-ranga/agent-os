# Digital Adoption Copilot

Latest deployment (18 October 2026): independent runtime **20261018-owner-workspace-c**, platform **adoption-20261018-maker-checker-c** (unchanged), source/evidence publication **20261018-owner-workspace-d**. Owner and account management now use a persistent website selector and seven focused tabs. Searchable bounded pages replace silent list caps; workflow editors and map details render on demand.

All **260** service checks pass locally and in the final VPS image. **10** isolated browser cases and **6** analytics/pairing scenarios pass. The one-CPU/1-GiB VPS fixture served **500 requests from 25 concurrent clients across 25 websites**, with zero errors and **115.84 ms p95**. This measures management HTTP/SQLite with synthetic authentication, not external platform authentication, LLM capacity or WAN latency. The [workspace testcase table and screenshots](test/evidence/owner-workspace-20261018/index.html) distinguish live administrator checks, isolated owner checks and the expired live email-owner session. Full Phase 1/2 device certification remains outside this incremental result.

The global maker/checker feature remains available and **Off** after UAT. Its earlier [admin/review evidence](test/evidence/admin-maker-checker-20261018/index.html) retains the optional local Ollama timeout and broad-agent coverage limitations; this workspace release does not recertify those cases.

Independent Flolah Free Tools product. This directory owns its implementation and tests; it does not import, mount, replace, or migrate Platform Help Copilot.

The [end to end design](DESIGN.md) defines the implemented extension: private
transaction attachments, user-confirmed copilot pairing, cross-website task
relay and user-specific workflow connectors governed by Flolah Action Policies.
These additions have separate acceptance evidence and per-website opt-in controls;
they do not inherit certification from the earlier shared-help release.

## Private tasks and workflow connectors

Visitors use **Task files & paired copilots** in Guide to attach PDF, DOCX,
UTF-8 text/Markdown, PNG or JPEG transaction files, summarize with citations,
prepare current fields, pair panels with bilateral confirmation, share selected
passages and end the task. Actions remains owner-only. A normal field review
never submits a form; Save has its own reviewed activation.

Files are encrypted per task. Keys, parsed passages, task chat, reviews and
results stay in bounded memory, outside SQLite, shared indexes and checkpoints.
Ending/expiring a task or restarting its coordinator revokes access and deletes
its objects. Ending a task clears both conversation panels; previously applied
host values and saved business records remain host data. Model provider retention
is governed separately by the configured provider; application deletion does not
claim to erase provider retention.

The Flolah workflow editor exposes **Digital Adoption Copilot** as a connector.
Explicitly link authorized browser targets to your signed-in Flolah user, choose registrations
and active instances, and select inspect, summarize, prepare, navigate, fill,
owner-bound native submission, status or cancel. Every required recipient must
complete; offline targets and unknown outcomes fail without replay or delivery
to later visitors. Existing Action Policies apply through one service for direct
API, tool and runner calls. Approval grants bind the exact payload/recipient set.
Private results are task-bound handles, including downstream workflow templates;
resolve them inside a subsequent Copilot operation, rather than copying passages
into durable workflow variables or unrelated tools.

Owners separately enable attachments, pairing and workflow relay per registration,
and configure smaller file/task/connection limits and exact native action bindings.
See [build and setup](deploy/README.md) for service wiring and test commands.

The scoped testing deployment uses app `20261018-feedback-i` and platform connector
`20261018-feedback-f`. Open `http://127.0.0.1:4194/customer`, expand **Task files &
paired copilots**, attach a synthetic file, and ask “Fill the customer form using
my transaction file.” Review the fields before applying. Save is separate and is
safe only on the synthetic local host used here. Open `/note` in another tab to
exercise bilateral pairing and consented context relay. Generate the synthetic
corpus with `test/make-transaction-fixtures.py OUTPUT_DIRECTORY`.

For workflows, link the short-lived group code in the signed-in Flolah Workflow
Editor's **Digital Adoption Copilot** connector. Select the group, websites and
action. To use existing visitor files, copy the panel's **Task ID** into the node;
the ID is not a credential and membership is still checked. A busy recipient
rejects overlapping commands. A failed required recipient fails the node and
revokes remaining effects; completed host changes are not rolled back.

The [current screenshot report](test/evidence/feedback-20261018/index.html),
[JSON ledger](test/evidence/feedback-20261018/results.json) and
[CSV table](test/evidence/feedback-20261018/results.csv) record **30 passed,
4 partial, 0 failed and 3 user-deferred cases**. Guided-session feedback is
18 passed and one partial (fresh real DNS/email self-service onboarding).
The historical private-task ledger is retained separately rather than rewritten.
Full Phase 1/2 certification remains partial: live effect-policy acceptance,
the wider downstream/privacy audit, sustained model/OCR load and the deferred
real Safari/iOS, Android and screen-reader matrix still need completion.
The public opt-in preview expires 18 October 2026 at 15:17 Singapore; this
report does not extend its approval. Its temporary workflow capability was
restored Off. Public browser tests use no login or host submission.

For a deterministic local preview, run `npm run dev:private`, then start
`src/local-vps-demo.mjs` with `ADOPTION_DEMO_CONFIG` pointing to
`.local/private-preview/public.json`. Both services bind loopback only. This
preview labels its deterministic planner; production uses the configured platform
LLM. Python parser dependencies and Tesseract are required for local binary/OCR
tests; the Docker image supplies them.

## Development

Run `npm test` in this directory, or `npm run dev` for the deterministic loopback harness on port 4193. `node src/local-vps-demo.mjs` serves the separate local page on port 4194 using `.local/demo-public.json`; it loads the SDK from the deployed VPS and uses the live model. Current implementation is partial and not production-ready.

## Boundaries

- Separate service, SDK, widget, database, OpenSearch namespace, release image and configuration are required before deployment.
- No edits to existing Platform Help components, APIs, templates, bridge or deployment configuration.
- Flolah Free Tools links to the independently authenticated registration console. Flolah Admin links to its website/token controls. These links do not activate the new SDK inside existing Flolah pages automatically.
- The reference plan's extraction/reuse language is superseded by the user's instruction to keep both implementations independent. Concepts may inform this implementation; runtime code is not shared.
- Phase 1 and Phase 2 (including technical sections 1–14 and mandatory Phase 2 acceptance) are in scope; Phase 3 is excluded. No production readiness is claimed by unit tests.

## Initial domain slice

`src/session-authority.mjs` owns hashed installation/runtime credentials, exact origin matching, renewal/revocation, and session message ownership. Public registrations use public knowledge; optional private deployments require short-lived host-signed Ed25519 identity, explicit issuer/key/role policy and tenant/role audiences. Policy revisions and revocation invalidate earlier identity. SQLite persistence and HTTP transport have local tests. Management authentication validates the existing Flolah login server-side; callers cannot supply roles. Domain ownership and admin approval have live browser evidence. Private host integration has automated coverage but still needs live host certification.

The development harness uses in-memory storage. Restart loses its state and invalidates its credentials. The SQLite repository has restart tests but still needs production migration/retention and operational hardening. Origin validation is a browser boundary, not visitor authentication.

The knowledge modules provide scoped lexical requests, an OpenSearch HTTP adapter and authoritative source-state rechecks. Independent parser workers accept PDF, DOCX, UTF-8 text/HTML, PNG/JPEG and MP4/WebM, including local English speech transcription. Original files live in embedding-derived object directories; only extracted sections are indexed. PDF pages, image OCR and video timestamps survive retrieval as citation locators. Public HTTPS help pages support explicit owner approval, same-origin redirects, DNS-pinned public-address fetching, refresh, revision metadata and deletion. Binary and URL processing status is durable; expired worker claims retry to a finite limit, with exhausted/invalid work visibly failed for owner review. Unit tests use doubles where labelled; separate VPS tests exercise actual extraction, OpenSearch and the configured model through Nginx. Broader crawling, hybrid/vector ranking, sustained scale and cross-host failover remain outstanding. Bounded discovery and coaching/recipe controls are implemented below; their full browser acceptance remains open.

## Embedded appearance

Pass `theme` to SDK `mount`, or call the returned `updateTheme(patch)` without recreating the session. Supported six-digit hex colors: `background`, `foreground`, `surface`, `primary`, `onPrimary`, `muted`, `border`. Other settings: `title`, `font` (`system`, `serif`, `mono`), bounded `radius`, `fontSize`, `width`, `height`, `offset`, and `position` (`bottom-right`, `bottom-left`, `top-right`, `top-left`). Choose accessible contrast pairs. Arbitrary CSS, remote fonts and CSS URLs are rejected. Widget CSS variables are isolated inside its iframe; no global host styles are changed.

The UX reference informs compact branding, inline field review and a bottom composer. Minimize/reopen retains the same session. The local browser test confirmed conversation preservation. This does not yet certify all reference UX features or Phase 1/2 acceptance.

The widget has Guide and Ask Knowledge channels. The entire Actions tab is visible only during authorized owner coaching, and its operations also check permission at the SDK and server boundaries. Visitors can use published guidance without gaining management access. Its three-dot settings dialog applies bounded appearance tokens to the current instance and can restore the website theme. Raw CSS, scripts and remote stylesheet URLs are intentionally not accepted.

Knowledge, website maps and workflows belong to the selected registration/embedding and audience. The owner email grants access to registrations; it is not a shared knowledge index. Two registrations for one origin remain separate. The management page labels origin, environment and registration and clears loaded results when the selection changes.

Explicit assignments to uniquely identified current fields and uniquely named safe navigation produce normal approval reviews without model inference. Ambiguous requests retain model reasoning or clarification. Native filling excludes unsupported input types rather than invalidating the entire form; custom controls, shadow roots and frames receive a manual-boundary notice. Neither this notice nor discovery inventory supplies executable references for unsupported controls.

Save is a separate, one-use review of a unique visible native submit control. Live values, constraints, form action and control identity are rechecked before one activation. Observed field values are not business-save verification. The local UAT host independently persists and reads back synthetic records; other hosts need an outcome/readback integration before the copilot can certify a business result.

## Registration email

Registration accepts a scoped idempotency key; retries with the same payload return the original registration/challenge and conflicting reuse is rejected. The browser preserves that key across retry clicks for the same form values. Text ingestion uses bounded leases and attempt fencing, exposes failed/interrupted attempts for retry, and treats completed indexing retries as reused work. Startup and periodic recovery mark expired attempts failed rather than falsely ready. Initial text quotas are 100 active sources and 2 MB per embedding. These controls do not imply binary/video ingestion support.

Public onboarding is `owner.html`, using independent verified-email identity rather than a Flolah login or installation token. Sign-in codes are challenge-bound, hashed, single-use, ten-minute and limited to five attempts. Owner sessions use Secure/HttpOnly/SameSite=Strict cookies, a 30-minute idle limit and eight-hour absolute expiry. Owner APIs enforce the platform Origin and ownership on every operation. This sign-in is distinct from recipient verification below. `manage.html` remains the authenticated Flolah-account console, with admin-only operations checked server-side. Public website owners never receive platform administration privileges.

An admin may transfer a registration only to an already verified independent owner, with a reason and expected current owner. Transfer retains its embedding ID, configuration and indexes, removes the former owner's management access and records both owner IDs in the audit. It does not silently revoke public installation tokens. A recipient verification for a different email is cleared. `deploy/update-owner-entrypoint.mjs` changes only the known Free Tools registration link, preserving unrelated live static-page changes.

The authenticated registration console verifies a recipient using a hashed, ten-minute, five-attempt email code. A verified recipient can receive a publishable installation token and snippet only after domain verification and platform approval. The browser never receives SMTP credentials. Server-side SMTP configuration comes from the platform deployment's `WORKFLOW_SMTP_*` variables; TLS is required. Failed snippet delivery revokes the newly issued token. Mail-server acceptance is not proof of inbox delivery. Tests use synthetic mail transports; a live verified-recipient send is recorded separately.

## Model boundary

The SDK only calls this service. The server-side model adapter calls an authenticated HTTPS platform gateway behind Nginx. The independent gateway reads only the active primary/secondary setting from a read-only platform database mount on each call; provider credentials are server-only deployment configuration. No provider credentials or direct model endpoints are exposed to embedded websites. Existing Platform Help/OpenClaw runtime code is not imported or restarted.

## Deployment and acceptance

`test/browser-uat.mjs` is an explicit opt-in browser regression runner, separate from `npm test`. Supply the loopback fixture origin, authorized public preview page, evidence output directory and optionally the published recipe ID. It requires Playwright plus its test assertions (module URLs can be supplied through `ADOPTION_PLAYWRIGHT_MODULE` and `ADOPTION_PLAYWRIGHT_TEST_MODULE`), and optionally `ADOPTION_UAT_BROWSER_EXECUTABLE` and `ADOPTION_UAT_BUILD`. The public-page cases fill controls but never submit them. Local cases save only synthetic fixture records. Starting the next task immediately after the host save signal preserves the Save/new-task timing regression. A failed assertion sets a nonzero exit status. Keep installation configuration, coaching codes and raw local evidence outside Git.

Owner source maps accept a reviewed JSON manifest `{schema:1, origin, screens:[{path,title,forms:[{id,label}],fields:[{key,label,type,required,form}]}]}`. Refresh replaces the previous source version atomically and reports all imported screen/form/field counts. Up to 200 screens, 500 fields per screen and 480 KB are supported; oversized maps fail explicitly. Entered values and arbitrary metadata are rejected, sensitive fields are excluded, and maps remain embedding/audience scoped. Source-map hints are separate from live inspections and verified coverage. Refreshing the view does not crawl a website. Use authorized read-only discovery to observe runtime screens.

No host-specific form catalog or platform source inventory is bundled or seeded. Each domain supplies only its own explicitly reviewed optional structural metadata, or uses live inspection and authorized discovery. Ordinary supported forms do not require a predeclared schema. Source-derived recipe drafts must be mapped to that domain's current controls and validated before publication.

Each source form can create a parameterized teaching draft. It must pass current live-screen validation and maintainer review before publication. Source structure never creates live element refs or grants permission. Assistant replies now carry an explicit action-instance contract, validate against current observed refs, and receive at most one bounded repair attempt. Invalid retries fail without creating an executable proposal. Off-screen fields require observed navigation and a fresh inspection.

Recording ingestion includes local English speech transcription with a build-time pinned Whisper tiny.en model and offline runtime loading. PyAV is pinned to 18.0.0 because faster-whisper 1.2.1 uses an API removed in PyAV 19. Shared tab/system audio is opt-in; microphone capture is not requested. Synthetic narrated-video backend acceptance does not certify real voice or browser capture consent.

`deploy/install.sh RELEASE` builds the independent official-Node image and starts one coordinator, two resource-capped parser workers and one model gateway in the `flolah-adoption` Compose project. Configuration is prepared server-side with protected permissions. Existing Nginx content is preserved; only the new locations are added, with a backup and syntax check before reload. The matching host-network configuration is also present in repository source. No application hotpatches are required. Demo origins are explicitly limited to the configured site and loopback port 4194; the demo installation expires in seven days. [Build and setup instructions](deploy/README.md) document the tracked release packager, Docker context exclusions and active retention units.

`test/acceptance-catalog.mjs` enumerates all 38 Phase 1/2 journeys and requires local and VPS end-to-end evidence before UAT readiness. The evidence ledger also tracks the plan's nonfunctional cases. The deployed preview has real model/search integration, persistent discovery and owner publication/version controls, but is **not full-phase certified**. Real synthetic-tab capture consent, pause/resume, review and discard have browser evidence with audio off and no upload. The synthetic loopback host also completed signed saved-record learning, owner-reviewed publication, fresh visitor reuse and disable; its temporary trust policy and learning preference were restored. Comprehensive DOM adapters and remaining lifecycle, quality, browser/device and operational branches remain open. Real Safari/macOS/iOS, Android Chrome and screen-reader cases remain pending at the user's request; Playwright WebKit is not Safari certification.

`deploy/install-platform-entrypoints.sh` builds the additive Admin entry against the running frontend release source and guards against concurrent cutover. It does not rebuild or restart the existing backend or OpenClaw. The static Free Tools card is maintained in `deploy/static/flolah-home/free-tools/index.html` at repository root. Keep a backup and compare the deployed version before replacing that page.

The independence regression rejects imports of existing Flolah/Platform Help runtime code. Nodemailer is explicitly allowlisted and locked for this service's independent email transport.

Conversation layout defaults to 420×680 with a 14px configurable font and compact bottom controls. Reply controls select a specific message in the same session/channel; the backend checks the reference before providing bounded quoted context to the model. Reply context never replaces action review or approval. Local regression covers cross-session/cross-channel rejection. Navigation recording can replay reviewed safe links and confirms the actual destination; this is not yet certification of parameterized multi-step form recipes.

The settings menu supports clearing only the current session conversation. A conversation version invalidates outstanding proposals and in-flight model responses; shared sources and other sessions are not cleared. VPS regression checks verify stale reply/approval denial and continued retrieval of shared knowledge after clearing.

## File processing and limits

The owner console supports file uploads, public help-page approval, source retries, refresh and removal. Visitor uploads default to disabled; only an authenticated website owner/admin can enable the capability. Enabled visitors use **Ask Knowledge → Share a document**, including explicit sharing consent; the entire Actions menu remains owner/coach only. Runtime requests derive that grant and embedding from server-side session authorization and recheck permission after storage. A permission change removes only the newly created upload, never a prior idempotent source. Large-body buffering requires authorization first and is limited to two concurrent uploads, 16 MB per file and 64 MB raw storage per embedding. Extracted text is limited to 200 KB per source and 2 MB per embedding; at most 100 active sources are accepted.

The isolated Python extractor uses pinned pypdf/Pillow, Poppler, Tesseract and FFmpeg in the independent container. It rejects active-document structures, unsafe archives, mismatched file signatures and scanning-test signatures. This validation is not a claim of comprehensive antivirus coverage. PDFs are limited to 30 pages, images to 16 million pixels, and silent recordings to two minutes. Audio uses the configured offline English transcription model and fails visibly if unavailable. Capture is explicitly user initiated, supports pause/stop/review/discard and never uploads automatically. Browser consent acceptance remains a separate release gate.

`test/make-document-fixtures.py`, `test/vps-document-acceptance.mjs` and `test/vps-url-lifecycle.mjs` provide repeatable synthetic format and lifecycle acceptance. They retain demonstration documents and delete only the labelled disposable lifecycle source. Results and binary fixtures remain outside Git in `.local` or protected server data. `deploy/install.sh` now retains a consistent independent SQLite checkpoint and server-only configuration backup before cutover. No OpenClaw data or configuration is part of that cutover.

## Coaching, recipes and guide mode

The website structure map and learned workflow map have different jobs. Discovery records that registration's observed pages, native forms, fields and links; an optional owner manifest adds reviewed source hints. The learned map derives page/transition relationships from current published, parameterized recipes. Owner-only observations validate recipe compatibility; they do not automatically become visitor permissions or executable targets. This follows the Platform Help separation between source metadata, reviewed lessons and live execution, without importing Flolah's generated inventory or form contracts.

Select the website and environment in the owner console before managing maps, help sources or recipes. The registration/embedding and audience determine their scope; the owner's email grants access and does not merge that owner's websites. In an authorized coaching session, **Inspect this page** refreshes only the current page, while **Website map → Choose pages to map → Build website map** discovers the explicitly approved routes within its budget. **Show workflows & screen map** in the owner console shows the observed screens separately from the learned workflow map. Neither a structural count nor a learned transition certifies every hidden state or a completed business task.

Owners can describe purpose, when to use, exclusions, examples, prerequisites and expected outcome. Changing intent creates a new draft version. Automatic selection requires reviewed publication with purpose, when-to-use and outcome present. Older unannotated lessons remain available by an explicit workflow name. Close matching candidates produce clarification with no proposed changes; complete ordered journeys are retained within a bounded context. Import/export preserves the intent in the target-owned draft. Visitors receive authorized published guidance; management, discovery and intent editing remain owner operations.

The owner console now issues private single-use ten-minute coaching grants for its exact approved website. Exchanging a grant elevates only the initiating runtime session; installation tokens alone cannot enable coaching. Inspection with that grant saves sanitized field/navigation structure, not current values. Publication requires server-side compatibility checks against recent screen observations, followed by owner review. Draft correction, disable, immutable rollback and checksum-verified JSON package import/export are available through the authenticated console. Imported recipes remain target-owned drafts and require mapped target-screen validation.

The widget can download a parameterized semantic recording, show permitted reusable workflows and prepare fresh session-bound reviews with new parameters. Recipe version changes invalidate outstanding approvals. Published summaries are indexed only in their embedding; authoritative recipe status/version also gates retrieval, so stale summaries are excluded immediately after repair or disable. Reviewed click, mouse-down and pointer-down navigation profiles use one activation without fallback retries. Optional verified-task learning defaults off, requires owner enablement, participant consent and a host-signed saved-record receipt, and creates owner-reviewed drafts. Live synthetic-host receipt acceptance is documented below; broader host compatibility and browser acceptance remain outstanding.

Guide mode returns highlight actions without field values or write commands. The SDK displays a pointer-transparent field marker and advances multi-field guidance only on Next. Assist mode retains reviewed filling. Real browser/CRM/ERP replay acceptance remains a separate release gate; API-command tests do not certify browser actions.

## Bounded discovery and retrieval

Authorized coaching sessions can preview same-origin paths, approve a route list and run bounded discovery from Actions. The persisted frontier supports pause/resume/stop, fresh-session maintainer resume, observer leases, a maximum of 50 pages and two minutes of active work. Every approved route is attempted in an isolated same-origin observation frame, keeping the parent draft, chat and coaching session intact. The observer has no form submission, popup or top-navigation permission. Unavailable, redirected or unframeable routes remain explicit gaps. Edited parent drafts pause the job. Inventory includes hidden native form structure, excludes values and secrets, and labels hidden or unsupported controls separately from live executable fields. Reports distinguish discovered structural coverage from task-tested behavior. Closed/cross-origin frame integration remains pending compatibility work.

Customer source, website, recipe and map lists apply server-derived owner/embedding filters in SQLite before returning rows. Global recovery workers and platform administration retain their explicit wider scope. OpenSearch retrieval combines original and English-stemmed text fields with a deterministic chunk tie-breaker and validated ranked pagination cursor. Original text remains indexed for other languages and exact spelling. Additive field migration backfills only the service's embedding-derived indexes and records completion only after the scoped update succeeds; interrupted updates remain retryable. Older lexical cursors remain accepted for compatibility. Possessive names retain their original spelling plus a plain-name query alias.

Ask retrieves at most 24 authorized candidates, removes identical passages and selects up to 12 distinct passages inside an actual 30,000-byte UTF-8 gateway request budget, reserving space for correction instructions. Different or conflicting passages are retained. Internal metadata is omitted from model context; returned citations still refer to exact authorized original chunks and current revisions. Each citation must include a quotation found in that exact passage; PDF layout newlines may split words, and the returned quotation retains the original source span. Invalid citation output gets at most one correction with the same evidence and a shared 40-second deadline. Provider failures are not retried. An explicit abstention discards all model prose and citations, including invented citation references, and returns a generic insufficient-evidence message. A purported supported answer with an invented citation remains rejected. Quotation membership does not prove semantic entailment or perfect recall; retained held-out results, tuned regressions and claim/citation review record those separately.

Discovery Pause and Stop interrupt stalled read-only requests before checking fresh coaching permission, so they do not queue behind the observer they must stop. Approval, upload, renewal and host submission requests are never interrupted or automatically retried. Discovery checks HTTP availability separately because iframe load also fires on error pages; missing pages remain explicit gaps rather than successful empty screens.

## Lifecycle and operational acceptance

Session mutations, owner proof consumption/logout, registration retries and installation issuance use SQLite transactions. Nested management operations use savepoints. A logged-out or revoked session cannot be restored by a concurrent activity update. Owner proof failures still commit their five-attempt limit; an older failed email delivery cannot remove a newer challenge.

Runtime access expires immediately at its credential, idle, identity or absolute boundary. Every 30 seconds, bounded maintenance removes up to 500 ended/expired conversation rows and their credentials and proposals. Expired initialization responses become minimal denied-operation tombstones, so retrying an ended initialization cannot create a replacement conversation. This maintenance never deletes website knowledge. A backlog can require additional maintenance turns; this is not a guaranteed physical-erasure deadline for every deployment.

Full document navigation closes the SDK instance. A persisted `pageshow` also disables it, clears the widget's conversations, unsent inputs and reviews, stops capture, and requires a host reload for a new empty conversation. No unload network request is assumed to arrive. Normal explicit SDK destruction attempts server termination; server expiry remains independent. Browser acceptance covers 30 remount cycles, full navigation, same-cookie tabs/window contexts and explicit persisted events. The tested Chrome fixture was not actually cached because its no-store policy excluded it; this is not proof of every browser's real BFCache path.

When `getHostIdentity` is configured, it must return a current signed identity. The SDK revalidates it before approval and after an asynchronous verified-Save binding. A signed-out host cannot silently fall back to anonymous access. Host integrations should destroy the widget at sign-out to stop it immediately.

Ingestion uses expiring transactional claims, bounded heartbeats and attempt ownership before extraction and publication. Deletion denies retrieval immediately and removes raw files even if search cleanup fails. Two isolated parser workers now use a private authenticated coordinator protocol; healthy ownership survives worker startup and coordinator restart. Expired work retries up to the configured attempt limit, then remains visibly Failed for owner review. Revision-specific search IDs prevent late old writes from replacing newer content. Remote workers require no shared SQLite filesystem. See [capacity and recovery deployment guidance](deploy/scaling.md) for resource caps, tuning, measured pilot criteria and the explicit single-coordinator boundary.

The local and VPS operational fixtures use two real HTTP API processes, independent SQLite connections and actual temporary object files. They exercise signed-identity bootstrap, discarded bootstrap responses, rotation/revocation, concurrent approvals and renewal, upload revocation, deletion during extraction, expiry, owner proof/logout races, a killed extraction process and a closed SQLite connection. Model/search/storage/identity adapter faults are explicitly labelled; they do not claim that shared Flolah infrastructure was stopped. The separate model-gateway outage has its own live evidence. Expiry-boundary cases use a controlled clock, not a claim that the test waited through every production lifetime.

Successful management changes carry hashed website/target correlation in the operational feed and retain reasons in the authorized audit trail. Identity outages, database/storage failures and model/search outages fail closed with bounded errors. Generic bootstrap rate-limit errors are readable by the caller without making CORS an authorization mechanism. No effectful operation is automatically retried.

The operator approved seven-day automatic checkpoint expiry. The isolated VPS timer runs daily at 02:20 UTC (10:20 Singapore), with up to five minutes of randomized delay and a catch-up run after downtime. Its first successful run retained all 104 files because none were seven days old. `deploy/checkpoint-retention.mjs` defaults to a read-only plan, accepts two explicit absolute checkpoint directories and a policy file, and requires `--apply` to delete expired matching files. It excludes unrelated files and symlinks and refuses changed or escaped candidates. The runner mounts only the two backup directories plus its read-only policy/helper, has no network, and uses a pinned runtime image. It drops capabilities except directory access needed for differently owned checkpoints. Active session/source deletion does not imply immediate erasure from retained backups. These checkpoints contain SQLite state and server configuration, not a complete object/search backup. The new backend pilot targets 25 website indexes and 25 concurrent users; retained reports distinguish measured results from targets and earlier two-index samples.

Actions → Current page → Inspect form and page shows progress and the structural forms, fields and navigation directly beside the control, including a saved-map result and explicit empty/unsupported coverage. It excludes field values and never fills or submits. It inspects only the loaded page; Website map separately discovers an owner-approved set of routes. Both require a current owner coaching grant.

Inspection and discovery persist structural screen maps by website and audience. Relevant observations from the last 24 hours enter the planner as bounded advisory memory across fresh conversations; current-page references still come from a new live snapshot. Owner source-map refresh separately replaces reviewed source metadata, which also supplies ranked planner hints. The planner uses published lessons for visitor guidance and relevant saved draft lessons only for an authorized coach. Its gateway request has a 30,000-byte UTF-8 budget: older conversation and lower-priority advisory entries may be omitted with an explicit context flag; task values, live refs and selected published-workflow steps are never silently truncated.

A saved route path cannot stand in for a live navigation ref. When no safe clickable link is observed, the model explains the known destination for manual navigation and returns no executable action. Completed informational responses and failed proposal preparation release their pending-review state, so a later owner discovery job is not blocked by a review that does not exist.

An empty proposal for an edit/create task naming current fields gets at most one same-task input recheck within the existing shared deadline. The recheck reminds the model to retain supplied values across navigation and still permits clarification when values are genuinely missing. It never retries effects or bypasses approval. A fresh inspection also removes the previous field highlight, preventing old labels from appearing over a newly rendered form.

Previous assistant proposals are passed as quoted conversation data instead of assistant turns to continue. When a task names multiple fields already present, unrelated live navigation and off-page map hints are excluded; an explicitly named different destination still takes precedence. This uses current labels and task text, not a website-specific form catalog.

Stopping a semantic teaching recording automatically persists its parameterized steps as an owner draft, using one stable operation ID for recovery from a lost response. Empty recordings are not stored. The UI reports save failures and offers an explicit retry; entered values, keystrokes and credentials are excluded. A new owner conversation can retrieve the draft and use it for planning; visitors require current validation and reviewed publication. Screen video remains a separate consent/review/upload flow. Recording a screen does not silently upload it or add it to shared knowledge. Pending proposals, approvals, task values and private chat stay session-local.

## Host saved-record receipts

`integrations/host-outcome-signer.mjs` is a backend-only adapter for any host website. Its trusted `readSavedTask` callback must authenticate the host request, enforce record ownership and independently read persisted data. It returns a recent successful readback with server-stored session/proposal/path/operation binding and trusted subject/tenant/roles. The signer hashes canonical record data and emits a two-minute Ed25519 outcome receipt without record values. Keep the private key on the host backend; configure only its public key and policy on this service. An outcome receipt cannot be used as a host identity token.

The SDK's optional `bindVerifiedSave` callback runs after the user's separate Save approval and learning consent, before host dispatch. Bind the pending task on the host server, then return its independently verified receipt from `getVerifiedOutcome`. Callback completion rechecks current access and task generation before dispatch. Neither the SDK nor a model can manufacture saved-record proof. Learning remains off by default and creates parameterized owner-reviewed drafts, never automatic publications. Live synthetic-host acceptance verified consent, binding before dispatch, independent persisted readback, one draft on repeated completion, session isolation, purpose separation, stale Save rejection, owner publication, fresh-value reuse and disable. This does not certify an unrelated host's backend integration.

## Failure messages and operations

The guided-session fixes use the same bottom composer for normal prompts and
`@` paired-copilot handoffs. Pairing setup offers a named group, expiry and
inactivity choices. Confirmed browser membership can reconnect to that saved
group; private tasks and approvals remain ephemeral. Offline workflow steps fail
immediately and are never delivered to a later visitor. Readable workflow
inspection results contain structural metadata only. Private chat instructions
and document passages clear when their task ends.

Native radio groups, multiple selects, datalist inputs and accessible input
comboboxes join the existing controls. Unique current options and fresh review
remain required. Mixed selection language and read-only summary intent are
handled without asking visitors for internal boolean encodings. Review panels
offer rejection/cancellation beside approval. Pending actions show busy feedback
and suppress repeated clicks. Bootstrap has a visible eight-second attempt and
an explicit retry path without blocking the host form.

Runtime seeding is off by default. Owner knowledge, maps and published recipes
belong to each registration and audience; pairing does not combine their indexes.
See [the design](DESIGN.md) and [test/setup instructions](deploy/README.md) for
durable pairing and the isolated React/Angular fixtures.

Authorized runtime callers receive readable CORS responses for dependency failures. Model/search outages return 503, malformed model output returns 502, budgets return 429, and excessive bodies return 413. Network loss says to inspect the current task before retrying; it never asserts that an uncertain host action failed. Errors stay at the bottom until dismissed. No effectful operation is automatically retried. Knowledge uses explicit evidence status so an evidenced negative answer is distinct from insufficient evidence; citations still require exact authorized chunks.

The independent service emits fixed-schema JSON request correlation and ingestion lifecycle events. Identifiers are hashed; raw chat, DOM, source text, URLs, headers, tokens and exception messages are excluded. Failed ingestion emits `INGESTION_FAILED` with a hashed job identifier. This is a machine-readable local alert, not proof of external notification delivery. Each independent container rotates JSON logs at 5 MB across three files. Only public SDK/widget asset types are gzip-compressed in the scoped Nginx location; private JSON API responses remain uncompressed. Pilot/load and actual wire measurements are retained in ignored UAT evidence, with their tested envelopes rather than unlimited-scale claims.

## Guided feedback evidence, 18 October 2026

Independent runtime `20261018-feedback-i` and platform connector/editor
`20261018-feedback-f` are deployed. The final source includes 208 passing
application tests locally and in the I image; ten real adapter/framework checks,
nine live visitor journeys, two cancellation checks and two bootstrap-recovery
checks are recorded separately. The evidence bundle has a SHA-256 manifest;
images show actual browser state, while assertions/result files prove behavior.
Open `http://127.0.0.1:4194/uat-evidence` on the running loopback fixture for the
filterable table and screenshot gallery. The report contains no raw credentials,
link codes or private task files.

Server workflows no longer depend on peer pairing. Link each browser explicitly
as a saved workflow target; adding another same-owner target requires its own
code. Save the stable group and selected websites once. Runs 4059/4060 used the
same definition across both tab refreshes. Offline run 4062 failed explicitly;
no later visitor receives the command. Peer handoffs still require bilateral
pairing and sharing consent.

Run 4063 consumed an earlier inspection handle in a following real LLM summary
while the host form was hidden (zero current fields). It correctly reported all
three earlier required fields. Pass task ID and result handles within the same
live task; task end invalidates private results. Structural inspection summaries
can remain in audit, with entered values excluded.

Field filling validates current native range/type/pattern constraints before
host events and rejects changed constraints after review. The complex fixture
covers async loading, empty/error/duplicate-label refusal and recovery, dependent
fields, dynamic editable table rows, row selection, filtering/sorting/pagination,
modal scope and independent saved-record readback. Vendor-specific grids and
closed components are not certified by these accessible fixture patterns.

## Owner pairing controls and optional analytics

The selected website now has **Visitor pairings & workflow targets** and
**Website & copilot analytics** sections in both management consoles. Owners
and authorized platform admins can review visitor groups, revoke them and
change expiry directly, including extensions. Connected visitors are notified
and may disconnect. Reconnect proofs rotate after revocation.

Analytics is Off by default. The approved policy is 30-day opt-in retention.
Once an owner enables it, visitors must
accept its current notice. Reports cover consenting browser IDs, page/form use,
validation/submit attempts, copilot engagement and requests, handoffs/workflow
outcomes, behavioral cohorts and optional possible-visitor-match hints. Values,
chat and file contents never enter analytics. IP hints are coarse, rotating,
website-specific and require a configured trusted proxy. They do not identify a
person, combine website indexes or grant pairing/workflow permissions.

See DESIGN section 18 and the deployment instructions for lifecycle, retention,
quota and measurement boundaries. Existing full-phase UAT gaps are unchanged.


Owner/analytics certification baseline runtime: **20261018-owner-analytics-d**; evidence/source
publication: **20261018-owner-analytics-e**. The [consolidated evidence report](test/evidence/owner-analytics-20261018/index.html)
contains 37 passed, five partial and three user-deferred cases, with no failed
cases. Seven new owner/analytics cases passed; live coarse-network matching is
partial. Historical feedback screenshots retain their original release labels.
All 221 application tests pass locally and in the D VPS image. Actual owner UI
and VPS-recipient checks verified local opt-in analytics, expiry extension and
revocation; the disposable group was removed and synthetic visitors opted out.
Local test analytics remains enabled with 30-day retention; both public Flolah
registrations remain Off. Network hints remain Off/unconfigured in live UAT.

The capped VPS analytics pilot measured 25 websites/25 concurrent clients,
5,000 events, ingest p95 158 ms and owner-report p95 35 ms without unexpected
errors. The separate private-task pilot measured 50 WebSockets, 25 real text
extractions and 50 recipients, with zero remaining private bytes after cleanup.
These are short synthetic pilots, not sustained-load or Kubernetes HA proof.
Owner resend cooldown now returns HTTP 429 with Retry-After and explains that
the code already sent remains usable; it does not replace a valid challenge.


Current deployment: **20261018-preview-expiry-f**, with source/evidence
publication **20261018-preview-expiry-g**. The explicitly approved seven-day,
opt-in public flolah.cloud preview is active until **25 October 2026, 15:57
Singapore time**. The existing isolated registration and permissions are kept.
Expired previews now show owner-renewal guidance instead of an ineffective
Retry button. Transient network failures still allow retry. All 225 regression
tests pass locally and in the VPS image; actual MCP browser opening and expiry
states are recorded in [preview renewal evidence](test/evidence/preview-renewal-20261018/index.html).
This update does not change the earlier full-phase certification gaps.

Task-grounded option resolution now gives the assistant bounded, relevant enabled choice labels, while automatic discovery continues to omit them and current field values. The model interprets default/keep wording and clear option spelling errors against observed choices; ambiguous choices require clarification. Recommendations alone do not apply field changes. Deployment and live workflow evidence for this update are recorded separately from the earlier certification baseline.

Current intent runtime: **20261018-agentic-j**, with additive platform policy fix **20261018-agentic-b**. All **240** independent service checks pass locally and in the VPS image. Seven live intent cases pass on public flolah.cloud and the loopback fixture, including default wording, control/option typos, mixed checkbox requests, recommendations, unsupported-choice clarification and semantic comparisons. These use generic observed controls and existing platform model configuration; no website-specific intent rule was added.

The workflow Save journey now passes: [run 4066](https://login.flolah.cloud/workflows/runs/4066) completed all 10 nodes and saved Customer, Note and Opportunity entirely through the local website copilot. Three HTTP 200 writes match three exact records independently read from the host records page. The observer performed no host filling, Save clicks or direct record writes. Run 4064's Save policy mismatch and run 4065's Note/navigation mistake were fixed before this complete retest. The journey ran on runtime H; runtime J adds semantic-choice stability and excludes private effect bookkeeping from future workflow status outputs. Historical synthetic run output is not retroactively redacted.

Visitor chat requires **Approve field changes** for a fill proposal. A workflow instead requires current Action Policy authorization for each effect; the server approves the matching validated proposal after that check. This UAT used an explicitly approved temporary three-use fill grant. Save was separate and used exact owner-reviewed local action bindings under the internal-write policy. A binding alone is not blanket Save authorization. The temporary grant was removed after the run; company policies and public workflow permissions remain unchanged.

Source/evidence publication: `20261018-agentic-k`; runtime remains `20261018-agentic-j`, platform `20261018-agentic-b`. The [closure table and screenshots](test/evidence/workflow-closure-20261018/index.html) record **29 passed, 1 partial and 0 failed current cases**. Broad arbitrary-website agent coverage remains partial; selective maker/checker is proposed, not implemented. The [earlier report](test/evidence/intent-workflow-20261018/index.html) preserves its original failed attempt. This closes the specified saved workflow and representative intent tests, not full Phase 1/2 certification or the earlier device, sustained-load/HA and fresh-onboarding gaps.


### Global maker/checker admin control

Admin → Models & routing → Digital Adoption copilot review provides a persistent, platform-wide enable switch. The default is Off, preserving maker-only behavior. When On, all website copilot model plans and knowledge/private-task answers use the active platform slot as maker and the inactive slot as checker. Deterministic field/navigation proposals also consult this policy. Explicit owner-bound Save execution remains governed by Action Policies rather than an LLM granting permission.

The checker accepts, requests at most one revision, asks for clarification, or rejects. Revised proposals are checked again and validated against observed controls. An unavailable, invalid or timed-out checker stops the response with a specific no-change message; there is no maker-only fallback while enabled. The optional “Ollama reasoning (efficiency)” checker route uses the registered local reasoning deployment and native thinking/JSON output, with no hosted fallback. This is an explicit global copilot route, independent of users’ unrelated utility efficiency preferences. No model IDs or provider credentials are accepted from websites or visitors.

Settings are stored in the platform database, apply on new requests without a restart, and survive deployment. Admin-only GET/PUT `/api/admin/copilot-quality` validates booleans and supported checker routes. Model prompts, private values, reasoning traces and secrets are excluded from the operational review log; it records only purpose, slots, decision, revision count and duration. See deployment scaling guidance for the bounded local reasoning budget.


Admin → Digital Adoption websites (`/admin/digital-adoption`) restores the platform-wide registration overview across owners. It uses the existing validated platform identity at the independent management service, with an admin-only inventory projection, server-side search/status filters and bounded pagination beyond the legacy 100-row management listing. Installation credentials, DNS challenges, action bindings, chat/document contents and private visitor data are excluded from inventory rows. Owner IDs identify website-owner registrations, not an automatic entitlement to another user’s workflow session. The “Manage website” link opens the existing console scoped to that authorized registration; owner email sign-in remains owner-scoped. The global review control is also available on this page.

## Website workspace and paginated management

Owner email login (`owner.html`) and existing Flolah-account login (`manage.html`) share the website workspace. Select a registration in the header; find additional registrations by domain, label or ID. Installation, Knowledge, Website map, Teaching, Visitor groups, Analytics and Settings keep the selected registration separate. The website ID and active tab persist in the URL. Advanced uploads, imports, identity settings and workflow editors are collapsed until requested.

Management-only paged routes are `website-page`, `source-page`, `learning-page`, `learning-map-page`, `source-map-page`, `learning-version-page`, `token-page` and `audit-page` under the existing authenticated owner/account API prefixes. Requests accept `offset`, `limit` (1–100; UI 10/25/50), and literal `query` (up to 200 characters), returning `pagination` totals and navigation flags. Ownership and content audiences are derived before querying. SQL pages cover registrations, sources, current workflows, observed screens and audit; bounded reviewed manifests and histories are sliced server-side. Token summaries are read by website, then paged. Existing visitor/model interfaces and their safety limits are unchanged. Source history metadata remains capped at 20 revisions. Analytics uses its existing bounded aggregate report; individual dataset tables paginate locally and render when opened. Pairing governance keeps its existing bounded server pages.

`capacity.managementPerIp` defaults to 600 requests/minute per observed network/proxy address (range 30–6000). `capacity.managementPerActor` defaults to 60 requests/minute per authenticated principal (range 1–600). Owner login/code requests retain their separate 30/minute network budget. Set these in private `service.json`; the installer preserves configured values. Request identities cannot select a different rate bucket. This remains a single SQLite coordinator with parser workers, not multi-coordinator HA. At much larger volumes, reassess offset/count costs and migrate to indexed cursor pagination/shared storage before horizontally replicating the API.

Run `node test/owner-workspace-browser.mjs` with the existing local fixture and Playwright installed under `test/frameworks`; it uses an isolated synthetic owner repository and browser URLs on `127.0.0.1:4194` only. Run `node test/management-capacity.mjs` separately for the isolated 25-client management benchmark. Neither command seeds or changes real registrations.
