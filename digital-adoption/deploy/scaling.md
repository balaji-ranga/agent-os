# Copilot capacity and recovery

Initial sizing target: 25 website registrations and 25 concurrent users in total.
This is a pilot envelope, not an unlimited-domain or sustained-load certification.
Each registration keeps its own index, audience policy, maps and workflows.

The private-task extension adds bounded in-memory tasks, live connections,
pairing groups, command outcomes and encrypted objects. `privateTasks` in the
service configuration overrides the validated engineering defaults: 100
connections/tasks, 25 group members, 200 retained commands, 256 MiB aggregate raw
transaction bytes, 16 MiB/file, four files/task and 64 MiB/task. Parser format
limits remain a hard ceiling. Owners may lower per-registration limits.
Anonymous pairing is not a physical-browser fingerprint.

Shared and private extraction alternate through a combined parser broker under
the same configured worker ceiling. Private leases and authorization stay ephemeral;
shared-help jobs retain their durable recovery behavior. Production extracted
passages are stored in separate hourly private-search indexes with 24-hour ISM
retention, not retained as full in-memory documents. Up to eight 1,800-character
passages are loaded per request. Partial context, task history and provider request
buffers still consume RAM. Raw upload, parser and request limits still apply.
Hourly indexes add roughly 24 small primary shards after steady-state cleanup;
that count is independent of website count. Measure OpenSearch heap/disk costs,
not just coordinator RSS. ISM delays can temporarily increase the shard count.
A private task cannot resume after coordinator restart. Browser commands are deduplicated per captured
recipient, and a possibly dispatched write with no proof returns unknown outcome.
Failed copilot workflow steps bypass automatic exception-policy replay and cannot
be turned into successful default timeout output.

The extension's synthetic loopback pilot used 25 registrations/users, 50 real
authenticated WebSockets, 25 UTF-8 files and two actual Python parser workers.
It completed extraction in about 3.6 seconds; local HTTP p95 was 2 ms and process
RSS about 74 MiB. This short run excludes LLM latency, real OCR concurrency,
external network/browser workloads and sustained soak. It does not establish
Kubernetes/multi-coordinator HA or replace public-domain acceptance.

The same workload in an isolated VPS container limited to 1 CPU / 1 GiB completed
25 extractions in 3.15 seconds and the complete probe in 3.62 seconds. Across 250
requests, HTTP p95 was 4 ms; process RSS was 90 MiB and event-loop p99 33 ms.
Its 50 captured fanout recipients completed and private bytes/cleanup backlog
returned to zero. See `test/evidence/private-capacity-vps.json`. These numbers
measure short UTF-8 extraction and synthetic policy/transport paths; they do not
measure 25 simultaneous production LLM/OCR requests. Workers remain capped at two
for this VPS; raising replica count requires matching broker limits and measured
CPU/memory/provider headroom.

## Current topology

One stateful API/coordinator owns the local SQLite WAL database, raw objects,
session authorization, admission budgets and publication into OpenSearch. Two
stateless document workers communicate with its authenticated private listener
on port 4196. Workers have no database/object-volume mounts or search/model
credentials. The Docker worker network is internal and the port is not published.
Only the coordinator fetches approved public help URLs; workers parse supplied
bytes with bounded CPU, memory, temporary storage and execution time.

An additional worker starting never resets another worker's healthy job. Claims,
fair scheduling and global/per-website active limits are transactional. A claim
expires after 90 seconds unless heartbeated, with a five-minute maximum attempt
lifetime. An expired job retries with bounded backoff, at most three attempts;
exhausted jobs remain visibly Failed for owner review and explicit retry. The
one-second recovery loop can claim expired work after the backoff. Coordinator
restart preserves leases and queued work. This is at-least-once execution with
fenced, idempotent publication, not an exactly-once execution guarantee.

Late results require the current worker ID, attempt ID and unexpired lease.
Search document IDs include source revision, so an old network write cannot
overwrite a different current revision. Retrieval also filters authoritative
source revisions and rechecks deletion/audience state after search. Retrying an
acknowledged completion returns the same Ready result. Incomplete URL objects
have durable cleanup records and are removed after their attempt lifetime.

## Configurable controls

The persistent backend-only `config/service.json` supports:

```
"ingestion": {
  "maxWorkers": 2, "perDomainWorkers": 1,
  "leaseMs": 90000, "maxAttemptMs": 300000,
  "maxAttempts": 3, "retryDelayMs": 1000
},
"capacity": {
  "modelConcurrency": 25, "modelPerDomain": 5,
  "searchConcurrency": 25, "searchPerDomain": 5
}
```

Set `ADOPTION_WORKERS` when installing/scaling Compose, and set the matching
coordinator `maxWorkers` limit. Increasing replicas alone does not bypass leases.
`ADOPTION_WORKER_CPUS` and `ADOPTION_WORKER_MEMORY` configure worker resource caps
(defaults 1 CPU and 1 GiB each). The installer preserves existing limits and the
worker credential. To rotate that credential, update both backend service and
worker Secret/config together, then restart only these independent services.

API concurrency overflow returns readable HTTP 429 with Retry-After before
conversation mutation. Model and search admission are independent, with global
and per-website limits. Existing per-minute request and upload/size quotas still
apply. Excess parser work queues durably; it does not launch unbounded parsers.

Authenticated private GET /status exposes job counts, oldest queued age,
active-worker ceiling and lease/retry settings without content or identities.
Monitor oldest queued age, Failed counts, 429/5xx rate, search latency/disk and
container RSS/CPU. Add workers when queue age exceeds the service target for
several minutes and memory/CPU headroom is available; do not scale solely on
queued count during a search/provider outage. Parser scaling does not increase
the upstream model provider's capacity. Keep reserves for shared VPS services.

## Kubernetes path and limits

The worker protocol supports separate hosts over HTTPS with a private endpoint,
worker Secret, NetworkPolicy and trusted TLS. Worker pods need only temporary
storage, that endpoint and the worker credential. Their deployment can scale to
the configured coordinator ceiling; allocate CPU/memory requests and limits.
Supply coordinatorUrl/token through `/config/worker.json`. Keep port 4196 out of
public Ingress and use HTTPS for every non-Docker remote endpoint.

**Keep the coordinator at replicas=1 with Recreate and a local/block RWO volume.**
SQLite WAL must not be shared over NFS or between Kubernetes nodes. Remote
workers work without shared database files. Multi-replica coordinator HA and
automatic cross-node state recovery require a separate migration to shared
transactional storage and object storage, plus shared admission budgets and
failover testing. They are not certified by this release.

OpenSearch currently has one primary and zero replicas per website. Provision
replicas only with sufficient data nodes. Track shard count/disk as registrations
grow; don't extrapolate the 25-website pilot to thousands of tiny per-site shards.
Old revision chunks are excluded from retrieval but can remain physically
stored. Disk compaction/reindexing and index lifecycle policy need operational
planning before sustained high-refresh deployments. Raw/extracted per-website
quotas and bounded source counts remain enforced.

## Reproducible validation

`node --test test/*.test.mjs` includes real OS-process workers, competing claims,
worker kill, coordinator restart, stale publication, delayed search write,
lost acknowledgement, heartbeat lifetime, exhausted retries, staged-object
cleanup, fairness and HTTP admission tests.

Run `node test/scaling-probe.mjs UNIQUE_LABEL` only in an isolated VPS test
container with read-only service config, a writable /evidence mount, and its own
temporary database. It creates 25 randomly scoped disposable indices, 500
synthetic documents, 25 sessions, 500 concurrent-search samples, 50 real parser
jobs with concurrent retrieval, and 25 simultaneous real model answers. It
deletes only those exact indices and terminates its sessions afterward. No
production authority database or objects are mounted. Test criteria: bootstrap
and retrieval p95 under 1 second, full-answer p95 under 30 seconds, event-loop
p99 under 100 ms, zero unexpected errors/leaks and 50 parser jobs under 120
seconds. This is a short pilot rather than a soak, saturation or browser matrix.

References: https://www.sqlite.org/wal.html and
https://www.sqlite.org/useovernet.html document SQLite's same-host WAL boundary.

## Guided-feedback pilot update (18 October 2026)

The independent H image repeated the isolated 25-site/25-user private-task
pilot under one CPU / 1 GiB: 50 authenticated sockets, 25 UTF-8 transaction
files, two parsers, 50 fan-out recipients and 250 HTTP samples. It completed
in 3.576 seconds with p95 HTTP 3 ms, RSS 89 MiB and event-loop p99 18 ms.
Cleanup reported zero tasks, private jobs/bytes and backlog. This short
synthetic coordinator/parser pilot excludes concurrent real LLM/OCR provider
latency and does not extend the earlier measured envelope to sustained load
or multi-coordinator HA. I changes only client constraint validation and owner
capability wording; no new backend scale claim is inferred. The JSON source is
`test/evidence/feedback-20261018/capacity-vps.json`.

## Copilot maker/checker capacity

The 19 October reliability release preserves concurrency one while allowing an
Admin-selected private registered checker. Native requests discover model
capabilities and respect their supplied completion budget, without the old
2,048-token floor. Compact review input preserves authorized task evidence and
typed-control semantics; it does not silently truncate oversized facts. See
`checker-model-live.mjs` for isolated same-case model measurements. Pure code
guard outcomes are recorded separately from actual model calls; latency and
accuracy results must not be extrapolated to concurrent production traffic.

Admin → Models → Digital Adoption copilot review exposes the registered local
deployment, model-supported thinking and an explicit 128–2,048 output-token
budget. The budget includes local reasoning and defaults to 700 when absent;
older valid configuration payloads preserve an explicitly saved budget. The
model gateway reads these settings afresh for each request. Changing this checker
does not rewrite general efficiency/reasoning deployments or provider keys.

For a reproducible comparison, run `test/checker-model-live.mjs` inside the
candidate image with the registered deployment IDs, a read-only platform volume
and a private model network. `CHECKER_TOKEN_BUDGETS` accepts a JSON map of those
IDs to explicit budgets; `CHECKER_TEST_TIMEOUT_MS` may not exceed 180,000. Keep
these profiles in the evidence: a reasoning model given more output tokens is
not an equal-token comparison. The harness uses a synthetic maker and cannot
certify a complete live workflow or general model accuracy.

The Admin review switch applies globally to new Digital Adoption model requests.
Disabled mode adds no checker inference. Enabled mode makes one sequential
checker call, with at most one maker revision and one final checker call. A
shared 180-second gateway deadline and client cancellation bound the entire
gateway operation; requests never fall back to unreviewed execution. This includes
cold model loading and all bounded maker/checker revisions, not 180 seconds per
attempt. The service client shares a 190-second budget across repairs; the widget
waits up to 200 seconds; model-dependent session requests allow 195 seconds,
while ordinary requests retain their 55-second budget. Scoped proxy budgets are 195 seconds (internal gateway)
and 210 seconds (public service). A longer deadline does not increase model
capacity, admission concurrency, CPU allocation or inference threads.

The optional local reasoning checker uses the registered `ollama-reasoning`
deployment, native JSON/thinking output and no hosted fallback. Its per-gateway
admission limit defaults to one request, with no waiting queue. Tune
`ollamaReasoning.concurrency` (1–16) in persistent `config/gateway.json` to the
actual Ollama host capacity; `threads` (1–8) defaults to two. Configuration
preparation preserves an existing custom concurrency value. Additional gateway
replicas multiply this local admission budget and must be sized against the
shared inference host. These bounds do not demonstrate 25 concurrent reasoning
checks or sustained model latency; benchmark the selected models before sizing.

## Private transaction search retention (19 October 2026)

Production startup verifies `adoption-private-task-24h-v1` and binds hourly indexes
under `adoption-private-tasks-v1-*`. A missing ISM plugin, denied policy permissions
or conflicting policy fails startup; private indexing failures stay failed and
do not fall back to a website help index or memory. Policy provisioning requires
ISM policy/read/add/explain privileges as well as index/bulk/search access to this
private prefix. Keep service credentials on the server. Shared website index
names and policies are unchanged. No additional database or worker is required.

The policy deletes whole indexes after 24 hours of index age. A later passage can
therefore be deleted before 24 hours of its own age. ISM runs periodically and
failures delay physical deletion. Application task authorization is revoked
immediately at End task; document `expires_at` is a secondary read cutoff, not a
native document TTL. Monitor managed-index failures and disk watermarks. Do not
include the private prefix in snapshots/exports; external backups have their own
retention and are not erased by End task.

Task-specific expiry is not a new visitor control. Existing server task safety
limits and independent pairing lifetime controls remain. Original upload objects
are still encrypted on disk and removed on task cleanup. A coordinator restart
loses task keys/authority and cannot recover access from the retained search text.

## Immediate-phase action guards

`execution.attemptRetentionMs` defaults to 86,400,000 ms (24 hours), bounded to
10 minutes–7 days. SQLite keeps only opaque action/scope/fence/outcome metadata;
indexed expiry maintenance removes old attempt rows. Missing/expired grants
remain invalid. Workflow-operation tombstones are separate, content-free replay
fences and are not removed by private-task End task or the search retention
policy. Do not delete them to recover a stuck command.

`capacity.modelDeadlineMs` bounds a model request (1,000–190,000 ms). Production
setup defaults to the shared 190-second service-client budget and advertises the matching client deadline plus
transport allowance. It is a ceiling, not an intentional delay or a latency
promise. The platform still selects maker/checker routes; unavailable capacity
fails closed without an unauthorized hosted fallback. Form effect segments keep
a separate 55-second ceiling, at most two continuation/repair stages after the
initial stage, and no uncertain-write replay.

Use `deploy/immediate-phase.Dockerfile` only against the captured running
coordinator image. Run Linux regressions with the disposable
`deploy/immediate-test.Dockerfile`. `install-immediate-phase.py` checks source
image identity, takes the usual consistent checkpoint and updates only the
coordinator. Its optional gateway overlay preserves the captured checker/provider
base and changes only the two generic intent/review guards. Parser replicas and
Admin model settings are preserved. Coordinator-only mode leaves gateway and
platform containers untouched. A rollback
must preserve action/operation fencing; prefer repair forward to starting legacy
code that ignores those guards. Standard Docker builds already copy all new
source and browser modules.

## Reference VPS Ollama resource change (19 October 2026)
The reference 8-vCPU VPS was changed on 19 October to a shared 4-CPU Ollama
quota and explicit 4-thread efficiency/checker requests, with checker concurrency
still one. The deployment environment, main Compose defaults and tracked resource
overlay preserve the setting; both models share the CPU quota. No image contents,
model selection, memory settings or review policy changed. The synthetic customer
browser retest still failed closed at 180 seconds, despite approximately 396% CPU
use and 9.3-second model startup. This resource change does not certify checker
availability or resolve the outstanding provider/inference failure.
