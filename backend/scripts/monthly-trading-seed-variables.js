/**
 * Default workflow variables for the Monthly Positive Return trading system.
 * Used later by workflow seed scripts — module only for Phase 1.
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
  cron_post_close_fallback: '5 21 * * 1-5',
  cron_weekly_review: '0 10 * * 6',
};