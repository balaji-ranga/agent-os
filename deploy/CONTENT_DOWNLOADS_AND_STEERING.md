# Chat content, scanning and steering

## Build and setup

The frontend supports Markdown formatting, pipe tables, sanitized HTML tables and
authenticated Markdown/PDF file previews. HTML tables never execute scripts.

`download_file` is the generic public HTTPS download tool; `download_pdf` is a
compatibility alias requiring a complete PDF. Downloads are capped at 25 MiB,
DNS-pinned and checked at every redirect. No login, form or paywall bypass.
Owner identity is authenticated server context, never a model argument.

Run `npm run test:chat` and `npm run build` in frontend. In backend run
`npm run test:pdf-download`, `npm run test:content-antivirus`,
`npm run test:work-steering` and `npm run test:ssrf`.

## VPS deployment

Canonical VPS scripts include `docker-compose.content-antivirus.yml`, including
when an older COMPOSE_FILE override exists. Keep base/browser/vps-client-ip and
docker-tools overlays. Start `content-antivirus` before recreating backend.
The official ClamAV image is digest-pinned; update the pin deliberately after
testing. The service has a 4 GiB cap, private Docker network and no host port.
The named signature volume persists updates; Freshclam requires internet egress.
Never upload files to a third-party scanning service.

Only recreate backend/frontend/OpenClaw after checking active work and keeping
rollback image tags. Backend contains the download/scan/steer APIs; OpenClaw must
reload its tool plugin to discover newly added tools. Standard Dockerfiles copy
the source and plugin; no new Node runtime dependencies are required by scanning.

## Security and UI outcomes

The backend streams in-memory bytes to private clamd using INSTREAM. Signatures
must be at most 72 hours old; missing/stale signatures, timeout, infected content,
encrypted documents and archive limits block attachment delivery. Clean bytes
only are persisted in owner-private `media/downloads/<owner>/` with an ownership
record. Rejected bytes are cleared from memory; no content or quarantine copy is
written to VPS. The audit table retains only owner, hash, byte count, scanner
version and outcome, never rejected file bytes. This does not retroactively scan
or delete pre-existing content and does not guarantee a clean file is harmless.

Chat activity displays download, scan and clean/rejected phases for the exact
authenticated active turn. Completed tool details retain the scan outcome.
Generic downloaded files use download-only cards, not executable HTML previews.
PDF/Markdown previews are separate from summarization or RAG ingestion.

## Non-interfering guidance

Steer work queues owner-scoped guidance for an exact active chat, task, goal or
schedule run. Recurring schedules accept guidance for the next run only.
Delivery occurs at the next platform checkpoint; it never aborts or restarts an
agent, changes the original work request or implies the guidance was applied.
If work ends first, guidance is marked not applied. Expired notes do not carry
over to new work. Existing permissions, risk limits and approval rules remain.

## Acceptance checks

Verify existing real chat tables, a clean PDF and a generic file attachment,
the clean scan badge, and authenticated download isolation. Use EICAR only as
an explicit benign antivirus test: assert rejection and no persisted file.
Test scanner outage fail-closed. Queue a bounded steer in a test work unit and
verify delivered once at a checkpoint without restarting it. Gate-blocked report
URLs remain explicit failures; never substitute another report silently.
