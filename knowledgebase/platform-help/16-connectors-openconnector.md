# Connectors (OpenConnector SaaS apps)

## What Connectors are

Path: **Agentic Workflows → Connectors** (`/connectors`).

Two tabs on the same page:

| Tab | Purpose |
|-----|---------|
| **OpenConnector** | Link SaaS apps (GitHub, Gmail, Drive, …) via OpenConnector OAuth / API keys |
| **MCPs** | Connect **platform MCP servers that use OAuth** (e.g. Facebook Meta Graph). Agent OS owns the OAuth flow; access tokens are **per CEO**. |

### OpenConnector tab (SaaS apps)

Connect **SaaS apps** to your CEO account via **OpenConnector**. Connected apps are then callable from workflow **Connector** nodes.

### MCPs tab (OAuth-backed MCP servers)

1. Open **Connectors → MCPs**.
2. MCPs listed here are only those **included** for OAuth (not the full Integrations → MCP list). Facebook appears when the platform seeds `mcp-meta-graph`; other providers (LinkedIn, etc.) appear after an admin includes them from the registry.
3. Admin: **Include from MCP registry** → pick a server → provider preset → client credentials → save. CEOs: **Connect** → complete OAuth → session stored in vault for your account only.
4. Use **MCP tool** nodes in workflows with that server id; do **not** use OpenConnector **Connector** nodes for these Graph/API tools.

#### Facebook / Meta Graph (publish to a Page)

- **App credentials** (App ID + App Secret) are platform/operator config — use the Facebook app’s App ID, not a Threads-only ID if they differ.
- **OAuth scopes** for Page post/comment work need the Meta use case permissions **Ready for testing** (Page show list, manage posts, read engagement / user content, manage engagement, business management as required).
- Graph can post as a **Facebook Page** you manage. A personal profile URL id is **not** a Graph **page_id**. Resolve pages via MCP (e.g. list accounts) or Page settings.
- Publish workflows typically pass **`page_id` + message** in **workflow run input** (or goal text consumed by the graph). See [30-content-creator-ops.md](./30-content-creator-ops.md).

This is **not** the same as the full **MCP registry** page (`/integrations/mcp`), which registers custom/user servers:

| | **Connectors → OpenConnector** | **Connectors → MCPs** | **MCP registry** |
|--|----------------|----------------------|------------------|
| Purpose | SaaS apps via OpenConnector | Platform OAuth sessions for MCP tools | Register any HTTP/SSE MCP server |
| Use in workflows | **Connector** node | **MCP tool** node | **MCP** / **SSE Listen** / Brain MCP tools |
| Isolation | Per CEO app connections | Per CEO OAuth tokens | Per CEO (+ admin-shared) servers |

## First-time setup (CEO) — OpenConnector

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

On the same **Connectors** page, **Local IBKR bridge** downloads a Windows zip of the laptop HTTP adapter for IB Gateway (used by Monthly Trading **W2**).

1. Download full (portable Node) or **lite** (Node already on PATH).
2. Keep minted `LOCAL_BRIDGE_TOKEN` private — paste the same value into W2 workflow variable `local_bridge_token`.
3. Point `WEBHOOK_URL` at W3 (`…/api/agent-workflows/hooks/monthly-trading-w3-events`) so fills/**cancels/rejects** reach order learnings.
4. Run IB Gateway (paper socket **4002**) then `.\scripts\run-bridge.ps1`.

CEO overview: [20-ibkr-monthly-trading.md](./20-ibkr-monthly-trading.md). Ops detail: [IBKR-LOCAL-BRIDGE.md](../IBKR-LOCAL-BRIDGE.md).

## Tips

- Prefer vaulted secrets from **API Keys** when an app needs a static API key (see [15-api-keys-vault.md](./15-api-keys-vault.md)).
- Failures often mean: not provisioned, OAuth expired, wrong action id, or app not connected for this CEO.
- Ask **Platform Help**: “How do I connect GitHub?” or “How do I use a Connector node?”
- Operator-level OpenConnector webhooks: `knowledgebase/OPENCONNECTOR-WEBHOOKS.md` (ops; not required for everyday CEO connect).
