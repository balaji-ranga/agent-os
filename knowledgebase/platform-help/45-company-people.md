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

Permissions are **platform features** (nav screens) plus **CRM / ERP access** (open `/crm` and `/erp`). They are **not** Twenty workspace roles or ERPNext Desk roles. Desk SSO still uses **that person’s email** inside the **company** Twenty workspace / ERPNext company. Inviting people does **not** consume another Twenty workspace slot — only a new Flolah company (CEO) does.

## Kanban

Everyone in the company **sees all cards**. Department employees may **act, chat, reopen, approve, or drag** only when the assignee (AI employee or person) is in **their department**. Unassigned cards are view-only for members. CEO and CEO Delegate can act on any card.

The agent filter also lists **people** (`user:…`) so COO tools can assign Kanban to a human when no specialist fits.

## Efficiency

- **Department** tab — AI employee token use **and** people task counts (assigned / done / failed).
- **User View** (`/efficiency?tab=user`) — Kanban performance for people this month (parallel to Agent View).

## COO

Treat people as employees. Prefer **AI employees** for work; send **approvals** to humans. If no specialist fits, assign the Kanban card to a person.

## Human chat and browser voice

From **My Org → People**, select a person to open their private company chat or create a **Voice call link**. Direct conversations have unread state and can be archived; archiving preserves a short summary for continuity. Only the company owner scope and conversation participants can read or write the messages.

Voice uses browser-to-browser WebRTC. The copied guest link is opaque, short-lived (maximum one hour), contains no employee contact details or credentials, and can be consumed only for the intended company employee. Flolah stores call state/signalling metadata, not the peer-to-peer audio stream. The COO may also create a voice invite for an exact directory user through `voice_call_invite`; agent workspaces receive safe directory metadata, never email addresses or phone numbers.

## AI and human work assignment

Open **Policies → Work assignment** to decide what happens when both an AI employee and human employee credibly match a planned outcome:

- **Equal weight** — choose the strongest capability fit.
- **Prefer AI employee** — AI wins a close match.
- **Prefer human employee** — a matched person wins a close match.
- **Prefer AI, but route high-risk judgment to humans** — AI handles routine work while financial commitments, legal/regulatory judgment, destructive operations, and binding external commitments go to a matched person.

You can also require a matched human for high-risk judgment and set default Kanban ETAs for urgent/high-risk, standard, and complex/research work. A task-specific ETA overrides the default. SLA delivery controls decide whether overdue work produces a bell, WhatsApp notice, or status-checker evidence; breach history remains available after the task changes state.

For a human goal step, Flolah creates an owner-scoped Kanban card tied to the exact goal and step, including the original objective and only relevant predecessor output. The person uses **Complete task**, **Unable to complete**, or **Ask a question**. Only explicit authenticated completion resumes the goal—ordinary chat text cannot complete it. A question pauses visibly; inability returns the blocker to the orchestrator without an automatic human retry loop.

## Related

- [02-navigation-and-chrome.md](./02-navigation-and-chrome.md) — nav filtered by role
- [03-dashboard-agents-chat.md](./03-dashboard-agents-chat.md) — My Org People tab
- [04-kanban-standups-broadcast.md](./04-kanban-standups-broadcast.md) — department act rules
- [18-agent-budgets-and-org-members.md](./18-agent-budgets-and-org-members.md) — Efficiency Agent / Department / User View
- [32-business-core-crm-erp.md](./32-business-core-crm-erp.md) — CRM/ERP access + company SSO
- [28-scheduled-goals.md](./28-scheduled-goals.md) — durable AI/human goal execution
