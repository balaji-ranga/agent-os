# Digital Adoption Copilot

Independent Flolah Free Tools product. This directory owns its implementation and tests; it does not import, mount, replace, or migrate Platform Help Copilot.

## Development

Run `npm test` in this directory, or `npm run dev` for the deterministic loopback harness on port 4193. `node src/local-vps-demo.mjs` serves the separate local page on port 4194 using `.local/demo-public.json`; it loads the SDK from the deployed VPS and uses the live model. Current implementation is partial and not production-ready.

## Boundaries

- Separate service, SDK, widget, database, OpenSearch namespace, release image and configuration are required before deployment.
- No edits to existing Platform Help components, APIs, templates, bridge or deployment configuration.
- Flolah Free Tools links to the independently authenticated registration console. Flolah Admin links to its website/token controls. These links do not activate the new SDK inside existing Flolah pages automatically.
- The reference plan's extraction/reuse language is superseded by the user's instruction to keep both implementations independent. Concepts may inform this implementation; runtime code is not shared.
- Phase 1 and Phase 2 (including technical sections 1–14 and mandatory Phase 2 acceptance) are in scope; Phase 3 is excluded. No production readiness is claimed by unit tests.

## Initial domain slice

`src/session-authority.mjs` owns hashed installation/runtime credentials, public-only session issuance, exact origin matching, renewal/revocation, and session message ownership. SQLite persistence and HTTP transport have local tests. Management authentication validates the existing Flolah login server-side; callers cannot supply roles. Domain ownership and admin approval have live browser evidence. Private host identity remains outstanding and private registrations fail closed.

The development harness uses in-memory storage. Restart loses its state and invalidates its credentials. The SQLite repository has restart tests but still needs production migration/retention and operational hardening. Origin validation is a browser boundary, not visitor authentication.

The knowledge modules provide scoped lexical requests, an OpenSearch HTTP adapter and authoritative source-state rechecks. The independent ingestion worker accepts PDF, DOCX, UTF-8 text/HTML, PNG/JPEG and silent MP4/WebM. Original files live in embedding-derived object directories; only extracted sections are indexed. PDF pages, image OCR and video timestamps survive retrieval as citation locators. Public HTTPS help pages support explicit owner approval, same-origin redirects, DNS-pinned public-address fetching, refresh, revision metadata and deletion. Binary and URL processing status is durable; interrupted jobs become visibly failed and can be retried. Unit tests use doubles where labelled; separate VPS tests exercise actual extraction, OpenSearch and the configured model through Nginx. Audio transcription, broader crawling, hybrid/vector ranking and production job scaling remain outstanding. Bounded discovery and coaching/recipe controls are implemented below; their full browser acceptance remains open.

## Embedded appearance

Pass `theme` to SDK `mount`, or call the returned `updateTheme(patch)` without recreating the session. Supported six-digit hex colors: `background`, `foreground`, `surface`, `primary`, `onPrimary`, `muted`, `border`. Other settings: `title`, `font` (`system`, `serif`, `mono`), bounded `radius`, `fontSize`, `width`, `height`, `offset`, and `position` (`bottom-right`, `bottom-left`, `top-right`, `top-left`). Choose accessible contrast pairs. Arbitrary CSS, remote fonts and CSS URLs are rejected. Widget CSS variables are isolated inside its iframe; no global host styles are changed.

The UX reference informs compact branding, inline field review and a bottom composer. Minimize/reopen retains the same session. The local browser test confirmed conversation preservation. This does not yet certify all reference UX features or Phase 1/2 acceptance.

The widget has Guide, Ask Knowledge and Actions tabs with separate conversation channels. Its three-dot settings dialog applies bounded appearance tokens to the current instance and can restore the website theme. Raw CSS, scripts and remote stylesheet URLs are intentionally not accepted.

## Registration email

Registration accepts a scoped idempotency key; retries with the same payload return the original registration/challenge and conflicting reuse is rejected. The browser preserves that key across retry clicks for the same form values. Text ingestion uses bounded leases and attempt fencing, exposes failed/interrupted attempts for retry, and treats completed indexing retries as reused work. Startup and periodic recovery mark expired attempts failed rather than falsely ready. Initial text quotas are 100 active sources and 2 MB per embedding. These controls do not imply binary/video ingestion support.

Public onboarding is `owner.html`, using independent verified-email identity rather than a Flolah login or installation token. Sign-in codes are challenge-bound, hashed, single-use, ten-minute and limited to five attempts. Owner sessions use Secure/HttpOnly/SameSite=Strict cookies, a 30-minute idle limit and eight-hour absolute expiry. Owner APIs enforce the platform Origin and ownership on every operation. This sign-in is distinct from recipient verification below. `manage.html` remains the authenticated Flolah-account console, with admin-only operations checked server-side. Public website owners never receive platform administration privileges.

An admin may transfer a registration only to an already verified independent owner, with a reason and expected current owner. Transfer retains its embedding ID, configuration and indexes, removes the former owner's management access and records both owner IDs in the audit. It does not silently revoke public installation tokens. A recipient verification for a different email is cleared. `deploy/update-owner-entrypoint.mjs` changes only the known Free Tools registration link, preserving unrelated live static-page changes.

The authenticated registration console verifies a recipient using a hashed, ten-minute, five-attempt email code. A verified recipient can receive a publishable installation token and snippet only after domain verification and platform approval. The browser never receives SMTP credentials. Server-side SMTP configuration comes from the platform deployment's `WORKFLOW_SMTP_*` variables; TLS is required. Failed snippet delivery revokes the newly issued token. Mail-server acceptance is not proof of inbox delivery. Tests use synthetic mail transports; a live verified-recipient send is recorded separately.

## Model boundary

The SDK only calls this service. The server-side model adapter calls an authenticated HTTPS platform gateway behind Nginx. The independent gateway reads only the active primary/secondary setting from a read-only platform database mount on each call; provider credentials are server-only deployment configuration. No provider credentials or direct model endpoints are exposed to embedded websites. Existing Platform Help/OpenClaw runtime code is not imported or restarted.

## Deployment and acceptance

Owner source maps accept a reviewed JSON manifest `{schema:1, origin, screens:[{path,title,forms:[{id,label}],fields:[{key,label,type,required,form}]}]}`. Refresh replaces the previous source version atomically and reports all imported screen/form/field counts. Up to 200 screens, 500 fields per screen and 480 KB are supported; oversized maps fail explicitly. Entered values and arbitrary metadata are rejected, sensitive fields are excluded, and maps remain embedding/audience scoped. Source-map hints are separate from live inspections and verified coverage. Refreshing the view does not crawl a website. Use authorized read-only discovery to observe runtime screens.

Each source form can create a parameterized teaching draft. It must pass current live-screen validation and maintainer review before publication. Source structure never creates live element refs or grants permission. Assistant replies now carry an explicit action-instance contract, validate against current observed refs, and receive at most one bounded repair attempt. Invalid retries fail without creating an executable proposal. Off-screen fields require observed navigation and a fresh inspection.

Recording ingestion includes local English speech transcription with a build-time pinned Whisper tiny.en model and offline runtime loading. PyAV is pinned to 18.0.0 because faster-whisper 1.2.1 uses an API removed in PyAV 19. Shared tab/system audio is opt-in; microphone capture is not requested. Synthetic narrated-video backend acceptance does not certify real voice or browser capture consent.

`deploy/install.sh RELEASE` builds the independent official-Node image and starts only the two `flolah-adoption` services. Configuration is prepared server-side with protected permissions. Existing Nginx content is preserved; only the new locations are added, with a backup and syntax check before reload. The matching host-network configuration is also present in repository source. No application hotpatches are required. Demo origins are explicitly limited to the configured site and loopback port 4194; the demo installation expires in seven days.

`test/acceptance-catalog.mjs` enumerates all 38 Phase 1/2 journeys and requires local and VPS end-to-end evidence before UAT readiness. The evidence ledger also tracks the plan's nonfunctional cases. The currently deployed preview has real model/search integration, but is **not full-phase certified**. Remaining management breadth (including bulk step-up revocation), audio/video learning, comprehensive DOM adapters, persistent discovery UI and real CRM/ERP end-to-end coverage remain open.

`deploy/install-platform-entrypoints.sh` builds the additive Admin entry against the running frontend release source and guards against concurrent cutover. It does not rebuild or restart the existing backend or OpenClaw. The static Free Tools card is maintained in `deploy/static/flolah-home/free-tools/index.html` at repository root. Keep a backup and compare the deployed version before replacing that page.

The independence regression rejects imports of existing Flolah/Platform Help runtime code. Nodemailer is explicitly allowlisted and locked for this service's independent email transport.

Conversation layout defaults to 420×680 with a 14px configurable font and compact bottom controls. Reply controls select a specific message in the same session/channel; the backend checks the reference before providing bounded quoted context to the model. Reply context never replaces action review or approval. Local regression covers cross-session/cross-channel rejection. Navigation recording can replay reviewed safe links and confirms the actual destination; this is not yet certification of parameterized multi-step form recipes.

The settings menu supports clearing only the current session conversation. A conversation version invalidates outstanding proposals and in-flight model responses; shared sources and other sessions are not cleared. VPS regression checks verify stale reply/approval denial and continued retrieval of shared knowledge after clearing.

## File processing and limits

The owner console supports file uploads, public help-page approval, source retries, refresh and removal. Visitor uploads default to disabled; only an authenticated website owner/admin can enable the capability. Runtime requests derive that grant and embedding from server-side session authorization. Large-body buffering requires authorization first and is limited to two concurrent uploads, 16 MB per file and 64 MB raw storage per embedding. Extracted text is limited to 200 KB per source and 2 MB per embedding; at most 100 active sources are accepted.

The isolated Python extractor uses pinned pypdf/Pillow, Poppler, Tesseract and FFmpeg in the independent container. It rejects active-document structures, unsafe archives, mismatched file signatures and scanning-test signatures. This validation is not a claim of comprehensive antivirus coverage. PDFs are limited to 30 pages, images to 16 million pixels, and silent recordings to two minutes. Recordings with audio fail visibly until transcription is configured. Capture is explicitly user initiated, supports pause/stop/review/discard and never uploads automatically. Browser consent acceptance remains a separate release gate.

`test/make-document-fixtures.py`, `test/vps-document-acceptance.mjs` and `test/vps-url-lifecycle.mjs` provide repeatable synthetic format and lifecycle acceptance. They retain demonstration documents and delete only the labelled disposable lifecycle source. Results and binary fixtures remain outside Git in `.local` or protected server data. `deploy/install.sh` now retains a consistent independent SQLite checkpoint and server-only configuration backup before cutover. No OpenClaw data or configuration is part of that cutover.

## Coaching, recipes and guide mode

The owner console now issues private single-use ten-minute coaching grants for its exact approved website. Exchanging a grant elevates only the initiating runtime session; installation tokens alone cannot enable coaching. Inspection with that grant saves sanitized field/navigation structure, not current values. Publication requires server-side compatibility checks against recent screen observations, followed by owner review. Draft correction, disable, immutable rollback and checksum-verified JSON package import/export are available through the authenticated console. Imported recipes remain target-owned drafts and require mapped target-screen validation.

The widget can download a parameterized semantic recording, show permitted reusable workflows and prepare fresh session-bound reviews with new parameters. Recipe version changes invalidate outstanding approvals. Published summaries are indexed only in their embedding; authoritative recipe status/version also gates retrieval, so stale summaries are excluded immediately after repair or disable. These controls extend the earlier recipe-store foundation. Automatic successful-session learning and broader browser acceptance are still outstanding; bounded discovery is described below.

Guide mode returns highlight actions without field values or write commands. The SDK displays a pointer-transparent field marker and advances multi-field guidance only on Next. Assist mode retains reviewed filling. Real browser/CRM/ERP replay acceptance remains a separate release gate; API-command tests do not certify browser actions.

## Bounded discovery and retrieval

Authorized coaching sessions can preview declared read-only links, approve a route list and run bounded discovery from Actions. The persisted frontier supports pause/resume/stop, fresh-session maintainer resume, observer leases, a maximum of 50 pages and two minutes of active work. Only permitted, uniquely matched read-only links are activated. Edited drafts pause navigation; unknown controls are counted and skipped. Reports distinguish discovered structural coverage from task-tested behavior. Closed/cross-origin frame integration and broader interaction profiles remain pending compatibility work.

Customer source, website, recipe and map lists apply server-derived owner/embedding filters in SQLite before returning rows. Global recovery workers and platform administration retain their explicit wider scope. OpenSearch retrieval sorts by relevance with a deterministic chunk tie-breaker and a validated ranked pagination cursor; older lexical cursors remain accepted for compatibility. Knowledge answers without a valid citation are returned as insufficient evidence rather than a supported factual answer.
