# Business Core (Twenty CRM + ERPNext + MCP)

Optional Compose overlay for platform-offered CRM/ERP used by Flolah Business Core.
Product plan: `knowledgebase/BUSINESS-CORE-WORKSPACE-PLAN.md`.
CEO guide: `knowledgebase/platform-help/32-business-core-crm-erp.md`.
Planned company P&L (meters → ERP postings): `knowledgebase/AUTOMATED-PNL.md` (pointer: platform-help **37**).

## Architecture (production)

| Piece | Default |
|-------|---------|
| Twenty containers | Compose profile `optional-twenty` (`twenty-server`, `twenty-worker`, `twenty-db`, `twenty-redis`) |
| Public CRM host | **Dedicated subdomain** `crm.<apex>` (e.g. `https://crm.flolah.cloud`) — **never** marketing `www`/`apex`, never path prefix `/crm-app` |
| Loopback publish | `127.0.0.1:3100` → nginx SSL for `crm.*` and `*.crm.*` |
| Session isolation + true SSO | Static `/flolah-handoff/` on **company workspace host** `{sub}.crm.<apex>` → `/verify?loginToken=…` |
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
# TWENTY_API_KEY=          # optional legacy single-workspace key only (SSO off); multi-CEO MCP/tools use APP_SECRET tokens
TWENTY_SERVER_URL=https://crm.example.com
TWENTY_EMBED_URL=https://crm.example.com
TWENTY_APP_SECRET=         # MUST match Twenty container APP_SECRET (SSO + per-company REST tools)
TWENTY_SSO_ENABLED=1
TWENTY_DATABASE_URL=postgres://twenty:twenty@twenty-db:5432/twenty
TWENTY_IS_MULTIWORKSPACE_ENABLED=true
TWENTY_FRONT_AUTO_BASE_URL=true
# TWENTY_BOOTSTRAP_EMAIL=  # optional Twenty admin used to create workspaces for new companies
# TWENTY_WORKSPACE_ID=     # do not share across CEOs — per-company bind via ensureCompanyTwentyWorkspace
TWENTY_DB_PASSWORD=twenty
TWENTY_HOST_PORT=3100
```

Compose wires these into **backend** (`deploy/docker-compose.yml`) and into Twenty as `APP_SECRET` / `SERVER_URL` (`docker-compose.business-core.yml`).

**Passwordless CRM SSO (true SSO):** with `TWENTY_APP_SECRET` + SSO enabled, authenticated Flolah users open CRM **in-app** via iframe handoff `/flolah-handoff/?next=/verify?loginToken=…` on the **company workspace host** `{sub}.crm.<apex>`. Backend JIT provision requires `TWENTY_DATABASE_URL` and writes `workspaceMember` into the workspace’s real `core.workspace.databaseSchema` (not the first `workspace_*` schema — that bug caused non-bootstrap CEOs such as Aru to hit “password” while Balaji worked). Company owners are provisioned as **Admin**. Server preflights `getAuthTokensFromLoginToken` before returning SSO URLs.

**Flolah logout clears CRM browser session:** the SPA calls `GET /api/business-core/crm-logout-targets` (CEO/admin scope), then loads hidden iframes to each host’s `/flolah-handoff/?logout=1&wipe=1` so Twenty `localStorage` / session storage on `crm.<apex>` and `{sub}.crm.<apex>` is wiped before the Flolah token is revoked.

**Tenancy:** **1 Flolah company → 1 Twenty workspace** (UUID + subdomain) on `company_business_profiles`. CRM open mints LOGIN SSO for that workspace only. Tools never accept foreign workspace ids for authorization. REST tools/MCP mint **owner workspace access tokens** (via `TWENTY_APP_SECRET`); do not use a single platform `TWENTY_API_KEY` for multi-CEO writes.

**Prefab agents:** Profile CRM = `twenty` → CRM Maker A/B + Checker (`crm_*` content tools).

## Nginx + handoff static

- Server block: `deploy/nginx/nginx.host-network.conf` → `crm.flolah.cloud` and `*.crm.flolah.cloud` → `127.0.0.1:3100`
- SSO/isolation page: `deploy/static/crm-handoff/` mounted at `/usr/share/nginx/crm-handoff` (see `docker-compose.yml` and `docker-compose.vps-client-ip.yml`)
- Location: `^~ /flolah-handoff/` → alias that directory (dir mode **755**, files **644**)

**DNS for multi-workspace:** A/CNAME `crm` → VPS **and** A `*.crm` → VPS (or per-workspace `{sub}.crm`).  
Cert: `bash deploy/scripts/vps-expand-crm-cert.sh` (apex + optional workspace SANs). After workspace DNS is live: `bash deploy/scripts/vps-ensure-crm-workspace-dns-cert.sh`. Ops refresh: `bash deploy/scripts/vps-refresh-tls-certs.sh [all|platform|crm]`.

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
| TWENTY_API_KEY | Optional legacy single-workspace REST key (not used when SSO owner tokens are available) |
| TWENTY_SERVER_URL / TWENTY_EMBED_URL | Public CRM host root (`https://crm.*`) |
| TWENTY_FRONT_AUTO_BASE_URL | `true` — browser API base = current origin (required for `{sub}.crm.*` multi-workspace) |
| TWENTY_APP_SECRET | Shared with Twenty; LOGIN token mint for SSO |
| TWENTY_SSO_ENABLED | `1` passwordless; `0` isolation handoff only |
| TWENTY_FRONT_AUTO_BASE_URL | `true` — front API origin = browser host (required for `{sub}.crm.*`) |
| TWENTY_DATABASE_URL | Postgres for JIT user/workspaceMember provision |
| TWENTY_IS_MULTIWORKSPACE_ENABLED | `true` on Twenty + backend (required for additional company workspaces) |
| TWENTY_BOOTSTRAP_EMAIL | Optional admin used for signUpInNewWorkspace |
| TWENTY_WORKSPACE_ID | Optional/legacy — not shared across CEOs |

**Passwordless browser SSO vs password form**

- Flolah **View as user / admin impersonation** does **not** block CRM passwordless login. Impersonation creates a session as the company CEO; CRM SSO mints a Twenty LOGIN token for that **CEO email** into the company workspace.
- You still see Twenty’s **password** screen when the LOGIN handoff did not complete (expired token, prior “Unable to Reach Back-end”, incomplete certs/DNS, or SSO env off). Use **Open** (new tab) after a fix, or **Switch CRM account**, not a different admin password.
- Force `TWENTY_SSO_ENABLED=1`, shared `TWENTY_APP_SECRET` (= Twenty `APP_SECRET`), `TWENTY_DATABASE_URL`, `TWENTY_FRONT_AUTO_BASE_URL=true`.
| ERPNEXT_* | ERP stack + embed |
| BUSINESS_CORE_MCP_URL | Internal MCP registry endpoint |

## Security

- Do not commit `deploy/.env`. Keep secrets out of logs (SSO redacts emails).
- Agent tools + MCP resolve owner → company profile → workspace/company bind only.
- Never trust body `ceo_user_id` / workspace ids for authorization.

## Org sync

`POST /api/business-core/sync-org` or tools `crm_sync_org` / `erp_sync_org`.