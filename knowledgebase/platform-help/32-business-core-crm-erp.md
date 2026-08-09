# Business Core ├óΓé¼ΓÇ¥ CRM (Twenty), ERP (ERPNext), prefab Maker/Checker, MCP

## Quick answers

**What is Business Core?** Optional platform CRM and ERP bound to your company: **Twenty** for CRM, **ERPNext** for ERP. Not required to use Flolah. Select under **Profile** or **Company setup ├óΓÇáΓÇÖ Systems**.

**When I pick platform CRM or ERP, do I get the Maker/Checker AI employees?** **Yes.**  
- Profile or Company setup Apply with **CRM = Twenty** only: provisions **CRM Maker A**, **CRM Maker B**, **CRM Checker** into **your org**. Not added if CRM is none/HubSpot/Zoho. Switching away **removes** them from the org.
- **ERP = ERPNext** only: provisions **ERP P&L**, **ERP Invoice**, **ERP Project Manager** into **your org**. Not added if ERP is none/Xero. Switching away **removes** them from the org.
They appear under **AI Employees** / chat picker and use **content tools** (`crm_*`, `erp_*`).

**Is there MCP for agents and workflows?** **Yes ├óΓé¼ΓÇ¥ real HTTP proxy to Twenty / ERPNext REST (v2), not dummy stubs.** Platform registry seeds (same **business-core-mcp** container):  
- **`mcp-flolah-crm`** ├óΓé¼ΓÇ¥ `crm_status`, people/companies CRUD list, **opportunities/deals**, **leads** (Twenty has no separate Lead object by default ├óΓÇáΓÇÖ early-stage opportunities: NEW/SCREENING/MEETING/PROPOSAL/QUALIFIED), notes, tasks, `crm_sync_org`  
- **`mcp-flolah-erp`** ├óΓé¼ΓÇ¥ `erp_status`, customers, leads, items, quotations, sales orders, projects, generic `erp_list_resource` / `erp_create_resource` / `erp_get_resource`, `erp_sync_org`  

Requires **`TWENTY_APP_SECRET` + SSO** (preferred) so CRM REST tools mint a **per-company workspace** access token. A single platform `TWENTY_API_KEY` only applies when SSO is off (legacy shared workspace). ERPNext API key/secret remain on platform env for live ERP data. OpenClaw AI employees use matching **content tools** (Tool access grants); workflows use **MCP nodes** / Brain MCP on these server ids.

**How does owner scope work?** Pass **`X-Ceo-User-Id`** (your company CEO id) on MCP auth headers from the workflow, or `owner_user_id` in tool args when using service key. Tools resolve Twenty workspace / ERPNext company from **your** business profile ├óΓé¼ΓÇ¥ never trust a foreign company id for authorization.

**When do CRM / ERP nav links appear?** Only when Profile provider is **twenty** / **erpnext**: left nav **CRM** (`/crm`) and **ERP** (`/erp`) open the platform embeds. Daily operate surface: **`/work`** (Work).

## CEO setup checklist

1. **Profile** (or Company setup Systems) ├óΓÇáΓÇÖ set CRM to **Twenty** and/or ERP to **ERPNext** ├óΓÇáΓÇÖ Save / Apply.  
2. Confirm Maker/Checker employees appear under **AI Employees** / Chat picker.  
3. Optional: open **CRM** / **ERP** menus when embeds are configured (`TWENTY_EMBED_URL` / `ERPNEXT_EMBED_URL`).  
4. Workflows: **Integrations ├óΓÇáΓÇÖ MCP** ├óΓÇáΓÇÖ platform servers `mcp-flolah-crm` / `mcp-flolah-erp` ├óΓÇáΓÇÖ Test ├óΓÇáΓÇÖ use in MCP or Brain nodes with header `X-Ceo-User-Id: <your ceo user id>`.  
5. Agents chat: grant `crm_*` / `erp_*` on the prefab employees (already granted at provision).

## Operators (deploy)

| Piece | Detail |
|-------|--------|
| MCP image | `deploy/docker/business-core-mcp.Dockerfile` ├é┬╖ `tools/business-core-mcp/server.js` |
| Compose profile | `optional-business-core-mcp` ├é┬╖ service `business-core-mcp` ├é┬╖ port 8082 |
| Env | `BUSINESS_CORE_MCP_URL=http://business-core-mcp:8082/mcp`, `TOOLS_API_KEY` (injected into MCP container for backend calls) |
| Seed | `node backend/scripts/seed-business-core-mcp.js` or `deploy/scripts/ensure-platform-mcps.sh` |
| CRM/ERP stacks | `deploy/docker-compose.business-core.yml` ├é┬╖ [business-core/README.md](../../deploy/business-core/README.md) |
| Plan | [BUSINESS-CORE-WORKSPACE-PLAN.md](../BUSINESS-CORE-WORKSPACE-PLAN.md) |

## Related

- MCP registry / workflows: [08-mcp-integrations.md](./08-mcp-integrations.md)  
- Company setup: [29-company-setup.md](./29-company-setup.md)  
- Navigation: [02-navigation-and-chrome.md](./02-navigation-and-chrome.md)  
- Content tools: [11-content-tools-scripts-profile.md](./11-content-tools-scripts-profile.md)

## Databases (platform SoR on VPS)

| System | Compose service | Engine | Notes |
|--------|-----------------|--------|-------|
| **Twenty CRM** | `twenty-db` | **PostgreSQL 16** | One workspace per Flolah company |
| **ERPNext ERP** | `erpnext-db` | **MariaDB 10.11** | Multi-company site; Flolah company map |
| Flolah itself | backend volume | **SQLite** | agents, profile, binds (not CRM/ERP rows) |

## CRM / ERP iframe

Ops set browser-reachable HTTPS URLs (mixed content blocks `http://` iframes on `https://login├óΓé¼┬ª`):

- `TWENTY_EMBED_URL` / `TWENTY_SERVER_URL` ├óΓé¼ΓÇ¥ **`https://crm.flolah.cloud`** (dedicated CRM subdomain)
- \ERPNEXT_EMBED_URL\ / \ERPNEXT_PUBLIC_URL\ — **\https://erp.crm.flolah.cloud\** (nginx TLS :443 → ERPNext on W.0.0.1:8085\; reuses \*.crm\ DNS). Do **not** rely on \:8444\ (Hostinger often drops it).

**If the iframe stays blank but Flolah itself loads:** confirm the embed host is on **:443**, cert SAN includes the ERP host (\ash deploy/scripts/vps-expand-crm-cert.sh\), and nginx has the exact \erp.crm…\ server before the CRM wildcard. Twenty does **not** support path-prefix embeds under \/crm/...\.

Deploy helper: `deploy/scripts/ensure-business-core-env.sh` (starts Twenty by default; **ERPNext profile is off** until `START_ERPNEXT=1`).

### Where is ERP running?

**By default: nowhere on the VPS.** Compose profile `optional-erpnext` is separate from Twenty. You will **not** see `erpnext-*` containers until:

```bash
START_ERPNEXT=1 bash deploy/scripts/ensure-business-core-env.sh
# or
docker compose -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-erpnext up -d
```

Even then the current overlay is **infra + stub backend** (site init still required ├óΓé¼ΓÇ¥ see `deploy/business-core/README.md`). Public ERP host returns **502** until a real ERPNext site listens on 127.0.0.1:8085.

### Flolah company ├óΓÇáΓÇ¥ CRM / ERP wiring

| Layer | Storage | Rule |
|-------|---------|------|
| Profile choice | SQLite `company_business_profiles` | `crm_provider=twenty|erpnext` / `erp_provider=erpnext` per **CEO owner** |
| CRM bind | `twenty_workspace_id` (+ bind JSON) | **One Twenty workspace per Flolah company** |
| ERP bind | `erpnext_company_id` (+ user map table) | **One ERPNext Company per Flolah company** (multi-company site later) |
| Authorization | tools + embeds | Always `resolveAuthenticatedCeoUserId` ├óΓé¼ΓÇ¥ never body-supplied foreign owner/workspace |

**Init / sync:** Profile Apply + provision runs `ensureTwentyWorkspaceForCompany` (real Twenty workspace UUID + subdomain when multi-workspace is enabled) / `ensureErpnextCompanyForOwner`. Live org population uses:

- UI: CRM or ERP page ├óΓÇáΓÇÖ **Sync Flolah org**
- API: `POST /api/business-core/sync-org` `{ "targets": ["crm"] }` or `["erp"]`
- Tools / MCP: `crm_sync_org`, `erp_sync_org`

Sync copies Flolah **departments** (Master Data) + **entitled AI employees** into Twenty people / ERPNext Department+Employee when company CRM REST auth works (owner workspace token via SSO) or ERPNext key/secret are set.

## Prefab Maker/Checker tool access

When Profile selects platform CRM/ERP, Maker/Checker packs receive full **`crm_*` / `erp_*` content tools** (including sync). OpenClaw uses content tools (same endpoints as MCP); workflows use MCP nodes with `X-Ceo-User-Id`.

## CRM browser session vs Flolah user

**Issue:** Browser cookies must not leak across Flolah companies. Each company also needs its **own** Twenty workspace (data isolation).

**Mapping:** **1 Flolah company (CEO owner)** ├óΓÇáΓÇÖ **1 Twenty workspace** (UUID + subdomain), stored on `company_business_profiles` (`twenty_workspace_id` + bind JSON with `subdomain`). Ensured on CRM open / Profile provision via `ensureCompanyTwentyWorkspace` (GraphQL `signUpInNewWorkspace` + `activateWorkspace` when multi-workspace is on). Local `flolah-ws-*` binds are upgraded to real remote workspaces.

**On CRM click (`/crm`):**
1. Resolve authenticated owner (never body `ceo_user_id` for auth).
2. Ensure company workspace (create if missing / non-UUID).
3. JIT-add the signed-in Flolah user into **that** workspace only.
4. Mint LOGIN JWT for **that** `workspaceId` (`APP_SECRET` + workspace + `LOGIN`).
5. Browser handoff on the **workspace origin** `https://{subdomain}.crm.<apex>/flolah-handoff/?next=/verify?loginToken=├óΓé¼┬ª` then `/verify`.

**Mitigation (always):** handoff wipes cookies/localStorage on owner change / `wipe=1` / loginToken (`deploy/static/crm-handoff/`).

| Env | Purpose |
|-----|---------|
| `TWENTY_APP_SECRET` | Same as Twenty `APP_SECRET` ├óΓé¼ΓÇ¥ mint LOGIN tokens |
| `TWENTY_SSO_ENABLED` | Default on when secret set; `0` = isolation handoff only |
| `TWENTY_DATABASE_URL` | JIT user + membership in company workspace |
| `TWENTY_IS_MULTIWORKSPACE_ENABLED` | **`true`** on Twenty server/worker ├óΓé¼ΓÇ¥ required to create additional workspaces |
| `TWENTY_BOOTSTRAP_EMAIL` | Optional admin used to call `signUpInNewWorkspace` (else first ACTIVE member) |
| `TWENTY_EMBED_URL` / `TWENTY_SERVER_URL` | Platform front origin `https://crm.<apex>` (subdomains built from this host) |

### CRM menu blank / server IP address could not be found

Twenty multi-workspace opens each company at https://{workspace-subdomain}.crm.flolah.cloud. Nginx already accepts *.crm.flolah.cloud, but **public DNS must resolve those names**.

| Symptom | Cause |
|---------|--------|
| Browser: host server IP address could not be found | No A/CNAME for workspace host (NXDOMAIN). Apex crm.flolah.cloud alone is not enough. |
| TLS error after DNS works | Cert SANs missing that host |

**Hostinger DNS (zone flolah.cloud) ΓÇö do one of:**

1. **Wildcard (preferred)** ΓÇö Type A, Name `*.crm`, Points to `76.13.209.30`, TTL 300
2. **Per workspace** ΓÇö Type A, Name e.g. `wise-mustard-elephant.crm` (also `faru18d2addc.crm`, `fcomskc0w0r.crm`), Points to `76.13.209.30`

**Refresh TLS (after DNS works):**

- **Admin UI (preferred):** sign in as platform admin ΓåÆ **TLS certs** (`/admin/tls-certs`) ΓåÆ unlock with TOTP ΓåÆ **Run Let's Encrypt refresh** (scope **all** or **crm**). Same acme.sh TLS-ALPN path as the VPS bash scripts; brief nginx downtime for ALPN. Shows current SANs, Twenty workspace hosts, and job logs.
- **CLI on VPS:**

```bash
bash /opt/agent-os/deploy/scripts/vps-ensure-crm-workspace-dns-cert.sh
# or combined refresh wrapper:
bash /opt/agent-os/deploy/scripts/vps-refresh-tls-certs.sh all
```

That checks DNS, expands Let's Encrypt SANs for ready hosts, installs certs, and reloads nginx. Re-open **CRM** in Flolah. New Twenty companies need a cert refresh only when their subdomain is not already a SAN (DNS can be wild-carded; LE SANs are per-FQDN).

**Infra:** DNS `*.crm.<apex>` ΓåÆ VPS; nginx `server_name` includes `crmΓÇª` and `*.crmΓÇª`; TLS must list each workspace host (or use DNS-01 wildcards separately ΓÇö this stack uses per-FQDN ALPN). Helpers: `vps-expand-crm-cert.sh`, `vps-refresh-tls-certs.sh`.


### Password form after CRM open (including admin View as user)

**Admin impersonation does not cause the password prompt by itself.** View-as-user creates a session as the company CEO; CRM passwordless SSO mints a Twenty LOGIN token for that **CEO email** into the company workspace.

You still see Twenty password UI when:
1. SSO handoff failed or expired (e.g. after brief outages, or before FRONT_AUTO_BASE_URL / certs were fixed).
2. `TWENTY_SSO_ENABLED=0` or `TWENTY_APP_SECRET` does not match Twenty `APP_SECRET`.
3. Browser stayed on an old failing session ΓÇö use **Open** (new tab) or **Switch CRM account** from the CRM toolbar.
4. **Membership gap (fixed in SSO JIT):** Bootstrap admin (often the first Flolah CEO such as Balaji) owns newly created Twenty workspaces; other CEOs need a `workspaceMember` row in **their** workspaceΓÇÖs `databaseSchema`. If that row was written into the wrong schema, mint still ΓÇ£succeedsΓÇ¥ but `/verify` shows password. Backend now maps schema via `core.workspace.databaseSchema`, provisions owners as Admin, and preflights token exchange.

Required env: `TWENTY_SSO_ENABLED=1`, shared secret, `TWENTY_DATABASE_URL`, `TWENTY_FRONT_AUTO_BASE_URL=true`, workspace DNS + cert SANs.

CRM opens **in the Flolah iframe** (not a full-page leave); use **Open** for first-party debugging only.

**Note:** CRM REST tools mint **per-company** workspace access tokens (LOGIN exchange for the CEO email + bound workspace). They do **not** use a single shared `TWENTY_API_KEY` when SSO is enabled ΓÇö that previously wrote Agent/MCP creates into the bootstrap admin workspace by mistake.

**Workspace name** ("Welcome, ΓÇª"): Twenty Settings ΓåÆ Workspace. Toolbar **Switch CRM account** ΓåÆ wipe + `/welcome`.

**Enterprise OIDC:** Not required for this LOGIN-token path.

---


## ERPNext stack (Docker)

- Compose profile **`optional-erpnext`**: MariaDB + Redis + configurator + **create-site** + gunicorn **erpnext-backend** + workers.
- ERPNext **requires MariaDB** (not Twenty's Postgres). Isolation still mirrors CRM: **1 Flolah company ΓåÆ 1 ERPNext Company** + User Permission on the company SSO user.
- Start: `START_ERPNEXT=1 bash deploy/scripts/ensure-business-core-env.sh`
- After first site: Administrator login on Desk ΓåÆ User ΓåÆ API Access ΓåÆ API Key + Secret ΓåÆ set `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` on backend. Internal URL: `ERPNEXT_URL=http://erpnext-backend:8000`.
- Public embed: `ERPNEXT_EMBED_URL` (prefer `https://erp.crm.…` on :443) with nginx handoff **`/flolah-erp-handoff/`**.

## ERP menu SSO (passwordless)

When API keys + `ERPNEXT_SSO_ENABLED=1` (default), opening **ERP** mints a one-time handoff (like CRM LOGIN token flow): Flolah ensures Company + SSO User + company User Permission, logs in server-side, returns `/flolah-erp-handoff/?t=ΓÇª` which sets `sid` and redirects to `/app?company=ΓÇª`.

## Prefab ERP AI employees

Selecting **ERP = ERPNext** provisions three specialists (not generic Maker A/B):

| Agent | Focus | Tools (examples) |
|-------|--------|------------------|
| **ERP P&L Agent** | Profit & Loss, GL | `erp_profit_and_loss`, `erp_list_gl_entries`, invoice lists |
| **ERP Invoice Agent** | Sales/Purchase invoices | `erp_create_sales_invoice`, `erp_list_sales_invoices`, customers/items |
| **ERP Project Manager** | Projects & tasks | `erp_create_project`, `erp_list_projects`, `erp_list_tasks`, `erp_create_task` |

All stay **owner-scoped**; company filter applied on list/create. See also design **AUTOMATED-PNL.md** / help **37**.


## Company P&L (design roadmap)

Automated **cost + income ΓåÆ ERP** is planned: meters and income events in Flolah, period rollups into ERPNext when ERP is on (Maker/Checker review). See Platform Help [37-company-pnl.md](./37-company-pnl.md) and product plan knowledgebase/AUTOMATED-PNL.md. Until shipped, use CRM for pipeline, ERP for invoices you enter, token budgets for AI burn, and OEI for ops ΓÇö not as blended book revenue.
