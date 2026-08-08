# Business Core — CRM (Twenty), ERP (ERPNext), prefab Maker/Checker, MCP

## Quick answers

**What is Business Core?** Optional platform CRM and ERP bound to your company: **Twenty** for CRM, **ERPNext** for ERP. Not required to use Flolah. Select under **Profile** or **Company setup → Systems**.

**When I pick platform CRM or ERP, do I get the Maker/Checker AI employees?** **Yes.**  
- Profile or Company setup Apply with **CRM = Twenty** → provisions **CRM Maker A**, **CRM Maker B**, **CRM Checker** (granted to your company only).  
- **ERP = ERPNext** → provisions **ERP Maker A**, **ERP Maker B**, **ERP Checker**.  
They appear under **AI Employees** / chat picker and use **content tools** (`crm_*`, `erp_*`).

**Is there MCP for agents and workflows?** **Yes — real HTTP proxy to Twenty / ERPNext REST (v2), not dummy stubs.** Platform registry seeds (same **business-core-mcp** container):  
- **`mcp-flolah-crm`** — `crm_status`, people/companies CRUD list, **opportunities/deals**, **leads** (Twenty has no separate Lead object by default → early-stage opportunities: NEW/SCREENING/MEETING/PROPOSAL/QUALIFIED), notes, tasks, `crm_sync_org`  
- **`mcp-flolah-erp`** — `erp_status`, customers, leads, items, quotations, sales orders, projects, generic `erp_list_resource` / `erp_create_resource` / `erp_get_resource`, `erp_sync_org`  

Requires **`TWENTY_API_KEY`** (CRM) and ERPNext API key/secret (ERP) on platform env for live data. OpenClaw AI employees use matching **content tools** (Tool access grants); workflows use **MCP nodes** / Brain MCP on these server ids.

**How does owner scope work?** Pass **`X-Ceo-User-Id`** (your company CEO id) on MCP auth headers from the workflow, or `owner_user_id` in tool args when using service key. Tools resolve Twenty workspace / ERPNext company from **your** business profile — never trust a foreign company id for authorization.

**When do CRM / ERP nav links appear?** Only when Profile provider is **twenty** / **erpnext**: left nav **CRM** (`/crm`) and **ERP** (`/erp`) open the platform embeds. Daily operate surface: **`/work`** (Work).

## CEO setup checklist

1. **Profile** (or Company setup Systems) → set CRM to **Twenty** and/or ERP to **ERPNext** → Save / Apply.  
2. Confirm Maker/Checker employees appear under **AI Employees** / Chat picker.  
3. Optional: open **CRM** / **ERP** menus when embeds are configured (`TWENTY_EMBED_URL` / `ERPNEXT_EMBED_URL`).  
4. Workflows: **Integrations → MCP** → platform servers `mcp-flolah-crm` / `mcp-flolah-erp` → Test → use in MCP or Brain nodes with header `X-Ceo-User-Id: <your ceo user id>`.  
5. Agents chat: grant `crm_*` / `erp_*` on the prefab employees (already granted at provision).

## Operators (deploy)

| Piece | Detail |
|-------|--------|
| MCP image | `deploy/docker/business-core-mcp.Dockerfile` · `tools/business-core-mcp/server.js` |
| Compose profile | `optional-business-core-mcp` · service `business-core-mcp` · port 8082 |
| Env | `BUSINESS_CORE_MCP_URL=http://business-core-mcp:8082/mcp`, `TOOLS_API_KEY` (injected into MCP container for backend calls) |
| Seed | `node backend/scripts/seed-business-core-mcp.js` or `deploy/scripts/ensure-platform-mcps.sh` |
| CRM/ERP stacks | `deploy/docker-compose.business-core.yml` · [business-core/README.md](../../deploy/business-core/README.md) |
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

Ops set browser-reachable HTTPS URLs (mixed content blocks `http://` iframes on `https://login…`):

- `TWENTY_EMBED_URL` / `TWENTY_SERVER_URL` — **`https://crm.flolah.cloud`** (dedicated CRM subdomain)
- `ERPNEXT_EMBED_URL` / `ERPNEXT_PUBLIC_URL` — **`https://login.flolah.cloud:8444`** (nginx TLS → ERPNext on `127.0.0.1:8085`)

**If the iframe stays blank but Flolah itself loads:** Hostinger (or other cloud) **inbound firewall often allows only 80/443**. Open **TCP 8443 and 8444**, or add DNS `crm.flolah.cloud` / `erp.flolah.cloud` → VPS IP and use the **:443** nginx `server_name` blocks already in `nginx.host-network.conf` (expand Let's Encrypt SANs). Twenty does **not** support path-prefix embeds under `/crm/...`.

Deploy helper: `deploy/scripts/ensure-business-core-env.sh` (starts Twenty by default; **ERPNext profile is off** until `START_ERPNEXT=1`).

### Where is ERP running?

**By default: nowhere on the VPS.** Compose profile `optional-erpnext` is separate from Twenty. You will **not** see `erpnext-*` containers until:

```bash
START_ERPNEXT=1 bash deploy/scripts/ensure-business-core-env.sh
# or
docker compose -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-erpnext up -d
```

Even then the current overlay is **infra + stub backend** (site init still required — see `deploy/business-core/README.md`). Port **8444** returns **502** until a real ERPNext site listens on `127.0.0.1:8085`.

### Flolah company ↔ CRM / ERP wiring

| Layer | Storage | Rule |
|-------|---------|------|
| Profile choice | SQLite `company_business_profiles` | `crm_provider=twenty` / `erp_provider=erpnext` per **CEO owner** |
| CRM bind | `twenty_workspace_id` (+ bind JSON) | **One Twenty workspace per Flolah company** |
| ERP bind | `erpnext_company_id` (+ user map table) | **One ERPNext Company per Flolah company** (multi-company site later) |
| Authorization | tools + embeds | Always `resolveAuthenticatedCeoUserId` — never body-supplied foreign owner/workspace |

**Init / sync:** Profile Apply + provision runs `ensureTwentyWorkspaceForCompany` / `ensureErpnextCompanyForOwner` (may be **local bind** until API keys work). Live org population uses:

- UI: CRM or ERP page → **Sync Flolah org**
- API: `POST /api/business-core/sync-org` `{ "targets": ["crm"] }` or `["erp"]`
- Tools / MCP: `crm_sync_org`, `erp_sync_org`

Sync copies Flolah **departments** (Master Data) + **entitled AI employees** into Twenty people / ERPNext Department+Employee when `TWENTY_API_KEY` or ERPNext key/secret are set.

## Prefab Maker/Checker tool access

When Profile selects platform CRM/ERP, Maker/Checker packs receive full **`crm_*` / `erp_*` content tools** (including sync). OpenClaw uses content tools (same endpoints as MCP); workflows use MCP nodes with `X-Ceo-User-Id`.

## CRM browser session vs Flolah user

**Issue:** One platform Twenty. Browser cookies on `crm.*` would otherwise keep the last Twenty login for every Flolah user.

**Mitigation (always):** CRM iframe / Open go through `/flolah-handoff/?owner=<ceo_id>&next=…`. When owner changes (or SSO token present / `wipe=1`), cookies and localStorage for Twenty are cleared first. Deploy static: `deploy/static/crm-handoff/` mounted into nginx.

**True passwordless SSO (implemented):** When `TWENTY_APP_SECRET` matches Twenty `APP_SECRET` (and `TWENTY_SSO_ENABLED` is not off), Flolah mints a short-lived Twenty **LOGIN** JWT for the authenticated user's email and sends the browser to `/verify?loginToken=…` after handoff wipe. Same exchange Twenty uses after password/OIDC login—no separate Twenty password.

| Env | Purpose |
|-----|---------|
| `TWENTY_APP_SECRET` | Same as Twenty container `APP_SECRET` — required to mint LOGIN tokens |
| `TWENTY_SSO_ENABLED` | Default on when secret is set; set `0` for isolation handoff only |
| `TWENTY_DATABASE_URL` | `postgres://…@twenty-db:5432/twenty` for JIT user + membership |
| `TWENTY_WORKSPACE_ID` | Optional UUID if profile bind is still a local `flolah-ws-*` id |

Repeatable setup: `deploy/business-core/README.md`, `bash deploy/scripts/ensure-business-core-env.sh`, cert `deploy/scripts/vps-expand-crm-cert.sh`. Public CRM host: **`https://crm.<apex>`** only.

API/tools stay CEO-scoped via `company_business_profiles`. Shared platform Twenty still shares CRM **data** unless separate workspaces are used.

**Workspace name** ("Welcome, …"): rename in Twenty Settings → Workspace. Toolbar **Switch CRM account** clears session and opens `/welcome` for manual Twenty login if needed.

**Enterprise OIDC:** Not required for this LOGIN-token path.
