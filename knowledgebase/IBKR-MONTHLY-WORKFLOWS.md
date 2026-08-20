# IBKR Monthly Trading — Workflows, tools, schedules, outcomes

Quick reference for the Monthly Positive Return suite. Detail and recovery: [IBKR-MONTHLY-EXECUTION-MODEL.md](IBKR-MONTHLY-EXECUTION-MODEL.md). Bridge: [IBKR-LOCAL-BRIDGE.md](IBKR-LOCAL-BRIDGE.md). Plan: [IBKR-MONTHLY-TRADING-PLAN.md](IBKR-MONTHLY-TRADING-PLAN.md).  
**CEO help (simple language + diagrams):** [platform-help/20-ibkr-monthly-trading.md](platform-help/20-ibkr-monthly-trading.md).

**Disclaimer:** Automation tooling — not financial advice. Paper first.

**Data isolation:** plans, snapshots, fills, and marks are per CEO (`owner_user_id`) — not shared across users.

---

## Workflow definitions (W1 · W2 · W3 · W4 · W5)

| Short | System name | Workflow ID | Goal | Outcome |
|-------|-------------|-------------|------|---------|
| **W1** | Post-Close Review & Plan | `monthly-trading-w1-post-close` | Build the **next trading session’s** plan from market regime, portfolio snapshot, open prior plans, screener, order learnings, Maker (OpenAI GPT) + Checker (DeepSeek cloud) + hard gates (+ optional CEO for discretionary loss sells) | Day plan row in `trading_day_plans` (`approved` or pending CEO); digest + `notify_ceo`; ready for W2 |
| **W2** | Execute | `monthly-trading-w2-execute` | At open (laptop), **fetch your open plan** and **execute** via local IBKR bridge (map actions → full brackets, stop-only, entry-only, stops, sells) | Orders submitted at Gateway; plan status `executing` → `partial` \| `executed` \| `failed` + execution report |
| **W3** | IBKR Events | `monthly-trading-w3-events` | Event graph for **EOD** (and optional `fanout_w3`): journal, `notify_ceo`, guardrail, **start W1**. Default laptop POSTs go to the ingest API (`/api/ibkr-trading/local-bridge-webhook`) using **this workflow’s hook secret** — 5‑min snapshots/fills save cache **without** starting W3 | On EOD: journal/notify + **W1 started**; book/order events already persisted by ingest |
| **W4** | *(not used)* | — | Reserved / unused in the current suite | No workflow |
| **W5** | Weekly Review | `monthly-trading-w5-weekly` | Weekly (default Saturday) **performance digest** from journal + guardrail | Email summary only; **no order placement** |
| **Bridge** | Local IBKR bridge | Connectors zip / `backend/local-ibkr-bridge` | Loopback HTTP to Gateway; **polls** (no live fill stream); POST ingest URL + W3 secret | Gateway reachable; cloud receives your session book and fills |

---

## Monthly suite (ops detail)

| Workflow | ID | Where | Schedule / trigger | Main tools | Purpose | Outcome |
|----------|-----|-------|--------------------|------------|---------|---------|
| **W1** Post-close review & plan | `monthly-trading-w1-post-close` | VPS | (1) W3 `eod_snapshot` chain; (2) cron `cron_post_close_fallback` default `5 21 * * 1-5` (server TZ); (3) chat `run monthly trading review`; (4) manual | `market_regime`, `ibkr_monthly_guardrail`, open day-plans API, **account-snapshot/latest** (laptop cache), `market_screener`, `ibkr_order_learnings`, brain history, Maker (OpenAI GPT + vault openAI_key), Checker (DeepSeek cloud + vault deepseek_key), optional Brave MCP, hard gates, optional `ceo_approval`, save plan, email digest, `notify_ceo` | Build next session plan from regime, learnings, open plans, last successful laptop snapshot | `trading_day_plans` **approved** (or pending CEO); digest + notify; ready for W2 |
| **W2** Execute | `monthly-trading-w2-execute` | Laptop | US open via Task Scheduler / desktop `Run-Workflow.ps1` (manual trigger in graph; schedule is OS-side) | `trading_plan_fetch`, local bridge `execute-day-plan` / place / exit / stop, plan execution report APIs, `notify_ceo` | Place approved/partial plan against IB Gateway | Orders at IBKR; plan `executing` → `partial` / `executed` / `failed`; post-session **account_snapshot** pushed for learnings |
| **W3** Event handler | `monthly-trading-w3-events` | VPS | Default: **`eod_snapshot`** from ingest API (also manual Run, or `fanout_w3=1`). Direct W3 hook URL runs the graph on every POST | `account-snapshot/ingest`, `ibkr_equity_mark`, `ibkr_monthly_guardrail`, ingest → `ibkr_order_events`, `trading_journal`, `notify_ceo`; on EOD → start W1 | Journal / notify / **W1 on EOD**. Intraday book + order events persist via ingest without this run |
| **W5** Weekly review | `monthly-trading-w5-weekly` | VPS | Saturday cron `cron_weekly_review` default `0 10 * * 6`; manual | `trading_journal`, `ibkr_monthly_guardrail`, email | Weekly (and first-week monthly) performance digest | Email summary; **no orders** |

| Process | ID / path | Where | Schedule | Role | Outcome |
|---------|-----------|-------|----------|------|---------|
| **Local IBKR bridge** | `backend/local-ibkr-bridge` (Connectors zip) | Laptop | Always-on / Task Scheduler while Gateway up; equity timer default **300s** | HTTP↔TWS adapter; poll Gateway; POST ingest URL (`WEBHOOK_SECRET` = W3 hook secret) | Gateway reachable; snapshots/fills reach VPS under that CEO owner |

W2 must **not** use `ceo_approval`, `brain`, or `agent` nodes (desktop package limit).

Default crons and **budget caps** live in workflow **Variables** (seed: `backend/scripts/monthly-trading-seed-variables.js`). Key dollar limits for W1:

| Variable | Default | Meaning |
|----------|---------|---------|
| `daily_budget_usd` | `1000` | Max USD notional for **new_entry** actions in a plan |
| Cash for spendable | IBKR snapshot → workflow fallback | `spendable = min(daily_budget, cash)`; cash is **not** NetLiquidation. Target notional for a new_entry is `min(spendable, equity × position_size_pct_max%)`, at least the `position_size_pct_min` band, using leftover that can still buy a share. |
| `max_trades_per_day` | `5` | Max **new_entry** count per plan |
| `risk_per_trade_pct` | `5` | Max **stop distance % below entry per order**. Blank or `0` = Maker chooses. Re-seed bumps the old `0.75` default to `5`. |
| `position_size_pct_*` | 3 / 8 / 15 | Soft band + hard max position % |
| `cash_band_pct_*` | 30 / 80 | Target cash band % |
| `entry_slip_pct_max` | `0.25` | Max % a BUY limit may sit **above** last (chase) |
| `entry_discount_pct_max` | `3` | Max % a BUY limit may sit **below** last (unfillable / invented prices). W1 hard gates reject; W2 skips the buy if Gateway/FMP last disagrees |
| `screener_enrich_limit` | `25` | FMP PE, SMA50/200, 3m/6m momentum, 52w distance, revenue/EPS YoY on screener names (default matches `screener_limit`). Missing stats → Brave Search fallback. |
| `monthly_drawdown_stop_pct` | `4` | Guardrail halt new entries |
| `cron_post_close_fallback` | `5 21 * * 1-5` | W1 schedule seed. Interpreted in **server `TZ`**, not US Eastern. On Asia/Singapore hosts use a converted post-close cron such as `40 4 * * 2-6` (04:40 Tue–Sat ≈ 16:40 US Eastern previous weekday). |

Override in Workflows → W1 → Variables (then Publish). Blank or `0` on `risk_per_trade_pct` leaves stop distance to the Maker. Re-seed bumps the old `0.75` default to `5`, old `screener_enrich_limit` of `8` to `25`, and keeps other CEO overrides.

Maker **chooses** on each `new_entry`: full IBKR bracket (stop+tp) **or** hold-for-weeks (`bracket` false, `exit_plan` later_day_plan, `forecast_up_weeks` ≥ 1, omit tp). A later W1 day plan then decides sell / hold / raise_stop. W2 places `bracket`, `stop_only`, or `entry_only`.

Company setup deep pack `demo_balaji_ranganathan` embeds the same graphs from the frozen JSON (not only the seed scripts). Keep that pack’s W1 hard-gates bindings and `entry_discount_pct_max` in sync (`patch-demo-blueprint-ibkr-quote-band.js` + `FROM_PACK_FILE=1 publish-balaji-demo-blueprint.js`). Refresh golden templates: `node scripts/export-standard-ibkr-workflows.js` → `company-blueprints/standard/trading/`. Thin industry pack `trading_ops` is org-only.

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

## IBKR Summary UI + clear APIs

| UI | Route |
|----|-------|
| CEO Summary (portfolio + plan vs executed) | `/ibkr-summary` → `frontend/src/pages/IbkrSummary.jsx` |

| API (auth / internal; owner-scoped) | Purpose |
|-------------------------------------|---------|
| `GET /api/ibkr-trading/summary` | Dashboard JSON |
| `GET /api/ibkr-trading/summary/day` | Drilldown for one `plan_date` |
| `GET /api/ibkr-trading/summary/clear-transactional` | Preview delete counts |
| `POST /api/ibkr-trading/summary/clear-transactional` | Clear plans/events/fills/marks/…; **keeps** workflow Variables |
| `GET /api/ibkr-trading/account-snapshot/latest` | Last laptop-pushed book for W1 |
| `POST /api/ibkr-trading/local-bridge-webhook` | Laptop default ingest (W3 hook secret + optional IP whitelist). Saves snapshot/fills; **starts W3 only** on `eod_snapshot` or `fanout_w3=1` |
| `POST /api/ibkr-trading/account-snapshot/ingest` | Internal/W3 node ingest of bridge `account_snapshot` |

Clear service: `backend/src/services/ibkr-transactional-clear.js` (confirm phrase `CLEAR_IBKR_TRANSACTIONAL`).  
CEO help: [platform-help/20-ibkr-monthly-trading.md](platform-help/20-ibkr-monthly-trading.md).

---

## Legacy paper workflows (pre-monthly)

| Workflow | ID | Schedule / trigger | Purpose |
|----------|-----|--------------------|---------|
| Maker/Checker day plan | `ibkr-maker-checker-paper` | Chat `run ibkr day plan` / manual | Allowlist paper day plan → CEO → place |
| Position poller | `ibkr-position-poller-paper` | Schedule / manual | Poll paper positions & orders |

Prefer the **monthly** W1–W3 / W5 suite for the Positive Return system. Snapshot budget/allowlist APIs follow **W1 Variables** when that workflow exists; they do not read this legacy paper allowlist.
