# Business Core, Identity spine and Workspace — product plan

**Status:** Approved for implementation. **Phase 1 shipped; Phase 2 (menus, embeds, ERP prefab, CRM/ERP platform MCP) shipped for agent + workflow consumption.**
**Related:** AI-COMPANY-OS.md, PHASE-D-E-F-OPERATE.md, platform-help [32-business-core-crm-erp.md](./platform-help/32-business-core-crm-erp.md).

**Source:** Pilot feedback + product design sessions (Aug 2026). Category remains **AI Company OS** (AI workforce), not workflow automation only.

---

## 1. Problem

Pilots report solid Knowledge, Automation, Agents, Integrations, but gaps on what a new company needs to run independently:

| Foundation | Pilot view |
|------------|------------|
| Identity | Partial — org/teams/permissions incomplete as product spine |
| Business Data | Gap — CRM / finance / projects not a first-class SoR story |
| Knowledge | Solid |
| Automation | Solid |
| Agents | Solid |
| Integrations | Solid |
| Workspace | Gap — no unified daily human + multi-agent OS (separate from executive Home) |

Independence for a specific company is configured at setup (subjective). The platform must still own building blocks (identity, optional SoR, daily Workspace) or setup only invents plans agents cannot run.

---

## 2. Frozen product decisions

| Foundation | Implementation |
|------------|----------------|
| Organization and Access | Flolah native — companies, departments, humans, AI employees, roles, permissions, **user + company entitlements** |
| Business Core | Platform CRM = **Twenty**; platform ERP = **ERPNext**. Both must expose MCP / agent tools. Onboard MCP for HubSpot, Zoho, Xero (Existing Company). |
| CRM / ERP selection | **Optional** at company setup and on Profile. Stored per Flolah company (CEO owner scope). |
| Prefab AI employees | Platform Twenty selected → **CRM Maker A + CRM Maker B + CRM Checker**. Platform ERPNext selected → **ERP Maker A + ERP Maker B + ERP Checker**. Prefabs get `crm_*` / `erp_*` content tools. **Yes — available to that CEO as soon as Profile (or Company setup Apply) selects the platform option.** |
| Knowledge | OpenSearch + Qwen embeddings + Flolah memory/RAG — existing |
| Automation | Flolah native — existing |
| AI Workforce | Flolah native — existing |
| Integrations | Flolah connectors + MCP + APIs + webhooks — existing + Business Core adapters |
| Home | **Unchanged** — executive how is the company doing (`/` AgentChat / home snapshot) |
| Workspace | **New menu** (daily operating system). Does **not** replace Home or existing `/workspace` **AI Employees** hire page (route: `/work`, nav label **Workspace**). |

### 2.1 Tenancy mapping

| System | Model |
|--------|--------|
| Twenty CRM | **One Twenty workspace per Flolah company** (CEO owner). Never share a workspace across Flolah companies. Store `twenty_workspace_id` (+ vaulted secrets) on that company business profile. |
| ERPNext | **Multi-user, multi-company** site maps to Flolah: Flolah company → ERPNext Company; Flolah user → ERPNext User + per-company permissions. Every tool call resolves company from authenticated owner context — never cross-tenant. |

### 2.2 Optional profile matrix

| Profile | SoR | Prefab agents | Workspace CRM/ERP chrome |
|---------|-----|---------------|---------------------------|
| crm_provider=none | — | — | Tasks + AI only |
| crm_provider=twenty | Workspace-per-company | 2 specialists + 1 approver | Yes |
| crm_provider=hubspot or zoho | External connect | None required (Phase 1/2) | Yes |
| erp_provider=none | — | — | — |
| erp_provider=erpnext | Company + user map | 2 specialists + 1 approver | Finance/Projects yes (Phase 2 depth) |
| erp_provider=xero | External connect | None required | Finance when connected |

Defaults: both `none`. Changing provider updates routing; tool layer remains Flolah-named (`crm_*`, `erp_*`).

### 2.3 Entitlements (non-negotiable)

- All post-login API and agent tool paths require authenticated session and enforce **user entitlements** (`user_agents`, tool grants) and **company/owner scope** (CEO `owner_user_id` / authenticate-resolve helpers).
- Never authorize from body-only `ceo_user_id` / workspace ids.
- CRM/ERP tool calls: resolve provider + bind from **owner business profile** after entitlement checks.
- Prefer existing helpers: `resolveAuthenticatedCeoUserId`, `resolveToolOwnerUserId`, `listAgentsForUser` / `user_agents`, org scopes.

### 2.4 Agents in Identity

- Structure under Org/teams (membership, permissions). Deep hire/configure remains AI Employees flows; prefab packs auto-provision when platform CRM/ERP selected.
- Approver agents gate risky writes; human CEO remains ultimate gate via existing approval patterns where applicable.

### 2.5 Docker / deploy

- **Twenty** and **ERPNext** ship as optional Compose profiles under `deploy/` (dockerfiles/setup kept in-repo and current).
- Platform stack does not require them for core Flolah; enabling CRM/ERP platform options expects the matching profile healthy.

---

## 3. Home vs Workspace

| | Home (`/`) | Workspace (`/work` — new) |
|--|------------|---------------------------|
| Job | Executive pulse | Daily operate: tasks, AI activity, @agent, CRM when enabled |
| Change policy | Keep behaviour; light links only | Build toward reference daily-OS UI |
| Existing `/workspace` | — | Remains **AI Employees** (hire/equip); nav label already AI Employees |

---

## 4. Phase 1 (implement now — validate before Phase 2)

**Goal:** Optional CRM on profile; Twenty tenancy model; prefab CRM pack; daily Workspace MVP; Home + company setup untouched in behaviour.

1. Org and access — companies/CEO owner, departments/teams, humans + AI members, roles/permissions/entitlements wired to new tools (extend existing; do not re-break company setup).
2. Business profile — optional `crm_provider` / `erp_provider` on company (owner) profile; gate tools.
3. Tool contracts — stable `crm_*` (and stubs for `erp_*`); adapter registry from profile; owner-scoped.
4. Twenty — Docker profile + env. On select `twenty`: bind/provision **workspace per Flolah company**; vault ids. Prefab **2 CRM specialists + 1 CRM approver** with CRM tool allowlists.
5. External CRM (thin) — HubSpot select records intent; full OAuth may complete later.
6. Workspace menu `/work` — My Tasks (list + link/Kanban reuse), AI activity, command bar/`@mention` stub to chat, metrics only when real data exists; CRM chrome if CRM selected.
7. Company setup — optional CRM/ERP controls without forcing; apply path may write profile + prefab when Twenty selected.
8. ERPNext — Docker/profile + mapping schema stubs; full multi-company map + ERP prefab = Phase 2 unless completed early safely.

**Phase 1 exit criteria**

- Setup can complete with CRM/ERP = none.
- Selecting Twenty creates/binds workspace isolation per company + prefab trio + user entitlements.
- CRM tools fail closed without entitlement or wrong company/workspace.
- `/work` usable for tasks + AI activity; Home unchanged.
- AI Employees `/workspace` and company-setup funnel still work.
- Compose profiles for Twenty (and ERPNext container stack) documented and deployable.

**Stakeholder gate:** validate Phase 1 before Phase 2.

---

## 5. Phase 2 (after validation only)

1. ERPNext multi-company multi-user mapping + `erp_*` tools + prefab ERP 2+1.
2. Xero / Zoho onboard MCP; HubSpot complete if not in P1.
3. Workspace depth — Projects/CRM/Finance entry points, inbox, favorites, approvals surface, richer metrics.
4. Setup auto-provision completeness; lifecycle add/remove users to ERPNext.
5. Team-scoped visibility polish on business tools.

---

## 6. Prefab agent design (platform packs)

| Agent | When | Focus |
|-------|------|--------|
| CRM Maker A | crm=twenty | Pipeline / accounts–contacts execution |
| CRM Maker B | crm=twenty | Research, enrichment, follow-ups |
| CRM Checker | crm=twenty | Gate mass/risky CRM writes |
| ERP Maker A | erp=erpnext | Ops / projects side |
| ERP Maker B | erp=erpnext | Finance/books side as exposed |
| ERP Checker | erp=erpnext | Gate spend/book posts |

All owner-scoped and `user_agents`-granted only to that company CEO (and entitled users when multi-human exists).

**MCP for workflows (same tool surface):** platform `mcp-flolah-crm` / `mcp-flolah-erp` via `business-core-mcp` (`optional-business-core-mcp`). OpenClaw packs use content tools; workflows use MCP nodes with `X-Ceo-User-Id`.

---

## 7. Delivery sequence

1. This doc + index
2. Schema business profile + binds
3. Docker Twenty + ERPNext profiles
4. Workspace `/work` + APIs (tasks/activity)
5. Twenty adapter + `crm_*` tools + prefab CRM Maker/Checker
6. Profile + company-setup optional fields
7. HubSpot thin path (later)
8. (P2) ERPNext mapping + ERP Maker/Checker + menus/embeds + Business Core MCP — shipped for current status tools

---

## 8. Deploy references

- `deploy/docker-compose.business-core.yml` — Twenty + ERPNext optional services
- `deploy/docker-compose.yml` — `business-core-mcp` profile + `BUSINESS_CORE_MCP_URL`
- `deploy/docker/business-core-mcp.Dockerfile` + `tools/business-core-mcp/server.js`
- `backend/scripts/seed-business-core-mcp.js` + `deploy/scripts/ensure-platform-mcps.sh`
- `deploy/business-core/` — setup notes, env samples
- Help: `knowledgebase/platform-help/32-business-core-crm-erp.md`

---

## 9. Explicit non-goals

- Merging Home into Workspace
- Replacing existing AI Employees page at `/workspace` without a deliberate rename migration
- Dual SoR forced on every tenant
- Agents calling Twenty/ERPNext APIs outside Flolah tools/MCP (entitlements bypass)
- Breaking company setup gate, onboarding helper, or core Home KPIs

---

*Last updated: Phase 2 + Business Core MCP (Aug 2026).*

