# Connectors (OpenConnector + MCPs overview)

Path: **Agentic Workflows → Connectors** (`/connectors`).

Two tabs on the same page:

| Tab | Purpose | Setup guide |
|-----|---------|-------------|
| **OpenConnector** | Link SaaS apps (GitHub, Gmail, Drive, …) via OpenConnector OAuth / API keys; call from workflow **Connector** nodes | **This page** (OpenConnector sections) + ops [OPENCONNECTOR-WEBHOOKS.md](../OPENCONNECTOR-WEBHOOKS.md) |
| **MCPs** | Connect **OAuth-backed platform/registered MCP servers** (e.g. Facebook Meta Graph); call from workflow **MCP tool** nodes | **[31-mcp-connectors-oauth.md](./31-mcp-connectors-oauth.md)** (Facebook, overrides, other providers) |

Registry vs Connectors:

| | **Connectors → OpenConnector** | **Connectors → MCPs** | **MCP registry** (`/integrations/mcp`) |
|--|--------------------------------|----------------------|----------------------------------------|
| Purpose | SaaS apps via OpenConnector | Platform OAuth sessions for MCP tools | Register any HTTP/SSE MCP server |
| Use in workflows | **Connector** node | **MCP tool** node | **MCP** / **SSE Listen** / Brain MCP tools |
| Isolation | Per CEO app connections (+ optional App credential override) | Per CEO OAuth tokens (+ optional App credential override) | Per CEO (+ admin-shared) servers |

---

## OpenConnector tab (SaaS apps)

Connect **SaaS apps** to your CEO account via **OpenConnector**. Connected apps are then callable from workflow **Connector** nodes.

### First-time setup (CEO)

1. Open **Connectors**.
2. Click **Provision runtime token** (or equivalent “ensure linked”) so workflows can call apps as you.
3. Use a **starter** (Hacker News, GitHub, Gmail, Google Drive) or **search** the app catalog.
4. Open an app → follow **OAuth** (browser popup / redirect) or paste an **API key** when the provider requires it.
5. Confirm the app appears under **Your connections**.

### Disconnect

Remove a connection from the Connectors page when you no longer want workflows to use that app.

### Admin note (OAuth client config)

Admins configure OAuth **client id/secret** for OpenConnector apps (GitHub, Google, …) on the Connectors admin view (**Provider OAuth apps**). CEOs then complete the OAuth link for their own account. Without admin OAuth config, some OAuth apps cannot start unless the CEO sets a personal override.

### CEO App ID / secret override (BYOA)

For providers where the OAuth **app** is tied to Pages/orgs you own (or you prefer your own GitHub/Google app), open the app on **Connectors → OpenConnector** → **App ID / secret override…**, paste your Client ID/secret, then **Connect with OAuth**.

- Stored **per CEO** in Agent OS (secret encrypted with `USER_API_KEYS_KEK` when set).
- On Connect, Flolah passes those credentials to OpenConnector as a **connection-scoped** custom OAuth client (`connectionName` = your CEO alias). OpenConnector keeps them for **token refresh** — no global admin client swap.
- Register the same callback as the platform: `{OPENCONNECTOR_PUBLIC_ORIGIN}/oauth/callback`.
- Requires OpenConnector env `OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH` (e.g. `*` or `github,linkedin,facebook`) and `OOMOL_CONNECT_ENCRYPTION_KEY`.
- Leave override empty to use the **platform** admin OAuth client.

For OpenConnector service deploy, seed, `execute_action`, webhooks, and catalog ops: **[OPENCONNECTOR-WEBHOOKS.md](../OPENCONNECTOR-WEBHOOKS.md)** — do not configure Meta Graph Page posting here (use **MCPs** tab / help **31** for Meta).

### Use in a workflow (Connector node)

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


### Browser Session package (local worker)

On **Connectors**, download a **Windows Browser Session worker** for multi-user Client Chrome (owner-scoped token `bwk_…`):

1. Download full (portable Node) or lite.
2. Run `scripts\\Start-BrowserWorker.ps1`; leave it running; status **Online**.
3. Defaults: headed (`BROWSER_HEADLESS=0`) + persistent profile (`BROWSER_USER_DATA_DIR=browser-profile`). Log into social sites **inside that window**.
4. Optional IP rules: [33-ip-whitelists.md](./33-ip-whitelists.md). Revoke tokens: [34-tokens-management.md](./34-tokens-management.md).
5. Agent `browse_*` tools and recipes use the worker while online.

CEO help: [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md). Ops: [BROWSER-SESSION-DESKTOP-LOCAL.md](../BROWSER-SESSION-DESKTOP-LOCAL.md).

### Local IBKR bridge

On the same **Connectors** page, **Local IBKR bridge** downloads a Windows zip of the laptop HTTP adapter for IB Gateway (used by Monthly Trading **W2**).

1. Download full (portable Node) or **lite** (Node already on PATH).
2. Keep minted `LOCAL_BRIDGE_TOKEN` private — paste the same value into W2 workflow variable `local_bridge_token`.
3. Point `WEBHOOK_URL` at **your** W3 hook (`…/api/agent-workflows/hooks/monthly-trading-w3-events`) so **account snapshots**, fills, and cancels update **your** private cloud book.
4. Run IB Gateway (paper socket **4002**) then `.\\scripts\\run-bridge.ps1`.
5. Open **IBKR Summary** (`/ibkr-summary`) to review portfolio + plan vs executed; **Clear data…** reset is documented in **20**.

IBKR plans, positions, fills, and budget are **per CEO** (not shared with other users). CEO overview + simple flow diagrams: [20-ibkr-monthly-trading.md](./20-ibkr-monthly-trading.md). Ops detail: [IBKR-LOCAL-BRIDGE.md](../IBKR-LOCAL-BRIDGE.md).

### OpenConnector tips

- Prefer vaulted secrets from **API Keys** when an app needs a static API key (see [15-api-keys-vault.md](./15-api-keys-vault.md)).
- Failures often mean: not provisioned, OAuth expired, wrong action id, or app not connected for this CEO.
- Ask **Platform Help**: “How do I connect GitHub?” or “How do I use a Connector node?”
- Operator-level OpenConnector webhooks: `knowledgebase/OPENCONNECTOR-WEBHOOKS.md` (ops; not required for everyday CEO connect).

---

## MCPs tab (short)

Facebook and other OAuth MCPs: step-by-step admin include, CEO Connect, optional **App ID / secret override**, redirect URI, env vars, and troubleshooting are in **[31-mcp-connectors-oauth.md](./31-mcp-connectors-oauth.md)**.

Registry, playground, and workflow MCP nodes: [08-mcp-integrations.md](./08-mcp-integrations.md).  
Content publish / community pack: [30-content-creator-ops.md](./30-content-creator-ops.md).
