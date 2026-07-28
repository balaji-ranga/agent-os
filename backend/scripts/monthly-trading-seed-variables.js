/**
 * Default workflow variables for the Monthly Positive Return trading system.
 * Used by monthly trading workflow seed scripts (W1/W2/W3/W5).
 */
export const MONTHLY_TRADING_VARIABLES = {
  min_market_cap_usd: 50_000_000_000,
  universe_size_min: 50,
  universe_size_max: 100,
  index_symbol: 'SPY',
  pct_from_52w_high_max: 15,
  entry_volume_mult: 1.5,
  require_above_sma50: true,
  require_above_sma200: true,
  risk_per_trade_pct: 0.75,
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
  digest_email_to: '',
  /** Laptop bridge (W2) — placeholders; CEO fills secrets in UI / desktop env, never commit real tokens */
  local_bridge_base_url: 'http://127.0.0.1:3010',
  local_bridge_token: '',
};

export default MONTHLY_TRADING_VARIABLES;