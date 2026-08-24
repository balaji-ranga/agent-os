---
title: Policies and guardrails
---

# Policies and guardrails

Path: **Policies**.

CEO **common guardrails** apply to all of your AI employees and to workflow Brain nodes. Use them for tone, forbidden actions, approval rules, and “never invent customers / prices”.

After you change policies, Resync org docs if the product asks you to, and start a **new chat** so employees pick up the latest text.

**Action control** (same page): three states per action family — Autonomous, Approval required, Prohibited. External messages default to approval; deletes default to prohibited. Approval uses a short-lived, owner-scoped grant; an agent cannot self-approve with request flags. A grant may be restricted to one tool, recipient, campaign, amount, and use. Prohibited always wins. Enforcement applies to read and write tool invokes for your company.

Use **Scoped overrides & recurring grants** for one goal, workflow, employee, or tool. Resolution is goal → workflow → employee → tool → company. A recurring email or publishing grant can be Autonomous while restricted to permitted email IDs or website domains, an expiry, and a maximum number of uses. Non-matching constraints fail closed; expired or exhausted overrides return to the next applicable policy.

The searchable target picker supports multi-select, so one save can apply the same bounded rule to several targets. A scheduled-goal override remains effective across that goal's future scheduled fires.

Policies are not a substitute for **tool grants**, **Maker/Checker**, or **IP allowlists**. Stack them: policy says what *should* happen; Action control, tools and Checker enforce what *can* happen.

See [Example stress test run](../operate/example-stress-test-run.md) for a scored outcome (verified CRM, spend cap, approval-required send).
