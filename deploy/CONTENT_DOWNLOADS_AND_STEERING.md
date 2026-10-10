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
Also run `npm run test:slash-commands` in backend for command parsing, replay,
governance boundaries and native WhatsApp command handler regression checks.

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

## Shared UI and WhatsApp slash commands

Type `/` in the existing chat message box to open the inline skills/tools/steer
picker above the composer (not a modal). Header New chat, Steer work and Commands
are icon buttons with tooltips; the Commands icon opens the same picker. Selection prepares
the existing message box; Send/Enter runs the command. Typing a command is not a new
LLM turn. Select a ready assigned skill or click a tool's `Use for task` to pin it
to the next request to this agent; describe the task and Send. Tool selections are
validated server-side and retained in the session's tool shortlist. The runtime
must call the selected tool or explain missing inputs, approvals or another blocker;
responses with no matching invocation are explicitly marked unverified. Selection
does not grant tools or authorize external actions. For an exact direct invocation,
`Prepare direct command` fills JSON arguments in the same composer; Send/Enter
dispatches it without an LLM turn. Commands icon preserves an existing task draft.

Use these same commands in a **private** WhatsApp conversation with the agent:

```
/flolah
/flolah skills
/flolah skill <assigned-slug> <request>
/flolah tools download
/flolah tool download_file {"url":"https://example.org/report.pdf"}
/flolah steer
/flolah steer goal:<exact-id-from-list> Cite primary sources for remaining work.
/flolah steer status goal:<exact-id>
```

Core OpenClaw reserves `/steer`, so the plugin registers only `/flolah`; it never
overrides core steering. The native command handler runs before the LLM and
returns `continueAgent:false`. Bare `/` and `/tools`, `/tool`, `/steer` aliases are
accepted by the UI command API, not installed as WhatsApp aliases.

The broker requires a private socket, no forwarded request, broker credential,
enabled tenant-agent WhatsApp account binding, matching session prefix and a
sender mapped uniquely to an active company CEO or CEO Delegate with agent access.
Groups, unknown senders, other tenants and ordinary employees are denied.
No command argument can supply owner/caller identity or an approval token.
The menu also shows enabled active assigned skills, version and missing
capabilities. Skill selection prepares the next chat request, not a tool call or
new goal. UI Send validates skill IDs and current readiness server-side, pins
authoritative instructions for direct chat and includes scoped skill references
in routed goal context. User selection is distinct from reported runtime use.
WhatsApp `/flolah skill` returns the validated next command `/skill <slug> <input>`;
that existing core skill command starts a normal agent request using its synced
workspace skill. For an ongoing platform goal/task use `/flolah steer` instead.
Tools must be enabled and granted to the selected agent and use canonical
`/api/tools/invoke` with an owner/actor/agent/session/tool-scoped lease. This is not
a shell or a way to call every unrestricted gateway/native tool.

UI submissions retain a request key and durable tool receipt; lost/unfinished
responses are not automatically repeated. Native gateway contexts currently lack
an inbound message id, so separate WhatsApp sends are separate requests: do not
resend a mutating command after a timeout before checking execution logs.
Steering names an exact active target; schedules receive guidance for one next
fire, and delivered guidance is not a guarantee it was applied. Existing running
WhatsApp LLM turns without a platform work id are not invented as steer targets.

Standard and scoped backend/OpenClaw Dockerfiles copy the command route, services
and plugin helper; frontend builds include the menu. Reload the gateway plugin
after a safe idle check. No new packages, scanner settings or public ports needed.

## Acceptance checks

Verify existing real chat tables, a clean PDF and a generic file attachment,
the clean scan badge, and authenticated download isolation. Use EICAR only as
an explicit benign antivirus test: assert rejection and no persisted file.
Test scanner outage fail-closed. Queue a bounded steer in a test work unit and
verify delivered once at a checkpoint without restarting it. Gate-blocked report
URLs remain explicit failures; never substitute another report silently.

### Interactive production acceptance — 10 October 2026

The web chat composer `/` picker selected the assigned
`ibkr-portfolio-strategy-sme` v4 skill for a read-only acceptance request.
The resulting reply displayed the runtime-confirmed skill badge and successful
canonical strategy-status, instrument-readiness and decision-history tool badges.

A separate bounded read-only chat received guidance through the **Steer work**
icon, targeting its exact active work id. The guidance history reported delivery
at `tool_result:ibkrnew_paper_instrument_readiness`, and the final reply included
the requested `STEER_CONFIRMED_OCT10` marker. It did not fully honor the requested
two-sentence limit: delivery and this marker demonstrate receipt/application of
that instruction, not guaranteed compliance with every part of a steer note.
Earlier short tests ended before delivery; the UI correctly reported not-applied
guidance or rejected the ended target instead of restarting or carrying over work.
No trading actions or configuration changes were requested by these tests.

Regression checks passed: `test:slash-commands`, `test:agent-skills`,
`test-work-steering.mjs`, frontend `test:chat`, and the frontend production build.
This does not constitute a real-handset WhatsApp acceptance test.
