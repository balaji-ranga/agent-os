---
title: Org and departments
---

# Org and departments

Your company has two related structures:

| | What it is | Where you manage it |
|--|------------|---------------------|
| **Departments** | Named groups (Executive, Research, Finance, …) with a purpose and optional token budget | **My Org → Design**, or **Knowledge → departments** table |
| **Org chart** | Who reports to whom: you (CEO), the COO, AI employees, and optional human **People** | **My Org** (`/org`) — **Chart** / **Design** / **People** |

AI employees live in departments so the COO can delegate the right work. Department purpose is written into each employee’s **ORG.md** after you **Resync**.

## Three ways to get an org

1. **[Company setup](./company-setup.md)** — structured wizard. After mission and org DNA, click **Design organization**. You then **Meet your team**: proposed AI employees and departments. Uncheck what you do not want, continue through systems and management style, then **Apply**. Apply **creates or extends** departments and employees; it does not wipe an existing org by default.
2. **[Onboarding Helper](./onboarding-helper.md)** — describe extra departments and roles in chat, **Review** checkboxes, **Apply** only the selection.
3. **Manual** — skip or finish the wizard, then open **My Org → Design** and create departments / hire yourself.

New accounts also get a starter **departments** table in Knowledge (typically Executive, Research, Finance, Social, Engineering, Operations, Job Pipeline).

## Open My Org

Path: **My Org** (`/org`).

The page opens with **How this company runs** (operating model and capability layers — same diagrams as [How the company runs](../start/how-the-company-runs.mdx)). Then three modes:

| Mode | Use for |
|------|---------|
| **Chart** | Tree view: you at the top, reports-to lines toward the COO and specialists |
| **Design** | Department columns: create depts, hire, **drag tiles** between departments (saves immediately) |
| **People** | Invite **human** employees (email invite), role, department |

After you add, rename, or move people, click **Resync ORG.md & AGENTS.md** on the same page so every AI employee sees the current roster. Hand-edited COO sections (Role, Priorities, Tools, Guardrails) are kept.

## Create and edit departments

### In Design mode

1. Open **My Org → Design**.
2. Type a name in **New department** → **Create dept**.
3. Drag an AI employee (or person) tile onto that column. The COO tile is not dragged.
4. Department **purpose** and **monthly token budget** appear on the column when set. Set them from the department picker **Edit** control (same fields as Knowledge).

### In Knowledge

1. Open **Knowledge** (`/master-data`).
2. Open the **departments** table.
3. Add a row or **Edit** an existing one.

| Column | Meaning |
|--------|---------|
| **name** | Label in every department dropdown |
| **purpose** | What the department owns (synced into ORG.md) |
| **monthly_token_budget** | Planning figure (tokens/month). Blank = no target. Blocking is per employee, not per department — see [Budgets](../operate/budgets.md) |

The name in Knowledge must match the department you assign on the chart (same spelling).

## Place AI employees

- **Hire** from **Design → Hire AI employee**, or **AI Employees** (`/workspace`). Pick a department and reports-to (usually the COO or a lead in that department). Details: [Hire AI employees](./hire-ai-employees.md).
- **Move** later by dragging the tile in **Design**, or by editing the employee’s department.
- **External / AgentExchange** listings can **Add to org** as a leaf (department + reports-to). They cannot manage others. See [AgentExchange](../systems/agent-exchange.md).

## Human people vs AI employees

**People** are humans you invite into **your** company (they do not get a separate tenant). Place them in a department like AI employees. Full roles (CEO Delegate vs Member), Kanban rules, and Efficiency User View: [People](./people.md).

Invite: **My Org → People** (name, email, phone → invite email). Then drop them into a department in **Design**.

## After the org is in place

- Talk to the **COO** on Home and run standups from My Org — [Chat and COO](../run/chat-and-coo.md)
- Tweaks to name / mission / DNA without re-hiring → [Update company details](./update-company-details.md)
- Optional CRM/ERP Makers appear when you enable those systems — [CRM and ERP](../systems/crm-and-erp.md)
