# Platform steering completion boundary

Steering does not re-run routing or planning, create work, change an approved plan,
grant tools/actions, bypass approvals/risk controls, or change trading mode.

The shared OpenClaw gateway boundary looks up the trusted registered execution
context for chat, delegation, goal agent steps and scheduled agent runs. Unsteered
calls retain the same messages and do not incur a coverage-model call. Delivered
guidance is repeated at subsequent content-tool checkpoints and checked against
the current assignment, final response and owner/session-scoped execution ledger.

Missing coverage permits at most two same-session continuations. Their temporary session
scope only allows existing granted connector discovery/guide/read actions and
web research. The OpenClaw before-tool-call hook blocks native tools and the
backend Action Control boundary independently blocks non-read connector actions.
Normal execution tools/scopes are restored in `finally`. Unknown actions deny.
Failed validation is explicitly unverified, not applied. Remaining omissions are
reported in the reply; no unbounded retry is performed. Model coverage verification
is evidence-based, but is not a deterministic guarantee of answer correctness.

The checker uses the configured independent (secondary) endpoint of the existing
maker/checker pair, with bounded JSON output and thinking disabled. It does not
change the platform's Active Slot, agent model, or router/planner configuration.
The current assignment comes from the registered execution context, not every old
user turn. Correction receives compact scoped receipts, preserves system constraints,
and omits stale conversational turns. Duplicate provider JSON/highlight metadata is
removed without inventing facts; truncated evidence remains explicitly partial.
If the agent still repeats an incorrect draft, one tool-free text repair on the
configured checker endpoint can reuse scoped successful evidence. It is checked
again before settlement, cannot satisfy missing tool prerequisites, and cannot
claim unexecuted actions. Failure remains not-applied/unverified; no retry loop.

## Chat rendering isolation

Content-tool logs include trusted `_work_unit_id` as well as `_chat_turn_id`.
Linked replies use the owner's exact work start through reply time for older
untagged receipts, without the historical future-time pad. Explicit work linkage
wins; another work's calls are never borrowed. Pre-linkage legacy history retains
its compatibility time window. Goal cards render explicit answer references,
successful goal creation, or exact status requests; a goal-list result alone never
creates cards for unrelated goals. This does not delete or alter existing goals.

`work_steering` adds nullable `resolution_json` and `source_note_id` columns safely
on first store use. Existing rows and work/plan identifiers are retained. Schedule
guidance is copied only into its next fire and associated goal, with linked outcome
status; it is never permanently appended to the schedule. Resolved source notes
must not be copied into subsequent fires.

## Build / release

- Run `npm run test:work-steering` in backend, the focused router/planner suite,
  command/owner isolation, execution-governor and action-policy regressions.
- Run `npm run build` in frontend. Standard Dockerfiles already include shared
  templates and plugin files; no new container or secret is required.
- Run `npm run test:chat-work-units` in backend and `npm run test:chat` in frontend
  to verify work-scoped attribution, Markdown/HTML tables and legitimate goal cards.
- For a scoped production update, capture currently deployed backend source and
  plugin/templates before overlaying reviewed files. Do not replace a dirty VPS
  checkout wholesale with an older repository snapshot.
- Build backend, OpenClaw and frontend images; run steering tests in the built
  backend image. Activate the OpenClaw plugin guard before the new backend.
- Standard/scoped Dockerfiles normalize plugin directories to 755 and files to
  644. Windows-created archives can otherwise carry mode 666 and OpenClaw refuses
  world-writable plugins. Verify the registered plugin, not only container health.
- Keep all three previous image IDs tagged for rollback and wait for healthy
  containers. Reload nginx after backend/frontend IP changes.
- Verify a live read-only COO run with mid-run guidance and the persisted note
  resolution, tools and unchanged work ID. UI/WhatsApp commands share the durable
  steering store. Never send a real WhatsApp message or modify a real goal merely
  to exercise channel/state tests.

Frontend displays queued/delivered, applied (coverage verified), acknowledged
(blocked/conflicting/deferred), not applied and unverified distinctly. Application
must not be inferred from delivery or a generic acknowledgement.

## Verified release — 10 October 2026

At 18:14 SGT, a deployed owner-scoped COO read-only chat discovered the news
connector from context. Mid-run guidance added fintech to the same work
`wu-72949fc4-8541-4ca8-9d39-735f437e2462`; routing stayed direct-tool, new-work,
restart=false. It read the action guide and retrieved eight stories across four
valid newest-first pages. The final answer separated AI and fintech, returned two
AI stories with truthful submission-date/action-ID provenance, and explicitly
reported no qualifying fintech story in that narrow slice, not global absence.
Note `16ab2d07-dcc0-4dc2-8a9c-939f882c0151` settled applied at 18:14:56 SGT.
The browser showed "Applied — completion coverage verified". Both the affected
historical news reply and final reply excluded unrelated goals and old downloads.

Passed regressions: durable steering/one-fire schedules, completion/repair and
read-only boundaries, contextual connector discovery/execution policy, chat tool
attribution, Markdown/HTML tables and goal references, focused router/planner,
goal orchestration, action policy, execution governor, slash commands/private
WhatsApp identity and replay contracts, Gmail reads, antivirus gates and channel
capability refresh. Frontend production build passed. WhatsApp and real schedule
fires were not sent/run in production; those checks used isolated fixtures.
