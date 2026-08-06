# MCP integrations onboarding

## What MCP is in Flolah

**MCP (Model Context Protocol)** servers expose tools, prompts, and resources. You register them once, test them, then use them in:

- Workflow **MCP** nodes
- Workflow **SSE Listen** nodes (event streams)
- **Brain** nodes with MCP tool-calling enabled

## Register an MCP server

Path: **MCP** → `/integrations/mcp`.

1. Click **+ Register server**.
2. Fill:
   - **Name** and **description**
   - **URL** (for HTTP transports)
   - **Transport:** `streamable_http` | `sse` | `stdio` (as supported)
3. Save. CEOs see their own servers plus admin-shared platform MCPs.

**Auth:** Registry often does **not** permanently store secrets the way you might expect — enter auth when you **Test server** (`/integrations/mcp/test/:serverId`) or on the workflow Brain / MCP node (headers / per-MCP auth JSON).

## Test server playground

1. Open the server → **Test**.
2. Connect, browse tools/prompts/resources.
3. Call a tool with sample arguments; review logs.
4. Confirm tools appear before wiring workflows.

## Use MCP in a workflow

### MCP node

1. Add **MCP** from the palette.
2. Set `mcpInvokeKind`: tool | prompt | resource.
3. Select `mcpServerId` and tool/prompt/resource name or URI.
4. Add `staticArguments` JSON; bind dynamic `arguments` / `uri` from prior steps if needed.
5. **Auth (static or dynamic):** optional **Bearer token** and/or HTTP headers on the node. Values support `{{nodeId.path}}` templates (e.g. `{{api-login.body.accessToken}}` from a prior API login). Same for Brain per-server auth headers and SSE Listen headers. Full patterns: [14-workflow-dynamic-values.md](./14-workflow-dynamic-values.md).
6. Map outputs `text` / `result` / `ok` downstream.

### Brain + MCP tool calling

1. Add **Brain**.
2. Enable `mcpToolCalling`.
3. Set `mcpServerIds` (JSON array of server ids), optional allowlist, max rounds, per-server auth.
4. The LLM may call MCP tools in a loop; inspect `mcp_tool_calls` output.

### SSE Listen

1. Add **SSE Listen**.
2. Provide `streamUrl` **or** MCP server + `eventsPath`.
3. Downstream nodes run per event (`event`, `text`, …).
4. Stop listen on the active run when finished.

## Tips

- Prefer Content Tool nodes when an Agent OS catalog tool already wraps the capability.
- Keep secrets out of exported workflow JSON when sharing definitions — use **API Keys** vault refs where possible ([15-api-keys-vault.md](./15-api-keys-vault.md)).
- Local/dev: a random SSE MCP test server may run on port 3099 (`tools/local-mcp-random-sse/`).
- **Brave Search MCP:** BYOK HTTP MCP (`optional-brave-mcp`). Rebuild with `docker compose --profile optional-brave-mcp up -d --build brave-search-mcp`. Pass `X-Subscription-Token` or Bearer from the workflow MCP / Brain auth headers (or vault) — the container does **not** use `BRAVE_API_KEY`. Seed: `node backend/scripts/seed-brave-search-mcp.js`. Demo: `seed-balaji-brave-byok-workflow.js` / `test-balaji-brave-byok-workflow.js`.
- **Meta Graph MCP (Facebook / Instagram):** HTTP MCP (`optional-meta-graph-mcp`). Platform server `mcp-meta-graph`. Operators set Meta **app** credentials (`FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`); each CEO connects their own Facebook session under **Connectors → MCPs**. OAuth tokens are vaulted per CEO; workflows use **MCP tool** nodes (not OpenConnector connector nodes). Callback: `GET /api/integrations/mcp/oauth/callback` (public). Deploy: `ensure-platform-mcps.sh` (from `up.sh` / `vps-deploy-latest.sh`). Smoke: `deploy/scripts/vps-smoke-meta-graph-mcp.sh`.
- Only MCPs with an enabled row in **`mcp_oauth_configs`** appear on the Connectors → **MCPs** tab (not every server from the registry). Facebook shows by default because seed creates that config for `mcp-meta-graph`. Brave Search does not appear (header BYOK, no OAuth).
- **Include any OAuth MCP:** Admin opens **Connectors → MCPs → Include from MCP registry**, picks a server already registered under [Integrations → MCP](./08-mcp-integrations.md) (or seed a new one), chooses a provider preset (Facebook, LinkedIn, GitHub, Google, or custom OAuth 2.0), sets client id/secret (or env), and saves. CEOs then **Connect** their own session. Future LinkedIn MCP: register the server, then Include with provider `linkedin`.
- Soft-remove with **Remove from tab** (disables OAuth config; does not delete the MCP registry row).
- Deploy repeatability: `deploy/scripts/ensure-platform-mcps.sh` starts both optional profiles and seeds `mcp-brave-search` + `mcp-meta-graph` (`is_platform=1`). Skip with `SKIP_PLATFORM_MCPS=1`.
- **Connectors (OpenConnector SaaS apps)** are separate from MCP tool servers — see [16-connectors-openconnector.md](./16-connectors-openconnector.md). The Connectors **UI also has an MCPs tab** for OAuth-backed MCP sessions. Operator OpenConnector webhooks: `knowledgebase/OPENCONNECTOR-WEBHOOKS.md`.
