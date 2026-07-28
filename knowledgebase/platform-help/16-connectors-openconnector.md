# Connectors (OpenConnector SaaS apps)

## What Connectors are

Path: **Agentic Workflows → Connectors** (`/connectors`).

Connect **SaaS apps** (GitHub, Gmail, Google Drive, Hacker News, …) to your CEO account via **OpenConnector**. Connected apps are then callable from workflow **Connector** nodes.

This is **not** the same as **MCP** (`/integrations/mcp`):

| | **Connectors** | **MCP** |
|--|----------------|---------|
| Purpose | Link SaaS apps with OAuth / API key | Register MCP tool servers |
| Use in workflows | **Connector** node | **MCP** / **SSE Listen** / Brain MCP tools |
| Isolation | Per CEO connections | Per CEO (+ admin-shared) servers |

## First-time setup (CEO)

1. Open **Connectors**.
2. Click **Provision runtime token** (or equivalent “ensure linked”) so workflows can call apps as you.
3. Use a **starter** (Hacker News, GitHub, Gmail, Google Drive) or **search** the app catalog.
4. Open an app → follow **OAuth** (browser popup / redirect) or paste an **API key** when the provider requires it.
5. Confirm the app appears under **Your connections**.

### Disconnect

Remove a connection from the Connectors page when you no longer want workflows to use that app.

## Admin note (OAuth client config)

Admins configure OAuth **client id/secret** for apps (GitHub, Google, …) on the Connectors admin view. CEOs then complete the OAuth link for their own account. Without admin OAuth config, some OAuth apps cannot start.

## Use in a workflow

1. Open **Workflows** → edit a definition.
2. Add a **Connector** node from the palette.
3. Choose **app** + **action** (and connection alias if offered).
4. Bind inputs from prior steps (`{{…}}` / I/O panel).
5. Map outputs:

| Output | Meaning |
|--------|---------|
| `text` | Human-readable connector response text |
| `result` | Full connector result JSON |

Prerequisite: the CEO who **runs** the workflow must have that app **connected** on Connectors (runtime token provisioned).

See also [07-workflow-nodes-reference.md](./07-workflow-nodes-reference.md) → Connector.

## Local IBKR bridge

On the same **Connectors** page, **Local IBKR bridge** downloads a Windows zip of the laptop HTTP adapter for IB Gateway (used by Monthly Trading W2). Keep `LOCAL_BRIDGE_TOKEN` private and paste it into the W2 workflow variable `local_bridge_token`. Details: [IBKR-LOCAL-BRIDGE.md](../IBKR-LOCAL-BRIDGE.md).

## Tips

- Prefer vaulted secrets from **API Keys** when an app needs a static API key (see [15-api-keys-vault.md](./15-api-keys-vault.md)).
- Failures often mean: not provisioned, OAuth expired, wrong action id, or app not connected for this CEO.
- Ask **Platform Help**: “How do I connect GitHub?” or “How do I use a Connector node?”
- Operator-level OpenConnector webhooks: `knowledgebase/OPENCONNECTOR-WEBHOOKS.md` (ops; not required for everyday CEO connect).
