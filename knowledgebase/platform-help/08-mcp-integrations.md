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
- Keep secrets out of exported workflow JSON when sharing definitions.
- Local/dev: a random SSE MCP test server may run on port 3099 (`tools/local-mcp-random-sse/`).
- **Brave Search MCP:** BYOK HTTP MCP (`optional-brave-mcp`). Rebuild with `docker compose --profile optional-brave-mcp up -d --build brave-search-mcp`. Pass `X-Subscription-Token` or Bearer from the workflow MCP / Brain auth headers — the container does **not** use `BRAVE_API_KEY`. Seed: `node backend/scripts/seed-brave-search-mcp.js`. Demo: `seed-balaji-brave-byok-workflow.js` / `test-balaji-brave-byok-workflow.js`.
- OpenConnector and other ops MCP setups: see operator docs in `knowledgebase/OPENCONNECTOR-WEBHOOKS.md` (admin/ops; CEOs still use the MCP UI the same way).
