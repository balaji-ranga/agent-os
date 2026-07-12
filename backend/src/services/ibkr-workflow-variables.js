/**
 * Shared IBKR workflow variable defaults (workflow-level static config).
 */
import { IBKR_ALLOWLIST } from './ibkr-trading-rules.js';

export const DEFAULT_ALLOWLIST_KEYS = IBKR_ALLOWLIST.map((a) => a.key);

export const IBKR_DAY_PLAN_VARIABLES = {
  markets: ['US', 'SG'],
  allowlist_keys: [...DEFAULT_ALLOWLIST_KEYS],
  daily_budget_usd: 1000,
  max_trades_per_day: 10,
  checker_max_loops: 3,
  min_rationale_chars: 80,
  block_duplicate_buys: true,
  require_live_cash: true,
  max_hold_days: 5,
};

export const IBKR_POLLER_VARIABLES = {
  markets: ['US', 'SG'],
  allowlist_keys: [...DEFAULT_ALLOWLIST_KEYS],
  daily_budget_usd: 1000,
  max_trades_per_day: 10,
  max_hold_days: 5,
  max_hold_extension_days: 2,
  on_review_fail: 'hold',
  checker_max_loops: 3,
  poll_interval_cron: '*/15 * * * *',
  require_ceo_on_exit: false,
};
