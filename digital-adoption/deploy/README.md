# Build and VPS setup

Run the application tests from `digital-adoption/` with Node 22 or newer:

```sh
npm ci --ignore-scripts
node --test --test-concurrency=2 test/*.test.mjs
```

The Python extractor also requires the packages in `requirements.txt` and the
system utilities installed by `Dockerfile`. The image builds an offline English
speech model, so the image build needs network access; running parsers do not.

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

## Current validation boundary

Release `20261017bk` has 174 passing local tests and 174 inside its VPS image,
plus live API and scoped local/public browser evidence. The synthetic backend
pilot passed 25 website indexes and 25 concurrent sessions, 500 documents, 750
searches and 50 parser jobs. Search p95 was 178.5 ms and full model-answer p95
8.59 seconds; this is a short pilot, not sustained or cross-host HA certification.
Full Phase 1/2 acceptance remains partial, with the previously recorded device,
accessibility, lifecycle and other formal-case limitations still applicable.
