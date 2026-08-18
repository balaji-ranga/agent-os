# Business Core — CRM (Twenty or ERPNext), ERP (ERPNext), Maker/Checker, MCP

## Quick answers

**What is Business Core?** Optional platform CRM and ERP bound to your company.
- **CRM:** **Twenty** ([github.com/twentyhq/twenty](https://github.com/twentyhq/twenty), **AGPL-3.0**) or **ERPNext** (Sales/CRM modules: Leads, Opportunities, Customers, Quotations, Orders).
- **ERP:** **ERPNext** ([github.com/frappe/erpnext](https://github.com/frappe/erpnext), **GPL-3.0**) — full books / invoicing / projects when selected as ERP provider.
Not required to use Flolah. Select under **Profile** or **Company setup → Systems**. Open-source attribution: `/legal/open-source.html` and [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).

**What process do the AI employees run?** They are **domain SMEs**, not form-fillers.
- **CRM:** **Lead → Prospect → Qualified deal → Proposal → Won → ERP Order**. Twenty is pipeline; ERPNext is books. Full playbook: [40-twenty-crm-help-tier-a.md](./40-twenty-crm-help-tier-a.md) + workspace **DOMAIN.md**.
- **ERP:** **quote → order → deliver → invoice → cash** (O2C) and **request → PO → bill → pay** (P2P), plus stock / accounting / projects. Full playbook: [39-erpnext-help-tier-a.md](./39-erpnext-help-tier-a.md) + workspace **DOMAIN.md**.
Makers/Checkers retrieve those docs with `master_data_rag` even if Knowledge uploads are empty. Start a **new chat** after a help deploy.

**When I pick platform CRM or ERP, do I get the Maker/Checker AI employees?** **Yes.**
Packs + workflow graphs ship in source under `backend/src/services/company-blueprints/standard/` (with industry blueprints). Enablement on Profile/Company setup **grants those prefabs into your org** and installs the MC workflow (chat: `run crm maker checker` / `run erp maker checker`). **Admin → Refresh default agents** (with Business Core checked) re-ensures those packs + MC graphs for CEOs who already have CRM/ERP selected; lean COO / Workflow Builder / Platform Help are always refreshed from `platform-agents.json` + workspace templates.
- **CRM = Twenty:** CRM Maker A/B + CRM Checker with crm_* tools; Checker also has `crm_delete_person` / `crm_delete_company`. CRM nav opens Twenty SSO.
- **CRM = ERPNext:** CRM Maker A/B + CRM Checker with Sales-side erp_* tools; CRM nav opens ERPNext desk SSO (/app/crm).
- **ERP = ERPNext:** ERP Maker A/B (full operational erp_* surface matching MCP), ERP Checker (submit/cancel + Kanban/workflow approvals), plus specialists P&L / Invoice / Project Manager.
Switching away from a platform provider **removes** those prefab agents from the org.

**Is there MCP for agents and workflows?** Yes — v2 HTTP proxy to real REST.
- **mcp-flolah-crm** — Twenty crm_* tools.
- **mcp-flolah-erp** — full erp_* operational set: customers/leads/contacts/opportunities, items, quotations, sales orders, delivery notes, sales/purchase invoices & orders, payments, journal entries, material requests, projects/tasks, GL, P&L, generic resource CRUD, **submit/cancel**.
Every MCP erp_* tool is also a **content tool** (/api/tools/erp-…) for agent Tool access grants (same names). Workflows use MCP with X-Ceo-User-Id.


**Company / fiscal / customers isolation?** Yes — bound company only. Customer & parties use `flolah_company`; fiscal years do not expose peer companies; agents match CEO entitlements. See **Tenant isolation** below.
**How does owner scope work?** CEO owner identity only; company map from business profile; never trust foreign company ids.

**When do CRM / ERP nav links appear?** Profile CRM is **twenty** or **erpnext** → **CRM** menu. Profile ERP is erpnext → **ERP** menu. Embeds: Twenty → TWENTY_EMBED_URL; ERPNext CRM/ERP → ERPNEXT_EMBED_URL (e.g. https://erp.crm.flolah.cloud).

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
- ERPNext SME: [39-erpnext-help-tier-a.md](./39-erpnext-help-tier-a.md)  
- Twenty CRM SME: [40-twenty-crm-help-tier-a.md](./40-twenty-crm-help-tier-a.md)  
- Maker/Checker: [38-maker-checker-coordination.md](./38-maker-checker-coordination.md)

## Databases (platform SoR on VPS)

| System | Compose service | Engine | Notes |
|--------|-----------------|--------|-------|
| **Twenty CRM** | `twenty-db` | **PostgreSQL 16** | One workspace per Flolah company |
| **ERPNext ERP** | `erpnext-db` | **MariaDB 10.11** | Multi-company site; Flolah company map |
| Flolah itself | backend volume | **SQLite** | agents, profile, binds (not CRM/ERP rows) |

## CRM / ERP iframe

Ops set browser-reachable HTTPS URLs (mixed content blocks `http://` iframes on `https://login.flolah.cloud`):

- `TWENTY_EMBED_URL` / `TWENTY_SERVER_URL` — **`https://crm.flolah.cloud`** (dedicated CRM subdomain)
- `ERPNEXT_EMBED_URL` / `ERPNEXT_PUBLIC_URL` — **`https://erp.crm.flolah.cloud`** (nginx TLS :443 → ERPNext on `127.0.0.1:8085`; reuses `*.crm` DNS). Do **not** rely on `:8444` (Hostinger often drops it).

**If the iframe stays blank but Flolah itself loads:** confirm the embed host is on **:443**, cert SAN includes the ERP host (`bash deploy/scripts/vps-expand-crm-cert.sh`), and nginx has the exact `erp.crm…` server before the CRM wildcard. Twenty does **not** support path-prefix embeds under `/crm/...`.

Deploy helper: `deploy/scripts/ensure-business-core-env.sh` (starts Twenty by default; **ERPNext profile is off** until `START_ERPNEXT=1`).

### Where is ERP running?

**By default: nowhere on the VPS.** Compose profile `optional-erpnext` is separate from Twenty. You will **not** see `erpnext-*` containers until:

```bash
START_ERPNEXT=1 bash deploy/scripts/ensure-business-core-env.sh
# or
docker compose -f docker-compose.yml -f docker-compose.business-core.yml --profile optional-erpnext up -d
```

Even then the current overlay is **infra + stub backend** (site init still required — see `deploy/business-core/README.md`). Public ERP host returns **502** until a real ERPNext site listens on 127.0.0.1:8085.

### Flolah company — CRM / ERP wiring

| Layer | Storage | Rule |
|-------|---------|------|
| Profile choice | SQLite `company_business_profiles` | `crm_provider=twenty|erpnext` / `erp_provider=erpnext` per **CEO owner** |
| CRM bind | `twenty_workspace_id` (+ bind JSON) | **One Twenty workspace per Flolah company** |
| ERP bind | `erpnext_company_id` (+ user map table) | **One ERPNext Company per Flolah company** (multi-company site later) |
| Authorization | tools + embeds | Always `resolveAuthenticatedCeoUserId` — never body-supplied foreign owner/workspace |

**Init / sync:** Profile Apply + provision runs `ensureTwentyWorkspaceForCompany` (real Twenty workspace UUID + subdomain when multi-workspace is enabled) / `ensureErpnextCompanyForOwner`. Live org population uses:

- UI: CRM or ERP page → **Sync Flolah org**
- API: `POST /api/business-core/sync-org` `{ "targets": ["crm"] }` or `["erp"]`
- Tools / MCP: `crm_sync_org`, `erp_sync_org`

Sync copies Flolah **departments** (Master Data) + **entitled AI employees** into Twenty people / ERPNext Department+Employee when company CRM REST auth works (owner workspace token via SSO) or ERPNext key/secret are set.

## Prefab Maker/Checker tool access

When Profile selects platform CRM/ERP, Maker/Checker packs receive **`crm_*` / `erp_*` content tools** (including sync). **CRM person/company delete** (`crm_delete_person`, `crm_delete_company`) is **Checker-only**. AgentSystem uses content tools (same endpoints as MCP); workflows use MCP nodes with `X-Ceo-User-Id`.

Workspace MD (TOOLS / AGENTS / SOUL / MEMORY) lives under platform **workspace templates** role folders (`crm-maker-a`, `crm-maker-b`, `crm-checker`, `erp-maker-a`, `erp-maker-b`, `erp-checker`, `erp-pnl`, `erp-invoice`, `erp-project`). Runtime agent ids stay owner-scoped (`crm-s1-{slug}`, …); the backend maps them via `resolveWorkspaceTemplateBaseId`. Profile enable + Admin refresh force-push those templates into each CEO tenant workspace, including **DOMAIN.md** (Twenty CRM / ERPNext SME card from `_shared/TWENTY-CRM-SME.md` / `_shared/ERPNEXT-SME.md` — full Lead→Order / O2C–P2P process maps). Makers/Checkers **`master_data_rag`** includes Platform Help **39** / **40** (`corpus=platform-help`) even when the CEO has no uploads.

### CRM deletes (duplicates / inactive)

Do **not** archive in the Twenty UI and do **not** grant delete tools to Maker.

1. **Maker** lists people/companies, writes keep vs drop ids, and creates Kanban **`[CRM] Review delete …`** assigned to **CRM Checker**. Maker is not granted `crm_delete_*`.
2. **Checker** lists to audit, then `crm_delete_person` / `crm_delete_company` with `{ id, confirm: true }` (Twenty soft-delete / archive; ERPNext CRM facade deletes Contact / Customer after owner get). Then complete the card.

Same protocol in workspace **AGENT-OS-OPS.md** / **DOMAIN.md** and help **38** / **40**.

## CRM browser session vs Flolah user

**Issue:** Browser cookies must not leak across Flolah companies. Each company also needs its **own** Twenty workspace (data isolation).

**Mapping:** **1 Flolah company (CEO owner)** → **1 Twenty workspace** (UUID + subdomain), stored on `company_business_profiles` (`twenty_workspace_id` + bind JSON with `subdomain`). Ensured on CRM open / Profile provision via `ensureCompanyTwentyWorkspace` (GraphQL `signUpInNewWorkspace` + `activateWorkspace` when multi-workspace is on). Local `flolah-ws-*` binds are upgraded to real remote workspaces.

**On CRM click (`/crm`):**
1. Resolve authenticated owner (never body `ceo_user_id` for auth).
2. Ensure company workspace (create if missing / non-UUID).
3. JIT-add the **signed-in Flolah user** (CEO or invited employee email) into **that** workspace only.
4. Mint LOGIN JWT for **that** `workspaceId` (`APP_SECRET` + workspace + `LOGIN`) and **exchange it server-side**.
5. Browser handoff on the **workspace origin** `https://{subdomain}.crm.<apex>/flolah-handoff/?t=…` then same-origin **`/flolah-crm-sso`** (nginx → `GET /api/business-core/crm-sso-apply`). That page writes Twenty `tokenPairState` in the workspace origin and sets **Partitioned** cookies — required because Chrome treats Twenty `/verify` GraphQL cookies as third-party inside the Flolah iframe.

**Mitigation (always):** handoff wipes cookies/localStorage on owner change / `wipe=1` / SSO token (`deploy/static/crm-handoff/`). IndexedDB is wiped only on logout so SSO apply is not raced.

| Env | Purpose |
|-----|---------|
| `TWENTY_APP_SECRET` | Same as Twenty `APP_SECRET` — mint LOGIN tokens |
| `TWENTY_SSO_ENABLED` | Default on when secret set; `0` = isolation handoff only |
| `TWENTY_DATABASE_URL` | JIT user + membership in company workspace |
| `TWENTY_REDIS_URL` | Same Redis as Twenty (`redis://twenty-redis:6379`) — invalidate member flat-maps after JIT join |
| `TWENTY_IS_MULTIWORKSPACE_ENABLED` | **`true`** on Twenty server/worker — required to create additional workspaces |
| Twenty workspace cap | Self-hosted Twenty without an enterprise key allows **5** live workspaces. Flolah **reclaims unused desks** (offboarded companies, or CRM no longer set to Twenty) then retries. It never binds you onto another company’s workspace. Prefab CRM Maker/Checker still join your org even if the desk is still provisioning. |
| `TWENTY_BOOTSTRAP_EMAIL` | Optional admin used to call `signUpInNewWorkspace` (else first ACTIVE member) |
| `TWENTY_EMBED_URL` / `TWENTY_SERVER_URL` | Platform front origin `https://crm.<apex>` (subdomains built from this host) |
| `ERPNEXT_DEFAULT_CURRENCY` | Fallback when country has no mapped ISO currency. New companies use country currency when known (Singapore → SGD) so Debtors and invoices match. |

### CRM menu blank / server IP address could not be found

Twenty multi-workspace opens each company at https://{workspace-subdomain}.crm.flolah.cloud. Nginx already accepts *.crm.flolah.cloud, but **public DNS must resolve those names**.

| Symptom | Cause |
|---------|--------|
| Browser: host server IP address could not be found | No A/CNAME for workspace host (NXDOMAIN). Apex crm.flolah.cloud alone is not enough. |
| TLS error after DNS works | Cert SANs missing that host |

**CRM workspace DNS** — ops publishes an A record for `*.crm` (wildcard preferred) or one A record per workspace host, pointing at the public CRM host. Apex `crm.flolah.cloud` alone is not enough. Use generic names such as `your-company.crm`, not live workspace slugs.

**Chrome “this page might be temporarily down or it may have moved”** on `https://{sub}.crm.…/flolah-handoff/…` is almost always **TLS**, not SSO. Let’s Encrypt lists each workspace host as its own SAN. Apex `crm.<apex>` on the cert does **not** cover `{sub}.crm.<apex>`. A gap-detector bug used to treat apex as covering every workspace, so new companies never got a SAN (cron and post-create debounce no-op’d). That matcher now requires an exact host SAN (or a true `*.crm` wildcard). Backend boot also re-runs SAN sync so a deploy that restarts the API cannot drop an in-memory debounce. Until the SAN exists, CRM embed **does not** load that host (avoids the Chrome error) and shows a Flolah message instead.

**Refresh TLS (after DNS works):**

- **Admin UI (preferred):** sign in as platform admin → **TLS certs** (`/admin/tls-certs`) → unlock with OTP (authenticator or email; 30-minute privileged session, shared with AgentSystem recovery / Tools Onboarding) → **Run Let's Encrypt refresh** (scope **all** or **crm**). Same acme.sh TLS-ALPN path as the VPS bash scripts; brief nginx downtime for ALPN. Shows current SANs, Twenty workspace hosts, and job logs.
- **CLI on VPS:**

```bash
bash /opt/agent-os/deploy/scripts/vps-ensure-crm-workspace-dns-cert.sh
# or combined refresh wrapper:
bash /opt/agent-os/deploy/scripts/vps-refresh-tls-certs.sh all
```

That checks DNS, expands Let's Encrypt SANs for ready hosts, installs certs, and reloads nginx. Re-open **CRM** in Flolah.

**Automatic (preferred, all new companies):** After a company gets a Twenty workspace, Flolah **debounces** a CRM SAN expand (~45s). An hourly platform cron **`crm_tls_workspace_certs`** (Admin → **Crons** — pause / resume / **Run now**) also diffs ACTIVE `{sub}.crm.*` hosts vs the fullchain and expands only when something is missing. Requires DNS `*.crm.<apex>` (or per-workspace A) → VPS and Docker tools on the backend (same as Admin → TLS certs). Env: `CRM_TLS_WORKSPACE_CERT_CRON` (default hourly; `off` disables), `CRM_TLS_WORKSPACE_CERT_AUTO=0` skips the post-create debounce only.

New Twenty companies need a cert SAN only when their subdomain is not already on the cert (DNS can be wild-carded; LE SANs are per-FQDN under TLS-ALPN).

**Infra:** DNS `*.crm.<apex>` → VPS; nginx `server_name` includes `crm…` and `*.crm…`; TLS must list each workspace host (or use DNS-01 wildcards separately — this stack uses per-FQDN ALPN). Helpers: `vps-expand-crm-cert.sh`, `vps-refresh-tls-certs.sh`.


### Password form after CRM open (including admin View as user)

**Admin impersonation does not cause the password prompt by itself.** View-as-user creates a session as the company CEO; CRM passwordless SSO mints a Twenty LOGIN token for that **CEO email** into the company workspace.

You still see Twenty password / email UI when:
1. SSO handoff failed or expired (e.g. after brief outages, or before FRONT_AUTO_BASE_URL / certs were fixed).
2. `TWENTY_SSO_ENABLED=0` or `TWENTY_APP_SECRET` does not match Twenty `APP_SECRET`.
3. Browser stayed on an old failing session — use **Open in new tab** or **Switch CRM account** from the CRM toolbar.
4. **Iframe cookies blocked (fixed via `/flolah-crm-sso`):** Chrome third-party cookie rules drop Twenty `/verify` Set-Cookie inside the Flolah iframe. The desk then shows **email login**. Typing your Flolah email there often shows **“error occurred validating user”** because JIT CRM users are passwordless (or the password is not your Flolah password). Do not use that form — reload **CRM** or **Open in new tab**.
5. **Membership gap (fixed in SSO JIT):** The bootstrap admin can own newly created CRM workspaces; other CEOs need a `workspaceMember` row in **their** workspace’s `databaseSchema`. If that row was written into the wrong schema, mint still “succeeds” but `/verify` shows password. Backend now maps schema via `core.workspace.databaseSchema`, provisions owners as Admin, and preflights token exchange. After membership SQL, Flolah also invalidates Twenty Redis `flatWorkspaceMemberMaps` (`TWENTY_REDIS_URL`) so REST/MCP tools do not return `FORBIDDEN` / “User is not a member of the workspace”.

Required env: `TWENTY_SSO_ENABLED=1`, shared secret, `TWENTY_DATABASE_URL`, `TWENTY_REDIS_URL` (default docker hostname), `TWENTY_FRONT_AUTO_BASE_URL=true`, workspace DNS + cert SANs.

CRM opens **in the Flolah iframe** (not a full-page leave); use **Open in new tab** if the embed still shows Twenty’s email form.

**Note:** CRM REST tools mint **per-company** workspace access tokens (LOGIN exchange for the CEO email + bound workspace). They do **not** use a single shared `TWENTY_API_KEY` when SSO is enabled — that previously wrote Agent/MCP creates into the bootstrap admin workspace by mistake.

**Workspace name** ("Welcome, …"): Twenty Settings → Workspace. Toolbar **Switch CRM account** → wipe + `/welcome`.

**Education / college (CEO mapping, no extra doctypes):** Flolah `erp_*` allowlist is Selling / HR / Projects — not ERPNext Education (`Student`, `Program`, `Fee Schedule`). Map in the CEO tenant: admissions prospect → **Twenty Lead**; enrolled student or parent payer → **Customer**; tuition/hostel/exam fee → **Item** (service, no stock); fee bill → **Sales Invoice**; fee collected → **Payment Entry**; faculty/staff → **Employee**; academic batch → **Project**. Reference catalogs stay in Knowledge tables. Maker drafts; Checker submits. Same isolation as any ERPNext company.

**Enterprise OIDC:** Not required for this LOGIN-token path.

---


## ERPNext stack (Docker)

- Compose profile **`optional-erpnext`**: MariaDB + Redis + configurator + **create-site** + gunicorn **erpnext-backend** + workers.
- ERPNext **requires MariaDB** (not Twenty's Postgres). Isolation still mirrors CRM: **1 Flolah company → 1 ERPNext Company** + User Permission on the company SSO user.
- Start: `START_ERPNEXT=1 bash deploy/scripts/ensure-business-core-env.sh`
- After first site: Administrator login on Desk → User → API Access → API Key + Secret → set `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` on backend. Internal URL: `ERPNEXT_URL=http://erpnext-backend:8000`.
- Public embed: `ERPNEXT_EMBED_URL` (prefer `https://erp.crm.…` on :443) with nginx handoff **`/flolah-erp-handoff/`** and cookie apply **`/flolah-erp-sso`**.

## ERP menu SSO (passwordless)

When API keys + `ERPNEXT_SSO_ENABLED=1` (default), opening **ERP** mints a one-time handoff (like CRM LOGIN token flow): Flolah ensures Company + SSO User + company User Permission, logs in server-side, and returns `/flolah-erp-handoff/?t=...` on the ERP host. That page navigates same-origin to **`/flolah-erp-sso`** (nginx -> backend `GET /api/business-core/erp-sso-apply`), which **Set-Cookie**s Frappe `sid` (`HttpOnly; Secure; SameSite=None; Partitioned`) and **302**s to `/app?company=...`. Do not rely on `document.cookie` in the iframe — browsers drop third-party cookie writes from cross-origin JSON consume.


## Tenant isolation (ERP agents)

**Hierarchy (one Flolah company stack):**

1. **CEO user** (`owner_user_id`) — your login tenant root
2. **`company_business_profiles`** — CRM/ERP provider + binds for that CEO only
3. **Prefab agents** (ERP Maker A/B, Checker, …) — `agents.owner_user_id` + entitlement to that CEO; AgentSystem runtime `t-{ceo}--{agentId}`
4. **ERPNext** — shared multi-company *site*; each CEO maps to **one Company** document + desk SSO User
5. Tools run with Flolah owner context (`x-ceo-user-id` from your chat session), **not** other CEO sessions

**Why another CEO email could appear (before isolation harden):** All companies share one ERPNext site and a platform **API key** that bypasses desk User Permission. Agents with `erp_list_resource` could list global doctypes such as **User** and see every company SSO email (e.g. another platform customer). That is **not** Flolah granting cross-CEO agent access — it was an unscoped Frappe REST call.

**Enforced now:** blocked doctypes (User, roles, …); resource allowlist; bound company; native `company` on transactions; **`flolah_company`** on global masters (Customer/Supplier/Lead/Item/…). Agents stamp/filter the same field as CEO desk Company User Permission.

CRM Twenty remains stronger isolation: separate workspace DB per company.



## Flolah user / company map to ERPNext (ops)

| Flolah | ERPNext |
|--------|---------|
| CEO (`platform_users` / `owner_user_id`) | SSO **User** (email = CEO login email) with Company **User Permission** |
| Profile `crm_provider` / `erp_provider` = erpnext | Entitles ERPNext path (not automatic for every signup) |
| Bound company name | Real **Company** doc (must exist remotely — not only `flolah-co-*` local id) |
| Org sync (`erp_sync_org` / `crm_sync_org` when CRM=ERPNext) | **Department** (`{name} - {abbr}`) + **Employee** rows for AI employees under that Company (not desk User rows) |
| Desk SSO User list | Company User Permission **plus** User Permission `allow=User → self` so other CEOs’ emails are hidden |

**Not automatic for every Flolah user:** only CEOs who choose platform ERPNext CRM and/or ERP. Bind runs on company setup, profile save, SSO open, or sync.

**Company is Mandatory (Selling / Buying):** SSO Users get a **Company User Permission** with **`is_default = 1`**. Without the default flag, ERPNext desk Selling and Buying list views throw *Company is Mandatory* even when the Company document and permission exist. Flolah sets/repairs `is_default` on every SSO handoff (`ensureSsoUserPermissions`). Re-open **ERP** (passwordless handoff) after deploys to refresh the session.

**Org sync expectations:** Departments come from Flolah master-data; agents become **Employees** (status Active) under company Departments. Sync does **not** create a Frappe login User per agent (that would re-expose all tenants in Users). Re-open ERP or run Sync org after a deploy to apply desk User isolation.

**local_bind vs remote:** Older sites had Company create fail (missing **country**, missing **Warehouse Type: Transit**). Flolah still stored synthetic `flolah-co-{ceo}` → desk SSO / dept sync fail (“no access to company”, Stock Settings errors). Fix: ensure country + warehouse types, then create real Company and User Permission.

Agent tools use API keys (company-scoped filters). Desk SSO uses roles + User Permission only — System Manager without a real Company still hits module setup errors (e.g. Stock Settings).






## Tenant isolation (desk CEO = agent entitlements)

Flolah maps **1 CEO → 1 ERPNext Company** on a **shared multi-company site**. Isolation is enforced on **desk SSO** and **agent/MCP tools** the same way.

### Global masters (`flolah_company` custom Link)

ERPNext does not put `company` on Customer by default. Flolah adds **`flolah_company`** (Link → Company):

| Tagged doctypes | Customer, Supplier, Lead, Contact, Address, Item, Item Price, Opportunity |
| Desk | Company **User Permission** + **Apply strict user permissions** hide peer masters |
| Agents | Create/list/get/update **stamp + filter** `flolah_company` (API key cannot list peer rows) |
| Tools | `erp_get_company`, `erp_update_company` (own company only); masters inherit CEO company |

Backfill on company ensure: SSO `owner` email → company, else name heuristics (`ERPNEXT_TENANT_BACKFILL=1` default).

### Transactions (native `company`)

Sales/Purchase/Stock/Projects/GL/Warehouse/Account/Department/Employee etc. use ERPNext’s built-in **`company`** field + Company User Permission + agent force-filter.

### Special cases

| DocType | Behavior |
|---------|----------|
| **User** | Desk: User Permission `allow=User → self` (hides other CEOs’ emails). Agents: **blocked**. |
| **Fiscal Year** | Site-global year **name**; companies join via child table. Tools **redact** peer companies and creator emails. Create/link only for bound company (`erp_list_fiscal_years` / `erp_create_fiscal_year`). |
| **Company** | Tools never list all companies; only bound company. |

### Still shared / not flolah_company-tagged

Item Group, Mode of Payment, Payment Terms Template, Terms and Conditions, Tax Category, Currency Exchange, ToDo/Note/File (loose), many Setup masters not on agent allowlist. Expand tags if multi-tenant setup data becomes a product requirement.

**Agents inherit the CEO’s bound company** for tagged masters and native-company docs (not site-wide System Manager).

## Maker permissions (company setup)

ERP/CRM **Makers do not use the desk SSO password** — they call Flolah `erp_*` tools with the platform ERP API key, **scoped to the CEO-bound Company**.

| Capability | How |
|------------|-----|
| See own Company | `erp_get_company` / `erp_list_resource` (doctype Company → bound only) |
| Fiscal years (read) | `erp_list_fiscal_years` — **site-global** years your company can use (linked via `companies` child, or empty = all companies) |
| Fiscal years (write) | Maker A: `erp_create_fiscal_year` creates the year **or links your company** if that year name already exists (e.g. “2026” first created by another CEO on the shared site) |
| FY ownership myth | Year **names** may be unique site-wide, but tools **never return** peer company names or other CEOs' emails. `companies` in tool responses is **only your company**. |
| Accounts / warehouses | `erp_list_resource` (Account, Cost Center, Warehouse) company-filtered |
| Maker A vs B | Independent grants: A = finance/setup/sales-money; B = ops/stock. **Union ≈ CEO desk operational scope** (no System Manager / User admin) |
| Submit / cancel | **Checker** only (`erp_submit_doc` / `erp_cancel_doc`) |
| Other CEOs / User admin | Blocked |

If a Maker says it cannot see Company/Fiscal Year, reload agents (prefab grant refresh) after deploy and use `erp_get_company` explicitly.


## Prefab ERP AI employees

Selecting **ERP = ERPNext** provisions:

| Agent | Role | Tools |
|-------|------|--------|
| **ERP Maker A** | Finance / company setup | Company + fiscal write, customers, quotes/invoices/payments/journals, P&L |
| **ERP Maker B** | Ops / stock | Company + fiscal read, PO/DN/MR/items, projects |
| **ERP Checker** | Approvals / gates | List + `erp_submit_doc` / `erp_cancel_doc` + Kanban assign/move + `agent_workflow_certify_*` |
| **ERP P&L / Invoice / Project Manager** | Specialists | Focused tool subsets |

Makers draft; Checker owns submit/cancel and task/workflow approvals. Maker A + Maker B tools together cover desk ops for the bound company.


## Company P&L (design roadmap)

Automated **cost + income → ERP** is planned: meters and income events in Flolah, period rollups into ERPNext when ERP is on (Maker/Checker review). See Platform Help [37-company-pnl.md](./37-company-pnl.md) and product plan knowledgebase/AUTOMATED-PNL.md. Until shipped, use CRM for pipeline, ERP for invoices you enter, token budgets for AI burn, and OEI for ops — not as blended book revenue.

## Maker/Checker (Option 1) and org sync

- **Coordination:** Kanban primary + optional seeded workflows; ERP Checker hard-owns submit/cancel; CRM Checker owns high-risk process gates **and CRM person/company delete**. Full playbook: [38-maker-checker-coordination.md](./38-maker-checker-coordination.md).
- **Org sync** is **optional** (departments + AI employees as people/employees). Not required for customer pipeline or posting invoices — usually **skip** unless you want a roster mirror in the desk.
- **COO** may use company-scoped **read-only** `crm_*` / `erp_*` list/report tools to query and to route Makers/Checkers.
- **Platform Help** answers product how-to from RAG (**39 ERPNext SME**, **40 Twenty CRM SME**, this file); live data → COO or prefab agents. CRM/ERP Maker and Checker workspaces also get **DOMAIN.md** (Twenty/ERPNext SME card) from shared workspace templates.
