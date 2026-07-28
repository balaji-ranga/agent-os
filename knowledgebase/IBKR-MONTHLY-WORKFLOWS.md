# IBKR Monthly Trading — Workflows, tools, schedules, outcomes

Quick reference for the Monthly Positive Return suite. Detail and recovery: [IBKR-MONTHLY-EXECUTION-MODEL.md](IBKR-MONTHLY-EXECUTION-MODEL.md). Bridge: [IBKR-LOCAL-BRIDGE.md](IBKR-LOCAL-BRIDGE.md). Plan: [IBKR-MONTHLY-TRADING-PLAN.md](IBKR-MONTHLY-TRADING-PLAN.md).

**Disclaimer:** Automation tooling — not financial advice. Paper first.

---

## Monthly suite (primary)

| Workflow | ID | Where | Schedule / trigger | Main tools | Purpose | Outcome |
|----------|-----|-------|--------------------|------------|---------|---------|
| **W1** Post-close review & plan | `monthly-trading-w1-post-close` | VPS | (1) W3 `eod_snapshot` chain; (2) cron `cron_post_close_fallback` default `5 21 * * 1-5` (server TZ); (3) chat `run monthly trading review`; (4) manual | `market_regime`, `ibkr_monthly_guardrail`, open day-plans API, account snapshot API, `market_screener`, `ibkr_order_learnings`, brain history, Maker (Claude Opus), Checker (deepseek-v4-flash), hard gates, optional `ceo_approval`, save plan, email digest, `notify_ceo` | Build next session plan from regime, learnings, open plans, live snapshot | `trading_day_plans` **approved** (or pending CEO); digest + notify; ready for W2 |
| **W2** Execute | `monthly-trading-w2-execute` | Laptop | US open via Task Scheduler / desktop `Run-Workflow.ps1` (manual trigger in graph; schedule is OS-side) | `trading_plan_fetch`, local bridge HTTP (`127.0.0.1:3010` place/exit/stop), plan execution report APIs, `notify_ceo` | Place approved/partial plan against IB Gateway | Orders at IBKR; plan `executing` → `partial` / `executed` / `failed` |
| **W3** Event handler | `monthly-trading-w3-events` | VPS | Webhook anytime (`event` + manual); bridge POSTs fill / reject / cancel / stop_out / equity_mark / eod_snapshot / order_status | `ibkr_equity_mark`, `ibkr_monthly_guardrail`, **ingest → `ibkr_order_events`** (cancels/rejects/fills for learnings), `trading_journal`, `notify_ceo`; on EOD → start W1 | Persist marks/journal/**order learnings**; CEO notify on milestones; W1 started on EOD |
| **W5** Weekly review | `monthly-trading-w5-weekly` | VPS | Saturday cron `cron_weekly_review` default `0 10 * * 6`; manual | `trading_journal`, `ibkr_monthly_guardrail`, email | Weekly (and first-week monthly) performance digest | Email summary; **no orders** |

| Process | ID / path | Where | Schedule | Role | Outcome |
|---------|-----------|-------|----------|------|---------|
| **Local IBKR bridge** | `backend/local-ibkr-bridge` (Connectors zip) | Laptop | Always-on / Task Scheduler while Gateway up | HTTP↔TWS adapter; push webhooks to W3 | Gateway reachable; events reach VPS |

W2 must **not** use `ceo_approval`, `brain`, or `agent` nodes (desktop package limit).

Default crons and **budget caps** live in workflow **Variables** (seed: `backend/scripts/monthly-trading-seed-variables.js`). Key dollar limits for W1:

| Variable | Default | Meaning |
|----------|---------|---------|
| `daily_budget_usd` | `1000` | Max USD notional for **new_entry** actions in a plan |
| `max_trades_per_day` | `5` | Max **new_entry** count per plan |
| `risk_per_trade_pct` | `0.75` | Max risk % of portfolio per trade |
| `position_size_pct_*` | 3 / 8 / 15 | Soft band + hard max position % |
| `cash_band_pct_*` | 30 / 80 | Target cash band % |
| `monthly_drawdown_stop_pct` | `4` | Guardrail halt new entries |

Override in Workflows → W1 → Variables (then Publish). Re-seed merges defaults if the keys were missing.

---

## Day-plan statuses (W1 ↔ W2)

| Status | Meaning |
|--------|---------|
| `pending` | Plan produced; gates/CEO not finished |
| `approved` | Ready for W2 |
| `executing` | W2 started |
| `partial` | Some actions done |
| `executed` | Done (or intentionally skipped with reason) |
| `failed` | W2/bridge failure |
| `superseded` | Newer W1 replaced this plan |

If W2 ran but VPS missed updates: next W1 reconciles vs **IBKR snapshot** (IBKR truth wins). See execution model recovery table.

---

## Legacy paper workflows (pre-monthly)

| Workflow | ID | Schedule / trigger | Purpose |
|----------|-----|--------------------|---------|
| Maker/Checker day plan | `ibkr-maker-checker-paper` | Chat `run ibkr day plan` / manual | Allowlist paper day plan → CEO → place |
| Position poller | `ibkr-position-poller-paper` | Schedule / manual | Poll paper positions & orders |

Prefer the **monthly** W1–W5 suite for the Positive Return system.