import { getDb } from '../db/schema.js';
import { instrumentEligibility } from './ibkrnew-event-trader.js';

// Advisory data allocation only. Authorization still evaluates real prices,
// fresh quotes, signals, risk and the active goal independently.
export function getIbkrNewSubscriptionPriority(bridge, configs, db = getDb()) {
  const universe = configs.universe || {};
  const allow = new Set((universe.allowlist || []).map(s => String(s).toUpperCase()));
  const deny = new Set((universe.denylist || []).map(s => String(s).toUpperCase()));
  const rows = db.prepare('SELECT symbol,security_type FROM ibkrnew_instrument_profiles WHERE owner_user_id=? AND bridge_id=? AND environment=? ORDER BY symbol').all(bridge.owner_user_id, bridge.bridge_id, bridge.environment);
  const eligible = rows.filter(r => (!allow.size || allow.has(r.symbol)) && !deny.has(r.symbol)).filter(r => {
    const rules = universe.filters?.[r.security_type === 'ETF' ? 'etf' : 'stock'];
    return instrumentEligibility(db, bridge.owner_user_id, bridge.environment, universe, r.symbol, 'LONG_STOCK', { security_type: r.security_type, ask: Math.max(1, Number(rules?.minimum_price_usd || 1)), spread_pct: 0 }).eligible;
  }).map(r => r.symbol);
  return { environment: bridge.environment, universe_version: universe.version, as_of: new Date().toISOString(), eligible_symbols: eligible, conditional_only: true };
}
