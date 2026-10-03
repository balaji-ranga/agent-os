---
title: Risk classifications
sidebar_label: Risk classifications
---

# Risk classifications

Open **Settings → Risk classifications** to see the effective risk tier for platform tools, MCP tools, and connector actions in your company.

## R0–R4

| Tier | Meaning |
|---|---|
| R0 | Read only |
| R1 | Internal change |
| R2 | External action or communication |
| R3 | Destructive or financial action |
| R4 | Critical privileged action, such as credentials, permissions, production, or tenant administration |

Flolah interprets a default for every known capability. A company owner can override an exact capability for that company. The effective value is shown in the AI employee's **Tool Access** page and is enforced by **Action Control**.

R4 is fail-closed. It stays prohibited even when the broader Action Control family is autonomous. To permit the operation, the owner must deliberately remap that exact capability to the appropriate lower tier, then allow it through the applicable Action Control policy.

## Execution flow

1. Tool Access confirms that the AI employee has the capability.
2. Risk classifications resolves its effective R0–R4 tier.
3. Action Control decides whether the call is autonomous, approval-gated, or prohibited.

A risk override does not grant Tool Access, and Tool Access does not bypass Action Control. Overrides are isolated to the company that saved them. Use **Reset** to return to Flolah's interpreted tier.

Be cautious when lowering a tier: it changes the guardrail applied to future calls of that capability.

