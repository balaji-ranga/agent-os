---
title: Company setup
---

# Company setup

**Company setup** is the first-run wizard that shapes your AI company: type of business, name, mission, culture, systems, and management style. It then applies a team pack so you are not starting from a blank org chart.

## Open it

- Avatar menu → **Company setup**
- Or go to `/company-setup`

New CEOs may be asked to complete or skip setup before using the rest of the product. Skipping does not lock you out — you can return anytime.

## Wizard steps

1. Welcome
2. **Company type** (industry card — for example Education, **Revenue Company**, or content creator)
3. **Identity** — company name, headcount band, country and region
4. **Mission** — what success looks like
5. **Org DNA** — how the company should feel (startup, enterprise, cost-conscious, creative, and similar)
6. **Design organization** then **Meet your team** — proposed AI employees and departments (adjust checkboxes). How to change this later: [Org and departments](./org-and-departments.md)
7. **Systems** — apps and optional **CRM / ERP** (Twenty and/or ERPNext)
8. **Management style**
9. Review → **Apply**

## Management styles

| Style | Meaning |
|-------|---------|
| **AI suggests** | Employees draft; you decide and act |
| **AI after approval** | Work can prepare; public or high-risk actions wait for you |
| **AI autonomous** | May act within budgets and tool grants — use carefully |

## What Apply does

Apply **creates or extends** departments and AI employees from the selected blueprint. It does **not** wipe an existing org by default. You can re-run later to add a pack.

Published industry packs are templates: they must not contain live API keys, SMTP passwords, or SMTP account logins. Email workflow nodes bind to platform SMTP (`WORKFLOW_SMTP_*`) after install. Admin **publish** and **export zip** refuse to complete if any live key pattern remains after scrub.

Optional CRM/ERP on the systems step (or later on **Profile**):

- **Twenty** — CRM Maker A/B + CRM Checker, and a **CRM** menu when the desk is available
- **ERPNext** — ERP (and optionally CRM) Makers/Checker, **ERP** menu, company-scoped books

See [CRM and ERP](../systems/crm-and-erp.md).

## Company setup vs Onboarding Helper

| | Company setup | Onboarding Helper |
|--|---------------|-------------------|
| Path | `/company-setup` | `/onboarding` |
| Style | Structured funnel + blueprints | Freeform chat + selective Review / Apply |
| Use when | First company shape | Extra departments or custom employees |

## After setup

- Arrange departments and reporting lines → [Org and departments](./org-and-departments.md) (**My Org → Design**)
- Recurring work → [Scheduled goals](../run/scheduled-goals.md)
- Mission or DNA tweaks without re-running the full wizard → [Update company details](./update-company-details.md)
- Facebook / content packs → Connectors, then [Content and media](../systems/content-and-media.md)
