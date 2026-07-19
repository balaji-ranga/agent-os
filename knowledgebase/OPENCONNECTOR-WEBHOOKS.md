# OpenConnector, webhooks, email inbound, filesystem

## OpenConnector via MCP

OpenConnector runs as a **separate** service (Docker or Node). Agent OS registers it as an MCP server.

1. Start OpenConnector (or local mock):
   ```bash
   node tools/openconnector-mcp-mock/server.js
   # or: docker compose up  (oomol-lab/open-connector → http://localhost:3000/mcp)
   ```
2. Configure env (`backend/.env`): `OPENCONNECTOR_MCP_URL`, optional `OPENCONNECTOR_MCP_BEARER`
3. Seed: `node backend/scripts/seed-openconnector-mcp.js`
4. Status: `GET /api/integrations/openconnector/status`
5. Workflows: `mcp_tool` with `list_apps` / `search_actions` / `get_action_guide` / `execute_action`

## Webhooks — no central registry

There is **no** webhook registry table. Every workflow with **event** trigger mode gets its **own** endpoint:

```text
POST /api/agent-workflows/hooks/:definitionId
Header: X-Workflow-Hook-Secret: <secret>
```

Also:

- `POST /api/agent-workflows/:id/hooks/register` — enable event + ensure secret (auth)
- `POST /api/agent-workflows/:id/hooks/regenerate-secret` — rotate secret (auth)
- `GET /api/agent-workflows/:id/hook` — URL + secret (auth; UI masks secret by default)

## Email receive — also a webhook

`POST /api/integrations/email-inbound/:definitionId` (same secret). Providers POST mail; Agent OS normalizes to `email.received` and starts an event run.

## Filesystem — schedule the workflow (not a separate poller)

Use a **Filesystem** node (`list` / `exists` / `stat` / `read_text` / `move`) plus **schedule** on the Trigger node (cron). Paths must be under `WORKFLOW_FS_ROOTS` (or default `<cwd>/tmp/workflow-fs`).

Example: Trigger (schedule `*/5 * * * *`) → Filesystem (list `inbox/*.txt`) → IF `has_files` → …

## E2E

```bash
node backend/scripts/test-openconnector-webhooks-e2e.js
```
