import crypto from 'crypto';
import { getDb } from '../db/schema.js';

export const IBKRNEW_NAMESPACE = 'IBKRNew';
export const IBKRNEW_ENVIRONMENT = 'paper';

const DEFAULT_POLICY = Object.freeze({
  name: 'IBKRNew Conservative-Moderate Paper',
  environment: 'paper',
  feature_switches: {
    trading_enabled: true,
    paper_execution_enabled: true,
    live_execution_enabled: false,
    long_stock_enabled: true,
    short_stock_enabled: true,
    long_call_enabled: true,
    long_put_enabled: true,
    intraday_enabled: true,
    overnight_enabled: true,
    automatic_entry_enabled: true,
    automatic_exit_enabled: true,
    ceo_approval_required: false,
  },
  budgets: {
    total_gross_exposure_usd: 10000,
    daily_opening_exposure_usd: 1000,
    max_stock_position_usd: 750,
    max_option_premium_position_usd: 250,
    max_total_option_premium_usd: 1000,
    max_short_position_usd: 500,
    max_total_short_notional_usd: 2000,
    short_stress_buffer_pct: 30,
    max_open_positions: 6,
    max_open_option_positions: 3,
  },
  loss_limits: {
    max_planned_loss_per_trade_usd: 50,
    daily_loss_limit_usd: 150,
    weekly_loss_limit_usd: 400,
    max_drawdown_usd: 1000,
    max_consecutive_losses: 3,
  },
  freshness: {
    quote_max_age_ms: 5000,
    feature_max_age_ms: 15000,
    account_max_age_ms: 30000,
    shortability_max_age_ms: 15000,
    authorization_ttl_ms: 15000,
    approval_ttl_ms: 300000,
    bridge_offline_after_ms: 30000,
  },
  option_rules: {
    minimum_dte: 14,
    maximum_dte: 60,
    minimum_open_interest: 500,
    minimum_daily_volume: 50,
    maximum_spread_usd: 0.15,
    maximum_spread_midpoint_pct: 10,
    minimum_delta_abs: 0.55,
    maximum_delta_abs: 0.70,
    allow_automatic_exercise: false,
    allow_hold_through_expiry: false,
  },
  order_permissions: { entry_order_types: ['LIMIT'], protective_order_types: ['STOP', 'STOP_LIMIT', 'LIMIT'], allow_fractional_shares: false, allow_unprotected_entry: false, allow_hard_to_borrow: false },
  session_rules: { timezone: 'America/New_York', new_entry_cutoff_minutes_before_close: 60, intraday_exit_start_minutes_before_close: 30, intraday_exit_escalation_minutes_before_close: 15 },
  commissions: {
    stock_per_share_usd: 0.005,
    stock_minimum_per_order_usd: 1,
    option_per_contract_usd: 0.65,
    option_minimum_per_order_usd: 0.65,
    estimated_regulatory_exit_pct: 0.00278,
    minimum_expected_net_profit_usd: 5,
    maximum_round_trip_commission_pct_of_expected_gross_profit: 20,
  },
  allocation: {
    default_daily_budget_pct_per_trade: 50,
    allow_full_daily_budget_single_trade: true,
    concentrated_trade_minimum_confidence: 0.85,
    concentrated_trade_minimum_net_reward_risk: 2,
    concentrated_trade_maximum_commission_drag_pct: 10,
  },
});

const DEFAULT_STRATEGY = Object.freeze({
  name: 'IBKRNew US Liquid Trend Pullback', enabled: true, execution_mode: 'automatic',
  allowed_expressions: ['LONG_STOCK', 'SHORT_STOCK', 'LONG_CALL', 'LONG_PUT'],
  entry: { minimum_relative_volume: 1.25, require_15m_confirmation: true, maximum_atr_extension: 1 },
  exits: { first_target_r: 1, final_target_r: 2, single_lot_target_r: 1.5, never_widen_stop: true, maximum_holding_sessions: 5 },
});

const DEFAULT_UNIVERSE = Object.freeze({
  name: 'IBKRNew US Liquid Stocks', allowlist: [], denylist: [], maximum_active_subscriptions: 40,
  filters: { country: ['US'], security_types: ['STK', 'ETF'], minimum_price_usd: 10, maximum_price_usd: 300, minimum_average_daily_volume: 2000000, maximum_spread_pct: 0.2, require_shortable_for_short: true },
});

const DEFAULT_MARKET_DATA = Object.freeze({
  name: 'IBKRNew IBKR Executable Data', executable_source: 'IBKR', allow_delayed_for_execution: false,
  required_fields: ['bid', 'ask', 'last', 'quote_at'], bar_intervals: ['1m', '5m', '15m', '1d'], session: 'REGULAR',
});

const DEFAULT_STRATEGY_SKILL = Object.freeze({
  name: 'IBKRNew Trade Strategy Skill',
  agent_name: 'IBKRNewStrategyPlanner',
  reaction_name: 'IBKRNewStrategyEvaluation',
  skill_path: '.cursor/skills/ibkrnew-trade-strategy/SKILL.md',
  enabled: true,
  instructions: [
    'Evaluate only canonical IBKRNew market events and the active strategy, universe, policy, and commission model.',
    'Compare expected gross profit, round-trip commission, planned loss, net reward-to-risk, confidence, and remaining daily capacity.',
    'Prefer diversification unless concentration passes every configured concentration threshold.',
    'Never authorize or place an order; return a structured proposal to the deterministic IBKRNewRiskChecker.',
  ],
  output_schema: ['expression', 'confidence', 'quantity_requested', 'expected_gross_profit_usd', 'estimated_round_trip_commission_usd', 'expected_net_profit_usd', 'planned_loss_usd', 'net_reward_risk', 'commission_drag_pct', 'allocation_mode', 'allocation_rationale', 'veto_reasons'],
});

function json(value) { return JSON.stringify(value ?? null); }
function parse(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function nowIso() { return new Date().toISOString(); }
function tradingDay(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}

export function ensureIbkrNewEventTraderSchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ibkrnew_config_versions (
      id TEXT NOT NULL, owner_user_id TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL,
      status TEXT NOT NULL, document_json TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT,
      PRIMARY KEY(owner_user_id, kind, id, version)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ibkrnew_config_published
      ON ibkrnew_config_versions(owner_user_id, kind) WHERE status = 'published';
    CREATE TABLE IF NOT EXISTS ibkrnew_bridges (
      bridge_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL,
      environment TEXT NOT NULL CHECK(environment = 'paper'), token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'offline', last_sequence INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ibkrnew_events (
      event_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL,
      bridge_id TEXT NOT NULL, environment TEXT NOT NULL, event_type TEXT NOT NULL,
      source_event_id TEXT NOT NULL, sequence INTEGER NOT NULL, occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'accepted', reason TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(bridge_id, source_event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_events_owner_created ON ibkrnew_events(owner_user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ibkrnew_events_accepted_sequence ON ibkrnew_events(bridge_id, sequence) WHERE status = 'accepted';
    CREATE TABLE IF NOT EXISTS ibkrnew_account_state (
      owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL, bridge_id TEXT NOT NULL,
      eligible_capital_usd REAL NOT NULL DEFAULT 0, cash_usd REAL NOT NULL DEFAULT 0,
      realized_pnl_day_usd REAL NOT NULL DEFAULT 0, unrealized_pnl_usd REAL NOT NULL DEFAULT 0,
      positions_json TEXT NOT NULL DEFAULT '[]', open_orders_json TEXT NOT NULL DEFAULT '[]',
      captured_at TEXT NOT NULL, PRIMARY KEY(owner_user_id, account_id)
    );
    CREATE TABLE IF NOT EXISTS ibkrnew_budget_reservations (
      reservation_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL,
      trading_day TEXT NOT NULL, authorization_id TEXT NOT NULL UNIQUE, expression TEXT NOT NULL,
      daily_reserved_usd REAL NOT NULL, gross_reserved_usd REAL NOT NULL, filled_usd REAL NOT NULL DEFAULT 0,
      daily_released_usd REAL NOT NULL DEFAULT 0, gross_released_usd REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_budget_owner_day ON ibkrnew_budget_reservations(owner_user_id, trading_day, status);
    CREATE TABLE IF NOT EXISTS ibkrnew_authorizations (
      authorization_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL,
      bridge_id TEXT NOT NULL, signal_event_id TEXT NOT NULL UNIQUE, expression TEXT NOT NULL,
      authorization_json TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ibkrnew_command_outbox (
      command_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL,
      bridge_id TEXT NOT NULL, authorization_id TEXT NOT NULL UNIQUE, command_json TEXT NOT NULL,
      signature TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', available_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, lease_until TEXT, claimed_at TEXT, acknowledged_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_commands_claim ON ibkrnew_command_outbox(bridge_id, status, available_at);
    CREATE TABLE IF NOT EXISTS ibkrnew_circuit_breakers (
      owner_user_id TEXT NOT NULL, breaker_type TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      reason TEXT NOT NULL, created_at TEXT NOT NULL, cleared_at TEXT,
      PRIMARY KEY(owner_user_id, breaker_type)
    );
    CREATE TABLE IF NOT EXISTS ibkrnew_reaction_registry (
      reaction_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, agent_name TEXT NOT NULL,
      subscriptions_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      UNIQUE(owner_user_id, agent_name)
    );
    CREATE TABLE IF NOT EXISTS ibkrnew_position_snapshots (
      snapshot_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL,
      bridge_id TEXT NOT NULL, snapshot_type TEXT NOT NULL, payload_json TEXT NOT NULL,
      captured_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_snapshots_owner_time ON ibkrnew_position_snapshots(owner_user_id, captured_at DESC);
    CREATE TABLE IF NOT EXISTS ibkrnew_component_health (
      owner_user_id TEXT NOT NULL, bridge_id TEXT NOT NULL, component_id TEXT NOT NULL,
      component_type TEXT NOT NULL, status TEXT NOT NULL, version TEXT, detail_json TEXT NOT NULL,
      error_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY(owner_user_id, bridge_id, component_id)
    );
    CREATE TABLE IF NOT EXISTS ibkrnew_component_errors (
      error_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, bridge_id TEXT NOT NULL,
      component_id TEXT NOT NULL, error_code TEXT, message TEXT NOT NULL,
      detail_json TEXT NOT NULL, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_errors_owner_time ON ibkrnew_component_errors(owner_user_id, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS ibkrnew_trade_records (
      trade_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL,
      bridge_id TEXT NOT NULL, authorization_id TEXT NOT NULL UNIQUE, symbol TEXT NOT NULL,
      expression TEXT NOT NULL, quantity REAL NOT NULL, entry_value_usd REAL NOT NULL DEFAULT 0,
      exit_value_usd REAL NOT NULL DEFAULT 0, estimated_round_trip_commission_usd REAL NOT NULL DEFAULT 0,
      actual_commission_usd REAL NOT NULL DEFAULT 0, gross_pnl_usd REAL NOT NULL DEFAULT 0,
      net_pnl_usd REAL NOT NULL DEFAULT 0, expected_net_profit_usd REAL NOT NULL DEFAULT 0,
      required_profitable_exit_price REAL, status TEXT NOT NULL, economics_json TEXT NOT NULL,
      opened_at TEXT, closed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_trades_owner_time ON ibkrnew_trade_records(owner_user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS ibkrnew_executions (
      execution_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL,
      bridge_id TEXT NOT NULL, authorization_id TEXT, trade_id TEXT, order_role TEXT,
      side TEXT, quantity REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0,
      commission_usd REAL NOT NULL DEFAULT 0, realized_pnl_usd REAL NOT NULL DEFAULT 0,
      occurred_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_executions_owner_time ON ibkrnew_executions(owner_user_id, occurred_at DESC);
    CREATE TABLE IF NOT EXISTS ibkrnew_allocation_decisions (
      decision_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, signal_event_id TEXT NOT NULL UNIQUE,
      authorization_id TEXT, requested_quantity REAL NOT NULL, approved_quantity REAL NOT NULL,
      estimated_commission_usd REAL NOT NULL, expected_gross_profit_usd REAL NOT NULL,
      expected_net_profit_usd REAL NOT NULL, net_reward_risk REAL NOT NULL,
      confidence REAL NOT NULL, allocation_mode TEXT NOT NULL, rationale TEXT NOT NULL,
      detail_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
}

const IBKRNEW_REACTIONS = [
  ['IBKRNewMarketObserver', ['market.bar_closed', 'market.session_changed', 'instrument.shortability_changed']],
  ['IBKRNewStrategyPlanner', ['market.bar_closed', 'market.regime_changed']],
  ['IBKRNewRiskChecker', ['signal.created', 'account.snapshot', 'position.changed']],
  ['IBKRNewExecutionOperator', ['trade.authorized', 'order.status_changed']],
  ['IBKRNewPositionMonitor', ['order.filled', 'position.changed', 'position.maximum_hold_reached', 'option.expiry_exit_window_started']],
  ['IBKRNewTradingSupervisor', ['bridge.gateway_disconnected', 'reconciliation.mismatch', 'risk.circuit_breaker_fired']],
];

function defaultsFor(kind) {
  if (kind === 'policy') return DEFAULT_POLICY;
  if (kind === 'strategy') return DEFAULT_STRATEGY;
  if (kind === 'universe') return DEFAULT_UNIVERSE;
  if (kind === 'market_data') return DEFAULT_MARKET_DATA;
  if (kind === 'strategy_skill') return DEFAULT_STRATEGY_SKILL;
  throw Object.assign(new Error('unsupported IBKRNew configuration kind'), { status: 400 });
}

export function validateConfig(kind, document) {
  const d = structuredClone(document || {});
  if (kind === 'policy') {
    if (d.environment !== 'paper' || d.feature_switches?.live_execution_enabled) throw Object.assign(new Error('IBKRNew first release is paper-only'), { status: 400 });
    const b = d.budgets || {};
    for (const key of ['total_gross_exposure_usd', 'daily_opening_exposure_usd']) if (!(Number(b[key]) > 0)) throw Object.assign(new Error(`${key} must be positive`), { status: 400 });
    if (Number(b.daily_opening_exposure_usd) > Number(b.total_gross_exposure_usd)) throw Object.assign(new Error('daily budget cannot exceed total budget'), { status: 400 });
    const c = d.commissions || {}; const a = d.allocation || {};
    for (const key of ['stock_per_share_usd', 'stock_minimum_per_order_usd', 'option_per_contract_usd', 'option_minimum_per_order_usd', 'estimated_regulatory_exit_pct', 'minimum_expected_net_profit_usd']) if (!(Number(c[key]) >= 0)) throw Object.assign(new Error(`${key} must be zero or positive`), { status: 400 });
    if (!(Number(c.maximum_round_trip_commission_pct_of_expected_gross_profit) >= 0 && Number(c.maximum_round_trip_commission_pct_of_expected_gross_profit) <= 100)) throw Object.assign(new Error('maximum commission drag must be between 0 and 100 percent'), { status: 400 });
    if (!(Number(a.default_daily_budget_pct_per_trade) > 0 && Number(a.default_daily_budget_pct_per_trade) <= 100)) throw Object.assign(new Error('default allocation percentage must be above 0 and at most 100'), { status: 400 });
    if (!(Number(a.concentrated_trade_minimum_confidence) >= 0 && Number(a.concentrated_trade_minimum_confidence) <= 1)) throw Object.assign(new Error('concentrated trade confidence must be between 0 and 1'), { status: 400 });
    if (!(Number(a.concentrated_trade_minimum_net_reward_risk) > 0)) throw Object.assign(new Error('concentrated trade net reward/risk must be positive'), { status: 400 });
    if (!(Number(a.concentrated_trade_maximum_commission_drag_pct) >= 0 && Number(a.concentrated_trade_maximum_commission_drag_pct) <= 100)) throw Object.assign(new Error('concentrated trade commission drag must be between 0 and 100 percent'), { status: 400 });
  }
  if (kind === 'strategy' && !['automatic', 'approval_required', 'advisory'].includes(d.execution_mode)) throw Object.assign(new Error('strategy execution_mode is invalid'), { status: 400 });
  if (kind === 'universe' && (!Array.isArray(d.allowlist) || !Array.isArray(d.denylist) || !(Number(d.maximum_active_subscriptions) > 0))) throw Object.assign(new Error('universe lists and subscription ceiling are required'), { status: 400 });
  if (kind === 'market_data' && (d.executable_source !== 'IBKR' || d.allow_delayed_for_execution !== false)) throw Object.assign(new Error('Executable and account truth must use non-delayed IBKR data'), { status: 400 });
  if (kind === 'strategy_skill' && (d.agent_name !== 'IBKRNewStrategyPlanner' || !Array.isArray(d.instructions) || !d.instructions.length)) throw Object.assign(new Error('IBKRNew strategy skill must target IBKRNewStrategyPlanner and include instructions'), { status: 400 });
  return d;
}

export function getPublishedConfig(ownerUserId, kind) {
  ensureIbkrNewEventTraderSchema();
  const row = getDb().prepare(`SELECT * FROM ibkrnew_config_versions WHERE owner_user_id=? AND kind=? AND status='published' ORDER BY version DESC LIMIT 1`).get(ownerUserId, kind);
  return row ? { id: row.id, version: row.version, status: row.status, ...parse(row.document_json, {}) } : null;
}

export function ensureIbkrNewDefaults(ownerUserId) {
  ensureIbkrNewEventTraderSchema();
  const out = {};
  for (const kind of ['policy', 'strategy', 'strategy_skill', 'universe', 'market_data']) {
    let current = getPublishedConfig(ownerUserId, kind);
    if (!current) current = publishConfig(ownerUserId, kind, structuredClone(defaultsFor(kind)), { confirmRiskLoosening: true });
    out[kind] = current;
  }
  const addReaction = getDb().prepare(`INSERT OR IGNORE INTO ibkrnew_reaction_registry(reaction_id,owner_user_id,agent_name,subscriptions_json,created_at) VALUES(?,?,?,?,?)`);
  for (const [agentName, subscriptions] of IBKRNEW_REACTIONS) addReaction.run(id('IBKRNewReaction'), ownerUserId, agentName, json(subscriptions), nowIso());
  return out;
}

export function publishConfig(ownerUserId, kind, document, { confirmRiskLoosening = false } = {}) {
  ensureIbkrNewEventTraderSchema();
  const db = getDb(); const clean = validateConfig(kind, document); const current = getPublishedConfig(ownerUserId, kind);
  if (kind === 'policy' && current) {
    const oldB = current.budgets || {}; const newB = clean.budgets || {};
    const anyIncrease = (oldValues, newValues) => Object.keys(newValues || {}).some((key) => Number.isFinite(Number(newValues[key])) && Number(newValues[key]) > Number(oldValues?.[key] ?? newValues[key]));
    const enables = Object.keys(clean.feature_switches || {}).some((key) => clean.feature_switches[key] === true && current.feature_switches?.[key] !== true);
    const oldC = current.commissions || {}; const newC = clean.commissions || {}; const oldA = current.allocation || {}; const newA = clean.allocation || {};
    const economicsLoosened = Number(newC.minimum_expected_net_profit_usd) < Number(oldC.minimum_expected_net_profit_usd) || Number(newC.maximum_round_trip_commission_pct_of_expected_gross_profit) > Number(oldC.maximum_round_trip_commission_pct_of_expected_gross_profit) || Number(newA.default_daily_budget_pct_per_trade) > Number(oldA.default_daily_budget_pct_per_trade) || (newA.allow_full_daily_budget_single_trade === true && oldA.allow_full_daily_budget_single_trade !== true) || Number(newA.concentrated_trade_minimum_confidence) < Number(oldA.concentrated_trade_minimum_confidence) || Number(newA.concentrated_trade_minimum_net_reward_risk) < Number(oldA.concentrated_trade_minimum_net_reward_risk) || Number(newA.concentrated_trade_maximum_commission_drag_pct) > Number(oldA.concentrated_trade_maximum_commission_drag_pct);
    const loosens = anyIncrease(oldB, newB) || anyIncrease(current.loss_limits, clean.loss_limits) || enables || economicsLoosened;
    if (loosens && !confirmRiskLoosening) throw Object.assign(new Error('Explicit confirmation required for a risk-loosening policy'), { status: 409 });
  }
  const configId = current?.id || id(`IBKRNew${kind[0].toUpperCase()}${kind.slice(1)}`);
  const version = (current?.version || 0) + 1; const ts = nowIso();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE ibkrnew_config_versions SET status='retired' WHERE owner_user_id=? AND kind=? AND status='published'`).run(ownerUserId, kind);
    db.prepare(`INSERT INTO ibkrnew_config_versions(id,owner_user_id,kind,version,status,document_json,created_at,published_at) VALUES(?,?,?,?,?,?,?,?)`).run(configId, ownerUserId, kind, version, 'published', json(clean), ts, ts);
  }); tx();
  return { id: configId, version, status: 'published', ...clean };
}

export function registerBridge(ownerUserId, accountId) {
  ensureIbkrNewEventTraderSchema();
  if (!String(accountId || '').startsWith('DU')) throw Object.assign(new Error('A DU-prefixed IBKR paper account_id is required'), { status: 400 });
  const bridgeId = id('IBKRNewBridge'); const token = `ibkrnew_${crypto.randomBytes(32).toString('base64url')}`;
  getDb().prepare(`INSERT INTO ibkrnew_bridges(bridge_id,owner_user_id,account_id,environment,token_hash,status,created_at) VALUES(?,?,?,?,?,'offline',?)`).run(bridgeId, ownerUserId, String(accountId), 'paper', sha256(token), nowIso());
  return { bridge_id: bridgeId, account_id: String(accountId), environment: 'paper', token };
}

export function revokeBridge(ownerUserId, bridgeId) {
  ensureIbkrNewEventTraderSchema(); const ts = nowIso();
  const result = getDb().prepare(`UPDATE ibkrnew_bridges SET revoked_at=?,status='revoked' WHERE bridge_id=? AND owner_user_id=? AND revoked_at IS NULL`).run(ts, bridgeId, ownerUserId);
  if (!result.changes) throw Object.assign(new Error('bridge not found'), { status: 404 });
  getDb().prepare(`UPDATE ibkrnew_command_outbox SET status='cancelled',acknowledged_at=? WHERE bridge_id=? AND status IN ('pending','claimed')`).run(ts, bridgeId);
  getDb().prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd,gross_released_usd=gross_reserved_usd,status='released',updated_at=? WHERE owner_user_id=? AND status='reserved' AND authorization_id IN (SELECT authorization_id FROM ibkrnew_authorizations WHERE bridge_id=?)`).run(ts, ownerUserId, bridgeId);
  return { ok: true, bridge_id: bridgeId, status: 'revoked' };
}

export function authenticateBridge(bridgeId, token) {
  ensureIbkrNewEventTraderSchema();
  const row = getDb().prepare(`SELECT * FROM ibkrnew_bridges WHERE bridge_id=? AND revoked_at IS NULL`).get(String(bridgeId || ''));
  if (!row || !token) return null;
  const actual = Buffer.from(sha256(token)); const expected = Buffer.from(row.token_hash);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) ? row : null;
}

function grossFromPositions(positions, shortBufferPct) {
  return (positions || []).reduce((sum, p) => {
    const qty = Number(p.quantity ?? p.qty ?? 0); const price = Number(p.market_price ?? p.price ?? 0);
    const sec = String(p.security_type || p.secType || 'STK').toUpperCase();
    if (sec === 'OPT') return sum + Math.abs(qty) * price * Number(p.multiplier || 100);
    const notional = Math.abs(qty) * price;
    return sum + (qty < 0 ? notional * (1 + Number(shortBufferPct || 0) / 100) : notional);
  }, 0);
}

function signalFromBar(payload, strategy) {
  const f = payload.features || payload; const price = Number(f.last ?? f.close); const vwap = Number(f.vwap);
  const fast = Number(f.ema_fast ?? f.ema9); const slow = Number(f.ema_slow ?? f.ema21);
  const rvol = Number(f.relative_volume); const confirmed = f.confirmed_15m === true || f.confirmation_15m === true;
  if (![price, vwap, fast, slow, rvol].every(Number.isFinite) || rvol < Number(strategy.entry?.minimum_relative_volume || 1.25)) return null;
  if (strategy.entry?.require_15m_confirmation && !confirmed) return null;
  if (price > vwap && fast > slow) return 'LONG_STOCK';
  if (price < vwap && fast < slow) return 'SHORT_STOCK';
  return null;
}

function reservationAmount(expression, payload) {
  const quantity = Number(payload.quantity || 0); const maxPrice = Number(payload.maximum_entry_price ?? payload.limit_price ?? payload.ask ?? payload.last ?? payload.close);
  const multiplier = String(expression).includes('CALL') || String(expression).includes('PUT') ? Number(payload.multiplier || 100) : 1;
  return quantity * maxPrice * multiplier + Number(payload.estimated_fees_usd || 0);
}

function estimateRoundTripCommission(policy, expression, quantity, entryPrice, targetPrice, multiplier) {
  const c = policy.commissions || {}; const option = /CALL|PUT/.test(expression);
  const perOrder = option
    ? Math.max(Number(c.option_minimum_per_order_usd || 0.65), quantity * Number(c.option_per_contract_usd || 0.65))
    : Math.max(Number(c.stock_minimum_per_order_usd || 1), quantity * Number(c.stock_per_share_usd || 0.005));
  const exitNotional = quantity * targetPrice * multiplier;
  return perOrder * 2 + exitNotional * Number(c.estimated_regulatory_exit_pct || 0) / 100;
}

function tradeEconomics(policy, expression, payload, dailyUsed, activeTradeCount) {
  const requested = Number(payload.quantity || 0); const entry = Number(payload.limit_price ?? payload.ask ?? payload.last ?? payload.close);
  const target = Number(payload.protection?.targets?.[0]?.limit_price); const stop = Number(payload.protection?.stop_price);
  const multiplier = /CALL|PUT/.test(expression) ? Number(payload.multiplier || 100) : 1;
  const confidence = Math.max(0, Math.min(1, Number(payload.confidence ?? (payload.confirmed_15m ? 0.75 : 0.65))));
  const perUnitExposure = entry * multiplier; const remaining = Math.max(0, Number(policy.budgets.daily_opening_exposure_usd) - Number(dailyUsed || 0));
  const allocation = policy.allocation || {}; const baseCap = Number(policy.budgets.daily_opening_exposure_usd) * Number(allocation.default_daily_budget_pct_per_trade || 50) / 100;
  const requestedGross = requested * Math.abs(target - entry) * multiplier; const requestedRisk = requested * Math.abs(entry - stop) * multiplier;
  const requestedCommission = estimateRoundTripCommission(policy, expression, requested, entry, target, multiplier);
  const requestedNetRr = requestedRisk > 0 ? (requestedGross - requestedCommission) / requestedRisk : 0;
  const requestedDrag = requestedGross > 0 ? requestedCommission / requestedGross * 100 : Infinity;
  const concentrated = allocation.allow_full_daily_budget_single_trade === true && activeTradeCount === 0 && confidence >= Number(allocation.concentrated_trade_minimum_confidence || 0.85) && requestedNetRr >= Number(allocation.concentrated_trade_minimum_net_reward_risk || 2) && requestedDrag <= Number(allocation.concentrated_trade_maximum_commission_drag_pct || 10);
  const exposureCap = Math.min(remaining, concentrated ? remaining : baseCap); const quantity = Math.min(requested, Math.floor(exposureCap / Math.max(0.000001, perUnitExposure)));
  if (!(quantity > 0)) return { allowed: false, reason: 'allocation_capacity_too_small', requested_quantity: requested, approved_quantity: 0, confidence };
  const gross = quantity * Math.abs(target - entry) * multiplier; const risk = quantity * Math.abs(entry - stop) * multiplier;
  const commission = estimateRoundTripCommission(policy, expression, quantity, entry, target, multiplier); const net = gross - commission;
  const drag = gross > 0 ? commission / gross * 100 : Infinity; const netRr = risk > 0 ? net / risk : 0;
  const maxDrag = Number(policy.commissions?.maximum_round_trip_commission_pct_of_expected_gross_profit || 20);
  const minNet = Number(policy.commissions?.minimum_expected_net_profit_usd || 5);
  const reason = net < minNet ? 'expected_net_profit_below_minimum' : drag > maxDrag ? 'commission_drag_excessive' : netRr <= 0 ? 'commission_adjusted_reward_risk_invalid' : null;
  const profitableMove = (commission + minNet) / (quantity * multiplier); const requiredExit = expression === 'SHORT_STOCK' ? entry - profitableMove : entry + profitableMove;
  return { allowed: !reason, reason, requested_quantity: requested, approved_quantity: quantity, confidence, allocation_mode: concentrated ? 'concentrated_full_capacity_allowed' : 'diversified_capped', estimated_round_trip_commission_usd: commission, expected_gross_profit_usd: gross, expected_net_profit_usd: net, minimum_expected_net_profit_usd: minNet, required_profitable_exit_price: requiredExit, planned_loss_usd: risk, net_reward_risk: netRr, commission_drag_pct: drag, entry_price: entry, target_price: target, stop_price: stop, multiplier };
}

function saveAllocationDecision(db, ownerUserId, eventId, economics, authorizationId = null) {
  db.prepare(`INSERT OR REPLACE INTO ibkrnew_allocation_decisions(decision_id,owner_user_id,signal_event_id,authorization_id,requested_quantity,approved_quantity,estimated_commission_usd,expected_gross_profit_usd,expected_net_profit_usd,net_reward_risk,confidence,allocation_mode,rationale,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id('IBKRNewAllocationDecision'), ownerUserId, eventId, authorizationId, Number(economics.requested_quantity || 0), Number(economics.approved_quantity || 0), Number(economics.estimated_round_trip_commission_usd || 0), Number(economics.expected_gross_profit_usd || 0), Number(economics.expected_net_profit_usd || 0), Number(economics.net_reward_risk || 0), Number(economics.confidence || 0), economics.allocation_mode || 'blocked', economics.reason || economics.allocation_mode || 'evaluated', json(economics), nowIso());
}

function insertCommand(db, bridge, authorization, created, expires) {
  const commandId = id('IBKRNewCommand'); const command = { command_id: commandId, type: 'IBKRNewPlaceProtectedOrder', authorization };
  const signature = crypto.createHmac('sha256', bridge.token_hash).update(json(command)).digest('hex');
  db.prepare(`INSERT INTO ibkrnew_command_outbox(command_id,owner_user_id,account_id,bridge_id,authorization_id,command_json,signature,status,available_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,'pending',?,?,?)`).run(commandId, bridge.owner_user_id, bridge.account_id, bridge.bridge_id, authorization.authorization_id, json(command), signature, created, expires, created);
  return commandId;
}

function expireStaleAuthorizations(ownerUserId, db = getDb()) {
  const ts = nowIso();
  const rows = db.prepare(`SELECT authorization_id FROM ibkrnew_authorizations WHERE owner_user_id=? AND status IN ('pending_approval','issued') AND expires_at<=?`).all(ownerUserId, ts);
  const tx = db.transaction(() => {
    const expire = db.prepare(`UPDATE ibkrnew_authorizations SET status='expired' WHERE authorization_id=?`);
    const release = db.prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd,gross_released_usd=gross_reserved_usd,status='released',updated_at=? WHERE authorization_id=? AND status='reserved'`);
    const commands = db.prepare(`UPDATE ibkrnew_command_outbox SET status='expired' WHERE authorization_id=? AND status IN ('pending','claimed')`);
    for (const row of rows) { expire.run(row.authorization_id); release.run(ts, row.authorization_id); commands.run(row.authorization_id); }
  }); tx(); return rows.length;
}

function reconcileFilledReservations(ownerUserId, positions, ts, db = getDb()) {
  const openSymbols = new Set((positions || []).filter((p) => Number(p.quantity ?? p.qty ?? 0) !== 0).map((p) => String(p.symbol || '').toUpperCase()));
  const rows = db.prepare(`SELECT r.authorization_id,a.authorization_json FROM ibkrnew_budget_reservations r JOIN ibkrnew_authorizations a ON a.authorization_id=r.authorization_id WHERE r.owner_user_id=? AND r.status='filled' AND r.gross_released_usd<r.gross_reserved_usd`).all(ownerUserId);
  const release = db.prepare(`UPDATE ibkrnew_budget_reservations SET gross_released_usd=gross_reserved_usd,updated_at=? WHERE authorization_id=?`);
  // Once the broker reports the filled position, account state carries gross exposure;
  // release only the pending-reservation side so it is not counted twice.
  for (const row of rows) { const symbol = String(parse(row.authorization_json, {})?.contract?.symbol || '').toUpperCase(); if (symbol && openSymbols.has(symbol)) release.run(ts, row.authorization_id); }
}

function updateComponentHealth(db, bridge, componentId, componentType, status, detail, ts) {
  db.prepare(`INSERT INTO ibkrnew_component_health(owner_user_id,bridge_id,component_id,component_type,status,version,detail_json,last_seen_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,bridge_id,component_id) DO UPDATE SET status=excluded.status,version=excluded.version,detail_json=excluded.detail_json,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`).run(bridge.owner_user_id, bridge.bridge_id, componentId, componentType, status, detail?.version || null, json(detail || {}), ts, ts);
}

function recordComponentError(db, bridge, payload, occurred, created) {
  const componentId = String(payload.component_id || payload.component || 'IBKRNewDesktopBridge'); const message = String(payload.message || payload.error || 'Unknown desktop component error');
  db.prepare(`INSERT INTO ibkrnew_component_errors(error_id,owner_user_id,bridge_id,component_id,error_code,message,detail_json,occurred_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(id('IBKRNewComponentError'), bridge.owner_user_id, bridge.bridge_id, componentId, payload.code ? String(payload.code) : null, message, json(payload), occurred, created);
  db.prepare(`INSERT INTO ibkrnew_component_health(owner_user_id,bridge_id,component_id,component_type,status,detail_json,error_count,last_error,last_seen_at,updated_at) VALUES(?,?,?,?,?,'{}',1,?,?,?) ON CONFLICT(owner_user_id,bridge_id,component_id) DO UPDATE SET status='error',error_count=error_count+1,last_error=excluded.last_error,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`).run(bridge.owner_user_id, bridge.bridge_id, componentId, String(payload.component_type || 'desktop'), 'error', message, occurred, created);
}

function refreshTradeFinancials(db, ownerUserId, authorizationId, ts) {
  const trade = db.prepare(`SELECT * FROM ibkrnew_trade_records WHERE owner_user_id=? AND authorization_id=?`).get(ownerUserId, authorizationId);
  if (!trade) return;
  const sums = db.prepare(`SELECT COALESCE(SUM(commission_usd),0) commission,COALESCE(SUM(realized_pnl_usd),0) realized FROM ibkrnew_executions WHERE owner_user_id=? AND authorization_id=?`).get(ownerUserId, authorizationId);
  const reportedRealized = Number(sums.realized || 0);
  const gross = reportedRealized || (trade.status === 'closed' ? (trade.expression === 'SHORT_STOCK' ? Number(trade.entry_value_usd) - Number(trade.exit_value_usd) : Number(trade.exit_value_usd) - Number(trade.entry_value_usd)) : 0);
  const actualCommission = Number(sums.commission || 0); const economics = parse(trade.economics_json, {}); const multiplier = Number(economics.multiplier || 1);
  const entryUnit = Number(trade.quantity) > 0 ? Number(trade.entry_value_usd) / Number(trade.quantity) / multiplier : Number(economics.entry_price || 0);
  const remainingExitCommission = Math.max(0, Number(trade.estimated_round_trip_commission_usd) / 2); const minNet = Number(economics.minimum_expected_net_profit_usd || 0);
  const requiredMove = (actualCommission + remainingExitCommission + minNet) / Math.max(1, Number(trade.quantity) * multiplier);
  const requiredExit = trade.expression === 'SHORT_STOCK' ? entryUnit - requiredMove : entryUnit + requiredMove;
  db.prepare(`UPDATE ibkrnew_trade_records SET actual_commission_usd=?,gross_pnl_usd=?,net_pnl_usd=?,required_profitable_exit_price=?,updated_at=? WHERE trade_id=?`).run(actualCommission, gross, gross - actualCommission, requiredExit, ts, trade.trade_id);
}

function recordExecutionEvent(db, bridge, payload, occurred, created) {
  const authorizationId = payload.authorization_id || null; const trade = authorizationId ? db.prepare(`SELECT trade_id,expression FROM ibkrnew_trade_records WHERE owner_user_id=? AND authorization_id=?`).get(bridge.owner_user_id, authorizationId) : null;
  const brokerExecutionId = String(payload.execution_id || payload.exec_id || id('IBKRNewExecution'));
  const executionId = `${bridge.bridge_id}:${brokerExecutionId}`;
  db.prepare(`INSERT INTO ibkrnew_executions(execution_id,owner_user_id,account_id,bridge_id,authorization_id,trade_id,order_role,side,quantity,price,commission_usd,realized_pnl_usd,occurred_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(execution_id) DO UPDATE SET authorization_id=COALESCE(excluded.authorization_id,authorization_id),trade_id=COALESCE(excluded.trade_id,trade_id),order_role=COALESCE(excluded.order_role,order_role),side=COALESCE(excluded.side,side),quantity=CASE WHEN excluded.quantity>0 THEN excluded.quantity ELSE quantity END,price=CASE WHEN excluded.price>0 THEN excluded.price ELSE price END,commission_usd=CASE WHEN excluded.commission_usd<>0 THEN excluded.commission_usd ELSE commission_usd END,realized_pnl_usd=CASE WHEN excluded.realized_pnl_usd<>0 THEN excluded.realized_pnl_usd ELSE realized_pnl_usd END`).run(executionId, bridge.owner_user_id, bridge.account_id, bridge.bridge_id, authorizationId, trade?.trade_id || null, payload.order_role || null, payload.side || null, Number(payload.quantity || payload.shares || 0), Number(payload.price || 0), Number(payload.commission_usd || payload.commission || 0), Number(payload.realized_pnl_usd || payload.realized_pnl || 0), occurred, created);
  if (trade && payload.event_kind === 'fill') {
    const auth = db.prepare(`SELECT authorization_json FROM ibkrnew_authorizations WHERE authorization_id=?`).get(authorizationId); const multiplier = Number(parse(auth?.authorization_json, {})?.contract?.multiplier || (/CALL|PUT/.test(trade.expression) ? 100 : 1)); const value = Number(payload.quantity || payload.shares || 0) * Number(payload.price || 0) * multiplier;
    if (payload.order_role === 'entry') db.prepare(`UPDATE ibkrnew_trade_records SET entry_value_usd=entry_value_usd+?,status='open',opened_at=COALESCE(opened_at,?),updated_at=? WHERE trade_id=?`).run(value, occurred, created, trade.trade_id);
    else if (['target','protective_stop','exit'].includes(payload.order_role)) db.prepare(`UPDATE ibkrnew_trade_records SET exit_value_usd=exit_value_usd+?,status='closed',closed_at=?,updated_at=? WHERE trade_id=?`).run(value, occurred, created, trade.trade_id);
  }
  if (authorizationId) refreshTradeFinancials(db, bridge.owner_user_id, authorizationId, created);
}

function maybeAuthorize(bridge, eventId, payload) {
  const db = getDb(); expireStaleAuthorizations(bridge.owner_user_id, db); const configs = ensureIbkrNewDefaults(bridge.owner_user_id); const policy = configs.policy; const strategy = configs.strategy; const strategySkill = configs.strategy_skill;
  if (!policy.feature_switches?.trading_enabled || !policy.feature_switches?.paper_execution_enabled || !strategy.enabled) return { decision: 'blocked', reason: 'trading_disabled' };
  if (!strategySkill.enabled) return { decision: 'blocked', reason: 'strategy_skill_disabled' };
  const breaker = db.prepare(`SELECT 1 FROM ibkrnew_circuit_breakers WHERE owner_user_id=? AND active=1`).get(bridge.owner_user_id);
  if (breaker) return { decision: 'blocked', reason: 'circuit_breaker_active' };
  let expression = payload.expression || signalFromBar(payload, strategy);
  if (!expression) return { decision: 'no_signal' };
  if (strategy.execution_mode === 'advisory') return { decision: 'advisory', expression, reason: 'strategy_advisory_mode' };
  if (!strategy.allowed_expressions?.includes(expression)) return { decision: 'blocked', reason: 'strategy_expression_disabled' };
  const switchKey = ({ LONG_STOCK: 'long_stock_enabled', SHORT_STOCK: 'short_stock_enabled', LONG_CALL: 'long_call_enabled', LONG_PUT: 'long_put_enabled' })[expression];
  if (!policy.feature_switches?.[switchKey]) return { decision: 'blocked', reason: `${switchKey}_disabled` };
  if (expression === 'SHORT_STOCK' && payload.shortable !== true) return { decision: 'blocked', reason: 'shortability_not_confirmed' };
  const symbol = String(payload.symbol || payload.contract?.symbol || '').toUpperCase(); const universe = configs.universe;
  if (!symbol) return { decision: 'blocked', reason: 'symbol_required' };
  if ((universe.denylist || []).map((x) => String(x).toUpperCase()).includes(symbol)) return { decision: 'blocked', reason: 'symbol_denied' };
  if ((universe.allowlist || []).length && !(universe.allowlist || []).map((x) => String(x).toUpperCase()).includes(symbol)) return { decision: 'blocked', reason: 'outside_active_universe' };
  const quoteAt = Date.parse(payload.quote_at || payload.occurred_at || 0);
  if (!Number.isFinite(quoteAt) || Date.now() - quoteAt > Number(policy.freshness?.quote_max_age_ms || 5000)) return { decision: 'blocked', reason: 'stale_quote' };
  if (!Number.isInteger(Number(payload.quantity)) || Number(payload.quantity) <= 0) return { decision: 'blocked', reason: 'whole_positive_quantity_required' };
  const unitPrice = Number(payload.maximum_entry_price ?? payload.limit_price ?? payload.ask ?? payload.last ?? payload.close);
  if (expression.includes('STOCK') && (unitPrice < Number(universe.filters?.minimum_price_usd || 0) || unitPrice > Number(universe.filters?.maximum_price_usd || Infinity))) return { decision: 'blocked', reason: 'universe_price_filter_failed' };
  if (/CALL|PUT/.test(expression)) {
    const o = policy.option_rules || {}; const dte = Number(payload.dte); const spread = Number(payload.ask) - Number(payload.bid); const midpoint = (Number(payload.ask) + Number(payload.bid)) / 2;
    if (!Number.isFinite(dte) || dte < Number(o.minimum_dte) || dte > Number(o.maximum_dte)) return { decision: 'blocked', reason: 'option_dte_failed' };
    if (Number(payload.open_interest || 0) < Number(o.minimum_open_interest) || Number(payload.daily_volume || 0) < Number(o.minimum_daily_volume)) return { decision: 'blocked', reason: 'option_liquidity_failed' };
    if (!Number.isFinite(spread) || spread > Number(o.maximum_spread_usd) || (midpoint > 0 && spread / midpoint * 100 > Number(o.maximum_spread_midpoint_pct))) return { decision: 'blocked', reason: 'option_spread_failed' };
    const delta = Math.abs(Number(payload.delta)); if (!Number.isFinite(delta) || delta < Number(o.minimum_delta_abs) || delta > Number(o.maximum_delta_abs)) return { decision: 'blocked', reason: 'option_delta_failed' };
  }
  const account = db.prepare(`SELECT * FROM ibkrnew_account_state WHERE owner_user_id=? AND account_id=?`).get(bridge.owner_user_id, bridge.account_id);
  if (!account || Date.now() - Date.parse(account.captured_at) > Number(policy.freshness?.account_max_age_ms || 30000)) return { decision: 'blocked', reason: 'account_state_stale' };
  const day = tradingDay();
  const dailyBefore = Number(db.prepare(`SELECT COALESCE(SUM(daily_reserved_usd-daily_released_usd),0) used FROM ibkrnew_budget_reservations WHERE owner_user_id=? AND trading_day=? AND status IN ('reserved','partially_filled','filled')`).get(bridge.owner_user_id, day).used || 0);
  const activeTradeCount = Number(db.prepare(`SELECT COUNT(*) count FROM ibkrnew_budget_reservations WHERE owner_user_id=? AND status IN ('reserved','partially_filled','filled') AND gross_reserved_usd>gross_released_usd`).get(bridge.owner_user_id).count || 0);
  const economics = tradeEconomics(policy, expression, payload, dailyBefore, activeTradeCount);
  if (!economics.allowed) { saveAllocationDecision(db, bridge.owner_user_id, eventId, economics); return { decision: 'blocked', reason: economics.reason, economics }; }
  const effectivePayload = { ...payload, quantity: economics.approved_quantity, estimated_fees_usd: Number(payload.estimated_fees_usd || 0) + economics.estimated_round_trip_commission_usd, planned_loss_usd: economics.planned_loss_usd };
  const amount = reservationAmount(expression, effectivePayload);
  if (!(amount > 0)) return { decision: 'blocked', reason: 'invalid_opening_exposure' };
  const positionLimit = expression.includes('STOCK') ? (expression === 'SHORT_STOCK' ? policy.budgets.max_short_position_usd : policy.budgets.max_stock_position_usd) : policy.budgets.max_option_premium_position_usd;
  if (amount > Number(positionLimit)) { economics.reason = 'position_limit_exceeded'; saveAllocationDecision(db, bridge.owner_user_id, eventId, economics); return { decision: 'blocked', reason: economics.reason, economics }; }
  const authId = id('IBKRNewAuthorization'); const reservationId = id('IBKRNewReservation'); const created = nowIso();
  const grossReservation = expression === 'SHORT_STOCK' ? amount * (1 + Number(policy.budgets.short_stress_buffer_pct || 0) / 100) : amount;
  const approvalRequired = policy.feature_switches.ceo_approval_required === true || strategy.execution_mode === 'approval_required' || policy.feature_switches.automatic_entry_enabled !== true;
  const expires = new Date(Date.now() + Number(approvalRequired ? policy.freshness?.approval_ttl_ms || 300000 : policy.freshness?.authorization_ttl_ms || 15000)).toISOString();
  const transaction = db.transaction(() => {
    const daily = db.prepare(`SELECT COALESCE(SUM(daily_reserved_usd-daily_released_usd),0) used FROM ibkrnew_budget_reservations WHERE owner_user_id=? AND trading_day=? AND status IN ('reserved','partially_filled','filled')`).get(bridge.owner_user_id, day).used;
    const pendingGross = db.prepare(`SELECT COALESCE(SUM(gross_reserved_usd-gross_released_usd),0) used FROM ibkrnew_budget_reservations WHERE owner_user_id=? AND status IN ('reserved','partially_filled','filled')`).get(bridge.owner_user_id).used;
    const positions = parse(account.positions_json, []); const existingGross = grossFromPositions(positions, policy.budgets.short_stress_buffer_pct);
    const pending = db.prepare(`SELECT expression,gross_reserved_usd,gross_released_usd FROM ibkrnew_budget_reservations WHERE owner_user_id=? AND status IN ('reserved','partially_filled','filled') AND gross_reserved_usd>gross_released_usd`).all(bridge.owner_user_id);
    if (positions.filter((p) => Number(p.quantity ?? p.qty ?? 0) !== 0).length + pending.length >= Number(policy.budgets.max_open_positions)) throw Object.assign(new Error('max_open_positions_exceeded'), { code: 'RISK_BLOCK' });
    const optionPremium = positions.filter((p) => String(p.security_type || p.secType).toUpperCase() === 'OPT').reduce((sum, p) => sum + Math.abs(Number(p.quantity ?? p.qty ?? 0)) * Number(p.market_price ?? p.price ?? 0) * Number(p.multiplier || 100), 0) + pending.filter((p) => /CALL|PUT/.test(p.expression)).reduce((sum, p) => sum + Number(p.gross_reserved_usd) - Number(p.gross_released_usd), 0);
    if (/CALL|PUT/.test(expression) && optionPremium + amount > Number(policy.budgets.max_total_option_premium_usd)) throw Object.assign(new Error('total_option_premium_limit_exceeded'), { code: 'RISK_BLOCK' });
    const shortNotional = positions.filter((p) => Number(p.quantity ?? p.qty ?? 0) < 0 && String(p.security_type || p.secType || 'STK').toUpperCase() !== 'OPT').reduce((sum, p) => sum + Math.abs(Number(p.quantity ?? p.qty)) * Number(p.market_price ?? p.price ?? 0), 0) + pending.filter((p) => p.expression === 'SHORT_STOCK').reduce((sum, p) => sum + Number(p.gross_reserved_usd) - Number(p.gross_released_usd), 0);
    if (expression === 'SHORT_STOCK' && shortNotional + amount > Number(policy.budgets.max_total_short_notional_usd)) throw Object.assign(new Error('total_short_notional_limit_exceeded'), { code: 'RISK_BLOCK' });
    const totalCeiling = Math.min(Number(policy.budgets.total_gross_exposure_usd), Number(account.eligible_capital_usd || 0));
    if (Number(daily) + amount > Number(policy.budgets.daily_opening_exposure_usd)) throw Object.assign(new Error('daily_budget_exceeded'), { code: 'RISK_BLOCK' });
    if (existingGross + Number(pendingGross) + grossReservation > totalCeiling) throw Object.assign(new Error('total_budget_exceeded'), { code: 'RISK_BLOCK' });
    const quantity = Number(effectivePayload.quantity); const authorization = {
      authorization_id: authId, owner_user_id: bridge.owner_user_id, account_id: bridge.account_id, bridge_id: bridge.bridge_id, environment: 'paper',
      strategy: { id: strategy.id, version: strategy.version }, strategy_skill: { id: strategySkill.id, version: strategySkill.version, agent_name: strategySkill.agent_name }, policy: { id: policy.id, version: policy.version }, universe: { id: configs.universe.id, version: configs.universe.version },
      signal_event_id: eventId, action: 'OPEN', expression, contract: effectivePayload.contract || { symbol: effectivePayload.symbol, security_type: expression.includes('STOCK') ? 'STK' : 'OPT', exchange: 'SMART', currency: 'USD' },
      side: expression === 'SHORT_STOCK' ? 'SELL' : 'BUY', quantity, entry: { order_type: 'LIMIT', limit_price: Number(effectivePayload.limit_price ?? effectivePayload.ask ?? effectivePayload.last) },
      protection: effectivePayload.protection, budget: { daily_opening_reserved_usd: amount, total_exposure_reserved_usd: grossReservation, planned_loss_usd: Number(effectivePayload.planned_loss_usd || 0), estimated_round_trip_commission_usd: economics.estimated_round_trip_commission_usd, reservation_id: reservationId },
      economics, observed: { bid: effectivePayload.bid, ask: effectivePayload.ask, last: effectivePayload.last ?? effectivePayload.close, quote_at: effectivePayload.quote_at }, issued_at: created, expires_at: expires,
      idempotency_key: `IBKRNew:${eventId}`, nonce: crypto.randomBytes(16).toString('hex'),
    };
    if (!authorization.protection?.stop_price) throw Object.assign(new Error('protective_stop_required'), { code: 'RISK_BLOCK' });
    const entryPrice = Number(authorization.entry.limit_price); const stopPrice = Number(authorization.protection.stop_price); const targetPrice = Number(authorization.protection.targets?.[0]?.limit_price);
    if (!Number.isFinite(targetPrice) || (expression === 'SHORT_STOCK' ? !(stopPrice > entryPrice && targetPrice < entryPrice) : !(stopPrice < entryPrice && targetPrice > entryPrice))) throw Object.assign(new Error('invalid_protection_geometry'), { code: 'RISK_BLOCK' });
    if (authorization.budget.planned_loss_usd > Number(policy.loss_limits.max_planned_loss_per_trade_usd)) throw Object.assign(new Error('planned_loss_limit_exceeded'), { code: 'RISK_BLOCK' });
    db.prepare(`INSERT INTO ibkrnew_budget_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(reservationId, bridge.owner_user_id, bridge.account_id, day, authId, expression, amount, grossReservation, 0, 0, 0, 'reserved', created, created);
    db.prepare(`INSERT INTO ibkrnew_authorizations VALUES(?,?,?,?,?,?,?,?,?,?)`).run(authId, bridge.owner_user_id, bridge.account_id, bridge.bridge_id, eventId, expression, json(authorization), approvalRequired ? 'pending_approval' : 'issued', expires, created);
    saveAllocationDecision(db, bridge.owner_user_id, eventId, economics, authId);
    db.prepare(`INSERT INTO ibkrnew_trade_records(trade_id,owner_user_id,account_id,bridge_id,authorization_id,symbol,expression,quantity,estimated_round_trip_commission_usd,expected_net_profit_usd,required_profitable_exit_price,status,economics_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'authorized',?,?,?)`).run(id('IBKRNewTrade'), bridge.owner_user_id, bridge.account_id, bridge.bridge_id, authId, symbol, expression, quantity, economics.estimated_round_trip_commission_usd, economics.expected_net_profit_usd, economics.required_profitable_exit_price, json(economics), created, created);
    const commandId = approvalRequired ? null : insertCommand(db, bridge, authorization, created, expires);
    return { decision: approvalRequired ? 'pending_approval' : 'authorized', authorization_id: authId, command_id: commandId, reservation_id: reservationId, reserved_usd: amount, economics };
  });
  try { return transaction(); } catch (e) { if (e.code === 'RISK_BLOCK') return { decision: 'blocked', reason: e.message }; throw e; }
}

export function ingestBridgeEvent(bridge, input) {
  ensureIbkrNewEventTraderSchema(); const db = getDb(); const sourceId = String(input.event_id || input.source_event_id || ''); const sequence = Number(input.sequence); const eventType = String(input.event_type || input.type || '');
  if (!sourceId || !Number.isSafeInteger(sequence) || sequence < 1 || !eventType) throw Object.assign(new Error('event_id, positive integer sequence, and event_type are required'), { status: 400 });
  const currentBridge = db.prepare(`SELECT last_sequence FROM ibkrnew_bridges WHERE bridge_id=?`).get(bridge.bridge_id);
  const lastSequence = Number(currentBridge?.last_sequence || 0);
  const existing = db.prepare(`SELECT event_id,status,sequence FROM ibkrnew_events WHERE bridge_id=? AND source_event_id=?`).get(bridge.bridge_id, sourceId);
  if (existing && !(existing.status === 'quarantined' && Number(existing.sequence) === lastSequence + 1)) return { accepted: existing.status === 'accepted', duplicate: true, event_id: existing.event_id, status: existing.status };
  const eventId = existing?.event_id || id('IBKRNewEvent'); const occurred = input.occurred_at || nowIso(); const created = nowIso(); let status = 'accepted'; let reason = null;
  if (sequence !== lastSequence + 1) { status = 'quarantined'; reason = `sequence_gap_expected_${lastSequence + 1}`; }
  if (existing) db.prepare(`UPDATE ibkrnew_events SET status='accepted',reason=NULL,payload_json=?,occurred_at=? WHERE event_id=?`).run(json(input.payload || {}), occurred, eventId);
  else db.prepare(`INSERT INTO ibkrnew_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, bridge.owner_user_id, bridge.account_id, bridge.bridge_id, 'paper', eventType, sourceId, sequence, occurred, json(input.payload || {}), status, reason, created);
  db.prepare(`UPDATE ibkrnew_bridges SET status='online',last_seen_at=?,last_sequence=CASE WHEN ?='accepted' THEN ? ELSE last_sequence END WHERE bridge_id=?`).run(created, status, sequence, bridge.bridge_id);
  if (status !== 'accepted') return { accepted: false, event_id: eventId, status, reason };
  const payload = { ...(input.payload || {}), occurred_at: occurred };
  updateComponentHealth(db, bridge, 'IBKRNewDesktopBridge', 'desktop_bridge', 'online', { event_type: eventType, version: payload.bridge_version, sequence }, created);
  if (eventType === 'bridge.heartbeat') {
    updateComponentHealth(db, bridge, 'IBKRNewGateway', 'ibkr_gateway', payload.gateway_connected ? 'online' : 'offline', payload, created);
    for (const component of payload.components || []) updateComponentHealth(db, bridge, String(component.component_id || component.name), String(component.component_type || 'desktop'), String(component.status || 'unknown'), component, created);
  }
  if (/error|failed|disconnected/.test(eventType) || payload.level === 'error') recordComponentError(db, bridge, payload, occurred, created);
  if (eventType === 'account.snapshot') {
    db.prepare(`INSERT INTO ibkrnew_account_state(owner_user_id,account_id,bridge_id,eligible_capital_usd,cash_usd,realized_pnl_day_usd,unrealized_pnl_usd,positions_json,open_orders_json,captured_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,account_id) DO UPDATE SET bridge_id=excluded.bridge_id,eligible_capital_usd=excluded.eligible_capital_usd,cash_usd=excluded.cash_usd,realized_pnl_day_usd=excluded.realized_pnl_day_usd,unrealized_pnl_usd=excluded.unrealized_pnl_usd,positions_json=excluded.positions_json,open_orders_json=excluded.open_orders_json,captured_at=excluded.captured_at`).run(bridge.owner_user_id, bridge.account_id, bridge.bridge_id, Number(payload.eligible_capital_usd || payload.net_liquidation_usd || 0), Number(payload.cash_usd || 0), Number(payload.realized_pnl_day_usd || 0), Number(payload.unrealized_pnl_usd || 0), json(payload.positions || []), json(payload.open_orders || []), occurred);
    db.prepare(`INSERT INTO ibkrnew_position_snapshots(snapshot_id,owner_user_id,account_id,bridge_id,snapshot_type,payload_json,captured_at,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('IBKRNewSnapshot'), bridge.owner_user_id, bridge.account_id, bridge.bridge_id, 'account', json(payload), occurred, created);
    for (const order of payload.open_orders || []) if (String(order.order_ref || '').startsWith('IBKRNewAuthorization_')) db.prepare(`UPDATE ibkrnew_authorizations SET status='submitted' WHERE authorization_id=? AND owner_user_id=? AND status IN ('issued','uncertain')`).run(order.order_ref, bridge.owner_user_id);
    reconcileFilledReservations(bridge.owner_user_id, payload.positions || [], created, db);
    const policy = ensureIbkrNewDefaults(bridge.owner_user_id).policy;
    const pnl = Number(payload.realized_pnl_day_usd || 0) + Number(payload.unrealized_pnl_usd || 0);
    if (pnl <= -Number(policy.loss_limits.daily_loss_limit_usd)) {
      db.prepare(`INSERT INTO ibkrnew_circuit_breakers(owner_user_id,breaker_type,active,reason,created_at) VALUES(?,'daily_loss',1,?,?) ON CONFLICT(owner_user_id,breaker_type) DO UPDATE SET active=1,reason=excluded.reason,created_at=excluded.created_at,cleared_at=NULL`).run(bridge.owner_user_id, `Daily P&L ${pnl} breached limit`, created);
      db.prepare(`UPDATE ibkrnew_command_outbox SET status='cancelled',acknowledged_at=? WHERE owner_user_id=? AND status IN ('pending','claimed')`).run(created, bridge.owner_user_id);
      db.prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd,gross_released_usd=gross_reserved_usd,status='released',updated_at=? WHERE owner_user_id=? AND status='reserved'`).run(created, bridge.owner_user_id);
    }
  }
  if (eventType === 'position.changed' && Array.isArray(payload.positions)) {
    db.prepare(`UPDATE ibkrnew_account_state SET positions_json=?,captured_at=? WHERE owner_user_id=? AND account_id=?`).run(json(payload.positions), occurred, bridge.owner_user_id, bridge.account_id);
    reconcileFilledReservations(bridge.owner_user_id, payload.positions, created, db);
    db.prepare(`INSERT INTO ibkrnew_position_snapshots(snapshot_id,owner_user_id,account_id,bridge_id,snapshot_type,payload_json,captured_at,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('IBKRNewSnapshot'), bridge.owner_user_id, bridge.account_id, bridge.bridge_id, 'positions', json(payload), occurred, created);
  }
  if (eventType === 'execution.fill') recordExecutionEvent(db, bridge, { ...payload, event_kind: 'fill' }, occurred, created);
  if (eventType === 'commission.report') recordExecutionEvent(db, bridge, { ...payload, event_kind: 'commission' }, occurred, created);
  if (eventType === 'order.status_changed' && payload.authorization_id) {
    const statusText = String(payload.status || '').toLowerCase();
    const filledQty = Number(payload.filled || 0); const remainingQty = Number(payload.remaining || 0);
    if (payload.order_role === 'entry' && filledQty > 0 && remainingQty > 0) {
      const auth = db.prepare(`SELECT authorization_json FROM ibkrnew_authorizations WHERE authorization_id=? AND owner_user_id=?`).get(payload.authorization_id, bridge.owner_user_id);
      const totalQty = Number(parse(auth?.authorization_json, {})?.quantity || filledQty + remainingQty);
      db.prepare(`UPDATE ibkrnew_budget_reservations SET filled_usd=daily_reserved_usd*?/?,status='partially_filled',updated_at=? WHERE authorization_id=? AND owner_user_id=?`).run(filledQty, totalQty, created, payload.authorization_id, bridge.owner_user_id);
    } else if (payload.order_role === 'entry' && statusText === 'filled') {
      db.prepare(`UPDATE ibkrnew_authorizations SET status='filled' WHERE authorization_id=? AND owner_user_id=?`).run(payload.authorization_id, bridge.owner_user_id);
      db.prepare(`UPDATE ibkrnew_budget_reservations SET filled_usd=daily_reserved_usd,status='filled',updated_at=? WHERE authorization_id=? AND owner_user_id=?`).run(created, payload.authorization_id, bridge.owner_user_id);
    } else if (payload.order_role === 'entry' && /cancel|inactive|reject/.test(statusText)) {
      db.prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd-filled_usd,gross_released_usd=CASE WHEN filled_usd>0 THEN gross_reserved_usd*(daily_reserved_usd-filled_usd)/daily_reserved_usd ELSE gross_reserved_usd END,status=CASE WHEN filled_usd>0 THEN 'filled' ELSE 'released' END,updated_at=? WHERE authorization_id=? AND owner_user_id=? AND status IN ('reserved','partially_filled')`).run(created, payload.authorization_id, bridge.owner_user_id);
    } else if (payload.order_role === 'protective_stop' && /cancel|inactive|reject/.test(statusText)) {
      db.prepare(`INSERT INTO ibkrnew_circuit_breakers(owner_user_id,breaker_type,active,reason,created_at) VALUES(?,'protection_failure',1,?,?) ON CONFLICT(owner_user_id,breaker_type) DO UPDATE SET active=1,reason=excluded.reason,created_at=excluded.created_at,cleared_at=NULL`).run(bridge.owner_user_id, `Protective stop ${payload.order_id} became ${payload.status}`, created);
    }
  }
  const reaction = (eventType === 'market.bar_closed' || eventType === 'market.signal') ? maybeAuthorize(bridge, eventId, payload) : null;
  return { accepted: true, duplicate: false, event_id: eventId, status, reaction };
}

export function claimCommands(bridge, limit = 10) {
  ensureIbkrNewEventTraderSchema(); const db = getDb(); const ts = nowIso(); const lease = new Date(Date.now() + 10000).toISOString();
  const tx = db.transaction(() => {
    const expired = db.prepare(`SELECT authorization_id FROM ibkrnew_command_outbox WHERE bridge_id=? AND status IN ('pending','claimed') AND expires_at<=?`).all(bridge.bridge_id, ts);
    db.prepare(`UPDATE ibkrnew_command_outbox SET status='expired' WHERE bridge_id=? AND status IN ('pending','claimed') AND expires_at<=?`).run(bridge.bridge_id, ts);
    const release = db.prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd,gross_released_usd=gross_reserved_usd,status='released',updated_at=? WHERE authorization_id=? AND status='reserved'`);
    const expireAuth = db.prepare(`UPDATE ibkrnew_authorizations SET status='expired' WHERE authorization_id=? AND status='issued'`);
    for (const row of expired) { release.run(ts, row.authorization_id); expireAuth.run(row.authorization_id); }
    db.prepare(`UPDATE ibkrnew_command_outbox SET status='pending',lease_until=NULL WHERE bridge_id=? AND status='claimed' AND lease_until<=?`).run(bridge.bridge_id, ts);
    const rows = db.prepare(`SELECT * FROM ibkrnew_command_outbox WHERE bridge_id=? AND status='pending' AND available_at<=? AND expires_at>? ORDER BY created_at LIMIT ?`).all(bridge.bridge_id, ts, ts, Math.min(50, Math.max(1, Number(limit) || 10)));
    const mark = db.prepare(`UPDATE ibkrnew_command_outbox SET status='claimed',claimed_at=?,lease_until=? WHERE command_id=? AND status='pending'`);
    return rows.filter((r) => mark.run(ts, lease, r.command_id).changes === 1).map((r) => ({ ...parse(r.command_json, {}), signature: r.signature, expires_at: r.expires_at }));
  }); return tx();
}

export function acknowledgeCommand(bridge, commandId, status, detail = {}) {
  const allowed = new Set(['submitted', 'rejected', 'cancelled', 'uncertain', 'filled']);
  if (!allowed.has(status)) throw Object.assign(new Error('invalid acknowledgement status'), { status: 400 });
  const db = getDb(); const row = db.prepare(`SELECT * FROM ibkrnew_command_outbox WHERE command_id=? AND bridge_id=?`).get(commandId, bridge.bridge_id);
  if (!row) throw Object.assign(new Error('command not found'), { status: 404 });
  const mapped = status === 'submitted' ? 'acknowledged' : status;
  db.prepare(`UPDATE ibkrnew_command_outbox SET status=?,acknowledged_at=?,lease_until=NULL WHERE command_id=?`).run(mapped, nowIso(), commandId);
  db.prepare(`UPDATE ibkrnew_authorizations SET status=? WHERE authorization_id=?`).run(status, row.authorization_id);
  if (['rejected', 'cancelled'].includes(status)) db.prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd,gross_released_usd=gross_reserved_usd,status='released',updated_at=? WHERE authorization_id=? AND status='reserved'`).run(nowIso(), row.authorization_id);
  if (status === 'filled') db.prepare(`UPDATE ibkrnew_budget_reservations SET filled_usd=daily_reserved_usd,status='filled',updated_at=? WHERE authorization_id=?`).run(nowIso(), row.authorization_id);
  return { ok: true, command_id: commandId, status, detail };
}

export function approveAuthorization(ownerUserId, authorizationId) {
  ensureIbkrNewEventTraderSchema(); const db = getDb(); const ts = nowIso();
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM ibkrnew_authorizations WHERE authorization_id=? AND owner_user_id=?`).get(authorizationId, ownerUserId);
    if (!row) throw Object.assign(new Error('authorization not found'), { status: 404 });
    if (row.status !== 'pending_approval') throw Object.assign(new Error('authorization is not pending approval'), { status: 409 });
    if (Date.parse(row.expires_at) <= Date.now()) return { expired: true };
    const bridge = db.prepare(`SELECT * FROM ibkrnew_bridges WHERE bridge_id=? AND owner_user_id=? AND revoked_at IS NULL`).get(row.bridge_id, ownerUserId);
    if (!bridge) throw Object.assign(new Error('bridge unavailable'), { status: 409 });
    const commandId = insertCommand(db, bridge, parse(row.authorization_json, {}), ts, row.expires_at);
    db.prepare(`UPDATE ibkrnew_authorizations SET status='issued' WHERE authorization_id=?`).run(authorizationId);
    return { authorization_id: authorizationId, command_id: commandId, status: 'issued' };
  }); const result = tx();
  if (result.expired) { expireStaleAuthorizations(ownerUserId, db); throw Object.assign(new Error('authorization expired'), { status: 409 }); }
  return result;
}

export function getDashboard(ownerUserId) {
  const db = getDb(); ensureIbkrNewEventTraderSchema(db); expireStaleAuthorizations(ownerUserId, db); const configs = ensureIbkrNewDefaults(ownerUserId); const day = tradingDay();
  const bridges = db.prepare(`SELECT bridge_id,account_id,environment,status,last_sequence,last_seen_at,created_at,revoked_at FROM ibkrnew_bridges WHERE owner_user_id=? ORDER BY created_at DESC`).all(ownerUserId);
  const account = db.prepare(`SELECT * FROM ibkrnew_account_state WHERE owner_user_id=? ORDER BY captured_at DESC LIMIT 1`).get(ownerUserId);
  const daily = db.prepare(`SELECT COALESCE(SUM(daily_reserved_usd-daily_released_usd),0) used FROM ibkrnew_budget_reservations WHERE owner_user_id=? AND trading_day=? AND status IN ('reserved','partially_filled','filled')`).get(ownerUserId, day).used;
  const events = db.prepare(`SELECT event_id,event_type,bridge_id,sequence,occurred_at,status,reason,created_at FROM ibkrnew_events WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 100`).all(ownerUserId);
  const commands = db.prepare(`SELECT command_id,authorization_id,bridge_id,status,expires_at,created_at,acknowledged_at FROM ibkrnew_command_outbox WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 50`).all(ownerUserId);
  const approvals = db.prepare(`SELECT authorization_id,expression,bridge_id,expires_at,created_at FROM ibkrnew_authorizations WHERE owner_user_id=? AND status='pending_approval' ORDER BY created_at DESC`).all(ownerUserId);
  const reactions = db.prepare(`SELECT reaction_id,agent_name,subscriptions_json,enabled FROM ibkrnew_reaction_registry WHERE owner_user_id=? ORDER BY agent_name`).all(ownerUserId).map((r) => ({ ...r, subscriptions: parse(r.subscriptions_json, []) }));
  const staleMs = Number(configs.policy.freshness?.bridge_offline_after_ms || 30000); const now = Date.now();
  return { namespace: IBKRNEW_NAMESPACE, environment: 'paper', configs, reactions, approvals, trading_day: day, budgets: { daily_limit_usd: configs.policy.budgets.daily_opening_exposure_usd, daily_used_usd: Number(daily), total_limit_usd: configs.policy.budgets.total_gross_exposure_usd }, bridges: bridges.map((b) => ({ ...b, effective_status: !b.last_seen_at || now - Date.parse(b.last_seen_at) > staleMs ? 'offline' : b.status })), account: account ? { ...account, positions: parse(account.positions_json, []), open_orders: parse(account.open_orders_json, []) } : null, events, commands };
}

export function getIbkrNewSummary(ownerUserId) {
  const db = getDb(); ensureIbkrNewDefaults(ownerUserId);
  const totals = db.prepare(`SELECT COUNT(*) trade_count,COALESCE(SUM(actual_commission_usd),0) actual_commission_usd,COALESCE(SUM(estimated_round_trip_commission_usd),0) estimated_commission_usd,COALESCE(SUM(gross_pnl_usd),0) gross_pnl_usd,COALESCE(SUM(net_pnl_usd),0) net_pnl_usd,SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) open_trade_count,SUM(CASE WHEN status='closed' AND net_pnl_usd>0 THEN 1 ELSE 0 END) profitable_trade_count FROM ibkrnew_trade_records WHERE owner_user_id=?`).get(ownerUserId);
  const trades = db.prepare(`SELECT * FROM ibkrnew_trade_records WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 200`).all(ownerUserId).map((row) => ({ ...row, economics: parse(row.economics_json, {}) }));
  const allocations = db.prepare(`SELECT * FROM ibkrnew_allocation_decisions WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 200`).all(ownerUserId).map((row) => ({ ...row, detail: parse(row.detail_json, {}) }));
  const profile = db.prepare(`SELECT data_retention_days FROM platform_users WHERE id=?`).get(ownerUserId);
  return { retention_days: Number(profile?.data_retention_days || 90), totals: { ...totals, win_rate_pct: Number(totals.trade_count) ? Number(totals.profitable_trade_count || 0) / Number(totals.trade_count) * 100 : 0 }, trades, allocations };
}

export function getIbkrNewLiveOperations(ownerUserId, { limit = 200 } = {}) {
  const db = getDb(); const dashboard = getDashboard(ownerUserId); const n = Math.min(500, Math.max(1, Number(limit) || 200)); const staleMs = Number(dashboard.configs.policy.freshness?.bridge_offline_after_ms || 30000); const now = Date.now();
  const health = db.prepare(`SELECT * FROM ibkrnew_component_health WHERE owner_user_id=? ORDER BY updated_at DESC`).all(ownerUserId).map((row) => ({ ...row, detail: parse(row.detail_json, {}), effective_status: now - Date.parse(row.last_seen_at) > staleMs ? 'offline' : row.status }));
  const errors = db.prepare(`SELECT * FROM ibkrnew_component_errors WHERE owner_user_id=? ORDER BY occurred_at DESC LIMIT ?`).all(ownerUserId, n).map((row) => ({ ...row, detail: parse(row.detail_json, {}) }));
  const snapshots = db.prepare(`SELECT * FROM ibkrnew_position_snapshots WHERE owner_user_id=? ORDER BY captured_at DESC LIMIT ?`).all(ownerUserId, n).map((row) => ({ ...row, payload: parse(row.payload_json, {}) }));
  const executions = db.prepare(`SELECT * FROM ibkrnew_executions WHERE owner_user_id=? ORDER BY occurred_at DESC LIMIT ?`).all(ownerUserId, n);
  const profile = db.prepare(`SELECT data_retention_days FROM platform_users WHERE id=?`).get(ownerUserId);
  return { generated_at: nowIso(), retention_days: Number(profile?.data_retention_days || 90), health, errors, snapshots, executions, dashboard, summary: getIbkrNewSummary(ownerUserId) };
}
