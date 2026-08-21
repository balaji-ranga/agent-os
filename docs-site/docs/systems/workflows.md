---
title: Workflows
---

# Workflows

Path: **Workflows** (`/workflows`).

Visual automations: triggers, employees, APIs, approvals, connectors. This is different from **Job workflows** (a fixed job-application pipeline).

## Lifecycle

1. Create blank or from a **template**.
2. **Edit** — drag nodes, connect edges, set attributes and **Input / Output**.
3. **Save draft** → **Publish** (required before Run).
4. **Run** with optional input. Watch the runs panel or fullscreen **run audit**. Each run has a numeric **WF run id** (searchable from Ctrl+K).
5. On audit: **Retry from this step**, retry stuck/failed, or **Retry from start** (new run).
6. Optional: **Publish as A2A**, **Download for Windows**, import/export JSON.

Chat with **Workflow Builder** in everyday language (“look this up and send me a recap”, “promote this product on Medium and Hacker News with blogs”). It infers APIs, Connectors, and MCP for you. After a build it lists any **Settings → API Keys** names to store — never paste secrets into the chat. Brain steps use **free Ollama** and an **installed** local model (not the platform’s paid/cloud model name). Public posts wait for **your approval**. Medium binds `MEDIUM_INTEGRATION_TOKEN`; Hacker News uses Connectors. Then: **take it live**, **put it back in draft**, **share so other companies can call it** (A2A), or **delete this workflow**.

Use **Platform Help** to *explain* a node; use Workflow Builder to *change* the graph.

## Triggers

| Mode | When it fires |
|------|----------------|
| **Manual** | You click Run |
| **Schedule** | A cron expression you set on the trigger |
| **Chat** | Phrase match (COO and others can trigger) |
| **Event** | Webhook after save (secret header required) |

## Mapping values

Each node has **Input / Output**:

- **Static** — a value you type (may include `{{…}}` templates)
- **From previous step** — pick source node and output key
- **Workflow variable** — shared config for this graph (budgets, base URLs)

Examples: `{{brain-1.text}}`, `{{trigger-1.trigger_input}}`, `{{var.budget_usd}}`.

Prefer **API Keys** vault names for long-lived secrets. Connector nodes need a saved [Connector](./connectors-and-mcp.md) first.

## Filesystem, FTP, and SFTP

A **Filesystem** node can read/write a **local path** (including the Windows desktop package) or talk to **FTP / FTPS / SFTP**. Put passwords in **API Keys**, not in the node or in chat. Pair with a schedule trigger to poll a folder.

Optional **input JSON Schema** on the Trigger validates Run / webhook / A2A payloads.

## Maker / Checker certify

Some packs ship Maker and Checker graphs (for example `run crm maker checker`). High-risk steps can pause for **CEO approval** on Kanban. See [Maker and Checker](../operate/maker-checker.md).
