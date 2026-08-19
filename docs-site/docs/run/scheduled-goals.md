---
title: Scheduled goals
---

# Scheduled goals

A **scheduled goal** is a prompt you write once. Flolah delivers it on a cadence to the **COO** (or another employee) without building a workflow.

Path: **Management → Scheduled goals**, or ask the COO in plain language:

- “Every weekday at 9, prepare market insights for the blog and LinkedIn.”
- “Every hour, check MAGS versus previous close; notify me if down 2% or more.”

## Cadence

**Hourly**, daily, weekdays, or weekly. Times use your local timezone. Hourly fires **once per hour** at the chosen **minute** (not every minute).

You can set an end date or keep the goal perpetual. **Pause** and **Delete** survive restarts; only **active** goals run. **Run now** fires immediately.

## Create, edit, pause

On the page: create, **Edit → Save changes**, pause, resume, run now, delete. The COO can do the same from chat.

Optional **Enrich with AI** when composing. Optional **Also send the final outcome on WhatsApp / Slack** if that employee’s [Channels](../systems/channels.md) are paired. Unpaired channels are skipped; web chat still receives the work. Channel copies are prefixed with the employee name.

## Plans (COO)

On the **COO**, a multi-intent prompt can become a **draft execution plan** (workflows + specialty + notify). **Tell the COO the outcome first**; inspect the Goal Plan (KPI current/target, plan version, retrospective when done) before opening Workflow Builder. Recoverable tool failures retry or switch to a fallback capability provider; policy/auth blocks escalate to you with a reason.

- **Generate draft plan** is **COO-only**. Other employees **Save & schedule** and run their own prompt/tools.
- Review steps → **Amend plan manually** if mapping is wrong → **Save draft** → **Approve plan & schedule**.
- Until approved, the schedule stays **draft** and will not tick.

Business Discovery (and similar specialists) typically **Save & schedule** without a nested CRM ladder. When they **Act** with handoff, Kanban + the orphan watcher can start CRM Maker.

## What to expect

- Several due goals can run **in parallel** (they do not block each other).
- Plan-mode fires create a **new** run each tick — they do not reuse yesterday’s plan id.
- If a run is stuck on “running”, wait for the platform to reconcile, then **Run now**, or ask Platform Help.

Related: [Maker and Checker](../operate/maker-checker.md) for CRM→ERP multi-phase work. An example outcome (40 verified, spend cap, no unapproved send): [Example stress test run](../operate/example-stress-test-run.md).
