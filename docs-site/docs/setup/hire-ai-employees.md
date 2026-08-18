---
title: Hire AI employees
---

# Hire AI employees

AI employees are durable roles: name, purpose, workspace instructions, and **tool access**. They are not disposable chatbots.

## Where to hire

- **AI Employees** (`/workspace`) → **Hire** / add employee
- **My Org** (`/org`) → org chart **Design** (create departments, drag tiles) — [Org and departments](./org-and-departments.md)
- **Company setup** / **Onboarding Helper** for packs and proposals

Pick an **icon or image** (a default robot icon is used if you skip). The same icon appears in chat, the workspace, and AgentExchange.

Optional at hire: pick a **role template** (Slow Caller, Realtime Caller) so workspace files and default tools are applied. Monthly **token budget** and **error budget** are also optional. See [Budgets](../operate/budgets.md).

- **Slow Caller** uses WhatsApp voice notes + the chat **microphone** icon (speak, pause 3s after you finish, auto-send; Whisper/Piper). **Realtime Caller** uses the **phone** icon (Call) and a public Voice widget (`/p/voice/:slug`) after Channels → Voice; needs an OpenAI Realtime-capable key. Phone numbers are not included. See [Channels](../systems/channels.md).

## Workspace files (identity)

Open an employee → **Workspace** to edit:

| File | Meaning |
|------|---------|
| **SOUL** | Voice, capabilities, boundaries |
| **AGENTS** | Who they work with and how they should delegate |
| **TOOLS** | How to use granted tools |
| **MEMORY** | Long-lived notes the employee may keep |

Saves apply on the next message. **Tool access** changes apply immediately.

After you add, rename, or reorganise people, use **My Org → Resync ORG.md & AGENTS.md** so everyone sees the current CEO, peers, and COO delegates.

## Who to keep in the starter team

| Employee | Role |
|----------|------|
| **COO** | Plan, delegate, standups, scheduled goals. Cannot be removed. |
| **Workflow Builder** | Visual graphs |
| **Platform Help** | Product how-to |

You can hire researchers, finance, social, CRM/ERP Makers, and others as packs or custom roles.

## Publish an employee

From the employee list or workspace you can **Publish to AgentExchange** for other Flolah CEOs (import into their org) or as a public listing. Workflow publish is separate — see [AgentExchange](../systems/agent-exchange.md).

## Remove an employee

Removing deletes that employee’s chats and grants. **Kanban cards stay** (unassigned). Reports-to children move up. Removal sticks across restarts.
