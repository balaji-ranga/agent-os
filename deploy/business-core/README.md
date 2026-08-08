# Business Core (Twenty CRM + ERPNext + MCP)

Optional Compose overlay for platform-offered CRM/ERP used by Flolah Business Core.
Product plan: `knowledgebase/BUSINESS-CORE-WORKSPACE-PLAN.md`.
CEO guide: `knowledgebase/platform-help/32-business-core-crm-erp.md`.

## Start Twenty (CRM)

```bash
cd deploy
# set TWENTY_APP_SECRET (32+ chars) and TWENTY_DB_PASSWORD in .env
docker compose -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-twenty up -d
```

Backend env (docker network):

```env
TWENTY_API_URL=http://twenty-server:3000
TWENTY_API_KEY=   # workspace/API key from Twenty admin after first login
TWENTY_SERVER_URL=https://your-public-host:3100   # browser redirect if published
TWENTY_EMBED_URL=https://your-public-host:3100    # CRM menu iframe
```

**Tenancy:** Flolah binds **one Twenty workspace per Flolah company** and stores `twenty_workspace_id` on the business profile. Tools never accept foreign workspace ids from agent bodies for authorization.

**Prefab agents:** When Profile CRM = `twenty`, Flolah provisions **CRM Maker A**, **CRM Maker B**, **CRM Checker** for that CEO only (`crm_*` content tools).

## Start ERPNext (ERP)

```bash
docker compose -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-erpnext up -d
```

First-time site (example; adjust passwords):

```bash
docker compose -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-erpnext exec erpnext-backend bash
# Inside bench (if image includes bench CLI) create site — or use frappe_docker installer.
# Map Flolah company -> ERPNext Company, Flolah users -> ERPNext users (multi-company).
```

Backend env:

```env
ERPNEXT_URL=http://erpnext-backend:8000
ERPNEXT_API_KEY=
ERPNEXT_API_SECRET=
ERPNEXT_EMBED_URL=https://your-public-host:8085
```

**Tenancy:** Multi-user multi-company on one site; Flolah maps company and user per authenticated owner.

**Prefab agents:** When Profile ERP = `erpnext`, provisions **ERP Maker A**, **ERP Maker B**, **ERP Checker** (`erp_*` tools).

## Platform MCP (agents/workflows consume CRM + ERP)

Same tool surface as content tools, registered for workflows / MCP nodes:

```bash
# From deploy/ (or as part of ensure-platform-mcps.sh)
docker compose --profile optional-business-core-mcp up -d --build business-core-mcp
docker compose exec backend node scripts/seed-business-core-mcp.js
```

| Registry id | Tools | Container |
|-------------|-------|-----------|
| `mcp-flolah-crm` | crm_status, crm_list_people, crm_list_companies, crm_create_person | `business-core-mcp:8082` |
| `mcp-flolah-erp` | erp_status | same (shared server) |

Env:

```env
BUSINESS_CORE_MCP_URL=http://business-core-mcp:8082/mcp
# TOOLS_API_KEY must be set (compose injects it into business-core-mcp for backend calls)
```

Workflow MCP auth: pass headers `X-Ceo-User-Id: <ceo platform user id>` (and Bearer session if preferred). Deploy hook: `deploy/scripts/ensure-platform-mcps.sh` builds/seeds Brave + Meta Graph + Business Core MCPs.

Source: `tools/business-core-mcp/server.js`, `deploy/docker/business-core-mcp.Dockerfile`.

## Backend variables (summary)

| Variable | Purpose |
|----------|---------|
| TWENTY_API_URL | Platform Twenty HTTP base |
| TWENTY_API_KEY | Platform admin/API credential for workspace ops |
| TWENTY_SERVER_URL / TWENTY_EMBED_URL | Public / iframe URLs for Twenty UI |
| ERPNEXT_URL | Platform ERPNext base |
| ERPNEXT_API_KEY / ERPNEXT_API_SECRET | Frappe API keys for server-side tools |
| ERPNEXT_EMBED_URL | Public iframe for ERP menu |
| BUSINESS_CORE_MCP_URL | Internal MCP endpoint for registry |
| BUSINESS_CORE_ENABLED | `1` to advertise Business Core in APIs (default 1 when profile set) |

## Security

- Vault secrets; do not log API keys.
- Agent tools + MCP resolve owner → company profile → workspace/company bind only.

## Browser embed (iframe) on VPS

HTTPS iframe targets (same cert as `login.flolah.cloud`):

| App | Host port (loopback) | TLS nginx listen | Env |
|-----|----------------------|------------------|-----|
| Twenty | `127.0.0.1:3100` | **8443** | `TWENTY_EMBED_URL=https://login.flolah.cloud:8443` |
| ERPNext | `127.0.0.1:8085` | **8444** | `ERPNEXT_EMBED_URL=https://login.flolah.cloud:8444` |

```bash
bash deploy/scripts/ensure-business-core-env.sh   # env + start Twenty
# open firewall for 8443/8444 if your host firewall blocks them
docker compose up -d --force-recreate nginx backend
```

## Org sync

`POST /api/business-core/sync-org` or tools `crm_sync_org` / `erp_sync_org`.