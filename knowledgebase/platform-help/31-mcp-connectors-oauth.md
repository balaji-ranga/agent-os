# Connectors → MCPs (OAuth MCP setup)

## Quick answers

**What is the MCPs tab?** On **Agentic Workflows → Connectors** (`/connectors`), the **MCPs** tab manages **OAuth-backed platform or registered MCP servers** (for example Facebook Meta Graph). You connect **your** session; workflows call tools as you with an **MCP tool** node.

**Is this OpenConnector?** **No.** OpenConnector is the sibling tab for SaaS app OAuth / APIs and workflow **Connector** nodes. For GitHub, Gmail, Drive, OpenConnector runtime, webhooks, and catalog setup, see the OpenConnector guides (below)—not this page.

**Where do App ID and App Secret live?**

| Layer | Who | What |
|-------|-----|------|
| **Platform default** | Admin (or env) | One Meta (or other) **app** `client_id` / `client_secret` for the product |
| **CEO override (optional)** | Each CEO | Own App ID, secret, and scopes on **App ID / secret override** |
| **OAuth session** | Each CEO | *Connect* → login grant; **access token** vaulted per CEO |

**Resolve order for client credentials:** CEO override row → if missing, **platform** admin row (`owner_user_id` empty). Secrets at rest use **`USER_API_KEYS_KEK`** (AES-GCM; prefix `enc:g1:`).

## Setup: Facebook / Meta Graph (typical)

### A. Platform operator / admin

1. Deploy Meta Graph MCP (Compose profile **`optional-meta-graph-mcp`**; `up.sh` / `vps-deploy-latest.sh` run **`ensure-platform-mcps.sh`**).
2. Create a Meta **app** at [developers.facebook.com](https://developers.facebook.com/). Note **App ID** and **App Secret** (not a Threads-only app ID if they differ).
3. **Valid OAuth Redirect URI** (exact):

   ```text
   https://<your-login-host>/api/integrations/mcp/oauth/callback
   ```

   Example: `https://login.flolah.cloud/api/integrations/mcp/oauth/callback`  
   Or set `MCP_OAUTH_CALLBACK_URL` in deploy env so the platform generates the same URL.

4. Enable **Facebook Login** (and required use cases / Page permissions). For Page posting, put Page permissions **Ready for testing** (or complete App Review for Live).

5. Credentials (pick one):
   - **UI (recommended):** Admin login → **Connectors → MCPs → Include from MCP registry** → select `mcp-meta-graph` (or seed it) → provider **Facebook** → paste App ID + Secret → **Include MCP for OAuth**.
   - **Env fallback:** `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` in `deploy/.env` (see `deploy/.env.example`). Recreate backend if you only change env.

6. Seed if needed: `docker compose exec backend node scripts/seed-meta-graph-mcp.js`  
   Smoke: `bash deploy/scripts/vps-smoke-meta-graph-mcp.sh`.

7. Ensure **`USER_API_KEYS_KEK`** is set so App secrets and vaulted tokens encrypt correctly (`up.sh` / ensure-deploy-secrets often generates it).

### B. CEO (Facebook session)

1. Open **Connectors → MCPs**.
2. **Optional:** expand **App ID / secret override**, save *your* Meta app credentials (and scopes if different). Leave empty to use platform defaults. **Use platform defaults** clears your override.
3. Click **Connect with OAuth**, finish Facebook login, return when the popup reports success.
4. Confirm the card shows **Connected** (account label / token hint).
5. In workflows, use an **MCP tool** node with server **`mcp-meta-graph`** (e.g. `get_my_pages`, `create_page_post`). Pass **Page** `page_id` from Graph—not a personal `profile.php?id=…` id.

Content publish, community, and Page rules: [30-content-creator-ops.md](./30-content-creator-ops.md).

### Development vs Live

- **Development mode:** only Meta app roles (Admin / Developer / Tester) can complete OAuth meaningfully. Add CEOs as Testers or move the app to **Live** with approved scopes.
- **API access blocked** from Meta is an **app** restriction (not Agent OS deleting posts). Check Meta developer **Alerts / Required actions**.

## Setup: other OAuth MCPs (LinkedIn, GitHub, Google, custom)

1. **Register** the MCP under **Integrations → MCP** (or a platform seed) so tools are available: [08-mcp-integrations.md](./08-mcp-integrations.md).
2. Admin: **Connectors → MCPs → Include from MCP registry** → choose provider preset (or custom authorization + token URLs) → client id/secret → include.
3. CEO: optional **App ID / secret override**, then **Connect with OAuth**.
4. Workflows: **MCP tool** node (or Brain MCP tools)—not the OpenConnector **Connector** node unless the tool intentionally wraps OpenConnector.

LinkedIn **as SaaS share/post** may use the **OpenConnector** tab and **Connector** nodes instead of Meta Graph MCP. Prefer the product path for your pack (content_creator → FB MCP primary; LI via OC when certified).

## OpenConnector configuration (separate)

For **OpenConnector** tab setup, provisioning, catalog apps, workflow **Connector** nodes, IBKR local bridge download on Connectors, and operator OpenConnector MCP/webhook detail:

| Topic | Doc |
|-------|-----|
| CEO OpenConnector connect + Connector node | OpenConnector sections in [16-connectors-openconnector.md](./16-connectors-openconnector.md) |
| OpenConnector service, seed, execute_action, webhooks (ops) | [OPENCONNECTOR-WEBHOOKS.md](../OPENCONNECTOR-WEBHOOKS.md) |
| Workflow **Connector** node attributes | [07-workflow-nodes-reference.md](./07-workflow-nodes-reference.md) |

Do **not** paste Meta Graph App secrets into OpenConnector admin fields expecting Facebook Page Graph tools—use **Connectors → MCPs**.

## Data model (operators)

Table **`mcp_oauth_configs`** (same table for admin and CEO):

- `owner_user_id = ''` → platform default row  
- `owner_user_id = <ceo-id>` → that CEO override row  
- `client_secret` → encrypted with KEK when set  
- Enabled platform rows list servers on the MCPs tab; **connections** live in **`mcp_oauth_connections`** (per CEO session/token vault refs)

## Troubleshoot

| Symptom | Check |
|---------|--------|
| Connect disabled / client not ready | Platform credentials incomplete and no CEO override; or env not loaded |
| Popup OAuth error | Redirect URI mismatch; wrong App ID; app Development mode + non-tester user |
| Token exchange fails | Decrypt/`USER_API_KEYS_KEK`; wrong secret; override vs platform app mismatch |
| Tools fail "access blocked" | Meta app restriction; Development scopes; re-Connect after fix |
| Wrong Page / no posts | Using profile id instead of Graph Page id; wrong MCP server in workflow |

## Related

- MCP registry & playground: [08-mcp-integrations.md](./08-mcp-integrations.md)  
- Connectors page overview: [16-connectors-openconnector.md](./16-connectors-openconnector.md)  
- Content / FB Page ops: [30-content-creator-ops.md](./30-content-creator-ops.md)  
- Deploy: `deploy/README.md` → Platform MCPs; `deploy/.env.example` (`META_GRAPH_MCP_URL`, `FACEBOOK_APP_*`, `MCP_OAUTH_CALLBACK_URL`, `USER_API_KEYS_KEK`)
