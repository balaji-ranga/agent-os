# FloAssist source release and restart verification

FloAssist API, UI, assistant instructions and gateway tool schemas are source-controlled together. Never fix a running container with `docker cp` as the final deployment. A gateway restart intentionally replaces volume plugins from its image; changing the volume alone is temporary.

## Release contract

1. Reconcile source changes, preserve unrelated VPS fixes and obtain approval for merge conflicts. Commit the reviewed tree. Generate a release source manifest with `node deploy/scripts/release-source-manifest.mjs <release>/source-manifest.json`.
2. Synchronize that snapshot to the VPS source checkout with a backup and hash verification. Preserve `.env`, credentials, databases, volumes and unrelated untracked files. Never reset the production checkout or copy credentials into a build context.
3. Use canonical `deploy/docker/{backend,frontend,openclaw}.Dockerfile`. Keep the required infrastructure overlays, then append `docker-compose.release.yml` once. Remove historical image/build-context overrides from the active Compose list; retain them only as rollback evidence.
4. Set `FLOLAH_RELEASE_TAG` and `FLOLAH_SOURCE_REVISION` to the reviewed release. Build all three application services from the same source snapshot. No application Dockerfile may derive from an older application image to assemble a release.
5. Run `npm run test:floassist` in an isolated backend container; run frontend build checks and installed gateway/config gates. Both backend and gateway builds validate schema registration. The gateway startup verifies every shipped extension JavaScript file matches its active volume copy and fails on stale/missing code.
6. Capture the previous image IDs and Compose list, then recreate the three services without rebuilding. Verify health, source revision labels, static UI, and `node /opt/agent-os/scripts/verify-openclaw-extension-integrity.mjs` inside the gateway. Compare its digest with the source-build result. Restart the gateway once and verify the same digest again.
7. Test one FloAssist responsibility at a time. A source-read failure is not a successful empty scan. Verify actual source receipts, Kanban lifecycle, grouped delivery and UI history. Restore temporary quiet-hour exceptions and retain schedule states.

The gateway plugin manifest and access grants are intentionally generated from the database; code integrity excludes these mutable configuration records. JS implementation and schema files must match the shipped image exactly. Existing unrelated connector grants and owner policy remain authoritative.

Rollback restores captured image IDs and the corresponding source/config release together. Do not leave the host source pointing at a different implementation from the active application images. Never roll back production data by replacing the database merely to undo a code release.

## Explicitly scoped production updates

When the operator requests no full deployment, build and recreate only affected services with `--no-deps --no-build`; preserve the other running images. Use the canonical backend Dockerfile. A plugin-only gateway update may use `openclaw.scoped-update.Dockerfile` with a locally tagged, captured running image ID as `BASE_IMAGE`, the committed `SOURCE_REVISION`, and the source/runtime integrity gates. Record the base image ID and rollback Compose files; never use a floating base or leave a volume-only plugin patch. Synchronize and verify the complete host source manifest even when only selected services change. Run goals one at a time and inspect queued/sent deliveries before the next run.

## Native budget and timezone release gates

Scheduled-goal partial execution requires the matching backend and frontend. The backend lazily adds `scheduled_goals.partial_goal` with default 0; per-run preferences live in durable goal context. No gateway schema or model-route change is required. Run `npm --prefix backend run test:goal-partial`, goal control/recovery, exception-policy and maker/checker contract regressions before a scoped backend/frontend release. Validate checkbox create/edit persistence, retained saved plans and partial run history against that frontend build. Keep the active gateway image intact, including its profile-clock fix.

Both gateway Dockerfiles run `install-native-model-budget.mjs` against the pinned runtime. Keep this adaptation in the image build; never edit the installed SDK in a running gateway. Unsupported stream ABIs fail the build. The plugin's budget-reply and profile-timezone modules ship alongside its registered schemas and are covered by startup integrity verification.

Run these additional tests in the built gateway image with `--network none`, no production volumes, and the committed backend test scripts available under `/opt/agent-os/backend/scripts/`:

- `node /opt/agent-os/backend/scripts/test-native-model-budget-runtime.mjs`
- `node /opt/agent-os/backend/scripts/test-floassist-reply-hooks-runtime.mjs`

Timezone context is appended to the system prompt on every trusted native session turn. Do not gate this metadata on WhatsApp channel discovery or the source-reader tool grant: resumed/compacted turns and reminder-only grants can omit them. The authenticated profile endpoint remains authoritative for owner/agent/profile matching. Preserve this hook test when updating OpenClaw or changing prompt hooks; a missing lookup must request the profile timezone rather than assume UTC.

These fixtures exercise the installed SDK and actual hook registration with synthetic metadata/providers, without reading user sessions or calling a model. The ordinary `npm --prefix backend run test:floassist` suite separately covers owner isolation, timezone changes, refusal correlation and failure-preserving messages. Use the management browser harness against a fresh frontend build to verify one Company Tools link, all four internal tabs and desktop/mobile layouts.

On Windows, package committed source with `git -c core.autocrlf=false archive` so exported files match the manifest's Git blobs. Verify the complete source manifest before building. The focused cutover script defaults to a 600-second per-service startup allowance and captures private startup diagnostics before automatic rollback; do not replace that with an unverified container patch or shorten it below the gateway's observed cold-start time.

## Local FloAssist assistance gates

Ad hoc digest grounding ships through the existing backend source/test copies; no gateway/frontend rebuild or connector credential change is needed. Add `node backend/scripts/test-goal-digest-grounding.mjs` to isolated release gates. This exercises production goal execution with synthetic provider responses and zero paid calls. Preserve the approved saved-plan reuse gate, source audit scope, bounded synthesis context, configured secondary checker and fail-closed outcomes. A green run status or `tea-*` ID alone must never be treated as source verification.

The source-assessment and notification-summary utilities ship through the existing backend Dockerfile's complete `backend` copy (or the scoped Dockerfile's `backend/src` and `test-*` copies). No container patch, secret, new service or model-route override is required. Efficiency mode and Admin workload policy govern activation; the new helpers explicitly prohibit an additional hosted utility fallback. A backend-only rollout is sufficient when these are the only source changes.

Run the standard FloAssist suite and `node backend/scripts/test-efficiency-controls.mjs` with synthetic providers in a disposable container with `--network none`. Optionally run `FLOASSIST_LOCAL_MODEL_TEST=1 node backend/scripts/test-floassist-local-assistance-live.mjs` in a separate disposable container on the private network shared with Ollama. Supply the intended local `OLLAMA_BASE_URL`, `OLLAMA_MODEL` and CPU-thread setting, and mount no production data or secrets. The opt-in probe creates its own temporary database and tests only synthetic text. It must report two local calls, assessment reuse, protected notification metadata and zero hosted calls. A safe template fallback is not proof that the local quality probe passed.

## Scheduled responsibility routing — 31 October 2026

Gateway-only change: keep granted `scheduled_goal_list` and `scheduled_goal_run_now` inside the bounded 96-tool discovery surface. A large COO catalog previously hid both, causing a WhatsApp request to run Morning Briefing to reuse an old terminal goal and try unrelated workflows. This is discovery ordering, not a permission expansion. Explicit session tool scopes still apply. Both runtime JavaScript and TypeScript source inject the same scheduled-execution guidance; existing schedules must be run once through the scheduler, with actual run/delivery status reported.

Gate with `node backend/scripts/test-native-channel-tool-budget.mjs`, native budget-reply/profile-timezone fixtures, and extension source/runtime integrity checks. Build through `deploy/docker/openclaw.scoped-update.Dockerfile` from the captured current gateway image; preserve backend v60 grounding and frontend v59. Do not patch only the mounted plugin. A successful visibility fixture is not a delivered briefing; live source and notification acceptance must be recorded separately.

### Partial source continuation recovery

The first real briefing after the routing correction read Gmail, Calendar, Drive and Outlook, but repeated page one of a 98,723-character Drive document and hit the isolated 600k-token allowance (552,163 reported tokens before the next request was denied). No digest was delivered and quiet hours were restored. This is not acceptance.

The backend invocation boundary now normalizes a repeated bare app/source selector to the stored next unread cursor, before duplicate detection. Recovery requires the exact authenticated owner, scheduled run and partially reviewed snapshot. Explicit cursor/restart requests, discovery, completed sources and ad hoc reads retain their semantics. The source reader still rechecks app selection, owner scope and current authorization for each page. Regression reads every character once from a multi-page synthetic document with no repeated provider download and checks owner/run isolation, aliases and explicit restarts. Deploy this backend change through the scoped backend Dockerfile; retain gateway v61 and frontend v59.

### Native model budget WAL contention — 31 October 2026

The v62 retest advanced eight Drive cursors and verified all four selected sources (25 source IDs, four read receipts, zero incomplete sources or unresolved errors), but still produced no notification: the gateway compacted its context and then failed with `database is locked`. 12 model calls reported 504,288 tokens; quiet hours were restored and Morning Briefing remained paused at the owner's request. Source verification alone did not constitute delivery acceptance.

A real second SQLite connection reproduces `SQLITE_BUSY_SNAPSHOT` at native budget admission when another writer commits after the deferred transaction's initial read. Admission, settlement and stale-reservation recovery now use immediate transactions, reserving the writer before reads. The contention test fails against v62 at the production admission INSERT and passes with the correction; admission/settlement still enforce reservations, owner identity and exactly-once usage. This ships through the scoped backend Dockerfile; no gateway patch or model substitution is needed. Run the full FloAssist suite and the two-connection native-budget regression before activation.

### Live v63 briefing acceptance — 31 October 2026

Run `sgr-db2787de168c44a1` completed through the existing Morning Briefing schedule, not a new ad hoc plan. Owner-scoped source evidence verified Gmail, Google Calendar, Google Drive and Outlook: 25 source IDs, four read receipts, zero unresolved errors, zero incomplete sources and no budget exhaustion. The notification row transitioned to `sent` at 23:56 Singapore time; end-to-end runtime was 164 seconds, with 16 metered model calls / 629,696 reported tokens including compaction. WhatsApp handset receipt is a separate user confirmation, not inferred from the scheduler status.

Quiet hours were restored to 22:00–08:00 Asia/Singapore. Morning Briefing remains paused by the owner's explicit instruction; other recurring checks were not resumed. Backend image `agent-os-backend:budget-wal-v63-20261031`, gateway image `agent-os-openclaw:scheduler-routing-v61-20261031` and frontend v59 retain the full scoped release chain. All images passed their affected regression gates, complete Git-source verification and health checks. This live pass confirms the repaired path; it does not establish day-after-day production reliability or solve the remaining cost of an agent-driven broad multi-source briefing. Do not report either as proven from a single successful run.
