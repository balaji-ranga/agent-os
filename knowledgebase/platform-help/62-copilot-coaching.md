# Teach Copilot: private screen recipes

Open Platform Help → **Teach Copilot**. This is an additive guidance feature;
it does not replace existing form contracts, DOM inspection or approval gates.

1. Name a lesson (or choose a CRM/ERP starter outline) and start it.
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

Published recipes for the current authorized screen are bounded to three in
the model context and an 8,000-character guidance budget. **Learned screen map**
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
