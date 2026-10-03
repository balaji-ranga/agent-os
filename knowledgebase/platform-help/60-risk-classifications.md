# Risk classifications for tools and actions

Use **Settings → Risk classifications** (`/settings/risk-classifications`) to review the effective risk tier for every known platform tool, MCP tool, and connector action in your company.

## What the tiers mean

| Tier | Meaning | Typical examples |
|---|---|---|
| R0 | Read only | Search, list, inspect, or retrieve data without changing it |
| R1 | Internal change | Create or update internal records, drafts, plans, or company data |
| R2 | External action | Send, publish, invite, or otherwise communicate outside Flolah |
| R3 | Destructive or financial | Delete, trade, transfer, or make another consequential change |
| R4 | Critical privileged | Change credentials, permissions, production deployment, tenant administration, or similarly privileged controls |

Flolah interprets an initial tier from the capability definition, declared metadata, and operation semantics. A company owner can override the exact capability for that company. Lowering a tier weakens its guardrail and requires an explicit confirmation in the UI.

R4 is fail-closed. An R4 capability remains prohibited even if its broader Action Control family is autonomous. The company owner must first remap that exact capability to an appropriate lower tier before its normal Action Control policy can permit it.

## How Tool Access and Action Control use the mapping

The effective tier has one source of truth:

1. **Tool Access** decides whether an agent can see and call the capability.
2. **Risk classifications** supplies the capability's effective R0–R4 tier.
3. **Action Control** maps that tier to the applicable policy family and decides whether execution is autonomous, requires approval, or is prohibited.

Changing a mapping does not grant a tool to an agent. Likewise, granting Tool Access does not bypass the risk classification or Action Control.

The effective tier and an **Override** marker are displayed beside platform tools, connector actions, and MCP tools in an AI employee's **Tool Access** page. Resetting an override restores Flolah's interpreted tier.

## Company isolation

Mappings are owner-scoped. An override made by one CEO company does not alter the platform default or another company's mapping. Only the company owner or an administrator acting for that owner can change the company's overrides.

## Recommended practice

- Keep read operations at R0.
- Use R1 for reversible internal records and drafts.
- Use R2 for messages, posts, invitations, and other external communications.
- Keep deletes, money movement, and trading at R3.
- Keep credentials, permissions, production, and tenant administration at R4 unless there is a reviewed reason to classify the exact operation differently.
- After changing a tier, verify both the AI employee's Tool Access badge and the corresponding Action Control behavior.

