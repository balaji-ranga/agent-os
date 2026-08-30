# Human + AI Company Communications and Execution

## Outcome

Flolah treats human employees as first-class company participants alongside AI employees. People can privately chat and make browser WebRTC voice calls, while orchestrators can assign a bounded goal step to the best matching human when knowledge or judgment is required. The goal does not stop at an unstructured acknowledgement: a human outcome is correlated to the exact goal run and step, then execution continues.

## One-phase implementation

- Add owner-scoped human directory metadata: department, role, specialty, purpose, web chat, and voice availability.
- Add owner/participant-scoped direct conversations, message history, unread state, archive state, and notifications.
- Add short-lived, opaque voice invitations and REST signalling for browser-to-browser WebRTC. Audio is peer-to-peer; Flolah stores only call state and signalling metadata.
- Add an always-available, minimizable COO chat dock without changing the existing COO chat execution path.
- Add work-assignment policy: equal weight, prefer AI, prefer human, or route matched high-risk judgment to a human.
- Let the goal planner semantically score overlapping capabilities against the live tenant roster. The deterministic policy—not a keyword rule—makes the final executor choice.
- Create an assigned human Kanban card bound to `owner_user_id + goal_run_id + goal_step_id` with complete original goal, relevant prior I/O from that goal only, and the assigned deliverable.
- Provide explicit **Complete task**, **Unable to complete**, and **Ask a question** actions. Completion resumes the exact goal; a question pauses visibly; inability returns the blocker to the orchestrator without an automatic human retry loop.
- Expose the safe human directory to COO through `ORG.md`. `voice_call_invite` accepts an exact human `user_id`/`user_name` only for COO and returns a new short-lived link without exposing contact details or credentials.

## Assignment decision

1. Build the plan from goal intent and executable capabilities.
2. For each specialty outcome, semantically compare the task with enabled human roles, specialties, and purposes in this company.
3. Ignore weak matches. If both AI and human are credible, apply the owner-scoped work-assignment policy.
4. Persist the selected executor and rationale in the plan before execution.
5. Keep every delegated AI or human step isolated by goal run and goal step.

High risk means financial commitments/costs, legal or regulatory decisions, destructive operations, or binding external commitments. It does not mean every finance-related lookup.

## Practical scenario: overdue invoice collection

The CEO asks the COO to resolve an overdue invoice. An ERP AI employee can retrieve the invoice and payment facts. A human Collections Manager is configured with the specialty “overdue invoice collections.” With `risk_to_human`, the planner keeps data retrieval with AI and assigns customer negotiation or financial judgment to the human. The human records the promised payment date and any commitment in Kanban, clicks **Complete task**, and COO receives that structured outcome for the terminal CEO report.

## Security and lifecycle

- Every row is owner-scoped; conversations additionally require participant membership.
- Cross-owner reads, writes, calls, and task responses are rejected.
- Invite tokens are random, stored as SHA-256 hashes, expire in at most one hour, and contain no user identifiers or credentials.
- Agent workspaces receive only safe directory metadata, never email addresses, phone numbers, credentials, or pairing material.
- Human task completion is an explicit authenticated event; arbitrary chat text cannot complete a goal.
- Existing agent chat routing, goal planning, browser recipes, workflow execution, and action-control enforcement remain unchanged outside the new executor type.

## Verification

`npm run test:human-company-execution` validates directory isolation, private conversation isolation, opaque voice invitations, policy selection, human Kanban creation, exact goal-step continuation, outcome persistence, and unauthorized completion rejection. The normal goal hardening, context routing, workflow contract, exception policy, action policy, browser recipe/routing, company operate, reviews, execution governor, and channel capability regressions must also remain green before deployment.
