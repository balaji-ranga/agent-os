# Amendment plan: Content Media publish via Facebook MCP + LinkedIn OpenConnector

**Status:** Phase 0–1 in progress (supersedes Browser Session as *primary* for FB/LinkedIn text posts)  
**Date:** 2026-08-05 (updated 2026-08-06)  
**Industry pack:** `content_creator`  
**Related:** `knowledgebase/SOCIAL_POSTING_OPTIONS.md`, blueprint `content_creator.json`, operate model `content-creator.js`  
**Secrets:** Facebook App ID/Secret on **Connectors → MCPs** (connector-level), not required in `.env`.  
**Bootstrap:** `backend/scripts/bootstrap-content-publish-phase01.js` (new CEO + company + workflow seed).  
**Workflow seed:** `backend/scripts/seed-content-publish-social-workflow.js` (`content-publish-social`).

---

## 1. Why this amendment

Browser Session autonomous publish (Client Chrome → compose → Post → close tab) has proven **unreliable for Facebook** (Lexical fill stacking, CDP evaluate/act timeouts, discard dialogs on close) and **maintenance-heavy** even when LinkedIn succeeded in isolated dual runs. That path should **not** remain the operating model for Content Media Studio.

Official platforms already partially exist on Agent OS:

| Platform | Intended vehicle | Status in product |
|----------|------------------|-------------------|
| **Facebook (Page)** | MCP **`mcp-meta-graph`** → `create_page_post` | Seeded + OAuth; **not** granted to Channel Publisher |
| **LinkedIn** | **OpenConnector** `connector` node / `connector_execute_action` | Catalog-driven; no in-repo hard-coded LI share schema |
| **Instagram** | Meta Graph MCP (`create_instagram_post`) | Same MCP family as FB; out of this phase unless ready |
| **Blog CMS** | Browser Session or dedicated CMS connector | Keep browser/recipe or API later |

**Decision:** Move **Facebook + LinkedIn text (and link) posts** off Browser Session and onto **one reusable published workflow** that agents trigger with **`agent_workflow_trigger`**. Browser remains optional fallback only (flagged, not the default SOP).

---

## 2. Review of the proposed approach

### What you proposed (accepted with refinements)

1. **Facebook MCP** (already onboarding) for Page posts.  
2. **LinkedIn via Open Connector** for share/post actions.  
3. **One publish workflow** with **branch (if / switch)** → Facebook MCP node **or** LinkedIn connector node.  
4. **Existing content production workflow** keeps its agent node(s); the publish agent gets a **workflow-trigger tool** (not browser fill).  
5. Agent triggers the posting workflow after draft approval.

### Does it simplify Content Media?

**Yes**, for the day-1 product claim (reliable autonomous text posts):

| Concern | Browser path | MCP + connector path |
|---------|--------------|----------------------|
| Tab lease / Client Chrome readiness | Required | **Not required** for FB/LI text |
| UI fragility (Lexical, Post button, discard) | High | **Low** (API contract) |
| Confirm “really on feed” | DOM heuristics | API id / URN + HTTP status |
| Multi-tab cleanup | Complex | **N/A** |
| CEO mid-run babysitting | Was a product failure mode | Only OAuth reconnect if token dies |
| Blueprint SOP surface | Long shadow-DOM runbooks | Short: credentials + trigger |

**Not automatically free:** LinkedIn only works after a **real OpenConnector LinkedIn app** is connected and the **share action id + input schema** are certified in the live catalog. Facebook only works after CEO OAuth + a chosen **page_id**.

### Improvisations (recommended over “agent calls raw MCP/OC tools”)

| Idea | Why |
|------|-----|
| **Single workflow** `Publish social post` (not per-platform workflows) | One grant surface, one run log shape, one Kanban hand-off |
| **`if` / switch on `platform`** | Same contract: `{ platform, body, link?, page_id?, media_urls? }` |
| Agent uses **`agent_workflow_trigger`** only | Already entitlement-scoped; no mid-tool OAuth gymnastics in OpenClaw chat |
| Optional thin wrapper tool later: **`social_post_publish`** | Maps to the same workflow; simpler skill text for OpenClaw |
| **Do not** put raw `connector_search_actions` on Channel Publisher by default | Catalog thrash; pin action id in the workflow node |
| Keep **Kanban / CEO approval** before trigger | Existing product gate | 
| **Browser demoted** to: IG story edge cases, sites without API, emergency flag `publish_path=browser` | Preserve code; remove from default SOP |
| **Instagram** via same Meta Graph MCP when ready; **blog** separate | Avoid blocking FB+LI on blog CMS |

---

## 3. Target architecture

```text
CEO weekly goal
    → COO agent_workflow_trigger: Operate – Content production loop
        → Strategist / Media / Reviewer (unchanged)
        → Kanban CEO gate (if style = approval)
        → Channel Publisher agent
              · tool: agent_workflow_trigger
              · args: workflow_id = "content-publish-social"
                      input = { platform, body, link?, page_id?, fingerprint, source_run_id }
        → Workflow: content-publish-social (published, certified)
              · validate_input
              · switch(platform)
                    · facebook  → mcp_tool  mcp-meta-graph / create_page_post
                    · linkedin  → connector  <LinkedIn share actionId>
                    · (later) instagram → mcp_tool create_instagram_post
              · normalize_result → { ok, platform, external_id, url?, error }
              · write master_data publish_log + content_topics_history
        → Notify / complete card
```

**Authorization line:**  
- Workflow run owner = company CEO (entitlement filter preserved).  
- MCP OAuth token and OC runtime token resolve from **that CEO**.  
- No agent may post without Kanban approval when operate style requires it.

---

## 4. Workflow design: `content-publish-social`

### 4.1 Contract (run input)

```json
{
  "platform": "facebook" | "linkedin",
  "body": "EXACT post text (non-empty)",
  "link": "optional https://...",
  "page_id": "required for facebook when multi-page",
  "fingerprint": "CMS-… uniqueness token",
  "source_run_id": "optional operate run id",
  "media": []
}
```

### 4.2 Graph (logical nodes)

| Node | Type | Role |
|------|------|------|
| `n_in` | input / validate | Reject if `body` &lt; N chars or platform unknown |
| `n_branch` | **if / switch** | Route by `platform` |
| `n_fb` | **mcp_tool** | `mcpServerId=mcp-meta-graph`, `toolName=create_page_post`, map `message←body`, `page_id`, optional `link` |
| `n_li` | **connector** | Pinned `actionId` for LinkedIn share/UGC (from certified catalog) |
| `n_norm` | code / brain short | Unify success → `external_id`, failure → `error` |
| `n_log` | master_data write | `publish_log`, `content_topics_history` (20-day fingerprint) |
| `n_out` | output | Structured for Channel Publisher to paraphrase |

### 4.3 LinkedIn action pinning

Before go-live:

1. CEO **Connectors** → provision OpenConnector → connect LinkedIn app.  
2. Operator certifies: `search_actions` / UI shows share action; record stable **`actionId`** + required fields (e.g. `commentary` / `text`).  
3. Store as workflow node config (and optional env `CONTENT_LINKEDIN_OC_ACTION_ID` for seed).  
4. If catalog has **no** LinkedIn share yet → **Phase 0 gate**: do not claim LinkedIn publish; product UI shows “LinkedIn connector incomplete”.

### 4.4 Facebook MCP

1. CEO **Connectors → MCPs** → connect **Meta Graph** (existing OAuth).  
2. Once: call `list_my_pages` (setup wizard or first-run workflow step) → store default `page_id` in master_data `channel_config` or company settings.  
3. Runtime: `create_page_post` only (no browser).

---

## 5. Blueprint & operate model changes

### 5.1 `content_creator` pack (`content_creator.json`)

| Area | From | To |
|------|------|-----|
| Channel Publisher **role** | “Autonomous Browser Session publish…” | “Trigger certified social publish workflow (FB MCP + LI OpenConnector)” |
| Channel Publisher **tools** | `browse_task_*`, `browse_recipe_*` | **`agent_workflow_trigger`**, `agent_workflow_runs`, master_data_*, notify_ceo, kanban_*; browse tools **optional**/demoted |
| SOPs | Autonomous Browser Session fill/post/close | **SOP – API publish via workflow**; browser SOP marked **fallback only** |
| Operate narrative | CEO path /browser-session | CEO path `/connectors` (MCP + OC apps ready) |
| Channels catalog | `system_id: browser_session` | `facebook` → `mcp-meta-graph`; `linkedin` → `openconnector`; blog may stay browser |

### 5.2 Operate model (`content-creator.js`)

- Goals: add **Facebook MCP connected**, **LinkedIn OpenConnector linked**, **default page_id set**, **publish workflow certified**.  
- Channel Publisher daily tasks: trigger `content-publish-social` with exact body; poll run; log outcome.  
- Remove “do not ask CEO for tab focus” as primary; replace with “do not claim publish without connector ready.”  
- COO content loop unchanged except publish hand-off text.

### 5.3 Published templates

- Seed **workflow definition** `content-publish-social` into blueprint pack / company seed (like other operate workflows).  
- Content production loop agent system prompts: **never** invent post URLs; use run output only.  
- Re-publish blueprint `content-media-autonomous-publish` (or successor id/name: **“Content Media Studio (API Publish)”**).

### 5.4 Entitlements

- Post-login: all tool endpoints and workflow runs remain **CEO owner-scoped**.  
- Channel Publisher may **trigger** the publish workflow only for its company’s owner (existing `triggerAgentWorkflowForOwner`).  
- Do **not** remove owner filters when adding convenience tools.

---

## 6. Agent tooling detail

### 6.1 Preferred (minimal new surface)

Grant Channel Publisher (and optionally COO):

- `agent_workflow_list`  
- `agent_workflow_trigger`  
- `agent_workflow_runs`  

Skill / SOUL text:

> After approval, call `agent_workflow_trigger` with workflow_id `content-publish-social` and input `{ platform, body, page_id?, link?, fingerprint }`. Wait via `agent_workflow_runs` until completed/failed. Log from structured output. Never use browser compose for Facebook/LinkedIn unless `publish_path=browser` is explicitly set.

### 6.2 Optional productization (Phase 2)

`social_post_publish` content tool → server-side wraps the same workflow (validates body, maps aliases `fb`/`li`, returns normalized result). Easier for OpenClaw than free-form workflow_id.

**Avoid Phase 1:** Channel Publisher freely calling `connector_search_actions` / ad-hoc MCP tool names (nondeterministic action ids, harder audit).

---

## 7. What happens to Browser Session social publish

| Capability | Action |
|------------|--------|
| `browser-social-publish.js` | Keep in tree; feature-flag or “emergency only” |
| Recipe + generic browse | Blog CMS, research, login setup |
| Dual FB/LI UI tests | Retire as go-live criteria for Content Media |
| Knowledge docs | Prefer amendment + update `22-browser-session` to “not primary for FB/LI post” |

Explicit **product messaging:** Content Media Studio publish = **connectors + workflow**, not Client Chrome babysitting.

---

## 8. Phased delivery

### Phase 0 - Readiness gates (1-2 days)

- [x] Seed Meta Graph MCP registry path (seed-meta-graph-mcp.js + platform MCP ensure).  
- [ ] Platform admin: set **App ID/Secret on Connectors -> MCPs** (not .env); CEO OAuth Connect; list_my_pages.  
- [ ] Confirm OpenConnector provisioned for content CEO; **LinkedIn share action** exists; pin ctionId.  
- [ ] Master data fields: acebook_page_id, linkedin_connection_ready.  
- [x] Stop shipping browser dual tests as acceptance for FB/LI.

### Phase 1 - Publish workflow (core)

- [x] Implement / seed graph content-publish-social (if + mcp_tool FB + connector LI).  
- [x] Bootstrap new CEO/company + publish definition (ootstrap-content-publish-phase01.js).  
- [ ] Manual run test: FB then LI with unique fingerprint (after OAuth).  
- [ ] Fail closed on missing OAuth / action (verify live).

### Phase 2 — Blueprint wire-up

- [ ] Update pack, operate model, SOPs, channel readiness.  
- [ ] Channel Publisher tools: workflow trigger set; browse demoted.  
- [ ] Re-validate blueprint snapshot; re-publish industry template.  
- [ ] Onboarding wizard step: “Connect Facebook MCP + LinkedIn app”.

### Phase 3 — Operate loop polish

- [ ] Content production loop output schema always includes `{ platform, exact_body }`.  
- [ ] Optional `social_post_publish` thin tool.  
- [ ] Metrics: success rate by platform from `publish_log`.  
- [ ] Instagram via same Meta Graph when product wants it.

### Phase 4 — Deprecate

- [ ] Default SOPs no browser post for FB/LI.  
- [ ] Admin flag to disable social DOM engine.  
- [ ] Update `SOCIAL_POSTING_OPTIONS.md` recommendation = **this plan** (Option 1 + OC for LI).

---

## 9. Test plan (acceptance)

| # | Test | Pass criteria |
|---|------|----------------|
| T1 | FB OAuth | `list_my_pages` + one `create_page_post` from MCP playground / mcp_tool node |
| T2 | LI connector | One share via Connector node / `executeConnectorAction` with pinned action |
| T3 | Workflow switch FB | Trigger with `platform=facebook`; run completed; `external_id` present; row in `publish_log` |
| T4 | Workflow switch LI | Same for LinkedIn |
| T5 | Agent path | Channel Publisher (or script as that agent tools) uses **only** `agent_workflow_trigger`; no `browse_task_start` |
| T6 | Entitlements | Wrong CEO cannot run against another company’s pages |
| T7 | Gate | Unapproved draft: agent does not trigger publish |
| T8 | Fallback off by default | Browser FB/LI not in SOP; fail message points to Connectors |

**Not required for acceptance:** Client Chrome posting, tab close, brand-on-feed DOM scan.

---

## 10. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| LinkedIn OC catalog lacks share | Phase 0 hard gate; block blueprint claim until certified action |
| FB personal profile vs Page | Meta Graph posts are **Page**-oriented; document “Page only”; personal profile would need different product |
| Token expiry mid-campaign | MCP OAuth refresh / OC reconnect UX; task fails with “reconnect Facebook MCP” |
| Agents invent action ids | Pin in workflow; forbid free-form connector search on publisher in Phase 1 |
| Dual path confusion | Single SOP; demote browser; one publish workflow id |
| Media/image posts | Phase 1 text+link only; Meta `upload_photo` / OC media later |

---

## 11. Out of scope (this amendment)

- YouTube long-form.  
- Rewriting generic browser research tools.  
- Replacing Kanban CEO approval.  
- Unifying all SaaS into one third-party social scheduler (Ayrshare etc.) — optional later; not required if MCP + OC cover FB/LI.

---

## 12. Summary recommendation

**Adopt the workflow-as-tool model.** It is simpler, more stable, and aligns with onboarding already done (Facebook MCP) and LinkedIn OpenConnector. Improving the plan means:

1. **One** certified workflow with **if/switch**, not agent-raw multi-tool sprawl.  
2. **Pin** LinkedIn action id after catalog proof.  
3. **Regrant** Channel Publisher to **`agent_workflow_trigger`**, not `browse_task_start`.  
4. **Rewrite** content_creator blueprint SOPs and readiness around Connectors.  
5. **Retire** browser FB/LI as primary; keep only as explicit fallback.

This is an **operating-model and blueprint amendment first**; implementation follows Phases 0–2 without hotfixes on the Lexical/CDP path.

---

## Source of truth / deploy (no long-lived hotfixes)

All content-media pipeline changes live in git sources that full image builds pick up:

| Layer | Path |
|-------|------|
| Publish workflow seed | `backend/scripts/seed-content-publish-social-workflow.js` |
| Comments ingest + community triage (`mcp_tool` + `brain` MCP loop + agent master_data — **no** one-off content tools) | `backend/scripts/seed-content-comments-ingest.js` |
| Day0/Day1 org complete helper | `backend/scripts/complete-content-ops-pipeline.js` |
| Blueprint snapshot / publish | `backend/src/services/company-blueprint-publish.js`, `company-blueprints/registry.js` |
| Operate model pack | `backend/src/services/company-operate-models/content-creator.js`, `packs/content_creator.json` |
| Docker image | `deploy/docker/backend.Dockerfile` `COPY backend ./backend` (includes scripts + src) |
| Sync + rebuild | `deploy/scripts/sync-to-vps.ps1` → `vps-deploy-latest.sh` |
| Post-deploy CEO seeds | set `SEED_CONTENT_MEDIA_OWNER` in `deploy/.env` |

Do not leave production-only via `docker cp`; re-run sync + image rebuild so host `/opt/agent-os` matches the image.
