# AI Company OS execution maturity program

**Checkpoint:** `checkpoint/pre-ai-company-kernel-20260824` (`9c5bbae`)  
**Deployment rule:** source commit → tests/build → source sync → Docker build/up → VPS acceptance. Never patch a running container or leave a VPS-only hotfix.

This program strengthens seven product outcomes without duplicating foundations already shipped.

| Outcome | Existing foundation | Remaining work |
|---|---|---|
| Unified execution and verified outcomes | Goal plans, outcome observer, mission events, workflow/browser/Kanban histories | One owner-scoped execution vocabulary; typed evidence contracts at each side-effect boundary |
| Operate bootstrap | Phase D Day 0/Day 1 is implemented | Acceptance coverage, honest readiness, and connect installed loops to the unified execution view |
| Natural-language capability resolution | Business capability aliases, goal intent planning, recipe matching | Runtime registry across recipes/workflows/connectors/employees/executors; scored decision evidence |
| Browser maturity | Desktop worker, Flolah MV3 extension, recipes, executor routing | Extension acceptance, richer snapshots, resumability, typed recipe output verification |
| Policy-based autonomy | Action-family policy middleware and operating-model autonomy matrix | Context rules (recipient, spend, known campaign), durable approval grants, platform-wide enforcement coverage |
| CEO operations cockpit | Digest, OEI, Kanban, goal telemetry, LLMOps | One company pulse showing active, blocked, failed, unverified, cost, artifacts and next action |
| Governed learning | Learnings, retrospectives, feedback, plan history | Versioned improvement proposals, evidence/diff, CEO accept/reject, never auto-weaken gates |

## Slice 1 — unified company execution read model

The first additive slice introduces `/api/company-executions`. It projects existing authoritative runtimes rather than replacing them:

- goal plans;
- workflow runs;
- Browser Session tasks;
- Kanban tasks.

Every execution reports a common status (`pending`, `running`, `blocked`, `failed`, `completed`) and an outcome-verification state (`not_due`, `failed`, `unverified`, `verified`). A completed activity without an artifact, URL, provider receipt, explicit verification, or satisfied goal outcome is shown honestly as **unverified**.

The My Org dashboard shows a small Company execution pulse backed by this endpoint. Later slices may add durable cross-runtime correlation ids and more evidence adapters while keeping this response contract compatible.

## Acceptance gates

1. Every API query derives the owner from the authenticated CEO/admin session.
2. No body-supplied owner id authorizes access.
3. Completed side effects are not called verified without evidence.
4. Existing runtime tables remain authoritative during additive rollout.
5. Schema or deployment changes remain in Git and Docker source.
6. Each slice has unit/contract tests and a rollback commit before VPS rollout.
