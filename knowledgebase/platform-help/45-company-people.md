# Company people (employees / sub-users)

CEOs (the **root** / company owner) can invite **human employees** (also called **sub-users**) and place them in the org like AI employees.

## What employees inherit

Employees **do not** get their own tenant, AgentSystem workspace, or `user_agents` grants. They work inside the **CEO company**:

- AI employees, tools, Knowledge folders, BYOK / API Keys, CRM/ERP company binds
- AgentSystem workspaces stay on the **CEO (root)** tenant
- Home (COO chat), Profile, and Kanban are **always on**

Department members chat and delegate only with the **COO** and **AI employees in their department**. CEO and **CEO Delegate** see the full entitled roster.

## Invite and place people

1. **My Org → People** — name, email, phone. Flolah sends a password-reset / invite email (7-day link).
2. Assign a **role** (CEO Delegate or Member, or a custom role).
3. **Org Designer** — drop the person into a **department** and set **reports-to** (same pattern as AI employees).

Only the CEO and **CEO Delegate** can invite, disable, or change roles (`people.manage`). Custom roles cannot include that permission.

## Roles and permissions

| Kind | Access |
|------|--------|
| **CEO (root)** | Full company. Platform Admin and destroying the CEO account stay out of reach for everyone else. |
| **CEO Delegate** | On par with the CEO for company features (nav, setup, people, tools). Not platform Admin. Cannot destroy the CEO. |
| **Member** | Always-on Home / Kanban / Profile, plus checkboxes you grant (My Org, Efficiency, CRM, ERP, Knowledge, …). |

Permissions are **platform features** (nav screens) plus **CRM / ERP access** (open `/crm` and `/erp`). They are **not** Twenty workspace roles or ERPNext Desk roles. Desk SSO still uses **that person’s email** inside the company workspace / company.

## Kanban

Everyone in the company **sees all cards**. Department employees may **act, chat, reopen, approve, or drag** only when the assignee (AI employee or person) is in **their department**. Unassigned cards are view-only for members. CEO and CEO Delegate can act on any card.

The agent filter also lists **people** (`user:…`) so COO tools can assign Kanban to a human when no specialist fits.

## Efficiency

- **Department** tab — AI employee token use **and** people task counts (assigned / done / failed).
- **User View** (`/efficiency?tab=user`) — Kanban performance for people this month (parallel to Agent View).

## COO

Treat people as employees. Prefer **AI employees** for work; send **approvals** to humans. If no specialist fits, assign the Kanban card to a person.

## Related

- [02-navigation-and-chrome.md](./02-navigation-and-chrome.md) — nav filtered by role
- [03-dashboard-agents-chat.md](./03-dashboard-agents-chat.md) — My Org People tab
- [04-kanban-standups-broadcast.md](./04-kanban-standups-broadcast.md) — department act rules
- [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md) — Efficiency Agent / Department / User View
- [32-business-core-crm-erp.md](./32-business-core-crm-erp.md) — CRM/ERP access + company SSO
