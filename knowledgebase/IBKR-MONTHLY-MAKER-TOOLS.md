# IBKR Monthly Trading — Maker Tools (Paper vs Live)

Catalog of tools the **Monthly Positive Return** Maker Brain receives (wired as upstream workflow nodes; Maker does not call tools directly in v1). Clarifies paper vs live requirements, API keys, and caching policy.

Related: [IBKR-MONTHLY-TRADING-PLAN.md](IBKR-MONTHLY-TRADING-PLAN.md), [IBKR-TRADING-WORKFLOW.md](IBKR-TRADING-WORKFLOW.md).

**Disclaimer:** Automation tooling — not financial advice. Paper-trade until validated.

---

## Legend

| Column | Meaning |
|--------|---------|
| **API key** | External credential required beyond Agent OS session auth |
| **Paper** | What you need with `IBKR_IS_PAPER=true`, Gateway port **4002**, `IBKR_TRADING_ENABLED=0` (dry-run) or `1` (paper places) |
| **Live** | What you need with real money (`IBKR_ALLOW_LIVE=1`, live Gateway port **4001**, `IBKR_TRADING_ENABLED=1`) |
| **Cache** | When responses are served from SQLite (`market_data_cache` / existing `tool_summary_cache`) |

`force=true` on market-data tools bypasses cache (paper and live).

---

## 1. Market data (external provider — FMP)

Requires env `MARKET_DATA_API_KEY` (Financial Modeling Prep). Provider is abstracted; default = FMP **stable** API (`MARKET_DATA_BASE_URL=https://financialmodelingprep.com/stable`). Legacy `/api/v3` returns 403 for new keys.

**Free-tier note:** `company-screener` often returns **402** on free plans — Agent OS falls back to `MARKET_DATA_SCREENER_UNIVERSE` (or a built-in mega-cap list) + `/profile` enrichment. Regime uses EOD `/historical-price-eod/light` (then `/full` only if needed). Leftover workflow templates (`{{var.index_symbol}}`) are **never** sent to FMP. Plan-gated tickers (HTTP 402, e.g. some ETFs like VOOG on free) are skipped for the rest of the UTC day; remaining requested indexes then `MARKET_DATA_REGIME_FALLBACK_SYMBOLS` (default `SPY,QQQ,DIA,IWM`) are tried. First usable 200-DMA wins.

**Why one index (often SPY)?** `market_regime` is the **broader-market filter** (index vs 200-DMA → `risk_on` / `risk_off`), not the stock universe. The screener supplies candidate names. W1 variable `index_symbol` can be a single ticker or a comma-separated list; it is not hardcoded to SPY in the fetch path.

| Tool | API key | Paper | Live | Cache policy |
|------|---------|-------|------|--------------|
| `market_regime` | **Yes — FMP** (free tier OK) | Key + network | Same key; prefer paid if daily volume exceeds free 250 calls/day | **EOD cache** — valid until next UTC day. 200-DMA regime does not need intraday refresh. |
| `market_screener` | **Yes — FMP** | Free key OK for small universes / infrequent tests; expect to hit 250/day limit | **Paid FMP recommended** for daily 50–100 name screens | **Paper:** TTL **6h**. **Live:** TTL until next US session date (or **12h**). Screener is the biggest call consumer — always cache. Optional `enrich=true` (W1 default) attaches history + fundamentals on the top `enrichLimit` names (PE, SMA50/200, 3m/6m momentum, 52w, revenue/EPS YoY). |
| `market_history` | **Yes — FMP** | Free key OK with cache | Paid if screening many symbols daily | **Completed calendar days:** cache **indefinitely**. **Current day bar:** refresh **Paper 1h** / **Live 15m**. |
| `market_fundamentals` | **Yes — FMP** | Free key OK (basic US income statements) | Same; paid for higher limits / deeper history | **Paper:** TTL **7 days**. **Live:** TTL **3 days**. Fundamentals change slowly. |

### FMP plan guidance

| Mode | Suggested FMP plan | Why |
|------|-------------------|-----|
| Paper / certify / smoke | **Free** (250 calls/day) + aggressive cache | W1 once/day with cached history stays under limits |
| Live daily W1 (50–100 stocks) | **Starter+ (~$22/mo)** | Screener + per-symbol history/fundamentals exceeds free tier without heavy caching |

Signup: [FMP developer dashboard](https://site.financialmodelingprep.com/developer/docs) — free key needs no credit card.

---

## 2. IBKR account / orders (local Gateway)

No third-party market-data license. Needs **IBKR account + Gateway on the laptop**.

| Tool | API key | Paper | Live | Cache |
|------|---------|-------|------|-------|
| `ibkr_account_snapshot` | No (IBKR session via Gateway) | Paper account + Gateway **4002** | Live account + Gateway **4001** + `IBKR_ALLOW_LIVE=1` | **Never cache** — always fetch from Gateway |
| `ibkr_day_status` | No | Ledger in Agent OS DB | Same | **Never cache** — ledger is source of truth |
| `ibkr_preflight` | No | Same | Same | **Never cache** |
| `ibkr_exit_candidates` | No | Same | Same | **Never cache** |
| `ibkr_order_learnings` | No for `actual`; **platform/BYOK LLM** if `summarized` | Same | Same | Existing `tool_summary_cache` (per UTC day + watermark) |

Gateway env (secrets, not workflow variables): `IBKR_HOST`, `IBKR_PORT`, `IBKR_CLIENT_ID`, `IBKR_ACCOUNT_ID`, `IBKR_IS_PAPER`, `IBKR_TRADING_ENABLED`, `IBKR_ALLOW_LIVE`.

Optional later: IBKR **real-time US market data subscriptions** for live quotes on the Gateway. Paper/delayed MD type 3 is enough for bracket reference prices in v1.

---

## 3. Portfolio state / guardrail / journal (Agent OS DB)

| Tool | API key | Paper | Live | Cache |
|------|---------|-------|------|-------|
| `ibkr_monthly_guardrail` | No | Equity marks from ingest / EOD snapshot | Same | **Recompute always** from `ibkr_equity_marks` (cheap DB read) |
| `trading_journal` | No | Fills/events in DB | Same | **Recompute always** (or soft ≤5m if hot) |
| `trading_plan_save` / `trading_plan_fetch` | No | Stored plans | Same | N/A (CRUD) |
| `brain_history` | **platform/BYOK LLM** when summarized | Same | Same | Existing daily `tool_summary_cache` |

---

## 4. Brain models (not tools — but required keys)

| Role | Model | API key | Paper | Live |
|------|-------|---------|-------|------|
| Maker | OpenAI GPT (`openai` Brain, default `gpt-4o`) | Vault **`openAI_key`** (`apiKeyRef`) | Required | Required |
| Checker | DeepSeek cloud (`deepseek` Brain, default `deepseek-chat`) | Vault **`deepseek_key`** | Required | Required |
| Optional web context | Brave Search MCP (`mcp-brave-search`) on Maker/Checker | Vault **`BRAVE_SEARCH_BYOK`** | Optional | Optional |

These are independent of FMP / IBKR.

---

## 5. Explicitly not for Maker (downstream)

| Tool | Paper | Live | Notes |
|------|-------|------|-------|
| `ibkr_place` / `ibkr_reserve` / `ibkr_confirm_fill` | Dry-run or paper place | Live place only with kill-switch off | W2 laptop execution |
| `ibkr_validate_plan` | Script/Checker path | Same | Hard gates |
| `notify_ceo` | Session entitled CEO | Same | No extra key |
| Email digest (`email` node / `email_send`) | `WORKFLOW_SMTP_*` | Same | SMTP credentials |

---

## 6. Minimum checklist

### Paper (start here)

1. IBKR paper account + Gateway listening on `127.0.0.1:4002`
2. `IBKR_IS_PAPER=true`, `IBKR_TRADING_ENABLED=0` until dry-run validated
3. `MARKET_DATA_API_KEY` = FMP free key
4. CEO vault keys **`openAI_key`** + **`deepseek_key`** (optional **`BRAVE_SEARCH_BYOK`**) then reseed: `node scripts/seed-monthly-trading-w1-workflow.js`
5. SMTP if testing daily digest email

### Live (after paper validation)

1. Live Gateway port / account; `IBKR_IS_PAPER=false`, `IBKR_ALLOW_LIVE=1`, `IBKR_TRADING_ENABLED=1`
2. Paid FMP (or equivalent) if daily call volume exceeds free tier
3. Same Brain keys; consider IBKR real-time MD subscriptions if you leave delayed quotes
4. Confirm monthly drawdown guardrail + CEO ≥3% loss-sell approval still enforced

---

## 7. Caching summary (implementation defaults)

| Data class | Paper TTL | Live TTL | Rationale |
|------------|-----------|----------|-----------|
| Regime (index vs 200-DMA) | Until next UTC day | Until next UTC day | EOD indicator |
| Screener results | 6 hours | 12 hours / next session | Expensive; W1 runs once post-close |
| History bars (past days) | Forever | Forever | Immutable EOD |
| History bar (today) | 1 hour | 15 minutes | Intraday drift |
| Fundamentals | 7 days | 3 days | Slow-moving |
| IBKR snapshot / ledger / guardrail | Always fresh | Always fresh | Trading correctness |
| LLM summaries (learnings / brain history) | Existing daily watermark cache | Same | Cost control without stale decisions |

Env overrides (optional): `MARKET_DATA_REGIME_FALLBACK_SYMBOLS`, `MARKET_DATA_CACHE_SCREENER_TTL_SEC_PAPER`, `MARKET_DATA_CACHE_SCREENER_TTL_SEC_LIVE`, `MARKET_DATA_CACHE_FUNDAMENTALS_TTL_SEC_PAPER`, `MARKET_DATA_CACHE_FUNDAMENTALS_TTL_SEC_LIVE`, `MARKET_DATA_CACHE_TODAY_BAR_TTL_SEC_PAPER`, `MARKET_DATA_CACHE_TODAY_BAR_TTL_SEC_LIVE`.