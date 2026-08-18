# Business Core (Twenty CRM + ERPNext + MCP)

Optional Compose overlay for platform-offered CRM/ERP used by Flolah Business Core.
Product plan: `knowledgebase/BUSINESS-CORE-WORKSPACE-PLAN.md`.
CEO guide: `knowledgebase/platform-help/32-business-core-crm-erp.md`.
Maker/Checker SME playbooks: **39** ERPNext (O2C/P2P) and **40** Twenty CRM (Lead→Order); workspace **DOMAIN.md** is copied from `openclaw-workspace-templates/_shared/`.
Planned company P&L (meters → ERP postings): `knowledgebase/AUTOMATED-PNL.md` (pointer: platform-help **37**).

## Architecture (production)

| Piece | Default |
|-------|---------|
| Twenty containers | Compose profile `optional-twenty` (`twenty-server`, `twenty-worker`, `twenty-db`, `twenty-redis`) |
| Public CRM host | **Dedicated subdomain** `crm.<apex>` (e.g. `https://crm.flolah.cloud`) — **never** marketing `www`/`apex`, never path prefix `/crm-app` |
| Loopback publish | `127.0.0.1:3100` → nginx SSL for `crm.*` and `*.crm.*` |
| Session isolation + true SSO | Static `/flolah-handoff/` on **company workspace host** `{sub}.crm.<apex>` → `/flolah-crm-sso` (token pair apply) |
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
TWENTY_REDIS_URL=redis://twenty-redis:6379
TWENTY_IS_MULTIWORKSPACE_ENABLED=true
TWENTY_FRONT_AUTO_BASE_URL=true
# TWENTY_BOOTSTRAP_EMAIL=  # optional Twenty admin used to create workspaces for new companies
# TWENTY_WORKSPACE_ID=     # do not share across CEOs — per-company bind via ensureCompanyTwentyWorkspace
TWENTY_DB_PASSWORD=twenty
TWENTY_HOST_PORT=3100
```

Compose wires these into **backend** (`deploy/docker-compose.yml`) and into Twenty as `APP_SECRET` / `SERVER_URL` (`docker-compose.business-core.yml`).

**Passwordless CRM SSO (true SSO):** with `TWENTY_APP_SECRET` + SSO enabled, authenticated Flolah users open CRM **in-app** via iframe handoff `/flolah-handoff/?next=/verify?loginToken=…` on the **company workspace host** `{sub}.crm.<apex>`. Server-side `getAuthTokensFromLoginToken` is a membership preflight only; the browser gets a **separate** LOGIN JWT on Twenty `/verify`. That SPA page writes the token pair. Do not SSO by writing localStorage on a non-Twenty HTML page then navigating to `/` — that skips `/verify` and shows `/welcome` email login in the Flolah iframe. Backend JIT provision requires `TWENTY_DATABASE_URL` and writes `workspaceMember` into the workspace’s real `core.workspace.databaseSchema` (not the first `workspace_*` schema — that bug caused non-bootstrap CEOs such as Aru to hit “password” while Balaji worked). Company owners are provisioned as **Admin**.

**JIT membership + Redis:** Twenty caches `flatWorkspaceMemberMaps` in Redis. Flolah JIT SQL does not go through Twenty’s GraphQL layer, so after join/role changes backend **DELs** those keys via `TWENTY_REDIS_URL` (default `redis://twenty-redis:6379`) so REST tools do not return `FORBIDDEN` / “User is not a member of the workspace”.

**Flolah logout clears CRM browser session:** the SPA calls `GET /api/business-core/crm-logout-targets` (CEO/admin scope), then loads hidden iframes to each host’s `/flolah-handoff/?logout=1&wipe=1` so Twenty `localStorage` / session storage on `crm.<apex>` and `{sub}.crm.<apex>` is wiped before the Flolah token is revoked.

**Tenancy:** **1 Flolah company → 1 Twenty workspace** (UUID + subdomain) on `company_business_profiles`. CRM open mints LOGIN SSO for that workspace only. Tools never accept foreign workspace ids for authorization. REST tools/MCP mint **owner workspace access tokens** (via `TWENTY_APP_SECRET`); do not use a single platform `TWENTY_API_KEY` for multi-CEO writes.

**Prefab agents (source of truth in repo):** `backend/src/services/company-blueprints/standard/` next to industry `packs/`. **Prefab agents:** Profile CRM = `twenty` or `erpnext` → CRM Maker A/B + Checker (`crm_*` or Sales `erp_*`) **only in that CEO's org**. Profile ERP = `erpnext` → ERP Maker A/B + Checker + P&L / Invoice / Project Manager. After provision, Maker/Checker runbook workflows seed (`run erp maker checker` / `run crm maker checker`) with optional `needs_ceo` → **ceo_approval** (e.g. 5% discount). COO multi-phase goals use durable **agent goal plans** (`agent_goal_create` async ack / scheduled plan mode new `agr-…` each fire / multiphase-trigger upgrade): platform advances CRM→ERP after each async terminal; status callbacks name **goal plan id + title** when bound. Workflow integer `run_id` ≠ goal plan. COO gets CEO-scoped **read-only** `crm_*`/`erp_*` list tools. Platform Help is **docs-only** for CRM/ERP (help **39–40**). Switching CRM or ERP away from platform provider **removes those prefab agents from the org** (agents remain in the platform catalog disabled for the CEO until re-selected).

## Nginx + handoff static

- Server block: `deploy/nginx/nginx.host-network.conf` → `crm.flolah.cloud` and `*.crm.flolah.cloud` → `127.0.0.1:3100`
- SSO/isolation page: `deploy/static/crm-handoff/` mounted at `/usr/share/nginx/crm-handoff` (see `docker-compose.yml` and `docker-compose.vps-client-ip.yml`)
- Location: `^~ /flolah-handoff/` → alias that directory (dir mode **755**, files **644**)
- SSO apply: `location = /flolah-crm-sso` → `http://127.0.0.1:3001/api/business-core/crm-sso-apply` (must stay **before** `location /` Twenty proxy). Keep `proxy_buffer_size 32k` (and matching buffers) so a future header regression cannot 502.

**DNS for multi-workspace:** A/CNAME `crm` → VPS **and** A `*.crm` → VPS (or per-workspace `{sub}.crm`).  
Cert: `bash deploy/scripts/vps-expand-crm-cert.sh` (apex + optional workspace SANs). After workspace DNS is live: `bash deploy/scripts/vps-ensure-crm-workspace-dns-cert.sh`. Ops refresh: `bash deploy/scripts/vps-refresh-tls-certs.sh [all|platform|crm]`.

**Automated SANs for every new company:** Platform cron **`crm_tls_workspace_certs`** (Admin → Crons) + post-workspace-create debounce + **backend boot re-sync**. Gap detection requires an **exact** `{sub}.crm.*` SAN (apex `crm.*` does not count). Deploy logs SAN MISS after nginx recreate.

## Start ERPNext (ERP)

**Database:** ERPNext requires **MariaDB** (`erpnext-db`). Twenty CRM keeps **Postgres** (`twenty-db`). Tenancy maps match CRM isolation in Flolah SQLite (1 CEO → 1 ERPNext Company), not a shared Postgres schema for Frappe data.

```bash
START_ERPNEXT=1 bash deploy/scripts/ensure-business-core-env.sh
# or
docker compose -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-erpnext up -d
# Wait for erpnext-create-site to exit 0, then erpnext-backend healthy
```

Backend:

```env
ERPNEXT_URL=http://erpnext-frontend:8080
ERPNEXT_SITE_NAME=frontend
ERPNEXT_API_KEY=          # Desk → User → API Access after first site
ERPNEXT_API_SECRET=
ERPNEXT_SSO_ENABLED=1
ERPNEXT_DEFAULT_COUNTRY=United States
ERPNEXT_DEFAULT_CURRENCY=USD
# Tenant isolation: custom Link flolah_company on Customer/... + strict UP
# ERPNEXT_STRICT_USER_PERMISSIONS=1
# ERPNEXT_TENANT_BACKFILL=1
ERPNEXT_EMBED_URL=https://erp.crm.example.com
ERPNEXT_PUBLIC_URL=https://erp.crm.example.com
# Prefer :443 (erp.crm.* reuses CRM DNS wildcard). Avoid login…:8444 when the host firewall only allows 443.
ERPNEXT_ADMIN_PASSWORD=admin   # initial Administrator password from create-site
```

**SSO:** CRM menu → Twenty workspace-origin `/flolah-handoff/` then `/verify?loginToken=…` **or** ERPNext desk (`/app/crm`) when CRM=ERPNext. ERP menu → `/flolah-erp-handoff/?t=…` → same-origin `/flolah-erp-sso` (Set-Cookie `sid` + 302 Desk) for company-scoped user. Requires nginx proxy for ERP `erp-sso-apply` and optional CRM `crm-sso-apply` fallback (see `nginx.host-network.conf`).

**Tenant isolation (desk + agents share CEO scope):**

| Layer | How |
|-------|-----|
| Map | 1 Flolah CEO → 1 ERPNext **Company** + SSO User (not System Manager) + Company User Permission + User UP (self) |
| Global masters | Custom field **`flolah_company`** on Customer, Supplier, Lead, Contact, Address, Item, Item Price, Opportunity; strict User Permissions; backfill via `ERPNEXT_TENANT_BACKFILL` |
| Transactions | Native `company` forced/filtered on invoices, orders, stock, projects, GL, warehouse, accounts, … |
| Fiscal Year | Site-global year name; tools link bound company only and **never return** peer company names |
| Agents / MCP | API key + `X-Ceo-User-Id` → same bound company filters as desk (cannot list peer masters) |
| Org sync | `erp_sync_org` / `crm_sync_org`: Departments + **Employees** (not desk Users) under company |

Remaining shared setup masters (Item Group, Mode of Payment, …) are not `flolah_company`-tagged yet — see platform-help **32**.

**Prefab agents:** CRM Maker A/B + Checker (Twenty `crm_*` or ERPNext sales `erp_*`); ERP Maker A (finance/setup: company + fiscal write + money path), Maker B (ops/stock, company/fiscal read), Checker (submit/cancel + Kanban/workflow approvals), plus P&L / Invoice / Project specialists. A∪B ≈ CEO desk ops for the bound company.

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
| TWENTY_REDIS_URL | Same as Twenty `REDIS_URL`; invalidate flat member maps after JIT join |
| TWENTY_IS_MULTIWORKSPACE_ENABLED | `true` on Twenty + backend (required for additional company workspaces) |
| Twenty workspace cap | Self-hosted without a valid enterprise key: **5 workspaces**. Soft-delete unused `core.workspace` (`deletedAt`) to free a slot; never share across CEOs. ERP provision is independent of CRM. |
| TWENTY_BOOTSTRAP_EMAIL | Optional admin used for signUpInNewWorkspace |
| TWENTY_WORKSPACE_ID | Optional/legacy — not shared across CEOs |
| ERPNEXT_URL | Internal Frappe base (prefer `http://erpnext-frontend:8080`) |
| ERPNEXT_API_KEY / ERPNEXT_API_SECRET | Site API token for tools (bypasses desk UP — Flolah re-applies company filters) |
| ERPNEXT_SSO_ENABLED | Default on — passwordless desk handoff |
| ERPNEXT_DEFAULT_COUNTRY / CURRENCY | Used when provisioning Company |
| ERPNEXT_STRICT_USER_PERMISSIONS | `1` (default in code) — untagged Link company fields hidden on desk |
| ERPNEXT_TENANT_BACKFILL | `1` (default) — stamp `flolah_company` on existing global masters |
| ERPNEXT_EMBED_URL / ERPNEXT_PUBLIC_URL | Public ERP host (`https://erp.crm.*`) |
| BUSINESS_CORE_MCP_URL | Internal MCP registry endpoint |

**Passwordless browser SSO vs password form (Twenty)**

- Flolah **View as user / admin impersonation** does **not** block CRM passwordless login. Impersonation creates a session as the company CEO; CRM SSO mints a Twenty LOGIN token for that **CEO email** into the company workspace.
- You still see Twenty’s **password** screen when the LOGIN handoff did not complete (expired token, prior “Unable to Reach Back-end”, incomplete certs/DNS, or SSO env off). Use **Open** (new tab) after a fix, or **Switch CRM account**, not a different admin password.
- Force `TWENTY_SSO_ENABLED=1`, shared `TWENTY_APP_SECRET` (= Twenty `APP_SECRET`), `TWENTY_DATABASE_URL`, `TWENTY_REDIS_URL`, `TWENTY_FRONT_AUTO_BASE_URL=true`.

## Security

- Do not commit `deploy/.env`. Keep secrets out of logs (SSO redacts emails).
- Agent tools + MCP resolve owner → company profile → workspace/company bind only.
- Never trust body `ceo_user_id` / workspace ids for authorization.

## Org sync

`POST /api/business-core/sync-org` or tools `crm_sync_org` / `erp_sync_org`.

- **Twenty CRM:** people/dept stubs under workspace.
- **ERPNext:** ensures real Company + departments (`{name} - {abbr}`) + **Employees** for AI employees (HR fields: joining date, gender, DOB). Does **not** create desk Users per agent. Also tightens SSO desk permissions (Company + self User).

## CRM provider: ERPNext vs Twenty

- Profile **CRM = Twenty** → CRM menu SSO → Twenty workspace (`crm.*`).
- Profile **CRM = ERPNext** → CRM menu SSO → ERPNext desk Sales/CRM (`erp.crm.*` / `ERPNEXT_EMBED_URL`).
- Profile **ERP = ERPNext** → ERP menu + Maker A/B / Checker / specialists with expanded `erp_*` tools (mirrored in `mcp-flolah-erp` and content tools).
- Twenty uses Postgres (`twenty-db`); ERPNext uses MariaDB (`erpnext-db`) — not shared.
