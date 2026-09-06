# Objectives Key Results (OKR): outcomes, execution, measurement, and evidence

## Answer first

Use **Objectives Key Results (OKR)** when a company outcome must be pursued and measured over a monthly, quarterly, half-yearly, or annual period. The operating chain is:

`Company mission → Objective → Key Results + Initiatives → scheduled/ad-hoc Goals → Goal Plan runs → Evidence → KR progress → Digest`

Path: **Objectives Key Results (OKR)** (`/objectives`). Create: **New objective** (`/objectives/new`). Measurement catalogue: **Measurement registry** (`/objectives/measurement-registry`).

## Terminology and cardinality

- **Objective:** a time-bounded outcome, not a task. Example: “Generate S$100k qualified pipeline in Singapore manufacturing SMEs this quarter.”
- **Key Result (KR):** a numeric test of success with baseline, current value, target, unit, formula, source, definition, confidence, and evidence.
- **Initiative:** a coordinated body of work intended to move KRs. It groups execution; it is not itself the measurement.
- **Goal:** an executable instruction under an Initiative. It is either scheduled/recurring or ad-hoc/one-off.
- **Goal Plan run:** one actual execution instance with steps, agents, status, telemetry, decisions, and evidence.
- **Evidence:** owner-scoped records correlated to an Objective, Initiative, Goal Plan run, and selected KRs.

One Objective has many KRs and Initiatives. One Initiative has many Goals. One Goal may contribute to many KRs. A recurring Goal produces a new Goal Plan run for every tick; an ad-hoc Goal produces a run when **Run goal** is selected.

## Create and activate an Objective

1. Open **Objectives Key Results (OKR) → New objective**.
2. Enter the desired business outcome, period/label, start/end dates, currency, and AI/tool budget.
3. Select **Generate objective proposal**. AI recommends the Objective, KRs, Initiatives, and Goals from the supplied outcome and available company context.
4. Review the proposal. KRs and Initiatives are manually editable; they can be added, removed, and reordered.
5. Under each Initiative, use **Generate with AI** or **Add goal manually**. Multiple scheduled and ad-hoc Goals are supported.
6. For each Goal select type, owner/agent, contributing KRs, approval requirement, schedule (when recurring), and execution guidance.
7. **Save draft** or **Approve and operate**.

AI output is a recommendation, not automatic CEO approval. Write goal guidance with completed outcome, evidence/provenance, allowed writes, approval gates, and exception behavior.

## Objective-specific boundaries

Objective boundaries narrow execution for this particular outcome—for example budget, geography, approved audience, or “no external communication without approval.” They do not replace or override:

- company Policy, which defines company-wide permission;
- work assignments, which define employee/tool responsibility;
- Exception Policy, which defines blocked/uncertain/out-of-authority handling;
- connector action grants and other enforcement controls.

Objective authority must never be interpreted as permission broader than those controls.

## Key Results and autonomous measurement

Each KR should define exactly what counts, exclusions, period/window, and evidence. In Objective Studio select:

1. Measurement source.
2. Specific company source instance, when available.
3. Formula supported by that source.
4. Baseline, target, unit, and definition.

Standard source families include CRM, ERP, outcome evidence, Goal Plans, workflows, agents, Knowledge/RAG, notifications, media, connectors such as Gmail, MCPs such as Web Crawler, custom APIs, documents, and manual evidence. Availability is company/owner scoped.

Flolah uses the Objective period as the measurement window and requires provenance. Linked execution evidence is synchronized when list/detail/digest data is loaded. The KR card displays current value, target, percentage progress, source, and confidence. **Refresh evidence** reloads an already-open Objective.

Manual evidence is a fallback human attestation. Prefer authoritative platform or connected business data when available.

## Measurement Registry

The registry is intended for authorized company administrators. Its platform baseline is inherited and read-only; company-managed entries remain owner/company scoped.

### Platform baseline

Expand any baseline source to see:

- provider object catalogue and provider object name;
- supported attribute ID, object, data type, and provider mapping path;
- validated formula ID, expression, and description;
- source availability and configured company instances.

An attribute is not arbitrary free text. It identifies a catalogue field backed by a supported platform object. For a company attribute, choose Source → Object → Supported field; the UI fills the stable ID, mapping path, type, and description read-only.

### Company sources and formulas

An administrator can register a reusable source and formula. Formula expressions are declarative contracts, not executable JavaScript or SQL. They must use source-supported attributes, have stable IDs, and describe the intended window and calculation. Existing KRs retain their stored configuration if a company registry entry is later removed.

The reference cross-system rule correlates Web Crawler MCP evidence, Gmail connector messages, CRM opportunities, and ERP invoices. Its mappings validate against provider catalogues before installation. It currently displays **Evaluator not connected**: schema validation proves the referenced mappings exist, but the rule does not calculate a KR until a calculation adapter is connected.

## Initiatives, Goals, and Goal Plans

An Initiative is the workstream. Goals beneath it are the executable units.

- **Scheduled Goal:** runs on its cadence while enabled and within the active Objective. Each occurrence creates a distinct Goal Plan run. Open **Scheduled goals** for schedule controls.
- **Ad-hoc Goal:** remains as a reusable one-off definition. On an active Objective, **Run goal** creates its Goal Plan run.

Goal-to-KR linkage is explicit. A similarly named ad-hoc Goal is not automatically part of a KR. The Goal must carry the correct Objective, Initiative, and linked KR IDs.

All agents receive `company_objectives_query` so they can inspect active Objectives, KRs, Initiatives, and Goals before non-trivial work. COO/orchestrator agents additionally receive `company_goal_link_objective` to link existing Goal Plans to the selected Objective/Initiative/KRs. If the user explicitly names the Objective and Initiative, preserve that linkage.

## Evidence flow and Digest

When a linked Goal Plan becomes terminal, Flolah correlates it to its Objective hierarchy, retains durable execution evidence, and updates eligible KR measurements from the registered source/formula contract. The Objective detail shows:

- KR current/target/progress/source/confidence;
- Initiative tree and scheduled/ad-hoc Goal definitions;
- linked Goal Plan runs and execution status;
- evidence records and provenance;
- Objective constraints and version history.

Digest is the executive summary: Objective progress appears alongside Goal Plan outcomes, operating metrics, cost, exceptions, and work needing attention. Objective detail is the audit view; Digest is the operating view.

## Agent Chat, email, WhatsApp, and connected channels

Users can request Objective-aligned work through Agent Chat or a configured external channel. State the Objective, Initiative, and contributing KRs explicitly when linkage matters. Example:

> Create an ad-hoc Goal Plan under “Discover and qualify accounts” for the Q3 pipeline Objective. Link the qualified-account and weighted-pipeline KRs. Research 20 Singapore manufacturing SMEs, retain source URLs, permit reversible CRM writes only, and require approval before sending messages.

Channel transport does not bypass Flolah governance. Execution remains company-scoped, uses the assigned employee's granted tools, honors policies/approvals, and records its Goal Plan and evidence in Flolah.

Agents are instructed to query active Objectives before non-trivial work. When an intent fundamentally deviates from active Objectives/Initiatives, the agent calls `objective_deviation_record` to insert prompt/request, rationale, requesting user, agent, and timestamp into Knowledge table **Objective_deviation**, then proceeds if other policy permits. This is deliberately non-blocking. Daily Digest and COO status reporting summarize deviations.

## Troubleshooting

### KR did not change

Confirm all of the following:

1. Goal Plan is explicitly linked to this Objective, Initiative, and KR.
2. The execution reached a terminal status.
3. Evidence is retained and has required provenance.
4. The selected source instance and formula support that evidence.
5. The evidence is within the Objective period.

Then select **Refresh evidence**. A title match alone never creates linkage.

### No company source instance

Connect or configure the source for this company. Do not choose an unrelated source. Connector/MCP attributes come from their registered provider object catalogue; inspect the Measurement Registry mapping path.

### Formula is present but does not evaluate

Check whether it is a baseline formula with an active adapter or a company/composite calculation contract. The reference composite rule explicitly says **Evaluator not connected** and cannot update a KR yet.

### Scheduled Goal did not run

Confirm Objective status is active, Goal status is active/enabled, dates include now, and cadence/time/timezone are correct. Check **Scheduled goals** and the resulting **Goal Plans → Execution trace**.

### Work is awaiting approval

Use the relevant review surface to approve, correct, or cancel. Objective boundaries cannot override company Policy, Action Control, or connector grants.

### Agent work is not linked

Ask the COO/orchestrator to query the hierarchy and link the Goal Plan with explicit IDs. Other agents can query Objectives but only COO/orchestrator agents receive the linking tool.

## Related help

- **28 Scheduled goals** — recurring goals, Goal Plan lifecycle, reviews, and execution trace.
- **04 Kanban, standups, broadcast** — work status and CEO actions.
- **19 Scheduled jobs and crons** — platform timers versus company schedules.
- **05 Master Data and RAG** — evidence documents and Knowledge tables.
- **10 Policies and guardrails** — approval and action controls.
- **36 Operational effectiveness** — execution effectiveness, distinct from KR outcome measurement.
