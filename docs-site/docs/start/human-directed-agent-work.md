---
sidebar_position: 4
title: Human-directed agent work
description: How Flolah combines human-defined objectives, bounded authority, data provenance, and traceable agent decisions.
---

# Human-directed, traceable agent work

Flolah helps a company use AI agents without handing them unlimited control. Humans define the objective and the operating boundaries; agents plan and perform the permitted work; Flolah preserves the evidence and execution history needed for supervision.

> **Human intent → bounded plan → permitted action → sourced evidence → traceable decision → human review**

## Human-defined objectives

You begin with the business outcome—not a list of technical steps. Tell the COO or a specialist what should be achieved and include the constraints that matter:

- the expected outcome and quality bar;
- the evidence required to count the work as complete;
- the deadline or recurring cadence;
- a budget or usage limit; and
- actions that must not happen without approval.

For multi-step work, Flolah can create a durable **Goal Plan**. The plan records its objective, steps, KPI, limits, version, and progress. A later change to the objective produces a new plan version instead of silently rewriting the original instruction.

## Bounded authority

Every AI employee operates within an explicit envelope of authority. That envelope combines:

- **Role and purpose:** what the employee is responsible for.
- **Tool grants:** which systems and actions the employee can access.
- **Company policies:** whether an action is autonomous, approval-required, or prohibited.
- **Scoped overrides:** narrower rules for a goal, workflow, employee, tool, recipient, domain, amount, expiry, or number of uses.
- **Execution limits:** budgets, timeouts, retries, browser step limits, and permitted URLs.
- **Human gates:** approval cards and Maker/Checker separation for consequential actions.

The narrowest applicable rule wins, prohibited actions remain prohibited, and an agent cannot approve its own restricted action. Authentication gaps and policy conflicts return to a human rather than being bypassed.

## Data provenance

Agent output is more useful when you can see where it came from. Flolah carries evidence through the work instead of treating an unsupported completion statement as proof.

Depending on the task, provenance can include:

- the company Knowledge document or table used as context;
- public source links and citations gathered during research;
- records read from connected CRM, ERP, or other systems;
- workflow inputs and outputs;
- browser observations and resulting artifacts; and
- the employee, tool, workflow run, and plan associated with the result.

You can require evidence as part of the objective. Records that fail the configured evidence or validation bar should not count toward the plan KPI.

## Traceable decisions

Flolah keeps the operating sequence visible across several connected views:

- **Goal Plans → Execution trace:** plan versions, steps, KPI and spend, policy decisions, failures, recovery, human intervention, and final outcome.
- **Workflows → Run audit:** the graph, step inputs and outputs, tool activity, failures, and retries.
- **Kanban:** ownership, status, evidence, approvals, and exceptions requiring attention.
- **Digest:** recent plans, outcomes, and links to their traces.
- **Efficiency → LLMOps:** token usage, estimated cost, model/source attribution, quality signals, and trace links.

A trace does not expose hidden model reasoning. It records the operational facts needed to understand what was requested, what acted, which controls applied, what evidence was observed, and what result was produced.

## How the controls work together

Consider this objective:

> Find ten qualified Singapore prospects using publicly verifiable evidence, add only validated companies to CRM, prepare personalized outreach, keep tool spend below $15, and do not send anything.

Flolah can:

1. Save the objective, evidence bar, spend cap, and no-send boundary in a Goal Plan.
2. Delegate research and CRM work to employees with the required roles and tool grants.
3. Record public citations and CRM record identifiers as evidence.
4. Reject unsupported prospects rather than inventing missing details.
5. Track progress and cost against the plan.
6. Stop at the outreach boundary and create an approval item.
7. Preserve the completed steps, policy decisions, evidence, and final result in the execution trace.

The agents perform the work, but the company retains control of purpose, authority, evidence, and consequential decisions.

## What humans remain responsible for

Flolah supports accountable delegation; it does not transfer accountability away from people. Humans remain responsible for:

- company purpose and acceptable outcomes;
- the authority granted to employees and tools;
- policies, budgets, and approval thresholds;
- decisions with legal, financial, employment, safety, or reputational consequences; and
- reviewing exceptions, evidence, and material results.

Start with narrow authority and meaningful evidence requirements. Expand autonomy only after repeated work is reliable, observable, and reversible.

Next: [How the company runs](/start/how-the-company-runs) · [How we loop](/operate/how-we-loop) · [Policies and guardrails](/systems/policies) · [Monitoring and LLMOps](/operate/monitoring-and-llmops)
