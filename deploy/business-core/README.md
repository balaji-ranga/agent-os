# Business Core (Twenty CRM + ERPNext + MCP)

Optional Compose overlay for platform-offered CRM/ERP used by Flolah Business Core.
Product plan: `knowledgebase/BUSINESS-CORE-WORKSPACE-PLAN.md`.
CEO guide: `knowledgebase/platform-help/32-business-core-crm-erp.md`.

## Architecture (production)

| Piece | Default |
|-------|---------|
| Twenty containers | Compose profile `optional-twenty` (`twenty-server`, `twenty-worker`, `twenty-db`, `twenty-redis`) |
| Public CRM host | **Dedicated subdomain** `crm.<apex>` (e.g. `https://crm.flolah.cloud`) — **never** marketing `www`/`apex`, never path prefix `/crm-app` |
| Loopback publish | `127.0.0.1:3100` → nginx SSL on host network for `crm.*` |
| Session isolation + true SSO | Static `/flolah-handoff/` on CRM host → Twenty `/verify?loginToken=…` |
| Backend | Same compose project; injects `TWENTY_*` including `APP_SECRET`, `DATABASE_URL`, SSO flags |

## One-shot env + start (repeatable)

```bash
cd /opt/agent-os   # or repo root
# DNS: A crm.<apex> → VPS; expand LE SANs if needed:
#   bash deploy/scripts/vps-expand-crm-cert.sh
bash deploy/scripts/ensure-business-core-env.sh
# COMPOSE_FILE already includes business-core overlay when set in up.sh / VPS profile
docker compose --env-file deploy/.env -f deploy/docker-compose.yml -f deploy/docker-compose.business-core.yml \
  --profile optional-twenty up -d
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --no-deps --force-recreate --build backend nginx
```

`ensure-business-core-env.sh` is idempotent: fills missing `TWENTY_*` / ERP embed hosts, forces `crm.<apex>` for embed URLs, enables SSO + DATABASE_URL, starts Twenty when `START_TWENTY=1` (default).

## Backend env (docker network + SSO)

```env
TWENTY_API_URL=http://twenty-server:3000
# TWENTY_API_KEY=          # optional platform API key after first admin login (tools/MCP)
TWENTY_SERVER_URL=https://crm.example.com
TWENTY_EMBED_URL=https://crm.example.com
TWENTY_APP_SECRET=         # MUST match Twenty container APP_SECRET (required for passwordless SSO)
TWENTY_SSO_ENABLED=1
TWENTY_DATABASE_URL=postgres://twenty:twenty@twenty-db:5432/twenty
# TWENTY_WORKSPACE_ID=     # optional UUID; else auto-discover first ACTIVE workspace via DATABASE_URL
TWENTY_DB_PASSWORD=twenty
TWENTY_HOST_PORT=3100
```

Compose wires these into **backend** (`deploy/docker-compose.yml`) and into Twenty as `APP_SECRET` / `SERVER_URL` (`docker-compose.business-core.yml`).

**Passwordless CRM SSO (true SSO):** with `TWENTY_APP_SECRET` + SSO enabled, authenticated Flolah users open CRM via `/flolah-handoff/` → mint LOGIN JWT for their email → `/verify?loginToken=`. JIT membership uses Postgres when `TWENTY_DATABASE_URL` is set (`pg` dependency on backend).

**Tenancy:** profile binds `twenty_workspace_id` per CEO owner. Tools never accept foreign workspace ids from agent bodies for authorization. A single platform Twenty still shares CRM **data** unless multiple Twenty workspaces are provisioned later.

**Prefab agents:** Profile CRM = `twenty` → CRM Maker A/B + Checker (`crm_*` content tools).

## Nginx + handoff static

- Server block: `deploy/nginx/nginx.host-network.conf` → `crm.flolah.cloud` proxies to `127.0.0.1:3100`
- SSO/isolation page: `deploy/static/crm-handoff/` mounted at `/usr/share/nginx/crm-handoff` (see `docker-compose.yml` and `docker-compose.vps-client-ip.yml`)
- Location: `^~ /flolah-handoff/` → alias that directory (dir mode **755**, files **644**)

Cert SANs: `deploy/scripts/vps-expand-crm-cert.sh` (requires DNS `crm` → VPS).

## Start ERPNext (ERP)

```bash
START_ERPNEXT=1 bash deploy/scripts/ensure-business-core-env.sh
# or
docker compose -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-erpnext up -d
```

Backend:

```env
ERPNEXT_URL=http://erpnext-backend:8000
ERPNEXT_API_KEY=
ERPNEXT_API_SECRET=
ERPNEXT_EMBED_URL=https://login.example.com:8444
ERPNEXT_PUBLIC_URL=https://login.example.com:8444
```

## Platform MCP

```bash
docker compose --profile optional-business-core-mcp up -d --build business-core-mcp
docker compose exec backend node scripts/seed-business-core-mcp.js
```

| Registry id | Tools |
|-------------|-------|
| `mcp-flolah-crm` | crm_* REST proxy (people, companies, opportunities, sync_org, …) |
| `mcp-flolah-erp` | erp_* REST proxy |

```env
BUSINESS_CORE_MCP_URL=http://business-core-mcp:8082/mcp
```

Pass `X-Ceo-User-Id` on workflow MCP auth. Deploy hook: `deploy/scripts/ensure-platform-mcps.sh`.

## Backend variables (summary)

| Variable | Purpose |
|----------|---------|
| TWENTY_API_URL | Internal Twenty HTTP base |
| TWENTY_API_KEY | Optional REST key for tools/MCP |
| TWENTY_SERVER_URL / TWENTY_EMBED_URL | Public CRM host root (`https://crm.*`) |
| TWENTY_APP_SECRET | Shared with Twenty; LOGIN token mint for SSO |
| TWENTY_SSO_ENABLED | `1` passwordless; `0` isolation handoff only |
| TWENTY_DATABASE_URL | Postgres for JIT user/workspaceMember provision |
| TWENTY_WORKSPACE_ID | Optional real workspace UUID |
| ERPNEXT_* | ERP stack + embed |
| BUSINESS_CORE_MCP_URL | Internal MCP registry endpoint |

## Security

- Do not commit `deploy/.env`. Keep secrets out of logs (SSO redacts emails).
- Agent tools + MCP resolve owner → company profile → workspace/company bind only.
- Never trust body `ceo_user_id` / workspace ids for authorization.

## Org sync

`POST /api/business-core/sync-org` or tools `crm_sync_org` / `erp_sync_org`.