import { getDb } from '../db/schema.js';
import { instrumentEligibility } from './ibkrnew-event-trader.js';
import { profileProviders } from './ibkrnew-profile-data.js';
import { getIbkrNewWorkflowBlueprints } from './ibkrnew-blueprints.js';
import { tradingSession } from '../../ibkrnew-event-bridge/src/session.js';

const parse = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
const age = (at) => Number.isFinite(Date.parse(at)) ? (Date.now() - Date.parse(at)) / 1000 : null;
const fresh = (at, seconds) => age(at) != null && age(at) >= -1 && age(at) <= seconds;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const count = (items, field) => items.reduce((out, row) => { const key = row[field] || 'unknown'; out[key] = (out[key] || 0) + 1; return out; }, {});

// Never return raw broker payloads, account identifiers, bridge credentials,
// signed commands or caller-selected tenant data. These tools perform SELECTs
// only: no defaults initialization, goal reconciliation, refresh or orders.
function publicValue(value) {
  if (typeof value === 'string') return value.replace(/\b(?:DU|U)[A-Z0-9]{5,}\b/g, '[account redacted]');
  if (Array.isArray(value)) return value.map(publicValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/account_id|account_ref|token|secret|password|signature/i.test(key))
    .map(([key, child]) => [key, publicValue(child)]));
  return value;
}

function context(ownerUserId, options = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw error('Authenticated owner required', 403);
  if (options.environment != null && options.environment !== 'paper') throw error('SME evidence is Paper-only');
  for (const key of ['owner_user_id', 'ownerUserId', 'ceo_user_id', 'ceoUserId', 'user_id', 'userId', 'bridge_id', 'account_id']) {
    if (options[key] != null) throw error('Caller-selected owner, bridge or account scope is not allowed', 403);
  }
  const db = options.db || getDb();
  const configs = {};
  for (const row of db.prepare("SELECT kind,version,document_json,published_at FROM ibkrnew_config_versions WHERE owner_user_id=? AND status='published'").all(owner)) {
    configs[row.kind] = { ...parse(row.document_json, {}), version: row.version, published_at: row.published_at };
  }
  const mode = db.prepare('SELECT requested_mode,activation_state,attested_bridge_id,attestation_status,attestation_reason,attested_at,halted_at FROM ibkrnew_execution_modes WHERE owner_user_id=?').get(owner) || null;
  const bridge = db.prepare("SELECT bridge_id,status FROM ibkrnew_bridges WHERE owner_user_id=? AND environment='paper' AND revoked_at IS NULL AND (? IS NULL OR bridge_id=?) ORDER BY last_seen_at DESC LIMIT 1").get(owner, mode?.requested_mode === 'paper' ? mode.attested_bridge_id : null, mode?.requested_mode === 'paper' ? mode.attested_bridge_id : null) || null;
  const heartbeat = bridge ? db.prepare("SELECT event_id,occurred_at,created_at,payload_json FROM ibkrnew_events WHERE owner_user_id=? AND bridge_id=? AND environment='paper' AND event_type='bridge.heartbeat' AND status='accepted' ORDER BY created_at DESC LIMIT 1").get(owner, bridge.bridge_id) : null;
  const hp = parse(heartbeat?.payload_json, {});
  return { db, owner, configs, mode, bridge, heartbeat, hp };
}

function envelope(source) {
  return { ok: true, schema_version: 1, namespace: 'IBKRNew', environment: 'paper', source, as_of: new Date().toISOString(), advisory_only: true, read_only: true };
}

export function getIbkrNewPaperStrategyEvidence(ownerUserId, options = {}) {
  const c = context(ownerUserId, options), { db, owner, configs, mode, bridge, heartbeat, hp } = c;
  const goal = db.prepare("SELECT goal_id,name,mode,target_return_pct,duration_days,duration_basis,profit_basis,status FROM ibkrnew_goals WHERE owner_user_id=? AND environment='paper' ORDER BY CASE WHEN status='ACTIVE' THEN 0 ELSE 1 END,created_at DESC LIMIT 1").get(owner) || null;
  const cycle = goal ? db.prepare("SELECT cycle_id,cycle_number,status,started_at,scheduled_end_at,capital_basis_usd,target_profit_usd,net_realized_profit_usd,stop_reason FROM ibkrnew_goal_cycles WHERE owner_user_id=? AND environment='paper' AND goal_id=? ORDER BY cycle_number DESC LIMIT 1").get(owner, goal.goal_id) || null : null;
  const goalReasons = [];
  if (!goal || goal.status !== 'ACTIVE') goalReasons.push('goal_not_active');
  if (!cycle || cycle.status !== 'ACTIVE') goalReasons.push('goal_cycle_not_active');
  if (cycle && !(Date.parse(cycle.scheduled_end_at) > Date.now())) goalReasons.push('goal_cycle_deadline_reached');
  if (cycle && (!(cycle.capital_basis_usd > 0) || !(cycle.target_profit_usd > 0))) goalReasons.push('goal_cycle_capital_invalid');
  if (cycle && cycle.net_realized_profit_usd >= cycle.target_profit_usd) goalReasons.push('goal_target_reached');
  const policy = configs.policy || {}, session = tradingSession(new Date(), policy.session_rules?.new_entry_cutoff_minutes_before_close ?? 60);
  const breakers = db.prepare("SELECT breaker_type,reason,created_at FROM ibkrnew_circuit_breakers WHERE owner_user_id=? AND environment='paper' AND active=1").all(owner);
  const executionReady = mode?.requested_mode === 'paper' && mode.activation_state === 'ACTIVE' && mode.attestation_status === 'verified' && fresh(mode.attested_at, 60) && bridge?.status === 'online' && fresh(heartbeat?.occurred_at, Number(policy.freshness?.bridge_offline_after_ms || 30000) / 1000) && hp.gateway_connected === true;
  const enabled = configs.strategy?.enabled === true && configs.strategy_skill?.enabled === true && policy.feature_switches?.trading_enabled === true && policy.feature_switches?.execution_enabled === true;
  const reasons = [...goalReasons];
  if (!executionReady) reasons.push('paper_execution_context_not_ready');
  if (!enabled) reasons.push('strategy_or_execution_disabled');
  if (breakers.length) reasons.push('circuit_breaker_active');
  if (!session.opening_allowed) reasons.push(session.reason);
  if (configs.strategy?.execution_mode !== 'automatic' || policy.feature_switches?.automatic_entry_enabled !== true || policy.feature_switches?.ceo_approval_required === true) reasons.push('automatic_entry_not_enabled');
  const account = bridge ? db.prepare('SELECT captured_at,eligible_capital_usd,cash_usd,realized_pnl_day_usd,unrealized_pnl_usd,positions_json,open_orders_json FROM ibkrnew_account_state WHERE owner_user_id=? AND bridge_id=?').get(owner, bridge.bridge_id) : null;
  const positions = parse(account?.positions_json, []).map(p => ({ symbol: p.symbol, security_type: p.security_type || p.secType, quantity: p.quantity ?? p.qty, market_value_usd: p.market_value_usd, unrealized_pnl_usd: p.unrealized_pnl_usd }));
  const orders = parse(account?.open_orders_json, []).map(p => ({ symbol: p.symbol, status: p.status, protective_type_verified: false }));
  if (!account || !fresh(account.captured_at, Number(policy.freshness?.account_max_age_ms || 30000) / 1000)) reasons.push('account_state_stale');
  const workflows = getIbkrNewWorkflowBlueprints();
  const registry = db.prepare('SELECT agent_name,enabled FROM ibkrnew_reaction_registry WHERE owner_user_id=?').all(owner);
  const agents = workflows.map(w => ({ agent_name: w.agent_name, workflow_id: w.workflow_id, responsibility: w.responsibility, enabled: registry.some(r => r.agent_name === w.agent_name && r.enabled === 1) }));
  if (agents.some(a => !a.enabled)) reasons.push('reaction_agent_disabled_or_missing');
  const q = hp.components?.find(p => p.component_id === 'IBKRNewMarketSubscriptions');
  const v = hp.components?.find(p => p.component_id === 'IBKRNewVolumeProfiles');
  const spool = hp.components?.find(p => p.component_id === 'IBKRNewDurableSpool');
  return publicValue({ ...envelope('ibkrnew_published_configs_and_paper_runtime'), configured: Boolean(configs.strategy), configs, goal, cycle,
    goal_opening_permission: { allowed: goalReasons.length === 0, block_reasons: goalReasons },
    runtime: { mode, strategy_configured_enabled: enabled, execution_context_ready: executionReady, automatic_strategy_enabled: enabled && configs.strategy?.execution_mode === 'automatic', market_open_now: session.regular === true, session_clock_at: new Date().toISOString(), session_clock_source: 'current_server_time_us_exchange_calendar', opening_evaluation_allowed_now: reasons.length === 0, block_reasons: reasons, session, breakers,
      heartbeat: { event_id: heartbeat?.event_id || null, occurred_at: heartbeat?.occurred_at || null, accepted_at: heartbeat?.created_at || null, age_seconds: age(heartbeat?.occurred_at), gateway_connected: hp.gateway_connected === true, bridge_version: hp.bridge_version },
      subscriptions: { status: q?.status || 'missing', subscribed: q?.symbols || [], healthy_symbols: q?.healthy_symbols || [], pending_symbols: q?.pending_symbols || [], capacity_limited_symbols: q?.capacity_limited_symbols || [] },
      volume: { status: v?.status || 'missing', ready_count: v?.ready_symbols?.length || 0, pending_count: v?.pending_symbols?.length || 0 }, spool_depth: spool?.depth ?? null },
    account: account ? { captured_at: account.captured_at, age_seconds: age(account.captured_at), eligible_capital_usd: account.eligible_capital_usd, cash_usd: account.cash_usd, realized_pnl_day_usd: account.realized_pnl_day_usd, unrealized_pnl_usd: account.unrealized_pnl_usd, positions, orders, note: 'Account exposure is not automatically goal-attributed; order snapshots do not prove stop/target coverage.' } : null,
    agents, profile_providers: profileProviders(configs.universe || {}, 'paper'),
    interpretation: 'Active/configured is distinct from market-open, warmed-up, data-ready and authorized. Legacy strategy bundles are drafts, not the published IBKRNew strategy. No goal or trading state was changed.' });
}

// Explicitly separate the legacy process switch, IBKRNew configuration and
// current session permission. Account tools must not infer any of these from
// fills, snapshot timestamps or a disabled legacy flag.
export function getIbkrNewPaperTradingStatus(ownerUserId, options = {}) {
  const s = getIbkrNewPaperStrategyEvidence(ownerUserId, options);
  return {
    namespace: s.namespace, environment: s.environment, as_of: s.as_of,
    configured_enabled: s.runtime.strategy_configured_enabled,
    automatic_strategy_enabled: s.runtime.automatic_strategy_enabled,
    execution_mode: s.runtime.mode?.requested_mode || null,
    activation_state: s.runtime.mode?.activation_state || null,
    market_open_now: s.runtime.market_open_now,
    minutes_to_close: s.runtime.session.minutes_to_close,
    opening_evaluation_allowed_now: s.runtime.opening_evaluation_allowed_now,
    block_reasons: s.runtime.block_reasons,
    heartbeat: s.runtime.heartbeat,
    goal_id: s.goal?.goal_id || null, goal_status: s.goal?.status || null,
    cycle_id: s.cycle?.cycle_id || null,
    interpretation: 'Configured enabled is independent of market hours. market_open_now uses current server time, not cached account time. minutes_to_close is time UNTIL CLOSING, not opening. Opening evaluation permission is not an order authorization; fresh symbol data, signals and risk gates still apply. No fills does not prove Paper mode.',
  };
}

export function getIbkrNewPaperInstrumentEvidence(ownerUserId, options = {}) {
  const { db, owner, configs, bridge, hp } = context(ownerUserId, options);
  const symbol = String(options.symbol || '').trim().toUpperCase();
  if (symbol && !/^[A-Z0-9][A-Z0-9. -]{0,15}$/.test(symbol)) throw error('Invalid symbol');
  const u = configs.universe || {}, providers = profileProviders(u, 'paper');
  const q = hp.components?.find(p => p.component_id === 'IBKRNewMarketSubscriptions');
  const details = new Map((q?.details || []).map(r => [r.symbol, r]));
  const rows = db.prepare("SELECT symbol,security_type,profile_json,fundamentals_at,membership_at,corporate_events_at,updated_at FROM ibkrnew_instrument_profiles WHERE owner_user_id=? AND environment='paper' ORDER BY symbol").all(owner).filter(r => !symbol || r.symbol === symbol);
  const refresh = db.prepare("SELECT symbol,family,status,reason_code,refreshed_at,next_attempt_at,updated_at FROM ibkrnew_profile_refresh_state WHERE owner_user_id=? AND environment='paper' AND provider='FMP'").all(owner);
  const items = rows.map(r => {
    const p = parse(r.profile_json, {}), rules = u.filters?.[r.security_type === 'ETF' ? 'etf' : 'stock'] || {};
    const conditional = instrumentEligibility(db, owner, 'paper', u, r.symbol, 'LONG_STOCK', { security_type: r.security_type, ask: Math.max(1, Number(rules.minimum_price_usd || 1)), spread_pct: 0 });
    const quote = details.get(r.symbol), isStock = r.security_type === 'STK';
    const family = (name, at, source, value, maxHours) => ({ required: isStock && rules[name === 'fundamentals' ? 'fundamentals' : 'corporate_events']?.enabled === true, source: source || null, cached_at: at, cached_age_hours: age(at) == null ? null : age(at) / 3600, cached_fresh: Boolean(value) && fresh(at, Number(maxHours) * 3600), refresh: refresh.find(x => x.symbol === r.symbol && x.family === name) || null });
    return { symbol: r.symbol, security_type: r.security_type, subscribed: Boolean(q?.symbols?.includes(r.symbol)), capacity_limited: Boolean(q?.capacity_limited_symbols?.includes(r.symbol)),
      market_data: { ready: quote?.market_data_ready === true && quote?.market_data_type === 1 && fresh(quote?.bid_at, 5) && fresh(quote?.ask_at, 5), reason: quote?.reason || 'quote_unverified', error_code: quote?.error_code || null, market_data_type: quote?.market_data_type ?? null, bid_at: quote?.bid_at || null, ask_at: quote?.ask_at || null, last_bar_at: quote?.last_bar_at || null },
      profile_gates: { passed: conditional.eligible, reason: conditional.reason || null, assumptions: 'Profile screening uses a permitted hypothetical price and zero spread. Actual price, spread, fresh quotes, features, signal and risk gates still must pass; this is NOT trade readiness.' },
      fundamentals: family('fundamentals', r.fundamentals_at, p.fundamentals_source, p.fundamentals, rules.fundamentals?.maximum_age_hours),
      earnings: { ...family('earnings', r.corporate_events_at, p.corporate_events_source, p.corporate_events, rules.corporate_events?.maximum_age_hours), coverage_verified: p.earnings_coverage?.verified === true, next_earnings_date: p.earnings_coverage?.next_earnings_date || null },
      average_daily_volume: p.average_daily_volume ?? null, average_daily_volume_at: p.average_daily_volume_at || null,
      fundamental_values: isStock && p.fundamentals ? Object.fromEntries(['market_cap_usd', 'revenue_ttm_usd', 'debt_to_equity', 'operating_cash_flow_ttm_usd', 'sector', 'currency'].filter(k => p.fundamentals[k] != null).map(k => [k, p.fundamentals[k]])) : null, index_memberships: p.index_memberships || [], membership_at: r.membership_at,
      note: isStock ? 'Cached success can remain usable after a failed refresh until its own freshness deadline.' : 'Company fundamentals and stock earnings are not required for ETFs.' };
  });
  const requestedSymbols = (u.allowlist || []).map(x => typeof x === 'string' ? x : x.symbol).filter(Boolean).filter(x => !symbol || x === symbol);
  const missingProfiles = requestedSymbols.filter(x => !rows.some(r => r.symbol === x));
  return publicValue({ ...envelope('ibkrnew_paper_instrument_profiles_and_accepted_heartbeat'), profile_providers: providers, universe: { allowlist: u.allowlist || [], filters: u.filters || {} }, total: items.length, missing_profiles: missingProfiles, subscribed_count: q?.symbols?.length || 0, capacity_limited_count: q?.capacity_limited_symbols?.length || 0, profile_gate_counts: count(items.map(r => ({ reason: r.profile_gates.passed ? 'pass_conditional' : r.profile_gates.reason })), 'reason'), items });
}

export function getIbkrNewPaperDecisionEvidence(ownerUserId, options = {}) {
  const { db, owner } = context(ownerUserId, options);
  const limit = Math.floor(Math.min(50, Math.max(1, Number(options.limit) || 20)));
  const rows = db.prepare(`SELECT e.event_id,e.event_type,e.occurred_at,e.created_at,e.payload_json,r.decision,r.reason,
    a.authorization_id,a.status authorization_status,c.command_id,c.status command_status,c.acknowledged_at,
    t.trade_id,t.status trade_status,t.actual_commission_usd,t.net_pnl_usd
    FROM ibkrnew_events e LEFT JOIN ibkrnew_event_reactions r ON r.event_id=e.event_id AND r.owner_user_id=e.owner_user_id
    LEFT JOIN ibkrnew_authorizations a ON a.signal_event_id=e.event_id AND a.owner_user_id=e.owner_user_id
    LEFT JOIN ibkrnew_command_outbox c ON c.authorization_id=a.authorization_id AND c.owner_user_id=e.owner_user_id
    LEFT JOIN ibkrnew_trade_records t ON t.authorization_id=a.authorization_id AND t.owner_user_id=e.owner_user_id
    WHERE e.owner_user_id=? AND e.environment='paper' AND e.status='accepted' AND e.event_type IN ('market.signal','market.bar_closed')
    ORDER BY e.created_at DESC LIMIT ?`).all(owner, limit).map(({ payload_json, ...r }) => { const p = parse(payload_json, {}); return { ...r, symbol: p.symbol || null, observed_features: Object.fromEntries(['last','quote_at','feature_at','market_data_type','relative_volume','confirmed_15m','ema_fast','ema_slow','vwap','atr_extension','quantity'].filter(k => p[k] != null).map(k => [k, p[k]])) }; });
  const trades = db.prepare(`SELECT t.symbol,t.status,t.quantity,t.actual_commission_usd,t.net_pnl_usd,t.opened_at,t.closed_at,l.goal_id,l.cycle_id,json_extract(t.economics_json,'$.purpose') purpose
    FROM ibkrnew_trade_records t JOIN ibkrnew_bridges b ON b.bridge_id=t.bridge_id AND b.owner_user_id=t.owner_user_id
    LEFT JOIN ibkrnew_goal_trade_links l ON l.authorization_id=t.authorization_id AND l.owner_user_id=t.owner_user_id AND l.environment='paper'
    WHERE t.owner_user_id=? AND b.environment='paper' ORDER BY t.created_at DESC LIMIT ?`).all(owner, limit);
  const executions = db.prepare(`SELECT x.execution_id,x.authorization_id,x.trade_id,x.order_role,x.side,x.quantity,x.price,x.commission_usd,x.realized_pnl_usd,x.commission_reported,x.occurred_at,t.symbol,l.goal_id,l.cycle_id
    FROM ibkrnew_executions x JOIN ibkrnew_bridges b ON b.bridge_id=x.bridge_id AND b.owner_user_id=x.owner_user_id
    LEFT JOIN ibkrnew_trade_records t ON t.trade_id=x.trade_id AND t.owner_user_id=x.owner_user_id
    LEFT JOIN ibkrnew_goal_trade_links l ON l.authorization_id=x.authorization_id AND l.owner_user_id=x.owner_user_id AND l.environment='paper'
    WHERE x.owner_user_id=? AND b.environment='paper' ORDER BY x.occurred_at DESC LIMIT ?`).all(owner, limit);
  return publicValue({ ...envelope('ibkrnew_paper_events_reactions_authorizations_commands_and_goal_trade_links'), total: rows.length, latest_decision_at: rows[0]?.occurred_at || null, decision_counts: count(rows, 'decision'), decisions: rows, trades, executions,
    interpretation: 'No signal, eligibility veto, risk rejection, authorization, command acknowledgement and fill are distinct stages. This evidence is not a new proposal or authorization.' });
}
