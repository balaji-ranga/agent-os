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

Both gateway Dockerfiles run `install-native-model-budget.mjs` against the pinned runtime. Keep this adaptation in the image build; never edit the installed SDK in a running gateway. Unsupported stream ABIs fail the build. The plugin's budget-reply and profile-timezone modules ship alongside its registered schemas and are covered by startup integrity verification.

Run these additional tests in the built gateway image with `--network none`, no production volumes, and the committed backend test scripts available under `/opt/agent-os/backend/scripts/`:

- `node /opt/agent-os/backend/scripts/test-native-model-budget-runtime.mjs`
- `node /opt/agent-os/backend/scripts/test-floassist-reply-hooks-runtime.mjs`

These fixtures exercise the installed SDK and actual hook registration with synthetic metadata/providers, without reading user sessions or calling a model. The ordinary `npm --prefix backend run test:floassist` suite separately covers owner isolation, timezone changes, refusal correlation and failure-preserving messages. Use the management browser harness against a fresh frontend build to verify one Company Tools link, all four internal tabs and desktop/mobile layouts.

On Windows, package committed source with `git -c core.autocrlf=false archive` so exported files match the manifest's Git blobs. Verify the complete source manifest before building. The focused cutover script defaults to a 600-second per-service startup allowance and captures private startup diagnostics before automatic rollback; do not replace that with an unverified container patch or shorten it below the gateway's observed cold-start time.
