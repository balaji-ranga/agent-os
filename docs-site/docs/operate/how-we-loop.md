---
title: How we loop
description: How Flolah plans, acts, checks progress, recovers, and learns while your AI company operates.
---

# How we loop

Flolah turns a business outcome into supervised, traceable work. It does not simply send one prompt to one AI model and hope for the best.

Instead, your AI employees work through a loop:

> **Understand → plan → act → observe → decide → continue or recover → report**

Some parts use AI reasoning. Other parts are controlled by durable plans, workflows, policies, permissions, evidence checks, and approval rules. This combination lets work continue after a chat reply without giving an AI employee unlimited freedom.

## A simple example

You could tell the COO:

> Research ten suitable prospects, add only verified companies to CRM, prepare personalised outreach, do not send anything, and tell me when the drafts are ready.

Flolah can then:

1. Understand the outcome, quality rules, and the “do not send” boundary.
2. Create a Goal Plan and divide the work into suitable steps.
3. Give research and CRM work to the appropriate AI employees or workflows.
4. Carry completed results into the next step.
5. Check evidence instead of treating activity as success.
6. Retry a temporary failure or use an allowed alternative.
7. Stop at the outreach approval boundary.
8. Show you the result and execution trace.

You supervise the outcome and exceptions rather than manually routing every routine step.

## The loops working together

### 1. The employee loop

Every AI employee has a role, instructions, company context, memory, and a specific set of tools. When you send a request, the employee can reason, use an allowed tool, inspect its result, and continue until it can answer or start longer-running work.

The COO is the main coordinator. It can:

- answer a straightforward coordination request;
- delegate a specialist outcome;
- start a published workflow;
- create a multi-step Goal Plan; or
- ask you for genuinely missing information.

Clear specialty work is handed to the appropriate employee with the relevant context, rather than answered by the COO as if every role were interchangeable.

### 2. The Goal Plan loop

A multi-phase request becomes a durable **Goal Plan**. Each plan has an ID beginning with `agr-` and a visible sequence of steps.

Flolah starts the next eligible step and then waits in the background. When a workflow or specialist finishes, the platform records the result and advances the plan automatically. Your original chat does not need to stay open.

Goal Plan steps can include:

- running a published workflow;
- assigning work to a specialist AI employee;
- invoking an approved company tool;
- asking the coordinating employee to synthesize results; and
- notifying you when the requested outcome or exception is ready.

Open **Run & Operate → Goal plans** to see the current step, child runs, evidence, cost, plan versions, and terminal outcome.

### 3. The workflow loop

Workflows provide a more deterministic path for repeatable operations. They connect employee work, tools, conditions, branches, approvals, and repeated steps in a stored graph.

The workflow engine controls which node is ready next. It stores inputs and outputs, follows conditions, waits for delegated work, applies timeouts, and resumes when an approval or asynchronous result arrives.

This means the workflow structure—not an AI employee’s short-term memory—controls the operating sequence.

### 4. The browser loop

For an autonomous browser goal, Flolah can create a small plan and repeat:

1. Observe the current page.
2. Choose one structured action.
3. Perform the action in the selected owner-scoped browser.
4. Record what happened.
5. Observe the changed page.
6. Check whether the goal is actually complete.

A browser task is bounded by step limits and URL policy. It can pause for login, missing input, or a configured approval boundary. Completion can require page evidence; an unsupported “done” decision is not enough.

For repeatable browser work, a saved **recipe** replaces much of the next-action reasoning with recorded steps. Dynamic values—such as post text—are supplied when the recipe runs.

See [Browser Session](../systems/browser-session.md).

### 5. The recovery loop

Not every failure should interrupt you. Flolah distinguishes between failures that can be handled automatically and failures that need human attention.

Depending on the problem and policy, it can:

- retry a temporary failure within a limit;
- use an approved alternative executor or tool;
- preserve completed work and update the remaining plan;
- stop when continuing would violate policy;
- wait for authentication or missing information; or
- escalate one clear exception to you.

Retries are bounded. Authentication and policy restrictions are not silently bypassed. If a Goal Plan fails, Flolah can create one recovery task containing the original goal, completed steps, and failure details rather than losing the work or recursively starting plans.

### 6. The learning and schedule loop

Your thumbs-up or thumbs-down feedback and Kanban decisions can become learnings that employees consult during later work. This helps the company apply your preferences without weakening security or approval policies.

A **Scheduled goal** runs the same operating pattern on a cadence. Each occurrence creates a fresh execution from the approved plan, records a new result, and then waits for the next scheduled time.

See [Scheduled goals](../run/scheduled-goals.md).

## What keeps the loop under control

Flolah combines autonomy with deterministic controls:

- **Company isolation:** work, plans, browser jobs, knowledge, and tools are scoped to your company.
- **Tool grants:** each AI employee can use only the tools it has been given.
- **Policies:** consequential action families can be allowed, approval-gated, or prohibited.
- **Evidence:** important completion claims can require observed results or artifacts.
- **Bounded execution:** retries, browser actions, timeouts, and spending can have limits.
- **Idempotency:** supported writes are protected against accidental duplicate execution.
- **Traceability:** Goal Plans and workflow runs retain step statuses, outputs, failures, and timing.
- **Human supervision:** authentication, policy exceptions, missing information, and configured consequential actions can return to you.

Flolah does **not** require your approval for every routine action. An approval appears when the operating policy or the requested boundary requires one—for example, “prepare but do not send.”

## Where you can see the loop

- **Home or AI employee chat:** give the outcome in plain language and receive the plan or task ID.
- **Goal plans:** inspect multi-step progress and the execution trace.
- **Workflows:** inspect deterministic paths, branches, and approval nodes.
- **Kanban:** supervise delegated work, exceptions, and recovery tasks.
- **Digest:** review recent plans and outcomes.
- **Browser Session:** see browser executors, tasks, recipes, and connection status.
- **Efficiency:** review operational effectiveness, usage, cost, and LLMOps information.

## What Flolah does not do

Flolah is not an unrestricted, self-modifying system. It does not automatically weaken approval rules or rewrite your company’s governance.

The current platform closes the loop around planning, execution, observation, recovery, scheduling, and feedback. Changes to company policies, operating models, or other governance boundaries remain under human control.

## A good outcome prompt

You get the clearest loop when your request includes:

- the outcome you want;
- a quality or evidence bar;
- any deadline or cadence;
- a budget or operating limit when relevant; and
- actions that must not happen without approval.

For example:

> Every weekday, find five publicly verifiable prospects in Singapore, add only qualified companies to CRM, prepare outreach drafts, keep weekly tool spend below $25, and notify me only when drafts are ready or the quality target cannot be met. Do not send messages.

The COO can turn that business instruction into supervised execution without requiring you to name internal tools or manually direct every step.

Next: [Maker and Checker](./maker-checker.md) · [Example stress test run](./example-stress-test-run.md) · [Monitoring and LLMOps](./monitoring-and-llmops.md)
