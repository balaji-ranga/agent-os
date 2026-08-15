# IBKR monthly workflow templates

Golden graphs for monthly trading **W1–W5**. Edit here (or refresh from the demo pack) — do not hotfix only a live CEO copy.

```bash
# From the current demo pack (includes W1 risk_per_trade_pct default 5 / blank = Maker decides)
node scripts/export-standard-ibkr-workflows.js

# Or as part of Balaji demo publish (WRITE_STANDARD default on)
FROM_PACK_FILE=1 node scripts/publish-balaji-demo-blueprint.js
```

| File | Workflow |
|------|----------|
| `workflow-w1-post-close.json` | Post-close review & plan (`monthly-trading-w1-post-close`) |
| `workflow-w2-execute.json` | Laptop execute |
| `workflow-w3-events.json` | IBKR events / ingest |
| `workflow-w5-weekly.json` | Weekly review |

W1 Variables: `risk_per_trade_pct` default **5** (max stop % below entry per order). Blank or `0` = Maker chooses.

Paper IBKR day-plan / poller stay seed-only (deprecated). Thin industry pack `trading_ops` is org-only; Company setup deep pack `demo_balaji_ranganathan` overlays these graphs at Apply time.

Index: `ibkr-workflows-manifest.json`. Loaders: `standard-prefabs.js` (`loadIbkrWorkflowTemplate`) + `ibkr-trading-pack.js`.
