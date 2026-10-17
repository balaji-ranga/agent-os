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

The knowledge modules provide scoped lexical requests, an OpenSearch HTTP adapter, text ingestion and authoritative source-state rechecks. Unit tests use doubles; `test/vps-acceptance.mjs` additionally exercises actual separate OpenSearch indexes, live-model citation answers, isolation and one-use approvals through the deployed Nginx endpoint. Binary/media ingestion, production jobs and ranking remain outstanding. Discovery and recipe lifecycle modules are foundations, not a completed autonomous crawler or coaching UI.

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

`deploy/install.sh RELEASE` builds the independent official-Node image and starts only the two `flolah-adoption` services. Configuration is prepared server-side with protected permissions. Existing Nginx content is preserved; only the new locations are added, with a backup and syntax check before reload. The matching host-network configuration is also present in repository source. No application hotpatches are required. Demo origins are explicitly limited to the configured site and loopback port 4194; the demo installation expires in seven days.

`test/acceptance-catalog.mjs` enumerates all 38 Phase 1/2 journeys and requires local and VPS end-to-end evidence before UAT readiness. The evidence ledger also tracks the plan's nonfunctional cases. The currently deployed preview has real model/search integration, but is **not full-phase certified**. Remaining management breadth (including bulk step-up revocation), full ingestion formats, capture/video understanding, comprehensive DOM adapters, persistent discovery UI and real CRM/ERP end-to-end coverage remain open.

`deploy/install-platform-entrypoints.sh` builds the additive Admin entry against the running frontend release source and guards against concurrent cutover. It does not rebuild or restart the existing backend or OpenClaw. The static Free Tools card is maintained in `deploy/static/flolah-home/free-tools/index.html` at repository root. Keep a backup and compare the deployed version before replacing that page.

The independence regression rejects imports of existing Flolah/Platform Help runtime code. Nodemailer is explicitly allowlisted and locked for this service's independent email transport.

Conversation layout defaults to 420×680 with a 14px configurable font and compact bottom controls. Reply controls select a specific message in the same session/channel; the backend checks the reference before providing bounded quoted context to the model. Reply context never replaces action review or approval. Local regression covers cross-session/cross-channel rejection. Navigation recording can replay reviewed safe links and confirms the actual destination; this is not yet certification of parameterized multi-step form recipes.

The settings menu supports clearing only the current session conversation. A conversation version invalidates outstanding proposals and in-flight model responses; shared sources and other sessions are not cleared. VPS regression checks verify stale reply/approval denial and continued retrieval of shared knowledge after clearing.
