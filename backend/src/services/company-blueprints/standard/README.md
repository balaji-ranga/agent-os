# Standard prefabs & workflow templates

Redeploy-safe source of truth **alongside** industry packs in `../packs/`.

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

## When things land in a user account

| Asset | Trigger |
|-------|---------|
| COO / Workflow Builder / Platform Help | CEO create + backend startup (`DEFAULT_ONBOARD_AGENT_IDS`) |
| CRM prefabs + CRM MC workflow | Profile **CRM** = `twenty` or `erpnext` (or Company setup Apply) |
| ERP prefabs + ERP MC workflow | Profile **ERP** = `erpnext` |
| Industry agents / optional Day 1 graphs | Company setup / Operate Day 1 blueprints |
| IBKR paper workflows | Run seed scripts listed in the trading manifest (not auto Profile) |

Runtime loaders:

- `standard-prefabs.js` — load packs
- `prefab-crm-agents.js` / `prefab-erp-agents.js` — create/grant agents
- `business-core-maker-checker-workflows.js` — install published workflow defs

CLI re-seed: `node backend/scripts/seed-business-core-maker-checker-workflows.js`