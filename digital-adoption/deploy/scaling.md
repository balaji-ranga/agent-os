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
the same configured worker ceiling. Private leases and plaintext stay ephemeral;
shared-help jobs retain their durable recovery behavior. A private task cannot
resume after coordinator restart. Browser commands are deduplicated per captured
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
