# Standard prefabs & workflow templates

Redeploy-safe source of truth **alongside** industry packs in `../packs/`.

Regenerate from live CEOs:

```bash
# BrightBox: demo pack + platform-agents + business-core agent packs / 11-node MC graphs
node scripts/publish-brightbox-and-regenerate-standard.js

# Balaji: demo pack + zip + standard/video-content graphs (keeps richer BrightBox CRM/ERP graphs)
node scripts/publish-balaji-demo-blueprint.js

# IBKR monthly W1–W5 golden graphs from the demo pack
node scripts/export-standard-ibkr-workflows.js

# Workspace MD (KEEP_BETTER=1): video from Balaji; CRM/ERP/lean compared vs source
SOURCE_OWNER_USER_ID=ceo-bala node scripts/export-workspace-templates-from-owner.js
SOURCE_OWNER_USER_ID=ceo-demo-brightbox-744921 node scripts/export-workspace-templates-from-owner.js
```

| Path | Purpose |
|------|---------|
| `catalog.json` | Index of platform agents, Business Core packs, IBKR manifests |
| `platform-agents.json` | Lean COO (`balserve`), Workflow Builder, Platform Help |
| `business-core/agents-crm-twenty.json` | CRM Maker A/B + Checker (Twenty / `crm_*`) |
| `business-core/agents-crm-erpnext.json` | CRM Maker A/B + Checker (ERPNext Sales / `erp_*`) |
| `business-core/agents-erp-erpnext.json` | ERP Maker A/B, Checker, P&L / Invoice / Project |
| `business-core/workflow-crm-maker-checker.json` | Portable graph → `crm-mc-{ownerSlug}` |
| `business-core/workflow-erp-maker-checker.json` | Portable graph → `erp-mc-{ownerSlug}` |
| `trading/ibkr-workflows-manifest.json` | IBKR monthly W1–W5 golden graphs (`workflow-w*.json`; W1 `risk_per_trade_pct` default 5) + deprecated paper seed scripts |
| `trading/README.md` | How to refresh IBKR graphs from the demo pack |
| `video-content/` | Video studio agents + W-Reasoning / W-Media / W-Assembly graphs (`packs/video_content.json`) |

## Workspace templates (Business Core MD)

Role-stable folders under **`openclaw-workspace-templates/`** (not per-tenant ids). Runtime ids still use owner slug (`crm-s1-{slug}`, `erp-ap-{slug}`, …); `resolveWorkspaceTemplateBaseId()` maps them. **DOMAIN.md** (Twenty / ERPNext SME) is copied from `_shared/TWENTY-CRM-SME.md` / `_shared/ERPNEXT-SME.md` on template push. Full playbooks: platform-help **39** / **40**.

| Template folder | Prefab prefix / keys |
|-----------------|----------------------|
| `crm-maker-a` | `crm-s1-*` / maker_a |
| `crm-maker-b` | `crm-s2-*` / maker_b |
| `crm-checker` | `crm-ap-*` / checker |
| `erp-maker-a` | `erp-s1-*` |
| `erp-maker-b` | `erp-s2-*` |
| `erp-checker` | `erp-ap-*` |
| `erp-pnl` / `erp-invoice` / `erp-project` | `erp-pnl-*` / `erp-inv-*` / `erp-pm-*` |

Map JSON: `openclaw-workspace-templates/business-core-template-map.json` (exported from BrightBox Demo CEO).

On Profile CRM/ERP ensure and Admin **Refresh default agents** (`include_business_core`), workspaces are copied/force-pushed from these folders (TOOLS/AGENTS/SOUL/MEMORY + shared `AGENT-OS-OPS.md`).

## When things land in a user account

| Asset | Trigger |
|-------|---------|
| COO / Workflow Builder / Platform Help | CEO create + startup grants from `platform-agents.json` (`DEFAULT_ONBOARD` via `getPlatformLeanAgentIds()`). **Admin → Refresh default agents** re-syncs catalog fields + pushes `openclaw-workspace-templates/{id}/` MD (and shared `AGENT-OS-OPS.md`) for every targeted CEO. |
| CRM prefabs + CRM MC workflow | Profile **CRM** = `twenty` or `erpnext` (or Company setup Apply). Same Admin refresh re-ensures packs + MC graphs when Profile already has CRM. |
| ERP prefabs + ERP MC workflow | Profile **ERP** = `erpnext`. Same Admin refresh re-ensures when Profile has ERP. |
| Industry agents / optional Day 1 graphs | Company setup / Operate Day 1 blueprints |
| IBKR paper workflows | Deprecated seed scripts in the trading manifest. Prefer monthly W1–W5. |
| IBKR monthly W1–W5 | Golden graphs in `standard/trading/workflow-w*.json`. Company setup **demo_balaji_ranganathan** overlays them at Apply. Refresh: `node scripts/export-standard-ibkr-workflows.js`. W1 `risk_per_trade_pct` default 5 (blank = Maker decides). |
| Video content agents + W-Reasoning / W-Media / W-Assembly | Company setup / Operate **`video_content`** or **`demo_balaji_ranganathan`** (`companion_packs: ["video_content"]`). Runtime overlay hydrates full graphs from `standard/video-content/` so every Apply gets the tested studio (Content Orchestrator id `video-orch-{ownerSlug}`). Workspaces from `openclaw-workspace-templates/video-*`. |

### Video content maintenance

| Fix type | Edit here |
|----------|-----------|
| Agent SOUL/AGENTS/TOOLS/MEMORY | `openclaw-workspace-templates/video-orchestrator\|video-story\|video-scene\|video-prompt/` |
| Workflow graph / chat phrase | `standard/video-content/workflow-*.json` + `workflows-manifest.json` |
| Day 0 org / Master Data tables | `packs/video_content.json` |

Do not patch live CEO copies only — update these sources and re-seed/refresh.

Runtime loaders:

- `standard-prefabs.js` — load packs
- `admin-refresh-default-agents.js` — Admin refresh (lean + optional business-core)
- `prefab-crm-agents.js` / `prefab-erp-agents.js` — create/grant agents
- `business-core-maker-checker-workflows.js` — install published workflow defs

CLI re-seed: `node backend/scripts/seed-business-core-maker-checker-workflows.js`
