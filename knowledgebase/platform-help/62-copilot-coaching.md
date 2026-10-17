# Teach Copilot: private screen recipes

Open Platform Help → **⋯** → **Teach Copilot**. Assistance mode is in the same options panel. Errors appear next to the composer, dismiss after five seconds, and can be closed with ×; failed requests remain available to retry.

## Guided replay

Choose a published lesson under My recorded lessons and select **Replay recording**.
The chat shows the current step, its expected result, and pause/resume/stop controls.
If the step is recorded as **Navigate**, replay opens its authorized screen automatically and waits for it to load. Advancing to another Navigate step does the same. Embedded destinations must be visible, unique live links; otherwise replay stops for guidance instead of guessing a URL.
**Open recorded screen** opens authorized screens and only currently observed embedded links.
Choose current records yourself: recordings intentionally omit record identifiers.
**Prepare step in chat** copies the step into the composer; add current values and send it through normal Copilot review.
**I verified this step** advances after checking the current screen matches; it records your confirmation, not automated proof of business persistence.
Every action checks the current recipe version; archived or revised recordings cannot silently continue. Closing the panel pauses replay. Reloading ends replay; the published recording remains available to start again.

This is an additive guidance feature;
it does not replace existing form contracts, DOM inspection or approval gates.

1. Name a lesson (or choose a CRM/ERP starter outline) and start it. Under
   **New lesson purpose and matching**, describe its purpose, when to use,
   expected outcome, example requests, prerequisites and exclusions. Purpose,
   when to use and expected outcome are required before publishing.
2. Demonstrate a step using the normal application. Coaching does not click,
   fill or save on your behalf. Creating a CRM record may save immediately.
3. Explain the step and the observable success condition, then select
   **Capture this screen step**. Only authorized screen paths and field
   identifiers are captured. No input values, cookies, HTML, screenshots,
   option values or credentials are collected by the recorder.
4. Navigate and capture subsequent steps. Ordered steps form a task/navigation
   graph, including screen transitions, fill steps and verification steps.
5. Review the complete lesson. Undo a mistaken last step and recapture it.
   Publish only after removing sensitive details from your own descriptions.

Each capture/publication creates an immutable JSON version. Concurrent stale
updates fail instead of overwriting another tab. An edit returns a published
lesson to draft; old published guidance is not silently replayed. Archive
disables future retrieval. Lessons are private to the authenticated company
AND human login; they are not shared across users or tenants. Listing uses
server pagination. Historical versions remain stored; automated retention
and cross-user sharing are not introduced by this feature.

## Purpose and automatic matching

Open a private lesson to edit **Recipe purpose and matching**. Save metadata,
review the whole lesson, then publish the new version. Metadata changes return
the lesson to draft and invalidate an already-started replay version. The
**Suggest metadata from recording** button only copies the recorded title and
last success check into an unsaved draft: it does not infer a business purpose,
invent applicability or automatically publish. Supply when to use yourself.
Legacy published recordings remain available for explicit replay, but are not
selected automatically until their required metadata is reviewed and published.

Automatic matching considers all latest published recordings for the company
AND human login, filters out any containing unauthorized screens, and ranks
purpose/title/applicability/examples and step descriptions against request
terms. It uses conservative lexical matching, not embeddings or semantic
certification; unrelated or one-term requests select nothing. Recency/current
screen only break score ties; an older cross-screen lesson can be discovered.
Close scores ask the user to choose a lesson through explicit replay or clarify
the request, with no field proposal or model call. Otherwise one matching
recording's complete ordered journey is included within a 12,000-character
budget; oversized journeys require explicit stepwise replay, not truncation.
This ranking is not proof of applicability. The copilot must still check
prerequisites and exclusions and ask when uncertain. Chat shows **Matched
recorded guidance** with recipe title, immutable version and matched terms.

**Learned screen map**
shows screen contracts and transitions derived from up to 100 published
lessons; its JSON view is available for inspection. It excludes any recipe
containing a screen you can no longer access. Recipes are untrusted advice, never executable code or
permissions. Current user intent, current DOM, field allowlists and review
requirements win. Record IDs and query strings are generalized out of embedded
screen paths. Recipes do not prove persistence or certify live acceptance.

## Included starter sessions

- **CRM opportunity:** list → creation approval → name/amount/currency → reload verification.
- **CRM follow-up note:** Notes → creation approval → title/body → persistence check.
- **ERP customer:** Customer → New → name/type/group/territory → separate Save.
- **ERP project:** Project → New → name/dates/description → separate Save.
- **ERP task:** Task → New → subject/body/project → separate Save.

These source-controlled outlines are explicitly `starter_unverified`, not
published recordings. Teach against your installed screens before publishing.
In particular a rich-text body requires a supported editor handler; coaching
does not manufacture that capability. Guide manually when unsupported.

## Validation and rollback

Run `npm run test:ui-copilot` in backend and `npm run build` in frontend.
The coaching harness covers isolation, rejected paths/credentials, metadata
minimization, review/version gates, archival and pagination. Existing guided
fill, embedded navigation and stale-edit harnesses remain regression gates.

The new SQLite table is created lazily and is additive. Rolling back code
leaves it intact; no existing session or business record migration is required.
No new service, secret, OpenClaw restart or Docker topology change is needed.
