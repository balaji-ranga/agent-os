/**
 * Default workflow variables for the Monthly Positive Return trading system.
 * Used by monthly trading workflow seed scripts (W1/W2/W3/W5).
 */
export const MONTHLY_TRADING_VARIABLES = {
  min_market_cap_usd: 50_000_000_000,
  universe_size_min: 50,
  universe_size_max: 100,
  /** Broader-market filter (not the stock universe). Comma-separated OK; first usable ticker wins. */
  index_symbol: 'SPY,QQQ,DIA,IWM',
  pct_from_52w_high_max: 15,
  entry_volume_mult: 1.5,
  require_above_sma50: true,
  require_above_sma200: true,
  /** Max new-entry notional (USD) for the session / day plan — set in W1 Variables panel */
  daily_budget_usd: 1000,
  max_trades_per_day: 5,
  /** Max stop distance below entry per order (%). Blank / 0 = Maker chooses. */
  risk_per_trade_pct: 5,
  position_size_pct_min: 3,
  position_size_pct_max: 8,
  position_size_pct_hard_max: 15,
  partial_profit_pct_min: 15,
  partial_profit_pct_max: 25,
  cash_band_pct_min: 30,
  cash_band_pct_max: 80,
  monthly_target_pct_min: 3,
  monthly_target_pct_max: 5,
  monthly_drawdown_stop_pct: 4,
  discretionary_loss_sell_pct: 3,
  /** US post-close fallback; cron is interpreted in server local TZ */
  cron_post_close_fallback: '5 21 * * 1-5',
  cron_weekly_review: '0 10 * * 6',
  checker_max_loops: 3,
  brain_history_days: 14,
  order_history_days: 30,
  open_plans_limit: 14,
  screener_limit: 25,
  /** FMP history + fundamentals attached to the top N screener names (PE, SMA, 3m/6m momentum, YoY). */
  screener_enrich_limit: 8,
  digest_email_to: '',
  /** BUY limit may not exceed last by this % (chase). */
  entry_slip_pct_max: 0.25,
  /** BUY limit may not sit more than this % below last (unfillable / invented prices). */
  entry_discount_pct_max: 3,
  /** Laptop bridge (W2) — placeholders; CEO fills secrets in UI / desktop env, never commit real tokens */
  local_bridge_base_url: 'http://127.0.0.1:3010',
  local_bridge_token: '',
};

/** Previous seed default — bump to 5 on re-seed unless the CEO already changed it. */
export const LEGACY_RISK_PER_TRADE_PCT_DEFAULT = 0.75;

function isLegacyRiskPerTradeDefault(value) {
  return value === LEGACY_RISK_PER_TRADE_PCT_DEFAULT || value === '0.75';
}

/**
 * Merge seed defaults under existing CEO variables.
 * Blank/0 `risk_per_trade_pct` is preserved (Maker decides). Old 0.75 default becomes 5.
 */
export function mergeMonthlyTradingVariables(existing = {}) {
  const merged = { ...MONTHLY_TRADING_VARIABLES, ...existing };
  if (isLegacyRiskPerTradeDefault(existing.risk_per_trade_pct)) {
    merged.risk_per_trade_pct = MONTHLY_TRADING_VARIABLES.risk_per_trade_pct;
  }
  return merged;
}

export default MONTHLY_TRADING_VARIABLES;