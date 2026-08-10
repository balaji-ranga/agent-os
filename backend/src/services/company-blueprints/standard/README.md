# Standard prefabs & workflow templates

Redeploy-safe source of truth **alongside** industry packs in `../packs/`.

Regenerate from BrightBox Demo CEO:

```bash
node scripts/publish-brightbox-and-regenerate-standard.js
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
| `trading/ibkr-workflows-manifest.json` | IBKR day-plan / poller / monthly W1–W5 seed scripts |

## Workspace templates (Business Core MD)

Role-stable folders under **`openclaw-workspace-templates/`** (not per-tenant ids). Runtime ids still use owner slug (`crm-s1-{slug}`, `erp-ap-{slug}`, …); `resolveWorkspaceTemplateBaseId()` maps them:

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
| IBKR paper workflows | Run seed scripts listed in the trading manifest (not auto Profile) |

Runtime loaders:

- `standard-prefabs.js` — load packs
- `admin-refresh-default-agents.js` — Admin refresh (lean + optional business-core)
- `prefab-crm-agents.js` / `prefab-erp-agents.js` — create/grant agents
- `business-core-maker-checker-workflows.js` — install published workflow defs

CLI re-seed: `node backend/scripts/seed-business-core-maker-checker-workflows.js`
