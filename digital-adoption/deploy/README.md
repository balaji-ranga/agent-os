# Build and VPS setup

Run the application tests from `digital-adoption/` with Node 22 or newer:

```sh
npm ci --ignore-scripts
node --test --test-concurrency=2 test/*.test.mjs
```

The Python extractor also requires the packages in `requirements.txt` and the
system utilities installed by `Dockerfile`. The image builds an offline English
speech model, so the image build needs network access; running parsers do not.

## Private task and workflow setup

The API now serves an authenticated WebSocket at `v1/live`. Nginx must forward
HTTP/1.1 Upgrade/Connection headers; the tracked location updater adds them only
to the independent copilot location. Runtime tickets are one-use initial frames,
never URL parameters. Do not publish the private worker port 4196 or task-bridge
port 4197. The laptop fixture remains bound to `127.0.0.1:4194`.

The independent service's `taskBridgeToken` and the platform backend's
`DIGITAL_ADOPTION_BRIDGE_TOKEN` must match. Configure
`DIGITAL_ADOPTION_BRIDGE_URL` to the private coordinator listener and
`taskPolicyUrl` to the backend's authenticated
`/api/integrations/digital-adoption/effect` route. No browser receives this
credential. The platform editor's group-link API uses its normal signed-in user
and workflows permission; website ownership does not confer workflow access.

Owners enable `taskPolicy.attachments`, `pairing` and `workflow` separately.
Workflow linking works for a single copilot with pairing disabled. The signed-in
editor can add a separately authorized copilot to an existing saved target group;
this grants server delivery only. Peer document relay still requires bilateral
pairing, stored separately from target membership.
`taskPolicy.limits` may lower `fileBytes`, `files`, `taskBytes` and `instances`.
`actionBindings` entries contain `id`, exact `path`, native control `label` and
effect `family`. A changed binding invalidates in-flight authority. Source code
contains no website-specific binding catalog.

Pairing groups now persist in the existing SQLite repository (`paired_groups`).
Checkpoints include group consent, linked-user and hashed browser-proof metadata,
but cannot restore private tasks, files, commands or approvals. Until-revoked
pairing is an explicit browser choice; it is not a perpetual live session.
After cutover, already-open old clients must reload; previously ephemeral groups
have no reconnect proof and must be paired once with the updated client.
Preserve the normal private task cleanup/restart behavior during rollback.
New deployments seed no demo knowledge unless `demoSeedEnabled` is explicitly
true. Do not enable that switch on customer registrations.

For a scoped platform update, use
`package-platform-connector.py RELEASE --base-ref COMMIT_BEFORE_THE_CHANGE`.
The recorded merge base must precede this feature; an already updated HEAD is
not a valid substitute when reproducing its deployment patch.
On the VPS, unpack its archive into the candidate's `platform/` directory and run
`prepare-platform-connector.py` with that directory. It three-way merges backend
modules from the running image and uses the exact labelled deployed frontend
source, leaving the dirty VPS checkout alone. Conflicts stop preparation.
`build-platform-connector.sh RELEASE` builds candidate images and synchronizes
their generated screen inventory. `install-platform-connector.sh RELEASE` checks
that running image IDs still match, writes a protected runtime override, and
recreates only backend/frontend. Retain `previous.json` and previous images for
rollback. Deploy the independent candidate with the normal installer, using the
same protected bridge credential. These scripts do not start a public preview.

Private files use `/data/private-objects/*.enc`; task keys are never written to
configuration or SQLite. Startup sweeps orphan ciphertext, and task termination
retries physical cleanup. Workers use tmpfs scratch. Coordinator restart fails
private deliveries and does not resurrect tasks. Database/config checkpoints
cannot recover private task plaintext or keys. Provider-side processing follows
the configured provider's actual retention policy; no zero-retention guarantee
is implied by the application's task deletion.

Additional validation commands:

```sh
node --test test/private-tasks.test.mjs
node test/private-capacity.mjs
node ../backend/scripts/test-digital-adoption-connector.mjs
node ../backend/scripts/test-digital-adoption-runner.mjs
```

The test-only React/Angular control fixtures are built separately and are never
included in the runtime Docker context:

```sh
cd test/frameworks
npm ci
npm run build
cd ../..
node src/local-vps-demo.mjs
# In another terminal; fixture listener remains 127.0.0.1:4194 only:
node test/feedback-controls-browser.mjs
```

The browser runner uses installed Chrome and the framework package's Playwright.
Its ten checks distinguish direct adapter/application-state tests from full
LLM chat journeys. It saves synthetic records only on loopback. The fixture HTML
is read per request; restart the listener for server-code changes. Do not expose
the fixture through a tunnel or change its bind address.

`test/private-document-uat.mjs` requires the synthetic corpus generated by
`test/make-transaction-fixtures.py`, parser dependencies and a protected platform
model configuration. It exercises real OCR/model calls and prints only counts.
The browser script requires Playwright and an installed Chrome; configure its
module import for the test host. Its synthetic Save is restricted to loopback.

`test/private-public-browser-uat.mjs` separately checks explicit public opt-in,
anonymous cross-origin pairing, consent rejection, private handoff, fresh public
field review/fill and task cleanup. Run it only while the isolated public preview
is explicitly authorized and unexpired; set `ADOPTION_UAT_BUILD` to the deployed
release. The runner blocks public host write requests, login navigation and form
submission. It writes content-free results under `.local/private-preview/`.
Its public field names are acceptance fixtures, not application schemas. A new
preview period requires fresh authorization; this runner never renews one.

## Release bundle and image

From a Git checkout, stage/commit the intended source changes, then run:

```sh
python deploy/package-release.py UNIQUE_RELEASE
```

This packages tracked source, tests, build/deployment files and `.dockerignore`
into `.local/adoption-release-UNIQUE_RELEASE.tar.gz`. It reads working-tree
bytes for tracked paths, so use a clean committed checkout for a reproducible
release. An existing output label is refused. Shell scripts and systemd units
are normalized to LF. Local credentials, databases, uploaded objects, recordings,
evidence and dependency directories are excluded. The Docker context separately
allows only runtime sources, manifests and the required build helpers.

Copy the archive to the VPS and extract it under
`/opt/flolah-digital-adoption/releases/UNIQUE_RELEASE/`, then run:

```sh
sh /opt/flolah-digital-adoption/releases/UNIQUE_RELEASE/deploy/install.sh UNIQUE_RELEASE
```

The installer creates independent database/config checkpoints, prepares protected
server-side config, builds the release image, starts one coordinator, two parser
workers and one model gateway, and validates/reloads the additive nginx locations.
Model/search/mail credentials come from the existing platform deployment on the
server. Do not copy live configuration or installation/coaching tokens into Git.
The gateway's read-only platform data mount and the external `agent-os_default`
network are deployment prerequisites. A fresh unrelated VPS needs those platform
integrations configured before using this integration-specific installer.

`ADOPTION_WORKERS`, `ADOPTION_WORKER_CPUS` and `ADOPTION_WORKER_MEMORY` control
Compose worker allocation. Set the matching `ingestion.maxWorkers` in persistent
`config/service.json`; the installer preserves that policy. `config/worker.json`
contains only the private coordinator endpoint and worker credential. Port 4196
is not published. See [scaling and recovery](scaling.md) before changing topology.

## Checkpoint retention

`systemd/` contains the exact units active on the approved VPS. The timer runs
daily at 02:20 UTC (10:20 Singapore), with up to five minutes jitter and persistent
catch-up. The service intentionally pins `flolah-digital-adoption:20261017bb`,
the tested retention runtime. Retain that image until a replacement is tested and
the unit is explicitly updated; application releases do not retarget the timer.

The active protected policy is `/opt/flolah-digital-adoption/config/retention.json`:

```json
{"mode":"automatic","retentionDays":7}
```

The protected helper/runner live under `/opt/flolah-digital-adoption/bin/` and
come from `checkpoint-retention.mjs` and `run-checkpoint-retention.sh`. For an
authorized restoration, copy those files to the same paths (modes 0644 and 0755),
install the unit files in `/etc/systemd/system/`, run `systemctl daemon-reload`
and enable `flolah-adoption-retention.timer`. Verify the policy, named backup
directories and pinned image before activating expiry on any new deployment.

The runner mounts only `data/checkpoints`, `backups`, the policy and helper; it
has no network or live data/search/object-store mounts. Checkpoints cover SQLite
and configuration, not a complete disaster-recovery backup. Keep the existing
seven-day policy and do not infer immediate backup erasure from live deletion.

## Historical private-extension validation boundary

The private-task extension is deployed as `20261018-private-j`, with platform
connector/editor `20261018-private-f`. Its own evidence includes 197 passing
application tests both locally and inside the VPS image, three connector core
tests, the actual runner/policy/approval integration, five real document formats
through the deployed parser/model, and twenty-two Chrome journey checks across local PDF/PNG and public cross-domain
pairing/relay. The source includes JSON/CSV acceptance results and sanitized browser/
capacity evidence under `test/`. Signed-in editor/browser workflows and the remaining privacy/load/device
acceptance remain partial; see
`test/private-acceptance-results.json` for each composite condition. Do not infer
full certification from these passing checks. The laptop host remains loopback
only, and the approved public preview expires at 15:17 Singapore on 18 October 2026.

Release `20261017bk` has 174 passing local tests and 174 inside its VPS image,
plus live API and scoped local/public browser evidence. The synthetic backend
pilot passed 25 website indexes and 25 concurrent sessions, 500 documents, 750
searches and 50 parser jobs. Search p95 was 178.5 ms and full model-answer p95
8.59 seconds; this is a short pilot, not sustained or cross-host HA certification.
Full Phase 1/2 acceptance remains partial, with the previously recorded device,
accessibility, lifecycle and other formal-case limitations still applicable.

## Current guided-feedback release and reproducibility

The current runtime is `20261018-feedback-i`; platform backend/frontend remain
`20261018-feedback-f`. The source/evidence publication bundle is
`20261018-feedback-j`. It contains the same runtime source as I plus the final
sanitized reports and build instructions; test screenshots are excluded from
Docker runtime context by the existing allowlist.

All 208 application tests passed locally and in the I VPS image. Run the image
checks with `test` and `deploy` mounted read-only under `/adoption`, not `/app`;
use `--network none`, bounded CPU/memory and no production data mounts.

The final browser checks require the approved public preview to be unexpired:

```sh
ADOPTION_UAT_BUILD=20261018-feedback-i node test/feedback-visitor-browser.mjs
node test/feedback-reviews-browser.mjs
ADOPTION_UAT_PUBLIC=1 node test/feedback-bootstrap-browser.mjs
node test/feedback-controls-browser.mjs
```

The visitor runner waits for JSON stdin after its nine checks; send
`{"op":"close"}` to record its final zero-public-write/login/submit assertions
and close the browser. Workflow recipient harnesses are interactive: use the
existing signed-in editor to link the one-use code, never copy it into reports.
`feedback-context-browser.mjs` hides only the synthetic host form after real
inspection and asserts the following real LLM summary uses its prior result.

After those outputs exist, `python test/build-feedback-evidence.py` copies only
an explicit synthetic evidence allowlist, requires 208/208 TAP success and checks
all ledger links. `python test/build-feedback-canvas.py` creates a self-contained
review canvas under ignored `.local`; its report data/screenshots are inline.
The loopback `/uat-evidence` route serves the table and bounded image/JSON/CSV
filenames, without exposing arbitrary local files. Restart only the verified
local fixture process when changing its server routes; keep bind 127.0.0.1.

The latest capped H-image 25-site/25-user pilot used 50 authenticated sockets,
two real Python parsers and 250 HTTP samples: p95 3 ms, RSS 89 MiB, total 3.576 s,
parser time 3.181 s, event-loop p99 18 ms and zero private objects/jobs/backlog
at cleanup. This excludes LLM/OCR provider latency, saturation, soak and
multi-coordinator HA; see `test/evidence/feedback-20261018/capacity-vps.json`.

The temporary isolated public workflow capability is restored Off. Owner UI
screenshot and audit verify cleanup; local task capabilities remain available.
The six-hour opt-in preview expires at 15:17 Singapore on 18 October 2026.
No new preview credential or lifetime is granted by deployment or this report.

## Owner administration and analytics extension

The extension adds no npm/Python dependencies. New source modules are copied by
the existing Docker source rules. Startup creates an independent indexed
`visitor_analytics` table and an internal HMAC key; no Flolah application table
or shared knowledge index is used. Rollback to the earlier runtime ignores this
additive table. Back up the database normally; existing seven-day checkpoint
expiry is unchanged and is separate from live analytics retention.

The user approved 30-day opt-in collection on 18 October 2026. Keep analytics
Off until owner enablement; every visitor must accept its notice. Choices are
7/30/90 days; owner settings do not override visitor consent. Network hints also
require explicit trusted proxy peer addresses in protected `service.json`:

```json
{"analytics":{"maxSiteRows":50000,"maxRows":500000,"reportRows":20000,"trustedProxyAddresses":[]}}
```

Leave the address list empty until actual proxy topology/headers are verified.
Never trust an arbitrary caller's X-Forwarded-For. The service uses only the
last validated forwarded address from an explicitly trusted peer and retains
only a rotating coarse-network hint, never that raw address in analytics.

Reproducible isolated checks:

```sh
node --test test/pairing-governance.test.mjs test/visitor-analytics.test.mjs test/analytics-session-client.test.mjs
node test/owner-analytics-browser.mjs
node test/analytics-capacity.mjs
```

The browser harness creates its own temporary database and loopback API,
synthetic owner authentication and synthetic visitor data. Its website remains
127.0.0.1:4194. It does not turn on analytics for the real laptop registration or
public flolah.cloud, and does not prove fresh real-owner/DNS onboarding. Its
screenshots/results are separate from the historical feedback evidence.
The capacity script measures 25 isolated registrations/25 concurrent clients,
5,000 event writes and 25 authenticated owner reports over loopback HTTP. It
checks domain isolation and TTL cleanup; it does not certify model/OCR latency,
sustained load or multi-coordinator HA. Keep the coordinator replicas=1 with
SQLite and the existing resource-capped parser workers.


Validation on 18 October: runtime `20261018-owner-analytics-d` is deployed;
source/evidence publication `20261018-owner-analytics-e` carries the consolidated
report and updated checks. Runtime D passed 221 application tests in a separate
one-CPU/one-GiB container without production data mounts. Actual owner-console
UAT exercised pairing/analytics in B; D adds immediate owner-transfer isolation,
owner cooldown
feedback and named telemetry. Local analytics is enabled at 30-day retention,
network hints Off; both public registrations remain Off. The synthetic group
used for live expiry extension/revocation was removed. No preview lifetime was
extended. The actual public opt-in preview expires 15:17 Singapore today.

For the assisted live browser harness, choose a fresh `ADOPTION_OWNER_LIVE_DIR`
file URL for every run. It waits for operator files `enabled`, `extended` and
`revoked` only after those actions have visibly succeeded in the authenticated
owner UI. It refuses old flags; never seed flags as a replacement for UI checks.
The ordinary isolated browser harness needs no real owner authentication.


Public preview renewal requires an explicit duration approval. The operator-only
`renew-site-preview.mjs` accepts the existing exact HTTPS origin, 1–168 hours
and an audit reason. It renews only an existing isolated registration tied to a
currently approved verified parent. It preserves task/analytics permissions and
publishes a browser-visible installation token only for that origin. It neither
exposes the laptop nor enables workflows. The loader now distinguishes expired
previews/configuration errors from retryable download failures; an expired
preview requires owner renewal and a page reload.


Current preview runtime: `20261018-preview-expiry-f`; source/evidence publication
`20261018-preview-expiry-g`. At 15:57 Singapore on 18 October, explicit user
approval renewed the same isolated flolah.cloud preview for 168 hours, ending
25 October 2026 at 15:57 Singapore. Both installation and public-manifest expiry
were updated. Workflow/analytics permissions were preserved; no laptop exposure.
The existing MCP tab visibly opened the copilot after reload. All 225 regression
tests pass locally and in the deployed image. Earlier six-hour expiry statements
above describe historical checks and do not represent this renewed lifetime.
