# AI Revenue Company — objectives and operating-loop implementation plan

**Status:** Proposed implementation plan  
**Flagship outcome:** make one evidence-backed "company in a box" demonstrate the difference between Flolah and a workflow automation tool.  
**Related:** [`AI-COMPANY-OS.md`](./AI-COMPANY-OS.md), [`AI-COMPANY-OS-EXECUTION-PROGRAM.md`](./AI-COMPANY-OS-EXECUTION-PROGRAM.md), [`MANAGEMENT-LAYER-PHASE2.md`](./MANAGEMENT-LAYER-PHASE2.md), [`platform-help/48-pipeline-under-constraints.md`](./platform-help/48-pipeline-under-constraints.md), and [`AI-REVENUE-COMPANY-DEMO-REFERENCE.md`](./AI-REVENUE-COMPANY-DEMO-REFERENCE.md).

## Product promise

A CEO can state one bounded business outcome:

> Generate S$100k qualified pipeline this quarter. Target Singapore SMEs in the selected industry. Do not send external communications without approval.

Flolah turns that outcome into measurable key results, continuing initiatives, executable Goal Plans, governed work, evidence-backed progress, approvals, CRM updates, costs, exceptions, and a concise daily briefing.

The flagship operating chain is:

`CEO objective → COO goals → Research → Qualification → CRM Maker → CRM Checker → Content/Outreach draft → CEO approval → Outreach execution → Response monitoring → CRM pipeline update → Digest and Efficiency`

## Existing foundation

Reuse these shipped capabilities rather than creating parallel runtimes:

- Company setup and the `revenue_company` blueprint.
- Company mission, industry, org DNA, management style, employees, tool grants and policies.
- COO durable Goal Plans (`agr-…`), plan Maker/Checker, dependencies, retries, evidence, budgets, deadlines, plan versions and retrospectives.
- Scheduled goals for recurring Goal Plan creation.
- Research Analyst, Lead QA and Outreach Drafter from the Revenue Company pack.
- CRM Maker A/B, CRM Checker and company-scoped Twenty/ERPNext CRM operations.
- Workflow Builder, workflow approvals, Kanban approval tasks, action-control policy and scoped approval grants.
- Notifications, Home daily snapshot, Digest, Goal Plans execution trace, operational effectiveness and Efficiency/LLMOps.
- Platform connectors, Browser Session, email and WhatsApp channels.

The existing pipeline-under-constraints tests prove important primitives, but they do not yet prove a continuous live revenue company. The Revenue Company pack currently describes its operating sequence; the flagship must install a real, versioned and certified execution model.

## Missing product layer

### Durable objectives

A Goal Plan is an execution run. It must not also be the strategic objective. Add a durable management hierarchy:

`Company mission → Objective → Key results → Initiatives → Goal Plan runs → Workflows/agents/tasks → Evidence`

Objectives have one of four supported planning periods:

- **Monthly** — a named calendar month.
- **Quarterly** — Q1, Q2, Q3 or Q4 in the company's fiscal calendar.
- **Half-yearly** — H1 or H2 in the company's fiscal calendar.
- **Annual** — a fiscal or calendar year.

Daily and weekly views report progress against these objectives; daily/weekly are reporting cadences, not objective types.

Every objective stores owner, period, start/end, outcome, status, authority, budget, constraints, assumptions, version and parent/alignment references. Objective changes append immutable versions.

### Objective Studio

Add **Objectives** to the main navigation and a **New objective** flow. The CEO can start from UI, COO chat, WhatsApp, an email action, or convert a successful Goal Plan into a continuing objective.

Objective Studio extracts and proposes:

- measurable outcome and target;
- period and deadline;
- baseline and currency/unit;
- ICP or operating scope;
- key results and their sources of truth;
- initiatives, owners and cadence;
- budget and authority boundaries;
- explicit prohibited actions;
- assumptions and questions that need the CEO;
- proposed operating model and readiness gaps.

The CEO can edit, ask for alternatives, compare a conservative/base/ambitious scenario, save a draft, or **Approve and operate**. Approval activates initiatives; it does not grant authority beyond Policies and tool grants.

Objective ideation determines **what the company should pursue and how success is measured**. Existing Goal Plan generation determines **how one execution run advances it**.

### Key-result contract

Every key result requires:

- name and business definition;
- baseline, target, current value and unit;
- calculation type and formula;
- authoritative source;
- update cadence and last measured time;
- evidence references;
- confidence/data-quality state;
- owner and contributing initiatives.

Pipeline value must come from CRM opportunities or an approved valuation model. The definition records stages included, face versus probability-weighted amount, currency conversion and exclusions. Rejected, unverifiable and duplicate candidates never count.

### Initiatives

An initiative is a continuing workstream, not a task. It stores contributing key results, accountable owner, execution cadence, budget allocation, authority, status, next run and exception policy.

The default revenue initiatives are:

1. Discover target accounts.
2. Validate ICP fit and evidence.
3. Create and verify CRM opportunities.
4. Prepare personalised outreach.
5. Approve and execute outreach.
6. Monitor and classify responses.
7. Update pipeline, forecast and lessons.

Each scheduled or ad-hoc occurrence creates a normal Goal Plan linked to the initiative, objective and relevant key results.

## End-user experience

### Objectives list

Show active and draft objectives grouped by Monthly, Quarterly, Half-yearly and Annual periods. Each card shows target, actual, forecast, confidence, health, owner, budget consumption, approvals and exceptions. Filters are period, owner, status and capability; pagination is server-side.

### Objective cockpit

The objective detail is the control surface for definition and drill-down, not another general dashboard. It answers:

1. Are we on target?
2. What changed?
3. What is working?
4. What is blocked or unverified?
5. What needs my decision?
6. What did it cost?
7. Can I verify every number?

Sections are Overview, Key results, Initiatives, Execution, Approvals, Evidence and Decisions. Execution links to existing Goal Plan traces, workflow runs, Kanban work, agents and CRM records.

### Existing Home and Digest surfaces

Do not introduce a separate reporting dashboard.

Extend **Home / Today's Snapshot** with an **Objectives needing attention** block:

- objectives off track;
- approvals waiting;
- blocked initiatives;
- material KPI changes today;
- connector/authentication exceptions;
- next best CEO action.

Extend the existing **Digest** with an **Objective progress** section for the selected reporting window:

- target, actual, period progress and forecast;
- key-result movement during the day/week;
- researched, qualified and rejected counts;
- approval backlog and external actions executed;
- CRM pipeline created or changed;
- cost and effectiveness;
- exceptions and confidence/data quality.

The Digest's current operational value/time-saved measures remain separately labelled. CRM revenue and pipeline must never be presented as "estimated value delivered."

The current weekly Digest remains navigable by week. The same digest read model should support a **Today** summary on Home and daily email/WhatsApp rendering without duplicating calculation logic.

### Approval experience

Add a revenue batch view to the existing approval mechanism. Each item shows recipient, qualification evidence, CRM opportunity, draft, channel, unsupported-claim warnings and exact approval scope. The CEO can approve, edit or reject each item or approve selected items.

An approval grant is bound to objective, initiative, Goal Plan, content hash, recipients, channel, expiry and use count. Editing content or recipients invalidates the previous grant. Outreach remains blocked without a matching grant.

## Channel experience

The UI, WhatsApp and email are interfaces to the same durable objects. They must not create independent copies of objectives, approvals or progress.

### COO chat

The CEO can create, inspect or amend an objective conversationally. Material changes show a preview and require confirmation. The COO resolves "this objective" only when context is unambiguous; otherwise it offers matching objective names.

### WhatsApp

WhatsApp is for concise progress, exceptions and bounded decisions:

> Revenue objective: S$42k/S$100k qualified pipeline. Yesterday: 17 researched, 9 qualified, 8 rejected. Six drafts await approval. Cost S$3.81. LinkedIn needs reauthentication. Review: [secure link]

The CEO can ask why a metric changed, pause one initiative, narrow the ICP, or approve named draft items. Flolah echoes the exact affected object and records the channel, authenticated sender, decision and resulting objective version. Sensitive or broad approvals open the authenticated UI.

### Email

Email carries the fuller daily/weekly management briefing: target and forecast, funnel movement, key-result changes, cost, exceptions, approvals and secure deep links. Reply-by-email may propose changes, but activation, authority expansion and high-impact approval require a secure authenticated confirmation.

### Notification policy

Routine work stays quiet. Notify when:

- a CEO decision or approval is required;
- an initiative is blocked or materially off track;
- an authority/budget boundary prevents execution;
- a connector needs reauthentication;
- a material key-result change occurs;
- the configured daily/weekly briefing is ready.

## Revenue execution and evidence model

Provision canonical revenue records around, not instead of, the CRM system of record:

- ICP definition and version;
- candidate account and deduplication key;
- source evidence and observation time;
- qualification decision, score, criteria and rejection reason;
- verified contact fields and explicit unknowns;
- proposed opportunity and valuation evidence;
- outreach draft and factual-claim evidence;
- approval decision and scoped grant;
- send attempt and provider receipt;
- inbound response and classification;
- CRM read-back and stage change;
- model/tool cost and policy decision.

Every progress metric links to contributing records. A completed activity without required evidence is **unverified**, not successful.

Add a bounded **Outreach Executor** to the Revenue Company operating model. It consumes only approved drafts and recipient sets, checks suppression/rate limits, uses idempotency keys, records provider receipts, and writes the resulting CRM activity. Add a **Response Monitor** that correlates inbound events, classifies intent, proposes or performs allowed CRM updates, and escalates sensitive or positive responses.

## Technical implementation slices

### Slice 1 — objective kernel and read model

- Add owner-scoped objective, objective-version, key-result, initiative, alignment and measurement tables.
- Implement create/draft/revise/approve/activate/pause/close APIs.
- Add server-side pagination and period/status filtering.
- Enforce fiscal period validation and immutable version history.
- Link existing Goal Plans to objective, initiative and key-result IDs.
- Add an objective read model that derives current value and evidence without an LLM.

### Slice 2 — Objective Studio and cockpit

- Add Objectives navigation, list, create/ideate and detail screens.
- Use a Maker/Checker proposal contract for key results and initiatives.
- Require CEO confirmation for assumptions that change measurement or authority.
- Add target/actual/forecast, health, approvals, exceptions and evidence drill-down.
- Link rather than duplicate existing Goal Plan, Workflow, Kanban, CRM and Efficiency views.

### Slice 3 — revenue data and certified operating model

- Provision versioned ICP, candidate, qualification, draft and response schemas with the Revenue Company blueprint.
- Replace the pack's descriptive workflow string with real published workflow definitions and scheduled initiatives.
- Add deterministic deduplication, qualification and KPI calculators.
- Add CRM Maker/Checker read-back gates.
- Certify missing-system behavior: no CRM entitlement, disconnected research source or missing outreach channel fails closed and becomes a visible readiness blocker.

### Slice 4 — approval-bound outreach and response loop

- Implement Outreach Executor and exact-scope approval grants.
- Add suppression, frequency, duplicate-send and channel policy controls.
- Record provider receipts and CRM activities.
- Ingest and correlate responses; classify positive, negative, opt-out, bounce and ambiguous results.
- Update CRM only within policy and preserve human escalation.

### Slice 5 — Home, Digest, Efficiency and channels

- Add objective measurements to the common Digest read model.
- Render Today's Snapshot, weekly Digest, WhatsApp summary and email from that model.
- Attribute tokens/tool costs to objective, initiative and Goal Plan.
- Show effectiveness separately from activity: qualification yield, draft-to-approval, send-to-response, response-to-meeting and pipeline generated per dollar.
- Add deep links from every headline number to evidence.

### Slice 6 — flagship reliability gate

Run the reference company through deterministic fixtures and a bounded live trial. Required gates:

1. Zero cross-company records.
2. Zero invented contacts or unsupported personalisation claims.
3. Zero external sends without exact valid approval.
4. Zero duplicate CRM opportunities and sends on replay.
5. Every KPI reproducible from authoritative records.
6. Every completed side effect has a receipt and read-back.
7. Budget and rate limits fail closed.
8. Pausing one initiative does not stop unrelated initiatives.
9. Objective amendments create a new version and re-plan only affected work.
10. Daily brief counts and cost reconcile exactly with the cockpit.
11. Connector failure becomes one actionable exception, not repeated noise.
12. The monthly, quarterly, half-yearly and annual objectives remain aligned without double-counting progress.

## Definition of spectacular

The demo succeeds when the CEO can provide the outcome once, approve a clear operating contract, and then manage by exception. The next-morning report must be generated from durable records—not narrative inference—and every number must be inspectable. A viewer should see objective alignment, governed execution, company systems of record, evidence, decisions, cost and learning in one coherent loop without opening Workflow Builder.
