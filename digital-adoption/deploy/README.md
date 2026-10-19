# Build and VPS setup

19 October 2026: the immediate-phase implementation is available on coordinator
**20261019-immediate-j**, with gateway/platform changes from
**20261019-immediate-j**. See the [acceptance and regression report](../test/evidence/immediate-phase-20261019/index.html)
for executed-suite pass rates, screenshots, all 32 requirement families,
remaining partial gates and recommendations. Executed checks and full Phase 1/2
certification are reported separately.

## Checker reliability release — 19 October 2026

Merged source baseline: `9579893d`. Checker gateway and Admin API/UI images:
`20261019-checker-reliability-d`. This incremental release does not implement or
certify the separate immediate-phase design. The current coordinator/retention
runtime and workers were preserved, as were the production checker selection,
4-CPU/4-thread Ollama configuration, concurrency one and approval policies.

Publication note: a separate worktree subsequently deployed the parallel
`20261019-immediate-e` platform/gateway release on this checker baseline. The
image IDs and evidence in this section describe the checker verification, not
the current platform-wide release. Do not roll back that parallel release when
publishing these source changes; its additional source belongs to its own merge.

Admin → Models (also Admin → Digital Adoption) now offers an independently
selected registered private local checker, a thinking option and an explicit
128–2,048 output-token budget. Existing
inactive-platform and legacy reasoning routes remain supported. No model name
is embedded in the new selector. Capability discovery prevents unsupported
thinking requests; the requested token budget is no longer silently raised to
2,048. A configured deployment is not proof of model quality or availability.

Reviews use a bounded dedicated task/evidence contract, structured task-match,
grounding and safety checks, typed checkbox semantics, deterministic explicit
assignment/advice-only checks and conservative named-subject citation binding.
These guards do not establish general factual entailment or replace approval.
Contradictory, incomplete or unavailable reviews remain fail-closed. Diagnostic
logs use generated trace IDs, typed categories and timing/token counters; they
do not contain prompts, credentials, provider error bodies or reasoning text.

Reproduce with `checker-release.py prepare <release>` and activate only the
tested candidate with `checker-release.py activate <release>`. The source archive
must include the selected files, Dockerfiles, generated form inventories and
tests. Images derive from captured live bases and retain the complete Compose
overlay chains; activation aborts on concurrent changes and rolls back on failed
readiness. `--gateway-only` retains already verified API/UI images for a typed
review-contract update. Do not patch files inside running containers.

The final image passed all **283** service checks and the Admin authorization /
model-selection harness. The frontend production build, a mocked-transport UI
interaction test and a real deployed Admin browser/API test also passed. The
live test changed only unsaved UI drafts and rejected an unknown model ID;
production model selection was not changed. The existing DeepSeek checker was
retained with the tested 1,536-token budget. The real local customer-page test
against the deployed gateway returned a checked Express-shipping proposal in
49.0 seconds, HTTP 200, with zero host writes and the field unchanged. Approval
and Save were never clicked.

The [synthetic comparison evidence](../test/evidence/checker-reliability-20261019/model-comparison.json)
records 11 same-case pipeline checks per model on the shared 4-CPU/4-thread VPS:
DeepSeek R1 8B passed 11/11 with thinking and 1,536 tokens; Llama 3.2 passed 10/11
without thinking and with 700 tokens. Both accepted all five valid original
proposals; neither released an invalid original proposal after code safeguards.
Llama produced one contradictory verdict, safely blocked as an error rather
than counted as a clean rejection. Median elapsed time across the eight
model-involving cases (including the first cold-load case) was 36.364 seconds
for DeepSeek and 4.041 seconds for Llama. The three code-only cases per model
are not model-accuracy samples. These are different explicit operating profiles,
not an equal-token or raw-judge benchmark; the maker/revision fixture is synthetic.

Recommendation: retain DeepSeek for now for its clean verdict outcomes on this
small suite. Llama remains selectable for latency-oriented evaluation, but its
contradictory verdict prevents claiming equal reliability. This is a smoke test,
not a broad quality certification or proof for every form or production load.
Keep user approval and review-stop behavior enabled regardless of model.
The [Admin test](../test/evidence/checker-reliability-20261019/admin-live.json) and
[customer test](../test/evidence/checker-reliability-20261019/customer-live.json)
record the final deployed checks without private prompts or credentials.

## Earlier workspace deployment evidence

Latest deployment (18 October 2026): independent runtime **20261018-owner-workspace-c**, platform **adoption-20261018-maker-checker-c** (unchanged), source/evidence publication **20261018-owner-workspace-d**. Owner and account management now use a persistent website selector and seven focused tabs. Searchable bounded pages replace silent list caps; workflow editors and map details render on demand.

All **260** service checks pass locally and in the final VPS image. **10** isolated browser cases and **6** analytics/pairing scenarios pass. The one-CPU/1-GiB VPS fixture served **500 requests from 25 concurrent clients across 25 websites**, with zero errors and **115.84 ms p95**. This measures management HTTP/SQLite with synthetic authentication, not external platform authentication, LLM capacity or WAN latency. The [workspace testcase table and screenshots](../test/evidence/owner-workspace-20261018/index.html) distinguish live administrator checks, isolated owner checks and the expired live email-owner session. Full Phase 1/2 device certification remains outside this incremental result.

At the 18 October checkpoint global maker/checker was **Off**. Current Admin
settings were preserved. Immediate-phase canaries use a process-local passive
checker with a 2,048-token verdict budget. Its earlier [admin/review evidence](../test/evidence/admin-maker-checker-20261018/index.html) retains the optional local Ollama timeout and broad-agent coverage limitations; this workspace release does not recertify those cases.

The global maker/checker feature was **Off** after the 18 October UAT and was explicitly enabled with the local Ollama reasoning checker on 19 October. Its earlier [admin/review evidence](../test/evidence/admin-maker-checker-20261018/index.html) retains the optional local Ollama timeout and broad-agent coverage limitations; this workspace release does not recertify those cases.

The 19 October timeout update gives the complete gateway operation 180 seconds,
including cold model loading and bounded revisions. Client, widget and scoped
proxy deadlines are aligned as documented in [scaling](scaling.md). Deploy the
runtime and gateway together with `web/model-timeouts.mjs`, then update both
existing Nginx locations with `update-nginx.mjs`, syntax-test and reload Nginx.
This does not change CPU, inference threads, concurrency, models or review policy.

19 October verification: all 262 local regression checks passed. The synthetic
customer-page cold test still failed closed at 180 seconds, with no host writes
or changed fields. Ollama reported roughly 81 seconds of model startup. A warm
browser retest received no final HTTP response; the gateway logged a provider
failure after about 51 seconds. A separate minimal direct reasoning request also
exceeded 180 seconds. These results do **not** certify local checker availability.
The observed 2-CPU/2-thread inference used approximately 200% CPU and 6.6 GiB RAM.
Benchmarking 4 CPUs with 4 threads is recommended before further deadline changes;
resource settings and the explicitly enabled review policy remain unchanged.

Later on 19 October, the user approved the resource benchmark. The persistent
deployment now uses 4 CPUs shared by both local models, 4 inference threads in
the backend and checker gateway, and unchanged checker concurrency one. Current
images were retained: this is a Compose/environment configuration release, not
an in-container source patch. The same browser retest returned HTTP 503 after
180.258 seconds, with zero host writes and unchanged fields. Model startup was
9.3 seconds and observed inference CPU was about 396%; the checker remains
operationally unverified. See the tracked resource overlay and deployment runbook
under `deploy/` for reproduction; do not infer successful checking from CPU use.

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
cannot recover private task authority or keys. Extracted passages now use
`adoption-private-tasks-v1-*` hourly OpenSearch indexes under the verified 24-hour
ISM policy; retained text survives task ending but cannot be retrieved through
an inactive task. End task does not synchronously delete indexed passages. ISM
operates periodically on index age. Exclude this prefix from search snapshots
and exports; application checkpoint retention does not manage search indexes.
See `scaling.md` for privileges, monitoring and the physical-cleanup timing.
Provider-side processing follows
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

Intent runtime `20261018-agentic-j` and platform `adoption-20261018-agentic-b` preserve the seven-day opt-in preview expiry above. No model selection, website identity, public workflow permission or laptop exposure was changed. The platform candidate merged the exact deployed source before building. An isolated policy regression verifies reviewed binding categories, stricter explicit mappings, the binding floor and conservative unbound submissions. All **240** service tests pass locally and in the final deployed image; the isolated real workflow-runner regression also verifies private effect values do not enter stored workflow outputs.

Run 4066 completed all 10 workflow nodes on runtime H and saved the three synthetic local records, independently verified against the host records DOM. The published workflow reuses the same saved group across runs. Three fills used the explicitly approved workflow-specific temporary grant; three Saves used owner-reviewed bindings and the internal-write policy. Zero temporary overrides remain after cleanup. Run 4064 and the interrupted run 4065 remain historical attempts. Runtime J adds generic semantic-choice behavior and a whitelisted command-status contract; this does not retroactively rewrite historical synthetic audit output.

Source/evidence publication: `20261018-agentic-k`; runtime stays `20261018-agentic-j`, platform `20261018-agentic-b`. The [closure UAT table and screenshots](../test/evidence/workflow-closure-20261018/index.html) record **29 passed, 1 partial and 0 failed current cases**, including seven live intent cases and three independently read persisted records. The [earlier report](../test/evidence/intent-workflow-20261018/index.html) remains immutable. This is incremental closure, not full Phase 1/2 certification. No Docker dependencies or service topology changed: the existing source/web copy rules include these modules. Archive K publishes final source, docs and evidence; the tested runtime remains J.


### Global maker/checker admin control

Admin → Models & routing → Digital Adoption copilot review provides a persistent, platform-wide enable switch. The default is Off, preserving maker-only behavior. When On, all website copilot model plans and knowledge/private-task answers use the active platform slot as maker and the inactive slot as checker. Deterministic field/navigation proposals also consult this policy. Explicit owner-bound Save execution remains governed by Action Policies rather than an LLM granting permission.

The checker accepts, requests at most one revision, asks for clarification, or rejects. Revised proposals are checked again and validated against observed controls. An unavailable, invalid or timed-out checker stops the response with a specific no-change message; there is no maker-only fallback while enabled. The optional “Ollama reasoning (efficiency)” checker route uses the registered local reasoning deployment and native thinking/JSON output, with no hosted fallback. This is an explicit global copilot route, independent of users’ unrelated utility efficiency preferences. No model IDs or provider credentials are accepted from websites or visitors.

Settings are stored in the platform database, apply on new requests without a restart, and survive deployment. Admin-only GET/PUT `/api/admin/copilot-quality` validates booleans and supported checker routes. Model prompts, private values, reasoning traces and secrets are excluded from the operational review log; it records only purpose, slots, decision, revision count and duration. See deployment scaling guidance for the bounded local reasoning budget.


Admin → Digital Adoption websites (`/admin/digital-adoption`) restores the platform-wide registration overview across owners. It uses the existing validated platform identity at the independent management service, with an admin-only inventory projection, server-side search/status filters and bounded pagination beyond the legacy 100-row management listing. Installation credentials, DNS challenges, action bindings, chat/document contents and private visitor data are excluded from inventory rows. Owner IDs identify website-owner registrations, not an automatic entitlement to another user’s workflow session. The “Manage website” link opens the existing console scoped to that authorized registration; owner email sign-in remains owner-scoped. The global review control is also available on this page.

The final platform C update only improves the admin registration table layout; the tested independent service remains B. Scoped source merges retain the exact deployed frontend lineage. A reviewed single-line API merge resolution during B preparation is retained on the VPS; no unrelated service or company policy was changed. Ollama native transport follows [thinking](https://docs.ollama.com/capabilities/thinking) and [structured output](https://docs.ollama.com/capabilities/structured-outputs) interfaces, but interface support does not establish adequate latency for the configured model.

## Workspace capacity configuration

`prepare-config.mjs` now defaults `capacity.managementPerIp` to 600 and `capacity.managementPerActor` to 60 requests/minute, preserving private overrides. The network ceiling covers a shared reverse proxy/NAT; the second limit is applied after authentication, per trusted actor. Owner login/code traffic retains a separate 30/minute network bucket. No IP forwarding headers supply an authenticated identity. Both limits remain coordinator-local; multiple API coordinators require a shared-budget implementation first.

The existing Dockerfile copies all management CSS/modules through `COPY web`, so no extra build/runtime dependency is needed. Management CSP permits same-origin CSS; authenticated HTML and API responses remain uncached. Deployment retains consistent data/config checkpoints under the existing seven-day automatic expiry policy. No new backup mechanism is added by this UI release.

The final fixture benchmark runs in `flolah-digital-adoption:20261018-owner-workspace-c` with `--cpus 1 --memory 1g`, no production data mount, 25 synthetic owners/websites and 25 HTTP clients. Results do not establish model, parsing or external authentication throughput. Current production parser replica count remains two.

## Scoped private-retention rollout

The normal installer builds the current source, including private search startup
provisioning. For a scoped update, `private-retention.Dockerfile` inherits the
captured live image and replaces only retention-related modules. The release
helper `private-retention-release.py prepare RELEASE_DIRECTORY` three-way merges
those modules using `_base/` Git copies, runs isolated regressions and real-search
synthetic acceptance, and captures the live container identity. `activate` refuses
a changed container, retains a database checkpoint and recreates only the
coordinator with a health-checked rollback. Model settings, gateway and parser
workers stay unchanged. Search policies/indexes are additive and are not erased
by image rollback; they continue retention cleanup.

Release 20261019-private-retention-d uses the existing private search connection
and 24-hour policy. Full service regressions: 273 passed. Real OpenSearch cases:
7 passed. Scoped browser cases: 5 passed. The earlier 90-second checked-summary
timeout is retained as failed evidence, and elapsed retention deletion is pending.
See `test/evidence/private-retention-20261019/index.html`.

## Immediate-phase scoped release

Package with `package-immediate-phase.py RELEASE --base-ref COMMIT`. Upload and
unpack under `/opt/flolah-digital-adoption/releases/RELEASE`, then run
`prepare-immediate-phase.py RELEASE`. It captures immutable bases, runs the full
Linux regression and builds the merged platform frontend, preserving the exact
source of a concurrent checker release. `install-immediate-phase.py` and
`install-platform-connector.sh` perform separate guarded activations.
For a coordinator-only correction use `prepare-immediate-phase.py RELEASE --coordinator-only`;
its installer leaves gateway, platform and parser replicas untouched.
`verify-immediate-phase.py RELEASE` checks images, untouched services and health.

After both coordinator/gateway and platform activation, run
`publish-immediate-help.py RELEASE` to publish the shipped platform help and
verify exact indexed hashes plus workflow/map-context retrieval. The package
includes the two verification helpers separately; the runner does not assume
they are present inside an older backend image. No visitor knowledge is changed.
The map-context release adds no runtime configuration keys or database schema:
annotations use the existing website/audience-scoped source-map records.
`export-immediate-evidence.py` is the allowlisted October acceptance export;
runtime configs and overrides must never enter public evidence archives.

The gateway overlay changes only the generic assignment helper and mixed-instruction
review guard on the captured checker/provider image. Admin model settings are not
changed. Preserve action/command replay fences; use repair forward when an older
runtime would ignore those fences.
