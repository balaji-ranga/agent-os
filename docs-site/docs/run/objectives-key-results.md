---
title: Objectives and Key Results (OKR)
sidebar_position: 5
---

# Objectives and Key Results (OKR)

Flolah OKR connects company direction to autonomous execution and evidence:

```text
Company mission
  -> Objective
       +-> Key Results
       +-> Initiatives
             +-> Scheduled Goal -> Goal Plan run 1, 2, 3...
             +-> Ad-hoc Goal    -> one Goal Plan run
  -> Evidence -> Key Result progress -> Digest
```

Open **Objectives Key Results (OKR)** from the main navigation. Use this area when the company must pursue a measurable outcome over a monthly, quarterly, half-yearly, or annual period—not merely complete a single task.

## Know the five building blocks

| Building block | What it means | Example |
|---|---|---|
| **Objective** | A time-bounded business outcome: where the company intends to go. | Build S$100k qualified Singapore SME pipeline this quarter. |
| **Key Result (KR)** | A numeric test of whether the outcome is being achieved. | Reach S$100k weighted qualified pipeline. |
| **Initiative** | A coordinated body of work expected to move one or more KRs. It is not itself the measurement. | Discover and qualify target accounts. |
| **Goal** | An executable instruction beneath an initiative. It may recur on a schedule or run once. | Research and qualify 20 accounts every weekday. |
| **Goal Plan run** | One actual execution of a goal, including steps, agents, status, telemetry, decisions, and evidence. | The 9 September research run. |

An Objective can have many KRs and Initiatives. An Initiative can have many scheduled and ad-hoc Goals. A Goal may contribute to one or several KRs.

## Create an Objective

1. Open **Objectives Key Results (OKR) → New objective**.
2. Describe the business outcome. Include the result, target market or scope, and important boundaries.
3. Choose the period, label, dates, currency, and AI/tool budget.
4. Select **Generate objective proposal**. Flolah proposes an Objective, KRs, Initiatives, and execution Goals using the available company context.
5. Review and edit everything. Add, remove, reorder, or rewrite KRs and Initiatives. Under each Initiative, generate several Goals with AI or add them manually.
6. For each Goal, choose **Scheduled recurring goal** or **Ad-hoc goal**, assign an employee if appropriate, select the KRs it contributes to, and make the execution guidance explicit.
7. Choose **Save draft** to continue later or **Approve and operate** to activate it.

AI output is a recommendation. The CEO remains responsible for checking targets, source mappings, authority, approvals, and execution guidance before activation.

### Write a useful Objective

A useful Objective is outcome-oriented and time-bounded. “Run outreach” is a task. “Generate S$100k qualified pipeline in Singapore manufacturing SMEs by quarter end” is an Objective.

Objective-specific execution boundaries narrow this outcome—for example, a spend cap, target geography, or “do not send external communications without approval.” They do not replace company Policy, employee work assignments, or Exception Policy, and cannot broaden authority those controls withhold.

## Define measurable Key Results

Every KR contains a baseline, current value, target, unit, formula, authoritative source, and definition. During proposal review you can manually add and edit KRs.

For each KR:

1. State the measurable result in plain language.
2. Set the baseline and target with the correct unit.
3. Select a **Measurement source** such as CRM, ERP, Goal Plans, Knowledge, workflows, connectors, MCPs, or the outcome evidence ledger.
4. Select the specific company source instance when one is available.
5. Select a formula supported by that source.
6. Write a definition that states exactly what counts, exclusions, time window, and required evidence.

Measurements are company-scoped, use the Objective period as their window, and retain provenance. Linked execution evidence is synchronized when the Objective is loaded or refreshed. The KR card shows current value, target, progress, source, and confidence.

Use **Manual evidence** only as a controlled fallback. It records a human-attested measurement; it is not the preferred substitute for an authoritative business system.

## Measurement Registry

Open **Objectives Key Results (OKR) → Measurement registry** to see what a KR can measure.

- **Platform baseline** sources, provider object catalogues, attributes, mapping paths, and formulas are inherited and read-only.
- **Company-managed entries** let an authorized company administrator register a company source, add a supported provider-backed catalogue field, and define a reusable declarative formula.
- Attribute selection is catalogue-based: choose the source, provider object, and supported field. The registry then displays the stable attribute ID, object, data type, and provider mapping path.
- A formula expression is a calculation contract, not JavaScript or SQL. Use attributes supported by the chosen source and explain the calculation in its description.
- Source instances are owner/company scoped; one company's connectors and data do not become another company's measurement sources.

The cross-system reference rule demonstrates how Web Crawler MCP evidence, Gmail correspondence, a CRM opportunity, and an ERP invoice can be correlated. It is stored only after its mappings validate against the catalogues. The current reference composite rule is marked **Evaluator not connected**: it documents a valid contract but does not update a KR until a calculation adapter is implemented.

## Turn Initiatives into execution

An Initiative groups the work that should cause KRs to move. Under it, add as many Goals as needed.

### Scheduled Goals

A scheduled Goal runs at its configured cadence until paused, disabled, or the Objective ends. Each tick creates a new Goal Plan run. On the Objective page, open the schedule or any historical run to inspect its execution trace. See [Scheduled goals](./scheduled-goals.md) for cadence and controls.

### Ad-hoc Goals

An ad-hoc Goal is a reusable one-off definition. Select **Run goal** from the active Objective to start a Goal Plan. The resulting run appears beneath that Initiative.

For either type, the guidance should name the completed outcome, evidence and provenance required, allowed writes, approval gates, and what to do on exceptions. Linking the Goal to the relevant KRs is what lets its evidence contribute to those measurements.

## How evidence flows back

When a linked Goal Plan reaches a terminal state, Flolah correlates the run to its Objective, Initiative, and selected KRs. The Objective retains execution evidence and updates eligible measurements from the registered source/formula contract. Use **Refresh evidence** if the Objective page was already open.

On the Objective detail page you can inspect:

- KR current value, target, progress, source, and confidence;
- each Initiative and its scheduled and ad-hoc Goals;
- every linked Goal Plan run and execution status;
- traceable evidence records and provenance;
- constraints and Objective version history.

The **Digest** brings Objective progress together with operating results, work needing attention, Goal Plan status, cost, and deviations. Use the Objective detail for the audit trail and Digest for the CEO's operating summary.

## Working through agents and other channels

You can tell the COO or another employee the Objective and Initiative explicitly when requesting work. All agents can query active Objectives, KRs, Initiatives, and Goals. The COO/orchestrator can link a Goal Plan to an Objective and Initiative, including the KRs it contributes to.

Example:

> Create an ad-hoc Goal Plan under “Discover and qualify accounts” for the Q3 pipeline Objective. Contribute to the qualified-account and weighted-pipeline KRs. Research 20 Singapore manufacturing SMEs, retain source URLs, make only reversible CRM writes, and do not send messages without my approval.

The same intent may arrive in Agent Chat, email, WhatsApp, or another connected channel. Channel delivery does not change the governance model: the run still needs explicit linkage, uses the assigned employee's tools and company scope, respects policies and approvals, and records evidence in Flolah.

If a request materially deviates from active Objectives or Initiatives, agents record the prompt, rationale, user, and timestamp in Knowledge table **Objective_deviation** and continue when policy permits. Daily Digest/status reporting summarizes these non-blocking deviations for review.

## Operate and troubleshoot

- **No progress:** confirm the Goal is linked to the intended KR, the run is terminal, and the selected measurement source/formula can evaluate the retained evidence. Refresh evidence.
- **A Goal appears but does not affect a KR:** edit or relink it with the correct Objective, Initiative, and KR IDs; merely using a similar title does not create linkage.
- **No specific source instance:** connect or configure that company source first. Do not select an unrelated provider merely to activate the KR.
- **Composite rule stays unchanged:** a schema-valid composite contract still needs its evaluator; the reference rule explicitly reports this state.
- **Scheduled run is missing:** confirm the Objective and Goal are active, the schedule is enabled, its dates/cadence/timezone are valid, and then inspect Scheduled goals.
- **Work is blocked by approval:** decide the approval from the relevant review surface. Objective boundaries cannot bypass company Policy or Action Control.
- **Wrong proposal:** edit it before approval, or save as draft. Objective versions preserve the change history after updates.

For execution-level diagnosis, open **Goal Plans → Execution trace**. For recurring delivery controls, see [Scheduled goals](./scheduled-goals.md). For company-wide review, see [Notifications and Digest](./notifications-digest.md).
