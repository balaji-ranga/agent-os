# Flolah — Vision

**Flolah (Automate, Innovate, Elevate)** is the operating system for an AI agent company: a place where a solo founder can run named agents like a real team—so a one-person company no longer feels like one person—and publish those agents as secure, callable services.

---

## Purpose

Help **solo founders and lean operators** run a company of AI agents the way they would run a human team—with roles, purpose, memory, tools, accountability, and a clear human control plane—while making those agents **safe to expose** to partners and systems when ready.

The point is not more chatbots. It is staffing: one person at the top, a full org underneath—delegation, progress, and automation that keep working when the founder is not in every thread.

Flolah is not "another chat window" and not "only a workflow canvas." It is the **runtime and product surface** for agentic work: who the agents are, how they are organized, how work is delegated and tracked, and how completed capabilities become governed APIs.

---

## Vision

Every CEO on Flolah should be able to:

1. **Stand up an org** of specialists (COO, research, ops, domain agents) with durable identity (`SOUL`, `ORG`, `AGENTS`, `TOOLS`, memory)—even if the human headcount is one.
2. **Direct work in plain language**—chat, broadcast, standups—and see progress on Kanban and in the notification bell.
3. **Teach the company** with Master Data tables and searchable documents (including product help the agents can RAG).
4. **Automate** with visual workflows that call agents, tools, MCP, APIs, and approvals—not as the only metaphor, but as one powerful surface.
5. **Productize** a workflow as an **A2A agent** on AgentExchange: discoverable card, sync or async invoke, enquire/callback, deny-by-default network policy, optional OAuth, owner test path, and admin-visible invocation history (including blocks that never start a run).
6. **Stay isolated** as a tenant: one CEO's agents, data, standups, and secrets never leak into another's company.

Long term, Flolah is the **home base** where agent companies are built, operated, audited, and offered to the outside world as first-class protocol agents—so a one-person company can operate like a team.

---

## Core strengths

### Agent-native org, not flow-only automation

The primary unit is the **named agent** inside an org chart—purpose, peers, tools grants, workspace docs—not an anonymous step in a graph. The COO routes specialty work using agent purpose; Kanban and chat make that work visible to humans. Delegation feels like staffing a company, not poking a chatbot.

### Human control plane

Notifications, standups, CEO approval nodes, and Platform Help keep the human in the loop without forcing every action through a builder canvas. Agents can `notify_ceo`, send email, and update shared workboards.

### Durable knowledge and identity

Per-CEO Master Data (tables + documents), workspace MD, and tool allowlists give agents **persistent role and context**. Platform Help turns product how-to into RAG the company can ask.

### Workflows as capability builders

Visual workflows (triggers, agents, MCP, connectors, Brain, desktop packages) are how you **compose** capabilities. Publishing those capabilities is a deliberate product act—not an afterthought webhook.

### Governed AgentExchange (A2A)

Published agents are **services**:

- Sync or async invoke, with enquire (`taskId`) and optional HTTP callback
- Secure-by-default access (**Deny all** → Allow all or IP whitelist)
- Public or OAuth-secured invoke
- Schema-aware Test agent for owners
- Platform admin logs for success, failure, and **denials before a workflow ever runs**

### Multi-tenant isolation by design

CEO tenancy spans OpenClaw workspaces, API entitlements, schedulers, Master Data, and A2A ownership—so Flolah can host many agent companies on one platform.

---

## Differentiator (in general)

Flolah differentiates by treating **the agent company** as the product:

| Focus | What Flolah emphasizes |
|-------|-------------------------|
| **Unit of value** | Org of agents with roles, memory, and tools |
| **How work starts** | Chat, COO delegation, broadcast, standups—as well as schedules and webhooks |
| **How work is seen** | Kanban, bell, run history, invocation audit |
| **How capability ships** | A2A AgentExchange: protocol agents with policy, auth, async, and testability |
| **Who it serves** | Solo founders and lean CEOs whose one-person company should feel staffed—not only automation builders wiring systems |

**One line:** *With Flolah, a one-person company doesn't feel like one person anymore—and those agents ship as secure, protocol-native services.*

---

## Strategic focuses

1. **Org fidelity** — Keep ORG/AGENTS/purpose routing accurate so delegation feels like a real company.
2. **Trust & governability** — Deny-by-default A2A, OAuth, IP policy, owner testing without opening the public door, admin denial/success logs.
3. **Async agent services** — First-class enquire + callback so partners can integrate without holding long HTTP requests.
4. **Help as product** — Platform Help corpus and Test/sample tips so CEOs and integrators can use features without reading source.
5. **Composable edges** — MCP, connectors, external A2A, and desktop packages extend the company without abandoning the agent org metaphor.
6. **Tenant safety** — Isolation and entitlements remain non-negotiable as the marketplace and admin surfaces grow.

---

## What we are not optimizing for

- Being only a generic integration canvas with no agent identity
- Exposing every automation as an open URL by default
- Replacing domain SaaS systems; we orchestrate agents that *use* tools and connectors instead

---

## Success looks like

A solo CEO can hire (provision) specialists, ask the COO to get work done, see it on Kanban, teach the company from Master Data, automate a repeatable capability in Workflows, **publish it on AgentExchange under Deny all**, verify it with Test agent, open access for a partner IP or OAuth client, and an admin can later see every blocked or successful call—without confusing "our company of agents" with "a pile of anonymous jobs." One person at the top; a full org underneath.

---

*Related: [`PITCH.md`](./PITCH.md) (one-pager), root [`README.md`](../README.md) (product entry), [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (roadmap history), [`platform-help/`](./platform-help/) (CEO how-to).*