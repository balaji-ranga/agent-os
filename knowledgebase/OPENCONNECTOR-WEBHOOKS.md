# OpenConnector, webhooks, email inbound, filesystem

## OpenConnector via MCP

OpenConnector runs as a **separate** service (Docker or Node). Agent OS registers it as an MCP server.

1. Start OpenConnector (or local mock):
   ```bash
   node tools/openconnector-mcp-mock/server.js
   # or: docker compose --profile optional-openconnector up -d
   ```
2. Configure env (`deploy/.env`): `OPENCONNECTOR_URL`, `OPENCONNECTOR_ADMIN_TOKEN`, `OPENCONNECTOR_ENCRYPTION_KEY`, `OPENCONNECTOR_PUBLIC_ORIGIN` / `OOMOL_CONNECT_ORIGIN`
3. **CEO BYOA OAuth apps:** set `OOMOL_CONNECT_ALLOWED_CUSTOM_OAUTH=*` (or a provider list) on the `openconnector` service. Use image tag **`tip`** (`OPENCONNECTOR_IMAGE_TAG=tip`) — official `v1.3.5` / `:latest` ignores per-connection `clientId`. Flolah stores CEO overrides and passes them on Connect (help **16**).
4. Seed MCP row: `node backend/scripts/seed-openconnector-mcp.js`
5. Status: `GET /api/integrations/openconnector/status`
6. Smoke override + HN: `docker compose exec -T backend node scripts/test-openconnector-oauth-override.js`
7. Workflows: `mcp_tool` with `list_apps` / `search_actions` / `get_action_guide` / `execute_action`

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

Use a **Filesystem** node (`list` / `exists` / `stat` / `read_text` / `write_text` / `move`) plus **schedule** on the Trigger node (cron). Local disk on Flolah must be under `WORKFLOW_FS_ROOTS` (or default `<cwd>/tmp/workflow-fs`). Desktop packages read/write the laptop. FTP/SFTP use host + vault password (or SFTP key).

Example: Trigger (schedule `*/5 * * * *`) → Filesystem (list `inbox/*.txt`) → IF `has_files` → …

## E2E

```bash
node backend/scripts/test-openconnector-webhooks-e2e.js
```
