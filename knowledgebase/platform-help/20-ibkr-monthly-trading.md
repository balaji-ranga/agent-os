# IBKR Monthly Positive Return trading (CEO)

Automate post-close planning on Flolah (VPS) and order execution on your **trading laptop** via IB Gateway + local bridge. Paper first.

**Not financial advice.** Validate for weeks on paper before enabling live trading.

## Pieces

| Piece | Where | What |
|-------|--------|------|
| **W1** Post-close plan | VPS workflow `monthly-trading-w1-post-close` | Regime, screener, learnings, Maker/Checker, hard gates, day plan, digest |
| **W2** Execute | Laptop desktop package | Fetches approved plan; places via local bridge |
| **W3** Events | VPS webhook | Fills/cancels/rejects → journal + **order learnings**; EOD starts W1 |
| **W5** Weekly | VPS Saturday cron | Journal / performance email |
| **Local IBKR bridge** | Laptop (Connectors download) | HTTP on `127.0.0.1:3010` ↔ Gateway port **4002** (paper) |

Quick tables: [IBKR-MONTHLY-WORKFLOWS.md](../IBKR-MONTHLY-WORKFLOWS.md). Recovery: [IBKR-MONTHLY-EXECUTION-MODEL.md](../IBKR-MONTHLY-EXECUTION-MODEL.md).

## Budget & risk (W1 Variables)

Open **Workflows → monthly-trading-w1-post-close → Variables**:

| Variable | Meaning |
|----------|---------|
| `daily_budget_usd` | Max **USD notional for new buys** (`new_entry`) in a plan |
| `max_trades_per_day` | Max new buy count |
| `risk_per_trade_pct` / `position_size_pct_*` | Risk and size % caps |
| `cash_band_pct_*` | Target cash band |
| `monthly_drawdown_stop_pct` | Halt new entries after drawdown from month HWM |

Budget applies to **buys only**, not sells. Prefer an IBKR **Cash** account so the broker itself blocks margin borrowing.

## Connectors → Download local IBKR bridge

1. **Connectors** → **Download local IBKR bridge** (or lite without Node).
2. Unzip; keep minted `LOCAL_BRIDGE_TOKEN` private.
3. Paste the same token into W2 variable `local_bridge_token`.
4. Set `WEBHOOK_URL` to your W3 hook; optional `WEBHOOK_SECRET`.
5. Run IB Gateway (paper **4002**) → `npm install` → `.\scripts\run-bridge.ps1`.

Details: [IBKR-LOCAL-BRIDGE.md](../IBKR-LOCAL-BRIDGE.md). Desktop W2 package: [17-desktop-windows-download.md](./17-desktop-windows-download.md).

## Learnings

Bridge **fill / cancel / reject / order_status** events go to W3 → `ibkr_order_events`. W1’s `ibkr_order_learnings` tool reads cancels/rejects for avoid-hints. Placed ≠ filled; true fills arrive via bridge webhooks (and W1 reconciles vs IBKR snapshot).

## Chat / certify

- Chat phrase (W1): `run monthly trading review`
- Publish W1 only after Anthropic (Maker) + DeepSeek (Checker) keys are set on Brain nodes
- Phase 4 runbook: [IBKR-MONTHLY-PHASE4.md](../IBKR-MONTHLY-PHASE4.md)

## Ask Platform Help

Examples: “How do I download the IBKR bridge?”, “Where is daily_budget_usd?”, “What does W3 do with cancels?”