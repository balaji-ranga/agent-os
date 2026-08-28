# Internal Promotions and MCP Universe — Single-Phase Implementation Plan

**Status:** Approved for implementation planning  
**Date:** 2026-08-28  
**Product:** Flolah (`agent-os`)  
**Delivery model:** One release, implemented as two internally isolated workstreams on the existing Flolah platform

## Objective

Deliver two related growth capabilities without creating a parallel platform:

1. **Internal Promotions:** Admin-authored, audience-targeted sponsored or product announcements delivered as an in-app popup and optionally through a user's enabled WhatsApp channel, with honest event tracking.
2. **MCP Universe:** A controlled public directory of MCP servers, discoverable from the `flolah.cloud` Free Tools area, aggregated from authoritative registries and approved submissions, indexed in OpenSearch and protected against abuse.

## Architectural decisions

- Canonical campaign, targeting, event, source, listing, submission, and sync state belongs in the application database. OpenSearch is a derived public-search index, not the system of record.
- Reuse Flolah's Admin UI, platform cron registry, media controls, owner-scoped channels, backend, nginx, OpenSearch, static website, audit, and deployment model.
- Never expose OpenSearch directly. Public traffic reaches narrow backend APIs through nginx.
- Do not allow arbitrary executable HTML in promotions or MCP listings. Store structured content and render sanitized output.
- “All public MCPs” means all records discoverable from configured registry adapters plus approved submissions. There is no exhaustive global MCP catalogue; every record must retain source provenance.
- The official MCP Registry is the primary ingestion source. Additional sources are explicit adapters, not uncontrolled web crawling.
- Promotions sent through WhatsApp are clearly labelled Flolah announcements. They must not pretend to be conversational COO output.
- All new public write operations require human verification, strict validation, moderation, and rate limits.

---

## Workstream A — Internal Promotions

### A1. Admin campaign management

Add **Admin → Promotions** with a campaign builder supporting:

- Internal campaign name
- Advertiser/sponsor identity
- Required sponsored/promotional disclosure
- Structured text and safe rich-content blocks
- Image, audio, video, or supported combinations
- Primary and secondary CTA buttons
- Destination URLs and reviewed domains
- Priority
- Start/end timestamps and timezone
- Audience: all enabled users or selected users
- Delivery: login popup, WhatsApp, or both
- Frequency: once per campaign, once daily, or a configured maximum
- Impression/click cap where required
- States: draft, pending approval, scheduled, active, paused, completed, cancelled

Admin mutations must be privileged, audited, and protected against accidental duplicate publication.

### A2. Safe content model

Use a block model such as:

- `heading`
- `paragraph`
- `image`
- `video`
- `audio`
- `cta`
- `disclosure`

Do not store or render arbitrary scripts, inline event handlers, iframes, or untrusted CSS. Sanitize any limited rich text on both input and output. Reuse controlled media storage and validate MIME type, extension, size, and ownership.

### A3. In-app popup journey

After authenticated application startup:

1. The frontend requests the highest-priority eligible campaign.
2. The backend evaluates user targeting, campaign state, schedule, delivery mode, event history, and frequency cap.
3. The popup is rendered only after the main shell is ready.
4. At most one campaign is shown in a login/session.
5. The user may expand/read, invoke a CTA, dismiss, or choose “Don't show again” when the campaign permits it.
6. Refreshing or navigating must not repeatedly display the same campaign.

The component must support mobile, keyboard navigation, screen readers, day/night themes, reduced motion, captions/transcripts, and safe media fallbacks.

### A4. Event semantics

Record separate idempotent events:

- `eligible` — the user matched targeting
- `delivered` — the backend returned the campaign
- `impression` — the popup rendered
- `viewable` — visible for the configured minimum, initially two seconds
- `expanded_read` — the user opened details or crossed the configured read threshold
- `dismissed`
- `suppressed_by_user`
- `cta_clicked`
- `whatsapp_queued`
- `whatsapp_sent`
- `whatsapp_failed`

Do not call a render a “read.” Browser events should use event IDs/idempotency keys. The server derives the authenticated user and does not trust a client-supplied user ID.

### A5. WhatsApp delivery

Reuse the existing owner-scoped agent-channel infrastructure and bounded delivery queue.

- Send only when the target user has an enabled, paired WhatsApp channel and promotional consent.
- Label the message as a Flolah announcement or sponsored promotion.
- Support media using the existing channel-safe media delivery path.
- Use a signed tracking redirect for CTA URLs.
- Respect schedule, timezone, frequency limits, opt-out, and campaign cancellation.
- Retry only transient failures with bounded attempts.
- Track queued/sent/failed based on evidence available from the channel.
- Do not claim WhatsApp read or close tracking if the provider does not expose reliable evidence.

### A6. Paid-promotion governance

The first release supports paid campaigns operationally, without adding advertiser billing or self-service purchasing:

- Advertiser identity and contact
- Sponsor disclosure
- Admin approval
- Flight dates
- Approved destination domains
- Audience definition
- Impression/click limits
- Creative revision history
- Audit history
- Pause/terminate controls
- Exportable report

Advertiser self-service, invoicing, bidding, and payment collection are explicitly out of scope for this phase.

### A7. Admin analytics

Show campaign and per-user evidence:

- Targeted users
- Unique impressions
- Viewable impressions
- Expanded/read actions
- Dismissals and suppressions
- CTA clicks and conversion rate
- WhatsApp queued/sent/failed
- Breakdown by delivery channel
- Timestamped event history
- CSV export

Retention must preserve aggregate campaign reporting while expiring detailed user events according to platform privacy policy.

---

## Workstream B — MCP Universe

### B1. Public experience

Add **Free Tools** to the public Flolah site and an **MCP Universe** tool card linking to:

`https://flolah.cloud/free-tools/mcp-universe/`

The page provides responsive cards, search, pagination, filters, a detail view, “Include your MCP,” and “Report listing.”

Display available metadata:

- MCP/server name and description
- Publisher and verified/claimed state
- Categories/tags
- Source registry and provenance
- Source repository and documentation URL
- Package/container metadata
- Declared remote endpoint, when public
- Transport: Streamable HTTP, SSE, or stdio
- Authentication type
- Tools, resources, and prompts
- License
- Version and publication/update timestamps
- Last indexed and last verified timestamps
- Validation/health status

Metadata that is absent must be shown as unavailable, not inferred.

### B2. Canonical data and OpenSearch index

Create canonical records for:

- Registry sources and adapter configuration
- Source records and source cursors
- Normalized MCP identities
- Versions/packages/remotes
- Tools/resources/prompts
- Publisher claims
- Verification observations
- Public submissions
- Moderation decisions
- Sync runs and failures

Use a dedicated versioned OpenSearch index and stable read alias. A successful full rebuild switches the alias atomically. Preserve the previous index for rollback. Store no secrets in public index documents.

### B3. Registry ingestion cron

Register **`mcp_universe_sync`** in the existing Admin cron registry.

Admin controls and telemetry:

- Enable/pause
- Schedule
- Run now
- Configured source status
- Last cursor/checkpoint
- Last successful sync
- Added/updated/stale/error counts
- Duration and failure details
- Retry status

Execution flow:

1. Fetch paginated records through each configured adapter.
2. Validate source payloads against the applicable registry schema.
3. Normalize identity, repository, publisher, package, transport, endpoint, and capability metadata.
4. Deduplicate by registry identity, namespace, repository identity, and endpoint fingerprint.
5. Upsert canonical records and retain source provenance.
6. Mark missing records stale; do not immediately hard-delete them.
7. Bulk-index normalized public documents.
8. Switch the read alias only after successful validation.
9. Record the run and retain a rollback index.

The official MCP Registry API is the initial primary adapter. Community registries may be added only as explicit, tested adapters.

### B4. Safe metadata verification

A separate bounded worker may inspect declared public metadata but must never invoke advertised MCP tools.

Controls:

- HTTP(S) only, with HTTPS preferred
- Block loopback, private, link-local, multicast, and cloud metadata addresses
- Resolve and re-check DNS before connection and after redirects
- Redirect, timeout, response-size, and content-type limits
- No inherited cookies, credentials, or authorization headers
- Per-domain concurrency and retry limits
- Isolated worker/container
- No tool invocation or arbitrary command execution
- Store observation, timestamp, and failure class

Repository descriptions, icons, and publisher-provided content must be escaped/sanitized before rendering.

### B5. Public submission and publisher claim

“Include your MCP” collects:

- Publisher name and verified email
- MCP name/namespace
- Official registry identity, if available
- Source repository
- Documentation URL
- Package or remote endpoint metadata
- Transport
- License
- Optional logo
- Ownership evidence
- Terms and acceptable-use acknowledgement
- Cloudflare Turnstile token

Lifecycle:

`submitted → email_verified → automated_validation → admin_review → approved/rejected → indexed`

Public submissions never write directly to the live OpenSearch alias. Encourage registration in the official MCP Registry first; importing a verified registry identity is preferred to accepting duplicated self-declared metadata.

### B6. Public APIs

Expose only narrow backend endpoints through nginx:

- `GET /api/public/mcp-universe/search`
- `GET /api/public/mcp-universe/:id`
- `POST /api/public/mcp-universe/submissions`
- `POST /api/public/mcp-universe/events`
- `POST /api/public/mcp-universe/reports`

Never accept raw OpenSearch DSL from a client. Enforce strict query length, filter allowlists, sort allowlists, page size, total-result cap, OpenSearch timeout, and response-size limits.

### B7. Human verification and anti-abuse

Use layered protection:

- Cloudflare Turnstile rendered on the public page
- Mandatory server-side Siteverify validation
- Validate hostname/action and reject expired or replayed tokens
- Issue a short-lived, signed, HttpOnly human-verification session after success
- Rechallenge after expiry or suspicious volume
- nginx request/connection limits
- Backend IP/session quotas
- Submission quotas by IP, email, and domain
- Honeypot and minimum-form-completion time
- Cached popular searches
- Audit failed verification and abuse signals
- Restrict CORS to Flolah public hosts

Turnstile complements rate limiting; it does not replace it. Secrets live only in deployment environment configuration and are never committed.

---

## Database and API scope

Expected new tables/collections include:

- `promotion_campaigns`
- `promotion_campaign_targets`
- `promotion_campaign_media`
- `promotion_events`
- `promotion_delivery_jobs`
- `mcp_universe_sources`
- `mcp_universe_source_records`
- `mcp_universe_servers`
- `mcp_universe_capabilities`
- `mcp_universe_verifications`
- `mcp_universe_submissions`
- `mcp_universe_sync_runs`

All admin APIs use existing privileged-session controls. All authenticated promotion APIs derive the owner/user from the session. Public MCP APIs expose only approved fields.

## Deployment and configuration

Update and keep aligned:

- Backend routes/services/schema and tests
- Frontend Admin and authenticated popup UI
- Public static Free Tools and MCP Universe application
- nginx public proxy, caching, CORS, body-size, and rate-limit rules
- OpenSearch index template and alias management
- Platform cron registration and Admin cron metadata
- Docker build contexts and optional verification worker
- `deploy/.env.example` with Turnstile and MCP source configuration placeholders
- Repeatable sync/deploy scripts
- Public docs, cookie/privacy disclosure, promotion policy, and third-party notices

Production secrets, Turnstile secret, and channel credentials must remain only in local/VPS environment configuration.

## Test and acceptance matrix

### Promotions

- All-users and selected-user targeting
- Non-target users receive no campaign
- Campaign scheduling and timezone boundaries
- Frequency limits across reload, navigation, logout, and login
- Impression/viewable/read/dismiss/click event integrity
- Duplicate/idempotent event handling
- Image/audio/video/text combinations
- Mobile, accessibility, theme, and reduced-motion behavior
- WhatsApp enabled, unpaired, opted-out, paused, sent, and failed paths
- Campaign pause, expiry, cancellation, and rollback
- Admin authorization and user isolation
- Malicious HTML, URL, media, and XSS rejection

### MCP Universe

- Official registry pagination, cursor resume, and incremental sync
- Schema version changes and adapter failure
- Deduplication and provenance retention
- Stale-record behavior
- OpenSearch rebuild, alias switch, and rollback
- Search/filter/sort/pagination/result limits
- Public static host → nginx → backend → OpenSearch path
- Submission, email verification, validation, moderation, approval, and rejection
- Turnstile valid, invalid, expired, replayed, wrong-host, and unavailable cases
- IP/session/query/submission rate limits
- SSRF, DNS rebinding, redirect, oversized response, and unsupported protocol rejection
- OpenSearch unavailable/degraded response
- Proof that OpenSearch has no public direct route

### Regression

- Authentication and registration
- Admin privileged actions
- Platform notifications
- Agent channels and WhatsApp pairing
- Scheduled goals and Admin cron controls
- Content/media rendering
- Existing MCP registry/connectors UI
- OpenSearch document RAG and Admin console access
- Public website/docs/blog routing
- Mobile and theme regressions

## Release gates

The single phase is complete only when:

1. Both workstreams are source-backed, built through Docker, deployed through the repeatable VPS scripts, and contain no server-only hotfix.
2. Promotion targeting and analytics are evidence-based and owner/user scoped.
3. WhatsApp promotion delivery is labelled, consent-aware, bounded, and does not overstate read tracking.
4. MCP Universe reads only from an approved derived index and submissions require moderation.
5. Turnstile is verified server-side and backed by nginx/backend rate limits.
6. SSRF controls pass negative tests.
7. OpenSearch remains private.
8. Full targeted tests and the existing regression pack pass, with test records cleaned up.
9. Deployment health and public-host routing are verified on the VPS.

## Out of scope

- Advertiser self-service accounts
- Automated billing, auctions, or ad bidding
- Guaranteeing every MCP on the internet is indexed
- Executing untrusted MCP tools during discovery or verification
- Direct anonymous access to OpenSearch
- Treating popup rendering as proof of reading
- Claiming WhatsApp read/close evidence that the channel does not expose

## Reference sources

- Official MCP Registry API: <https://registry.modelcontextprotocol.io/docs>
- Official MCP Registry repository: <https://github.com/modelcontextprotocol/registry>
- MCP Registry API reference: <https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md>
- Cloudflare Turnstile server-side validation: <https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>

