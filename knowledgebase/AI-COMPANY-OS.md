# Flolah — AI Company OS (messaging, terminology, primitives)

**Status:** Phase A (language and category) and Phase B (primitives definition) are the product baseline. Phase C (company setup funnel + Content Creator blueprint) is shipped on /company-setup.
**Source of strategic feedback:** external product narrative review (Aug 2026) — keep vision OS, layer messaging, define category **AI Company OS**, freeze primitives, bootstrap create a company not a workflow.
**Refer here** for all user-facing copy, nav labels, empty states, pitch layers, and new-feature design rules.

Related: [`VISION.md`](./VISION.md) · [`PITCH.md`](./PITCH.md) · [`ONBOARDING-HELPER-PLAN.md`](./ONBOARDING-HELPER-PLAN.md) · [`platform-help/02-navigation-and-chrome.md`](./platform-help/02-navigation-and-chrome.md)

---

## 1. Category and golden messaging

### Category (own this; do not compete as)

| Own | Avoid (crowded) |
|-----|-----------------|
| **AI Company OS** | AI Agent Platform, Agent Builder, Workflow Automation, Agentic Framework, AI Workspace |

### Messaging layers (single source of truth)

| Layer | Copy | Audience |
|-------|------|----------|
| **Vision** | The Operating System for AI-Native Companies | CEO / brand |
| **Elevator (~30s)** | Build and run an AI-native company with digital employees that collaborate, use your business tools securely, and complete work under human supervision. | Buyer / founder |
| **Product** | Flolah lets you create an AI organization. Hire AI employees, give them roles and tools, define policies, delegate work, and watch them collaborate like a real company. | Hands-on buyer |
| **Technical** | Multi-agent operating system with memory, governance, workflows, MCP integration, A2A communication, enterprise connectors, and model-agnostic orchestration. | Architect |

### Brand usage

| Surface | Preferred |
|---------|-----------|
| Product name | **Flolah** |
| Category tagline | **AI Company OS** |
| Internal / engineer shorthand | Agent OS / code paths `agent-os`, `agentId` (not primary customer language) |
| Tagline | Automate, Innovate, Elevate |

Every public surface should answer: **What does this let me do?** — hire, organize, equip, govern, delegate, collaborate under human supervision.

---

## 2. Terminology style guide

### Dictionaries

| Audience | Word for runtime worker | Hire action | Knowledge store |
|----------|-------------------------|-------------|-----------------|
| **User-facing UI** (nav, heroes, empty states, auth) | **AI employee** / **AI employees** (or digital employee) | **Hire** / **Hire AI employee** | **Knowledge** (Master Data is secondary parenthetical when needed) |
| **Platform Help (CEO)** | AI employee; first mention may add "(agent)" | Hire, staff, delegate | Company knowledge / Master Data |
| **API, DB, OpenClaw, logs** | `agent`, `agent_id`, `agents` | `POST /api/agents` etc. | master data tables / documents |
| **Technical pitch only** | multi-agent, A2A agent | provision | RAG / embeddings |

### Rules

1. **Never break API compatibility** for naming cosmetic work — keep `agent` in paths, JSON keys, and code.
2. CEO-facing copy prefers **company / employee / hire / supervise / policy / knowledge** over prompt, graph, orchestration, agent builder.
3. **Workflows** remain a product area and a **primitive**, not the category. Lead with org and AI employees.
4. On first technical screen that requires the old term, optional footnote: *AI employee (called an agent in the API).* Do not spray that footnote everywhere.
5. New UI text must pass the **CEO 15-minute test**: if the session is dominated by agent / graph / prompt, rewrite.

### Preferred phrase map

| Avoid (customer primary) | Prefer |
|--------------------------|--------|
| Agent platform | AI Company OS |
| Add agent | Hire AI employee |
| Agent Workspaces | AI Employees |
| No agents yet | No AI employees yet |
| Agentic Workflows (section) | Company OS |
| Agent OS workspace (login) | AI company |
| Refresh agents | Refresh team |
| external agents (card title) | Partner AI / External AI (A2A) — keep AgentExchange as product name |

---

## 3. OS primitives (frozen set)

Every Flolah capability should map to one or more of these primitives. Orphan features (no story under a primitive) are IA debt.

| Primitive | Meaning | Primary product surfaces (today) |
|-----------|---------|----------------------------------|
| **People** | Human users (CEO, admin) | Login, Profile, entitlements, admin users |
| **Employees** | AI workers | My Org, AI Employees (`/workspace`), agent chat/workspace/channels |
| **Departments** | Org structure | Org designer, department budgets, Efficiency → Department |
| **Projects** | Work containers | *Not first-class yet* — do not market as core until shipped; Kanban cards may proxy later |
| **Knowledge** | Tables, docs, RAG, help | Master Data (`/master-data`), Content Explorer, Platform Help corpus |
| **Tools** | What employees may invoke | Tools, Connectors, MCP, Custom scripts, tool grants, API Keys |
| **Policies** | Guardrails, budgets, access | Policies, Efficiency budgets, A2A deny/whitelist, channel policy |
| **Workflows** | Composable automation | Workflows editor, Prebuilt job workflows, Workflow Builder agent |
| **Tasks** | Visible work items | Kanban, standups, Broadcast fan-out, COO delegation cards |
| **Approvals** | Human supervision | Kanban CEO approval, Policies, notify_ceo / bell |
| **Memory** | Durable identity and context | Workspace MD (SOUL/AGENTS/MEMORY/TOOLS), sessions, Master Data |

### Design rule for new features (enforce)

> **Any new feature must declare primary primitive(s) before merge.**
> Prefer extending an existing primitive over inventing a new top-level nav item.
> User-facing labels must use the dictionary in §2. APIs may remain technical.
> If the feature only fits "agent builder / workflow node," revisit whether it belongs in **Employees**, **Tools**, or **Workflows**.

---

## 4. Phase B screen to primitive map

| Route / surface | Primitives | User-facing label baseline |
|-----------------|------------|----------------------------|
| `/` home chat | Employees, Tasks, Memory | Chat with AI employees |
| `/org` My Org | People, Employees, Departments | My Org |
| `/kanban` | Tasks, Approvals | Kanban |
| `/broadcast` | Employees, Tasks | Broadcast |
| `/master-data` | Knowledge | **Knowledge** (Master Data) |
| `/content-explorer` | Knowledge | Content Explorer |
| `/api-keys` | Tools, Policies | API Keys |
| `/policies` | Policies | Policies |
| `/efficiency` | Policies, Employees, Departments | Efficiency View |
| `/workspace` | Employees | **AI Employees** |
| `/agents/:id/*` | Employees, Tools, Memory | Employee workspace / chat / channels |
| `/workflows*` | Workflows | Workflows |
| `/content-tools` | Tools | Tools |
| `/connectors`, MCP, custom-scripts | Tools | Connectors / MCP / Custom scripts |
| `/agent-exchange`, external-agents | Tools, Employees (external capacity) | AgentExchange / External AI |
| `/onboarding` | People, Employees, Departments | Onboarding |
| Browser Session, job profiles | Tools / Workflows (prebuilt) | unchanged product names |
| Admin * | People (platform), Tools, Policies | Admin |

---

## 5. Cosmetics vs fundamental roadmap

| Track | Scope | Phase |
|-------|--------|-------|
| **A — Language and category** | Golden copy, meta/SEO, auth, nav labels, empty states, help chrome | **Done (baseline)** |
| **B — Primitives** | Frozen list, screen map, design rule, docs/index | **Done (baseline)** |
| **C — Company bootstrap** | What kind of company? + blueprints (depts, employees, SOPs, knowledge, KPIs, dashboards, integrations) | Planned |
| **D — Run loop** | Day-1 home after apply; stronger supervise narrative | Planned |
| **E — Vertical scale** | Multi-industry packs + blueprint versioning | Later |

### Feedback analysis summary (archive)

1. Keep long-term vision as OS for AI-native companies.
2. Layer messaging so buyers hear value, architects hear platform.
3. Category **AI Company OS** is more distinct than agent/workflow labels.
4. Primitives make the product feel like one OS, not a feature bag.
5. Distinctive wedge: **users create a company**, not an empty graph — requires Phase C.

---

## 6. Implementation checklist (Phase A/B + company lifecycle)

- [x] This document + knowledgebase/README.md index + Cursor docs rule
- [x] VISION.md / PITCH.md layered messaging and AI Company OS
- [x] Frontend: index.html meta, Login/Register, nav, Workspaces to AI Employees, empty states, key kickers
- [x] platform-help/02-navigation-and-chrome.md labels aligned
- [x] Phase C company setup gate + Content Creator deep blueprint + thin packs
- [ ] Phase D Day 0 — interactive operating model (template or LLM); Day 1 — MD + workflows + systems apply for autonomous ops (see PHASE-D-E-F-OPERATE.md)
- [ ] Phase E — native APIs, multi-company, honest metrics, model version history
- [ ] Phase F — self-improve MD/workflows/model from run learnings (CEO-gated)

When changing customer language again, update **this file first**, then UI and help in the same change set.

---

## 7. Examples (golden lines for UI)

- Login: *Sign in to run your AI company.*
- Register: *Start your AI company — hire digital employees under your supervision.*
- Workspace hero: *AI Employees* / *Hire AI employee*
- Empty org: *No AI employees yet. Hire specialists from AI Employees, or open Onboarding.*
- Master Data: *Company knowledge — tables and documents your AI employees can use.*
- Section nav: **Company OS** (workflows, employees, tools, integrations).

---

## 8. Product lifecycle — Form then Operate (Phase C–F)

Full operate plan: **[PHASE-D-E-F-OPERATE.md](./PHASE-D-E-F-OPERATE.md)**.

### Phase C — Form the company (shipped)

**Question answered:** *Who are we?*

- Post-login gate: Create a company | Open existing (/company-setup).
- Funnel: type, identity, mission, DNA, org design (template pack or **LLM** when no dedicated pack), systems recommendations (checklist + OpenConnector search; not live OAuth), style, review, apply.
- Creates AI employees, optional knowledge seeds, company policy, day-1 **form** briefing (meet the team).
- Flagship deep pack: Content Creator (FB/IG/LI/YouTube). Thin packs for SaaS/talent/trading.
- Implementation: company-setup, company-blueprints, CompanySetup.jsx.
- Does **not** make the company autonomously runnable.

### Phase D — Operate kickstart (Day 0 model + Day 1 install)

**Prerequisite:** Phase C completed.

| Day | Question | Interactive outcome |
|-----|----------|---------------------|
| **D Day 0** | *How do we run?* | **Operating model** designed like Company Setup: cadence, RACI, autonomy matrix, channels, systems readiness, CEO gates — **template** when industry pack exists, **LLM** otherwise; human confirms |
| **D Day 1** | *Can we operate alone?* | Apply model: rich MD (daily tasks/SOPs), runnable workflows + schedules, Browser Session / connector setup paths, operate briefing — company can run under gates |

Flagship: Content Creator multi-channel ops via Browser Session first. Day 1 apply is **blocked** until Day 0 model is confirmed.

### Phase E — Harden and scale

Native channel APIs where ready, multi-company isolation, honest live Home metrics, richer industry operate templates, operating-model version history, CEO operate digests.

### Phase F — Self-improve

Learn from runs → propose MD / workflow / model updates; human always approves gate changes; never auto-weaken publish/spend gates.
