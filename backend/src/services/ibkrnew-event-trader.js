import crypto from 'crypto';
import { getDb } from '../db/schema.js';
import { IBKRNEW_CONFIG_KINDS, getIbkrNewConfigBlueprint, getIbkrNewGoalBlueprint, getIbkrNewWorkflowBlueprints } from './ibkrnew-blueprints.js';

export const IBKRNEW_NAMESPACE = 'IBKRNew';
export const IBKRNEW_ENVIRONMENT = 'paper';

const DEFAULT_STRATEGY_SKILL = getIbkrNewConfigBlueprint('strategy_skill');
const DEFAULT_GOAL = getIbkrNewGoalBlueprint();

function json(value) { return JSON.stringify(value ?? null); }
function parse(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } }
function mergeConfig(base, value) {
  if (Array.isArray(value)) return structuredClone(value);
  if (!value || typeof value !== 'object') return value === undefined ? structuredClone(base) : value;
  const out = base && typeof base === 'object' && !Array.isArray(base) ? structuredClone(base) : {};
  for (const [key, child] of Object.entries(value)) out[key] = mergeConfig(out[key], child);
  return out;
}
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function nowIso() { return new Date().toISOString(); }
const IBKR_ACCOUNT_VALUE_PATTERN = /\b(?:DU|U)[- ]?\d{5,12}\b/gi;
const IBKR_ACCOUNT_KEYS = new Set(['accountid', 'accountnumber', 'accountno', 'accountcode', 'acctid', 'acctnumber', 'acctno', 'acctcode', 'ibkraccountid', 'ibkraccountnumber']);

function redactIbkrAccountText(value) {
  return String(value).replace(IBKR_ACCOUNT_VALUE_PATTERN, '[REDACTED_IBKR_ACCOUNT]');
}

export function sanitizeIbkrNewPersistence(value, depth = 0) {
  if (depth > 30) return '[REDACTED_EXCESSIVE_DEPTH]';
  if (typeof value === 'string') return redactIbkrAccountText(value);
  if (Array.isArray(value)) return value.map((child) => sanitizeIbkrNewPersistence(child, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (IBKR_ACCOUNT_KEYS.has(normalizedKey)) continue;
    clean[key] = sanitizeIbkrNewPersistence(child, depth + 1);
  }
  return clean;
}

function sanitizeStoredText(value, legacyAccountIds = []) {
  if (value == null) return value;
  let scrubbed = String(value);
  for (const accountId of legacyAccountIds) if (accountId) scrubbed = scrubbed.split(String(accountId)).join('[REDACTED_IBKR_ACCOUNT]');
  try { return json(sanitizeIbkrNewPersistence(JSON.parse(scrubbed))); }
  catch { return redactIbkrAccountText(scrubbed); }
}

function withAccountRef(row) {
  if (!row) return row;
  const { account_id: accountRef, ...rest } = row;
  return { ...rest, account_ref: accountRef };
}

export function migrateIbkrNewAccountPrivacy(db = getDb(), { force = false } = {}) {
  db.pragma('secure_delete = ON');
  const migrationName = 'opaque-account-reference-v1';
  const legacy = db.prepare(`SELECT bridge_id,owner_user_id,account_id FROM ibkrnew_bridges WHERE account_id NOT LIKE 'IBKRNewAccount_%'`).all();
  if (!force && !legacy.length && db.prepare(`SELECT 1 FROM ibkrnew_privacy_migrations WHERE migration_name=?`).get(migrationName)) return { migrated_bridge_count: 0, storage_rebuilt: false, already_applied: true };
  const legacyAccountIds = [...new Set(legacy.map((row) => row.account_id).filter(Boolean))];
  let changed = false;
  const ts = nowIso();
  const accountTables = ['ibkrnew_events', 'ibkrnew_account_state', 'ibkrnew_authorizations', 'ibkrnew_command_outbox', 'ibkrnew_position_snapshots', 'ibkrnew_trade_records', 'ibkrnew_executions'];
  const migrate = db.transaction(() => {
    for (const bridge of legacy) {
      const accountRef = id('IBKRNewAccount');
      db.prepare(`UPDATE ibkrnew_command_outbox SET status='cancelled',acknowledged_at=?,lease_until=NULL WHERE bridge_id=? AND status IN ('pending','claimed')`).run(ts, bridge.bridge_id);
      db.prepare(`UPDATE ibkrnew_authorizations SET status='cancelled' WHERE bridge_id=? AND status IN ('pending_approval','issued')`).run(bridge.bridge_id);
      db.prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd,gross_released_usd=gross_reserved_usd,status='released',updated_at=? WHERE owner_user_id=? AND authorization_id IN (SELECT authorization_id FROM ibkrnew_authorizations WHERE bridge_id=?) AND status IN ('reserved','partially_filled')`).run(ts, bridge.owner_user_id, bridge.bridge_id);
      for (const table of accountTables) db.prepare(`UPDATE ${table} SET account_id=? WHERE bridge_id=?`).run(accountRef, bridge.bridge_id);
      db.prepare(`UPDATE ibkrnew_budget_reservations SET account_id=? WHERE authorization_id IN (SELECT authorization_id FROM ibkrnew_authorizations WHERE bridge_id=?)`).run(accountRef, bridge.bridge_id);
      db.prepare(`UPDATE ibkrnew_bridges SET account_id=?,status='revoked',revoked_at=COALESCE(revoked_at,?) WHERE bridge_id=?`).run(accountRef, ts, bridge.bridge_id);
      changed = true;
    }
    const textColumns = {
      ibkrnew_config_versions: ['document_json'],
      ibkrnew_goals: ['name'], ibkrnew_goal_cycles: ['stop_reason'],
      ibkrnew_events: ['payload_json', 'reason'],
      ibkrnew_account_state: ['positions_json', 'open_orders_json'],
      ibkrnew_authorizations: ['authorization_json'],
      ibkrnew_command_outbox: ['command_json'],
      ibkrnew_position_snapshots: ['payload_json'],
      ibkrnew_instrument_profiles: ['profile_json'],
      ibkrnew_component_health: ['detail_json', 'last_error'],
      ibkrnew_component_errors: ['message', 'detail_json'],
      ibkrnew_trade_records: ['economics_json'],
      ibkrnew_allocation_decisions: ['rationale', 'detail_json'],
    };
    for (const [table, columns] of Object.entries(textColumns)) {
      const rows = db.prepare(`SELECT rowid,* FROM ${table}`).all();
      for (const row of rows) {
        const values = columns.map((column) => sanitizeStoredText(row[column], legacyAccountIds));
        if (columns.some((column, index) => values[index] !== row[column])) {
          db.prepare(`UPDATE ${table} SET ${columns.map((column) => `${column}=?`).join(',')} WHERE rowid=?`).run(...values, row.rowid);
          changed = true;
        }
      }
    }
  });
  migrate();
  if (changed) {
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec('VACUUM');
  }
  db.prepare(`INSERT OR REPLACE INTO ibkrnew_privacy_migrations(migration_name,applied_at) VALUES(?,?)`).run(migrationName, nowIso());
  return { migrated_bridge_count: legacy.length, storage_rebuilt: changed };
}

function ensureIbkrNewPrivacyTriggers(db) {
  const accountTables = ['ibkrnew_bridges', 'ibkrnew_events', 'ibkrnew_account_state', 'ibkrnew_budget_reservations', 'ibkrnew_authorizations', 'ibkrnew_command_outbox', 'ibkrnew_position_snapshots', 'ibkrnew_trade_records', 'ibkrnew_executions'];
  for (const table of accountTables) db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${table}_opaque_account_insert BEFORE INSERT ON ${table}
    WHEN NEW.account_id NOT GLOB 'IBKRNewAccount_*' BEGIN SELECT RAISE(ABORT, 'IBKRNew requires an opaque account reference'); END;
    CREATE TRIGGER IF NOT EXISTS ${table}_opaque_account_update BEFORE UPDATE OF account_id ON ${table}
    WHEN NEW.account_id NOT GLOB 'IBKRNewAccount_*' BEGIN SELECT RAISE(ABORT, 'IBKRNew requires an opaque account reference'); END;
  `);
  const textColumns = {
    ibkrnew_config_versions: ['document_json'], ibkrnew_events: ['payload_json'], ibkrnew_account_state: ['positions_json', 'open_orders_json'],
    ibkrnew_authorizations: ['authorization_json'], ibkrnew_command_outbox: ['command_json'], ibkrnew_position_snapshots: ['payload_json'],
    ibkrnew_instrument_profiles: ['profile_json'], ibkrnew_component_health: ['detail_json', 'last_error'], ibkrnew_component_errors: ['message', 'detail_json'],
    ibkrnew_trade_records: ['economics_json'], ibkrnew_allocation_decisions: ['rationale', 'detail_json'], ibkrnew_goals: ['name'], ibkrnew_goal_cycles: ['stop_reason'],
  };
  const containsAccount = (column) => `(NEW.${column} GLOB '*DU[0-9][0-9][0-9][0-9][0-9]*' OR NEW.${column} GLOB '*U[0-9][0-9][0-9][0-9][0-9]*')`;
  for (const [table, columns] of Object.entries(textColumns)) {
    const condition = columns.map(containsAccount).join(' OR ');
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${table}_account_text_insert BEFORE INSERT ON ${table}
      WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'IBKR account identifiers are forbidden in IBKRNew server text'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_account_text_update BEFORE UPDATE OF ${columns.join(',')} ON ${table}
      WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'IBKR account identifiers are forbidden in IBKRNew server text'); END;
    `);
  }
}
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
    CREATE TABLE IF NOT EXISTS ibkrnew_privacy_migrations (
      migration_name TEXT PRIMARY KEY, applied_at TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS ibkrnew_instrument_profiles (
      owner_user_id TEXT NOT NULL, bridge_id TEXT NOT NULL, symbol TEXT NOT NULL,
      security_type TEXT NOT NULL, profile_json TEXT NOT NULL,
      fundamentals_at TEXT, membership_at TEXT, corporate_events_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_user_id, symbol, security_type)
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_profiles_owner_time ON ibkrnew_instrument_profiles(owner_user_id, updated_at DESC);
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
    CREATE TABLE IF NOT EXISTS ibkrnew_goals (
      goal_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('ONE_TIME','PERPETUAL')),
      target_return_pct REAL NOT NULL, duration_days INTEGER NOT NULL,
      duration_basis TEXT NOT NULL CHECK(duration_basis='CALENDAR_DAYS'),
      capital_basis TEXT NOT NULL CHECK(capital_basis='CYCLE_START_ELIGIBLE_CAPITAL_CAPPED_BY_TOTAL_BUDGET'),
      profit_basis TEXT NOT NULL CHECK(profit_basis='NET_REALIZED_AFTER_COMMISSIONS'),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAUSED','COMPLETED')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ibkrnew_goal_owner_open ON ibkrnew_goals(owner_user_id) WHERE status IN ('ACTIVE','PAUSED');
    CREATE TABLE IF NOT EXISTS ibkrnew_goal_cycles (
      cycle_id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
      cycle_number INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','ACHIEVED','EXPIRED','PAUSED')),
      started_at TEXT NOT NULL, scheduled_end_at TEXT NOT NULL,
      capital_basis_usd REAL NOT NULL, target_profit_usd REAL NOT NULL,
      net_realized_profit_usd REAL NOT NULL DEFAULT 0,
      achieved_at TEXT, closed_at TEXT, stop_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(goal_id,cycle_number)
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_goal_cycles_owner ON ibkrnew_goal_cycles(owner_user_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS ibkrnew_goal_trade_links (
      authorization_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL,
      goal_id TEXT NOT NULL, cycle_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ibkrnew_goal_links_cycle ON ibkrnew_goal_trade_links(owner_user_id,cycle_id);
  `);
  ensureIbkrNewPrivacyTriggers(db);
  migrateIbkrNewAccountPrivacy(db);
}

const IBKRNEW_REACTIONS = getIbkrNewWorkflowBlueprints().map((workflow) => [workflow.agent_name, workflow.subscriptions]);

function defaultsFor(kind) {
  return getIbkrNewConfigBlueprint(kind);
}

export function validateConfig(kind, document) {
  const d = structuredClone(document || {});
  const supportedSchemaVersion = Number(defaultsFor(kind).schema_version);
  if (Number(d.schema_version) !== supportedSchemaVersion) throw Object.assign(new Error(`${kind} schema_version must be ${supportedSchemaVersion}`), { status: 400 });
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
  if (kind === 'strategy') {
    if (!['automatic', 'approval_required', 'advisory'].includes(d.execution_mode)) throw Object.assign(new Error('strategy execution_mode is invalid'), { status: 400 });
    if (d.goal_binding?.required !== true || d.goal_binding?.selector !== 'ACTIVE_IBKRNEW_GOAL') throw Object.assign(new Error('strategy must require the active IBKRNew goal'), { status: 400 });
  }
  if (kind === 'universe') {
    if (!Array.isArray(d.allowlist) || !Array.isArray(d.denylist) || !(Number(d.maximum_active_subscriptions) > 0)) throw Object.assign(new Error('universe lists and subscription ceiling are required'), { status: 400 });
    const stock = d.filters?.stock; const etf = d.filters?.etf;
    if (!stock || !etf) throw Object.assign(new Error('separate stock and ETF filters are required'), { status: 400 });
    if (!Array.isArray(stock.indexes) || !['ANY', 'ALL'].includes(stock.index_match)) throw Object.assign(new Error('stock indexes must be a list with index_match ANY or ALL'), { status: 400 });
    if (stock.indexes.some((value) => !String(value || '').trim() || String(value).length > 64)) throw Object.assign(new Error('stock index identifiers must be non-empty and at most 64 characters'), { status: 400 });
    if (!Array.isArray(etf.allowlist) || !Array.isArray(etf.denylist) || !Array.isArray(etf.categories)) throw Object.assign(new Error('ETF allowlist, denylist, and categories must be lists'), { status: 400 });
    const fundamentals = stock.fundamentals || {}; const events = stock.corporate_events || {};
    for (const [key, value] of Object.entries({ index_membership_maximum_age_hours: stock.index_membership_maximum_age_hours, fundamentals_maximum_age_hours: fundamentals.maximum_age_hours, corporate_events_maximum_age_hours: events.maximum_age_hours, etf_profile_maximum_age_hours: etf.profile_maximum_age_hours })) {
      if (!(Number(value) > 0)) throw Object.assign(new Error(`${key} must be positive`), { status: 400 });
    }
    for (const key of ['earnings_blackout_days_before', 'earnings_blackout_days_after']) if (!(Number(events[key]) >= 0)) throw Object.assign(new Error(`${key} must be zero or positive`), { status: 400 });
    for (const [key, value] of Object.entries({ stock_minimum_price_usd: stock.minimum_price_usd, stock_maximum_price_usd: stock.maximum_price_usd, stock_minimum_average_daily_volume: stock.minimum_average_daily_volume, stock_maximum_spread_pct: stock.maximum_spread_pct, minimum_market_cap_usd: fundamentals.minimum_market_cap_usd, minimum_revenue_ttm_usd: fundamentals.minimum_revenue_ttm_usd, maximum_debt_to_equity: fundamentals.maximum_debt_to_equity, etf_minimum_price_usd: etf.minimum_price_usd, etf_maximum_price_usd: etf.maximum_price_usd, etf_minimum_average_daily_volume: etf.minimum_average_daily_volume, etf_maximum_spread_pct: etf.maximum_spread_pct, minimum_assets_under_management_usd: etf.minimum_assets_under_management_usd })) {
      if (!(Number(value) >= 0)) throw Object.assign(new Error(`${key} must be zero or positive`), { status: 400 });
    }
    if (Number(stock.maximum_price_usd) < Number(stock.minimum_price_usd) || Number(etf.maximum_price_usd) < Number(etf.minimum_price_usd)) throw Object.assign(new Error('maximum universe price must not be below minimum price'), { status: 400 });
  }
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
  for (const kind of IBKRNEW_CONFIG_KINDS) {
    let current = getPublishedConfig(ownerUserId, kind);
    if (!current) current = publishConfig(ownerUserId, kind, structuredClone(defaultsFor(kind)), { confirmRiskLoosening: true });
    const blueprint = defaultsFor(kind);
    if (Number(current.schema_version || 0) < Number(blueprint.schema_version)) {
      const prior = structuredClone(current); delete prior.id; delete prior.version; delete prior.status;
      const migrated = mergeConfig(blueprint, prior);
      if (kind === 'universe') {
        const legacyFilters = prior.filters || {};
        for (const key of ['minimum_price_usd', 'maximum_price_usd', 'minimum_average_daily_volume', 'maximum_spread_pct']) {
          if (Object.hasOwn(legacyFilters, key)) { migrated.filters.stock[key] = legacyFilters[key]; migrated.filters.etf[key] = legacyFilters[key]; }
        }
      }
      if (kind === 'strategy_skill') {
        migrated.instructions = [...new Set([...(prior.instructions || []), ...DEFAULT_STRATEGY_SKILL.instructions])];
        migrated.output_schema = [...new Set([...(prior.output_schema || []), ...DEFAULT_STRATEGY_SKILL.output_schema])];
      }
      migrated.schema_version = blueprint.schema_version;
      current = publishConfig(ownerUserId, kind, migrated, { confirmRiskLoosening: true });
    }
    out[kind] = current;
  }
  const addReaction = getDb().prepare(`INSERT OR IGNORE INTO ibkrnew_reaction_registry(reaction_id,owner_user_id,agent_name,subscriptions_json,created_at) VALUES(?,?,?,?,?)`);
  for (const [agentName, subscriptions] of IBKRNEW_REACTIONS) addReaction.run(id('IBKRNewReaction'), ownerUserId, agentName, json(subscriptions), nowIso());
  ensureDefaultIbkrNewGoal(ownerUserId, out.policy);
  return out;
}

function goalDefinition(row) {
  if (!row) return null;
  return { goal_id: row.goal_id, name: row.name, mode: row.mode, target_return_pct: Number(row.target_return_pct), duration_days: Number(row.duration_days), duration_basis: row.duration_basis, capital_basis: row.capital_basis, profit_basis: row.profit_basis, status: row.status, created_at: row.created_at, updated_at: row.updated_at };
}

function validateGoal(input = {}) {
  const goal = {
    name: String(input.name || DEFAULT_GOAL.name).trim().slice(0, 120),
    mode: String(input.mode || DEFAULT_GOAL.mode).toUpperCase(),
    target_return_pct: Number(input.target_return_pct ?? DEFAULT_GOAL.target_return_pct),
    duration_days: Number(input.duration_days ?? DEFAULT_GOAL.duration_days),
    duration_basis: String(input.duration_basis || DEFAULT_GOAL.duration_basis).toUpperCase(),
    capital_basis: String(input.capital_basis || DEFAULT_GOAL.capital_basis).toUpperCase(),
    profit_basis: String(input.profit_basis || DEFAULT_GOAL.profit_basis).toUpperCase(),
  };
  if (!goal.name) throw Object.assign(new Error('goal name is required'), { status: 400 });
  if (!['ONE_TIME', 'PERPETUAL'].includes(goal.mode)) throw Object.assign(new Error('goal mode must be ONE_TIME or PERPETUAL'), { status: 400 });
  if (!(goal.target_return_pct > 0 && goal.target_return_pct <= 100)) throw Object.assign(new Error('goal target return must be above 0 and at most 100 percent'), { status: 400 });
  if (!Number.isInteger(goal.duration_days) || goal.duration_days < 1 || goal.duration_days > 3650) throw Object.assign(new Error('goal duration must be 1 to 3650 calendar days'), { status: 400 });
  if (goal.duration_basis !== 'CALENDAR_DAYS') throw Object.assign(new Error('goal duration basis must be CALENDAR_DAYS'), { status: 400 });
  if (goal.capital_basis !== 'CYCLE_START_ELIGIBLE_CAPITAL_CAPPED_BY_TOTAL_BUDGET') throw Object.assign(new Error('unsupported goal capital basis'), { status: 400 });
  if (goal.profit_basis !== 'NET_REALIZED_AFTER_COMMISSIONS') throw Object.assign(new Error('unsupported goal profit basis'), { status: 400 });
  return sanitizeIbkrNewPersistence(goal);
}

function ensureDefaultIbkrNewGoal(ownerUserId, policy) {
  const db = getDb(); const existing = db.prepare(`SELECT 1 FROM ibkrnew_goals WHERE owner_user_id=? LIMIT 1`).get(ownerUserId);
  if (existing) return;
  const goal = validateGoal(DEFAULT_GOAL); const ts = nowIso();
  db.prepare(`INSERT INTO ibkrnew_goals(goal_id,owner_user_id,name,mode,target_return_pct,duration_days,duration_basis,capital_basis,profit_basis,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`).run(id('IBKRNewGoal'), ownerUserId, goal.name, goal.mode, goal.target_return_pct, goal.duration_days, goal.duration_basis, goal.capital_basis, goal.profit_basis, ts, ts);
  reconcileIbkrNewGoal(ownerUserId, { policy, at: ts });
}

function createGoalCycle(db, ownerUserId, goal, policy, startedAt, cycleNumber) {
  const account = db.prepare(`SELECT eligible_capital_usd FROM ibkrnew_account_state WHERE owner_user_id=? ORDER BY captured_at DESC LIMIT 1`).get(ownerUserId);
  const capital = Math.min(Number(policy?.budgets?.total_gross_exposure_usd || 0), Number(account?.eligible_capital_usd || 0));
  if (!(capital > 0)) return null;
  const startMs = Date.parse(startedAt); const end = new Date(startMs + Number(goal.duration_days) * 86400000).toISOString(); const ts = nowIso(); const cycleId = id('IBKRNewGoalCycle');
  db.prepare(`INSERT INTO ibkrnew_goal_cycles(cycle_id,goal_id,owner_user_id,cycle_number,status,started_at,scheduled_end_at,capital_basis_usd,target_profit_usd,created_at,updated_at) VALUES(?,?,?,?,'ACTIVE',?,?,?,?,?,?)`).run(cycleId, goal.goal_id, ownerUserId, cycleNumber, new Date(startMs).toISOString(), end, capital, capital * Number(goal.target_return_pct) / 100, ts, ts);
  return db.prepare(`SELECT * FROM ibkrnew_goal_cycles WHERE cycle_id=?`).get(cycleId);
}

function goalCycleProfit(db, ownerUserId, cycleId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(t.net_pnl_usd),0) value FROM ibkrnew_goal_trade_links l LEFT JOIN ibkrnew_trade_records t ON t.authorization_id=l.authorization_id AND t.owner_user_id=l.owner_user_id WHERE l.owner_user_id=? AND l.cycle_id=?`).get(ownerUserId, cycleId)?.value || 0);
}

function serializeGoalState(goal, cycle, now = new Date()) {
  const net = Number(cycle?.net_realized_profit_usd || 0); const target = Number(cycle?.target_profit_usd || 0); const remaining = Math.max(0, target - net); const endMs = Date.parse(cycle?.scheduled_end_at || 0);
  const allowed = goal?.status === 'ACTIVE' && cycle?.status === 'ACTIVE' && Number.isFinite(endMs) && now.getTime() < endMs;
  const reason = !goal ? 'goal_missing' : goal.status === 'PAUSED' ? 'goal_paused' : goal.status === 'COMPLETED' ? 'goal_completed' : !cycle ? 'goal_waiting_for_capital' : cycle.status === 'ACHIEVED' ? 'goal_target_achieved' : cycle.status === 'EXPIRED' ? 'goal_expired' : cycle.status === 'PAUSED' ? 'goal_paused' : allowed ? null : 'goal_cycle_inactive';
  return { definition: goalDefinition(goal), cycle: cycle ? { ...cycle, cycle_number: Number(cycle.cycle_number), capital_basis_usd: Number(cycle.capital_basis_usd), target_profit_usd: target, net_realized_profit_usd: net, remaining_profit_usd: remaining, progress_pct: target > 0 ? Math.max(0, net / target * 100) : 0, days_remaining: Number.isFinite(endMs) ? Math.max(0, Math.ceil((endMs - now.getTime()) / 86400000)) : 0 } : null, opening_trades_allowed: allowed, block_reason: reason };
}

function reconcileIbkrNewGoal(ownerUserId, { policy, at = nowIso() } = {}) {
  const db = getDb(); const atDate = new Date(at); const atMs = atDate.getTime();
  let goal = db.prepare(`SELECT * FROM ibkrnew_goals WHERE owner_user_id=? AND status IN ('ACTIVE','PAUSED') ORDER BY created_at DESC LIMIT 1`).get(ownerUserId);
  if (!goal) goal = db.prepare(`SELECT * FROM ibkrnew_goals WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 1`).get(ownerUserId);
  if (!goal) return serializeGoalState(null, null, atDate);
  let cycle = db.prepare(`SELECT * FROM ibkrnew_goal_cycles WHERE owner_user_id=? AND goal_id=? ORDER BY cycle_number DESC LIMIT 1`).get(ownerUserId, goal.goal_id);
  if (goal.status === 'PAUSED') {
    if (cycle?.status === 'ACTIVE') { db.prepare(`UPDATE ibkrnew_goal_cycles SET status='PAUSED',stop_reason='GOAL_PAUSED',updated_at=? WHERE cycle_id=?`).run(nowIso(), cycle.cycle_id); cycle = { ...cycle, status: 'PAUSED', stop_reason: 'GOAL_PAUSED' }; }
    return serializeGoalState(goal, cycle, atDate);
  }
  if (goal.status === 'COMPLETED') return serializeGoalState(goal, cycle, atDate);
  if (!cycle) cycle = createGoalCycle(db, ownerUserId, goal, policy, atDate.toISOString(), 1);
  if (!cycle) return serializeGoalState(goal, null, atDate);
  const net = goalCycleProfit(db, ownerUserId, cycle.cycle_id); cycle = { ...cycle, net_realized_profit_usd: net };
  db.prepare(`UPDATE ibkrnew_goal_cycles SET net_realized_profit_usd=?,updated_at=? WHERE cycle_id=?`).run(net, nowIso(), cycle.cycle_id);
  const endMs = Date.parse(cycle.scheduled_end_at);
  if (cycle.status === 'ACTIVE') {
    if (net >= Number(cycle.target_profit_usd) && atMs <= endMs) {
      db.prepare(`UPDATE ibkrnew_goal_cycles SET status='ACHIEVED',achieved_at=?,closed_at=?,stop_reason='TARGET_RETURN_REACHED',updated_at=? WHERE cycle_id=?`).run(atDate.toISOString(), atDate.toISOString(), nowIso(), cycle.cycle_id);
      cycle = { ...cycle, status: 'ACHIEVED', achieved_at: atDate.toISOString(), closed_at: atDate.toISOString(), stop_reason: 'TARGET_RETURN_REACHED' };
      if (goal.mode === 'ONE_TIME') { db.prepare(`UPDATE ibkrnew_goals SET status='COMPLETED',updated_at=? WHERE goal_id=?`).run(nowIso(), goal.goal_id); goal = { ...goal, status: 'COMPLETED' }; }
    } else if (atMs >= endMs) {
      db.prepare(`UPDATE ibkrnew_goal_cycles SET status='EXPIRED',closed_at=?,stop_reason='DURATION_ELAPSED',updated_at=? WHERE cycle_id=?`).run(cycle.scheduled_end_at, nowIso(), cycle.cycle_id);
      cycle = { ...cycle, status: 'EXPIRED', closed_at: cycle.scheduled_end_at, stop_reason: 'DURATION_ELAPSED' };
      if (goal.mode === 'ONE_TIME') { db.prepare(`UPDATE ibkrnew_goals SET status='COMPLETED',updated_at=? WHERE goal_id=?`).run(nowIso(), goal.goal_id); goal = { ...goal, status: 'COMPLETED' }; }
    }
  }
  if (goal.mode === 'PERPETUAL' && goal.status === 'ACTIVE' && ['ACHIEVED','EXPIRED'].includes(cycle.status) && atMs >= endMs) {
    const durationMs = Number(goal.duration_days) * 86400000; const skipped = Math.max(0, Math.floor((atMs - endMs) / durationMs)); const nextStart = new Date(endMs + skipped * durationMs).toISOString();
    cycle = createGoalCycle(db, ownerUserId, goal, policy, nextStart, Number(cycle.cycle_number) + skipped + 1) || cycle;
  }
  return serializeGoalState(goal, cycle, atDate);
}

export function getIbkrNewGoalState(ownerUserId, options = {}) {
  const configs = ensureIbkrNewDefaults(ownerUserId);
  return reconcileIbkrNewGoal(ownerUserId, { policy: configs.policy, at: options.at || nowIso() });
}

export function setIbkrNewGoal(ownerUserId, input = {}) {
  const configs = ensureIbkrNewDefaults(ownerUserId); const goal = validateGoal(input); const db = getDb(); const ts = nowIso();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE ibkrnew_goal_cycles SET status='EXPIRED',closed_at=?,stop_reason='GOAL_REPLACED',updated_at=? WHERE owner_user_id=? AND status IN ('ACTIVE','PAUSED')`).run(ts, ts, ownerUserId);
    db.prepare(`UPDATE ibkrnew_goals SET status='COMPLETED',updated_at=? WHERE owner_user_id=? AND status IN ('ACTIVE','PAUSED')`).run(ts, ownerUserId);
    const goalId = id('IBKRNewGoal');
    db.prepare(`INSERT INTO ibkrnew_goals(goal_id,owner_user_id,name,mode,target_return_pct,duration_days,duration_basis,capital_basis,profit_basis,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`).run(goalId, ownerUserId, goal.name, goal.mode, goal.target_return_pct, goal.duration_days, goal.duration_basis, goal.capital_basis, goal.profit_basis, ts, ts);
    return goalId;
  }); tx();
  return reconcileIbkrNewGoal(ownerUserId, { policy: configs.policy, at: ts });
}

export function pauseIbkrNewGoal(ownerUserId) {
  ensureIbkrNewDefaults(ownerUserId); const db = getDb(); const ts = nowIso(); const result = db.prepare(`UPDATE ibkrnew_goals SET status='PAUSED',updated_at=? WHERE owner_user_id=? AND status='ACTIVE'`).run(ts, ownerUserId);
  if (!result.changes) throw Object.assign(new Error('active IBKRNew goal not found'), { status: 404 });
  return getIbkrNewGoalState(ownerUserId);
}

export function resumeIbkrNewGoal(ownerUserId) {
  ensureIbkrNewDefaults(ownerUserId); const db = getDb(); const ts = nowIso(); const goal = db.prepare(`SELECT * FROM ibkrnew_goals WHERE owner_user_id=? AND status='PAUSED' ORDER BY created_at DESC LIMIT 1`).get(ownerUserId);
  if (!goal) throw Object.assign(new Error('paused IBKRNew goal not found'), { status: 404 });
  db.prepare(`UPDATE ibkrnew_goals SET status='ACTIVE',updated_at=? WHERE goal_id=?`).run(ts, goal.goal_id);
  db.prepare(`UPDATE ibkrnew_goal_cycles SET status='ACTIVE',stop_reason=NULL,updated_at=? WHERE goal_id=? AND status='PAUSED'`).run(ts, goal.goal_id);
  return getIbkrNewGoalState(ownerUserId);
}

export function publishConfig(ownerUserId, kind, document, { confirmRiskLoosening = false } = {}) {
  ensureIbkrNewEventTraderSchema();
  const db = getDb(); const validated = validateConfig(kind, document); const clean = sanitizeIbkrNewPersistence(validated); const current = getPublishedConfig(ownerUserId, kind);
  if (json(clean) !== json(validated)) throw Object.assign(new Error('IBKR account identifiers are not accepted in server-side configuration'), { status: 400 });
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

export function registerBridge(ownerUserId, suppliedAccountId) {
  ensureIbkrNewEventTraderSchema();
  if (suppliedAccountId != null && String(suppliedAccountId).trim()) throw Object.assign(new Error('Real IBKR account identifiers must remain in the desktop bridge only'), { status: 400 });
  const bridgeId = id('IBKRNewBridge'); const accountRef = id('IBKRNewAccount'); const token = `ibkrnew_${crypto.randomBytes(32).toString('base64url')}`;
  getDb().prepare(`INSERT INTO ibkrnew_bridges(bridge_id,owner_user_id,account_id,environment,token_hash,status,created_at) VALUES(?,?,?,?,?,'offline',?)`).run(bridgeId, ownerUserId, accountRef, 'paper', sha256(token), nowIso());
  return { bridge_id: bridgeId, account_ref: accountRef, environment: 'paper', token };
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

function normalizedValues(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))];
}

function isFresh(timestamp, maximumAgeHours) {
  const at = Date.parse(timestamp || 0);
  const age = Date.now() - at;
  return Number.isFinite(at) && age >= -300000 && age <= Number(maximumAgeHours) * 60 * 60 * 1000;
}

function saveInstrumentProfile(db, bridge, eventType, payload, occurred, created) {
  if (Buffer.byteLength(json(payload), 'utf8') > 262144) throw Object.assign(new Error('instrument profile exceeds 256 KiB'), { status: 413 });
  const symbol = String(payload.symbol || payload.contract?.symbol || '').trim().toUpperCase();
  const securityType = String(payload.security_type || payload.secType || 'STK').trim().toUpperCase();
  if (!symbol || !['STK', 'ETF'].includes(securityType)) throw Object.assign(new Error('instrument profile requires a symbol and STK or ETF security_type'), { status: 400 });
  const existing = db.prepare(`SELECT * FROM ibkrnew_instrument_profiles WHERE owner_user_id=? AND symbol=? AND security_type=?`).get(bridge.owner_user_id, symbol, securityType);
  const prior = parse(existing?.profile_json, {}); let profile = { ...prior, symbol, security_type: securityType };
  if (eventType === 'instrument.profile_refreshed') profile = { ...profile, ...payload, symbol, security_type: securityType };
  if (eventType === 'instrument.fundamentals_refreshed') profile.fundamentals = { ...(prior.fundamentals || {}), ...(payload.fundamentals || payload.data || {}) };
  if (eventType === 'instrument.membership_refreshed') profile.index_memberships = normalizedValues(payload.index_memberships || payload.indexes);
  if (eventType === 'instrument.corporate_events_refreshed') profile.corporate_events = Array.isArray(payload.corporate_events) ? payload.corporate_events : [];
  profile.index_memberships = normalizedValues(profile.index_memberships);
  profile.etf_categories = normalizedValues(profile.etf_categories || profile.categories);
  const fundamentalsAt = payload.fundamentals_at || (eventType === 'instrument.fundamentals_refreshed' || eventType === 'instrument.profile_refreshed' && profile.fundamentals ? occurred : existing?.fundamentals_at);
  const membershipAt = payload.membership_at || (eventType === 'instrument.membership_refreshed' || eventType === 'instrument.profile_refreshed' && Array.isArray(profile.index_memberships) ? occurred : existing?.membership_at);
  const corporateEventsAt = payload.corporate_events_at || (eventType === 'instrument.corporate_events_refreshed' || eventType === 'instrument.profile_refreshed' && Array.isArray(profile.corporate_events) ? occurred : existing?.corporate_events_at);
  db.prepare(`INSERT INTO ibkrnew_instrument_profiles(owner_user_id,bridge_id,symbol,security_type,profile_json,fundamentals_at,membership_at,corporate_events_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,symbol,security_type) DO UPDATE SET bridge_id=excluded.bridge_id,profile_json=excluded.profile_json,fundamentals_at=excluded.fundamentals_at,membership_at=excluded.membership_at,corporate_events_at=excluded.corporate_events_at,updated_at=excluded.updated_at`).run(bridge.owner_user_id, bridge.bridge_id, symbol, securityType, json(profile), fundamentalsAt || null, membershipAt || null, corporateEventsAt || null, created);
}

function instrumentEligibility(db, ownerUserId, universe, symbol, expression, payload) {
  const optionExpression = /CALL|PUT/.test(expression);
  const underlyingType = String(payload.underlying_security_type || payload.underlying_sec_type || (optionExpression ? 'STK' : payload.security_type || payload.contract?.security_type || 'STK')).toUpperCase();
  if (!['STK', 'ETF'].includes(underlyingType)) return { eligible: false, reason: 'unsupported_underlying_security_type' };
  if (!(universe.filters?.security_types || ['STK', 'ETF']).includes(underlyingType)) return { eligible: false, reason: 'security_type_filtered' };
  const row = db.prepare(`SELECT * FROM ibkrnew_instrument_profiles WHERE owner_user_id=? AND symbol=? AND security_type=?`).get(ownerUserId, symbol, underlyingType);
  const profile = row ? parse(row.profile_json, {}) : null;
  const rules = underlyingType === 'ETF' ? universe.filters?.etf : universe.filters?.stock;
  if (rules?.enabled !== true) return { eligible: false, reason: underlyingType === 'ETF' ? 'etf_filter_disabled' : 'stock_filter_disabled' };
  const unitPrice = Number(optionExpression ? payload.underlying_price : payload.maximum_entry_price ?? payload.limit_price ?? payload.ask ?? payload.last ?? payload.close);
  if (!Number.isFinite(unitPrice) || unitPrice < Number(rules.minimum_price_usd || 0) || unitPrice > Number(rules.maximum_price_usd || Infinity)) return { eligible: false, reason: 'universe_price_filter_failed' };
  const averageVolume = Number((optionExpression ? payload.underlying_average_daily_volume : payload.average_daily_volume) ?? profile?.average_daily_volume);
  if (!Number.isFinite(averageVolume) || averageVolume < Number(rules.minimum_average_daily_volume || 0)) return { eligible: false, reason: 'universe_average_volume_filter_failed' };
  const spreadPct = Number((optionExpression ? payload.underlying_spread_pct : payload.spread_pct) ?? (!optionExpression && Number(payload.ask) > 0 && Number(payload.bid) >= 0 ? (Number(payload.ask) - Number(payload.bid)) / ((Number(payload.ask) + Number(payload.bid)) / 2) * 100 : NaN));
  if (!Number.isFinite(spreadPct) || spreadPct > Number(rules.maximum_spread_pct || Infinity)) return { eligible: false, reason: 'universe_spread_filter_failed' };

  if (underlyingType === 'ETF') {
    const allow = normalizedValues(rules.allowlist); const deny = normalizedValues(rules.denylist); const categories = normalizedValues(rules.categories);
    if (deny.includes(symbol)) return { eligible: false, reason: 'etf_symbol_denied' };
    if (allow.length && !allow.includes(symbol)) return { eligible: false, reason: 'outside_etf_allowlist' };
    if (!profile || !isFresh(row?.updated_at, rules.profile_maximum_age_hours)) {
      if (rules.fail_closed !== false) return { eligible: false, reason: profile ? 'etf_profile_stale' : 'etf_profile_missing' };
    } else {
      const profileCategories = normalizedValues(profile.etf_categories || profile.categories);
      if (categories.length && !categories.some((category) => profileCategories.includes(category))) return { eligible: false, reason: 'etf_category_filter_failed' };
      const aum = Number(profile.assets_under_management_usd ?? profile.aum_usd);
      if (!Number.isFinite(aum) || aum < Number(rules.minimum_assets_under_management_usd || 0)) return { eligible: false, reason: 'etf_assets_filter_failed' };
    }
    return { eligible: true, security_type: underlyingType, profile_updated_at: row?.updated_at || null };
  }

  const requestedIndexes = normalizedValues(rules.indexes);
  if (requestedIndexes.length) {
    if (!profile || !isFresh(row?.membership_at, rules.index_membership_maximum_age_hours)) return { eligible: false, reason: profile ? 'index_membership_stale' : 'index_membership_missing' };
    const memberships = normalizedValues(profile.index_memberships);
    const matches = requestedIndexes.filter((index) => memberships.includes(index));
    if (rules.index_match === 'ALL' ? matches.length !== requestedIndexes.length : matches.length === 0) return { eligible: false, reason: 'outside_configured_stock_indexes' };
  }

  const fundamentalRules = rules.fundamentals || {};
  if (fundamentalRules.enabled === true) {
    const fundamentals = profile?.fundamentals;
    if (!fundamentals || !isFresh(row?.fundamentals_at, fundamentalRules.maximum_age_hours)) {
      if (fundamentalRules.fail_closed !== false) return { eligible: false, reason: fundamentals ? 'fundamentals_stale' : 'fundamentals_missing' };
    } else {
      const marketCap = Number(fundamentals.market_cap_usd); const revenue = Number(fundamentals.revenue_ttm_usd); const debtToEquity = Number(fundamentals.debt_to_equity);
      if (!Number.isFinite(marketCap) || marketCap < Number(fundamentalRules.minimum_market_cap_usd || 0)) return { eligible: false, reason: 'fundamental_market_cap_failed' };
      if (!Number.isFinite(revenue) || revenue < Number(fundamentalRules.minimum_revenue_ttm_usd || 0)) return { eligible: false, reason: 'fundamental_revenue_failed' };
      if (!Number.isFinite(debtToEquity) || debtToEquity > Number(fundamentalRules.maximum_debt_to_equity || Infinity)) return { eligible: false, reason: 'fundamental_debt_failed' };
      if (fundamentalRules.require_positive_operating_cash_flow === true && !(Number(fundamentals.operating_cash_flow_ttm_usd) > 0)) return { eligible: false, reason: 'fundamental_cash_flow_failed' };
      const sector = String(fundamentals.sector || '').trim().toUpperCase(); const allowed = normalizedValues(fundamentalRules.allowed_sectors); const excluded = normalizedValues(fundamentalRules.excluded_sectors);
      if (excluded.includes(sector)) return { eligible: false, reason: 'fundamental_sector_excluded' };
      if (allowed.length && !allowed.includes(sector)) return { eligible: false, reason: 'fundamental_sector_not_allowed' };
    }
  }

  const eventRules = rules.corporate_events || {};
  if (eventRules.enabled === true) {
    const events = profile?.corporate_events;
    if (!Array.isArray(events) || !isFresh(row?.corporate_events_at, eventRules.maximum_age_hours)) {
      if (eventRules.fail_closed !== false) return { eligible: false, reason: Array.isArray(events) ? 'corporate_events_stale' : 'corporate_events_missing' };
    } else {
      const beforeMs = Number(eventRules.earnings_blackout_days_before || 0) * 86400000; const afterMs = Number(eventRules.earnings_blackout_days_after || 0) * 86400000; const now = Date.now();
      const earningsRisk = events.some((event) => String(event.type || event.event_type || '').toLowerCase() === 'earnings' && Number.isFinite(Date.parse(event.at || event.date)) && Date.parse(event.at || event.date) >= now - afterMs && Date.parse(event.at || event.date) <= now + beforeMs);
      if (earningsRisk) return { eligible: false, reason: 'earnings_blackout_active' };
    }
  }
  return { eligible: true, security_type: underlyingType, profile_updated_at: row?.updated_at || null };
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
  if (authorizationId) {
    refreshTradeFinancials(db, bridge.owner_user_id, authorizationId, created);
    const policy = ensureIbkrNewDefaults(bridge.owner_user_id).policy;
    reconcileIbkrNewGoal(bridge.owner_user_id, { policy, at: occurred });
  }
}

function maybeAuthorize(bridge, eventId, payload) {
  const db = getDb(); expireStaleAuthorizations(bridge.owner_user_id, db); const configs = ensureIbkrNewDefaults(bridge.owner_user_id); const policy = configs.policy; const strategy = configs.strategy; const strategySkill = configs.strategy_skill;
  if (!policy.feature_switches?.trading_enabled || !policy.feature_switches?.paper_execution_enabled || !strategy.enabled) return { decision: 'blocked', reason: 'trading_disabled' };
  if (!strategySkill.enabled) return { decision: 'blocked', reason: 'strategy_skill_disabled' };
  const goalState = reconcileIbkrNewGoal(bridge.owner_user_id, { policy, at: payload.occurred_at || nowIso() });
  if (strategy.goal_binding?.required === true && !goalState.opening_trades_allowed) return { decision: 'blocked', reason: goalState.block_reason || 'goal_cycle_inactive', goal: goalState };
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
  const eligibility = instrumentEligibility(db, bridge.owner_user_id, universe, symbol, expression, payload);
  if (!eligibility.eligible) return { decision: 'blocked', reason: eligibility.reason };
  const quoteAt = Date.parse(payload.quote_at || payload.occurred_at || 0);
  if (!Number.isFinite(quoteAt) || Date.now() - quoteAt > Number(policy.freshness?.quote_max_age_ms || 5000)) return { decision: 'blocked', reason: 'stale_quote' };
  if (!Number.isInteger(Number(payload.quantity)) || Number(payload.quantity) <= 0) return { decision: 'blocked', reason: 'whole_positive_quantity_required' };
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
    const activeCycle = db.prepare(`SELECT c.*,g.status goal_status FROM ibkrnew_goal_cycles c JOIN ibkrnew_goals g ON g.goal_id=c.goal_id WHERE c.cycle_id=? AND c.owner_user_id=?`).get(goalState.cycle?.cycle_id, bridge.owner_user_id);
    if (!activeCycle || activeCycle.status !== 'ACTIVE' || activeCycle.goal_status !== 'ACTIVE' || Date.parse(activeCycle.scheduled_end_at) <= Date.now()) throw Object.assign(new Error('goal_cycle_inactive'), { code: 'RISK_BLOCK' });
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
      authorization_id: authId, owner_user_id: bridge.owner_user_id, account_ref: bridge.account_id, bridge_id: bridge.bridge_id, environment: 'paper',
      goal: { goal_id: activeCycle.goal_id, cycle_id: activeCycle.cycle_id, cycle_number: activeCycle.cycle_number, target_profit_usd: activeCycle.target_profit_usd, scheduled_end_at: activeCycle.scheduled_end_at }, strategy: { id: strategy.id, version: strategy.version }, strategy_skill: { id: strategySkill.id, version: strategySkill.version, agent_name: strategySkill.agent_name }, policy: { id: policy.id, version: policy.version }, universe: { id: configs.universe.id, version: configs.universe.version },
      signal_event_id: eventId, action: 'OPEN', expression, contract: effectivePayload.contract || { symbol: effectivePayload.symbol, security_type: expression.includes('STOCK') ? eligibility.security_type : 'OPT', exchange: 'SMART', currency: 'USD' },
      side: expression === 'SHORT_STOCK' ? 'SELL' : 'BUY', quantity, entry: { order_type: 'LIMIT', limit_price: Number(effectivePayload.limit_price ?? effectivePayload.ask ?? effectivePayload.last) },
      protection: effectivePayload.protection, budget: { daily_opening_reserved_usd: amount, total_exposure_reserved_usd: grossReservation, planned_loss_usd: Number(effectivePayload.planned_loss_usd || 0), estimated_round_trip_commission_usd: economics.estimated_round_trip_commission_usd, reservation_id: reservationId },
      economics, eligibility, observed: { bid: effectivePayload.bid, ask: effectivePayload.ask, last: effectivePayload.last ?? effectivePayload.close, quote_at: effectivePayload.quote_at }, issued_at: created, expires_at: expires,
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
    db.prepare(`INSERT INTO ibkrnew_goal_trade_links(authorization_id,owner_user_id,goal_id,cycle_id,created_at) VALUES(?,?,?,?,?)`).run(authId, bridge.owner_user_id, activeCycle.goal_id, activeCycle.cycle_id, created);
    const commandId = approvalRequired ? null : insertCommand(db, bridge, authorization, created, expires);
    return { decision: approvalRequired ? 'pending_approval' : 'authorized', authorization_id: authId, command_id: commandId, reservation_id: reservationId, reserved_usd: amount, economics };
  });
  try { return transaction(); } catch (e) { if (e.code === 'RISK_BLOCK') return { decision: 'blocked', reason: e.message }; throw e; }
}

export function ingestBridgeEvent(bridge, input) {
  ensureIbkrNewEventTraderSchema(); const db = getDb(); const sourceId = String(input.event_id || input.source_event_id || ''); const sequence = Number(input.sequence); const eventType = String(input.event_type || input.type || '');
  if (!sourceId || !Number.isSafeInteger(sequence) || sequence < 1 || !eventType) throw Object.assign(new Error('event_id, positive integer sequence, and event_type are required'), { status: 400 });
  if (redactIbkrAccountText(sourceId) !== sourceId || redactIbkrAccountText(eventType) !== eventType) throw Object.assign(new Error('IBKR account identifiers are not accepted in event metadata'), { status: 400 });
  const occurredMs = input.occurred_at == null ? Date.now() : Date.parse(input.occurred_at);
  if (!Number.isFinite(occurredMs)) throw Object.assign(new Error('occurred_at must be a valid timestamp'), { status: 400 });
  const currentBridge = db.prepare(`SELECT last_sequence FROM ibkrnew_bridges WHERE bridge_id=?`).get(bridge.bridge_id);
  const lastSequence = Number(currentBridge?.last_sequence || 0);
  const existing = db.prepare(`SELECT event_id,status,sequence FROM ibkrnew_events WHERE bridge_id=? AND source_event_id=?`).get(bridge.bridge_id, sourceId);
  if (existing && !(existing.status === 'quarantined' && Number(existing.sequence) === lastSequence + 1)) return { accepted: existing.status === 'accepted', duplicate: true, event_id: existing.event_id, status: existing.status };
  const eventId = existing?.event_id || id('IBKRNewEvent'); const occurred = new Date(occurredMs).toISOString(); const created = nowIso(); let status = 'accepted'; let reason = null;
  if (sequence !== lastSequence + 1) { status = 'quarantined'; reason = `sequence_gap_expected_${lastSequence + 1}`; }
  const cleanPayload = sanitizeIbkrNewPersistence(input.payload || {});
  if (existing) db.prepare(`UPDATE ibkrnew_events SET status='accepted',reason=NULL,payload_json=?,occurred_at=? WHERE event_id=?`).run(json(cleanPayload), occurred, eventId);
  else db.prepare(`INSERT INTO ibkrnew_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(eventId, bridge.owner_user_id, bridge.account_id, bridge.bridge_id, 'paper', eventType, sourceId, sequence, occurred, json(cleanPayload), status, reason, created);
  db.prepare(`UPDATE ibkrnew_bridges SET status='online',last_seen_at=?,last_sequence=CASE WHEN ?='accepted' THEN ? ELSE last_sequence END WHERE bridge_id=?`).run(created, status, sequence, bridge.bridge_id);
  if (status !== 'accepted') return { accepted: false, event_id: eventId, status, reason };
  const payload = { ...cleanPayload, occurred_at: occurred };
  updateComponentHealth(db, bridge, 'IBKRNewDesktopBridge', 'desktop_bridge', 'online', { event_type: eventType, version: payload.bridge_version, sequence }, created);
  if (eventType === 'bridge.heartbeat') {
    updateComponentHealth(db, bridge, 'IBKRNewGateway', 'ibkr_gateway', payload.gateway_connected ? 'online' : 'offline', payload, created);
    for (const component of payload.components || []) updateComponentHealth(db, bridge, String(component.component_id || component.name), String(component.component_type || 'desktop'), String(component.status || 'unknown'), component, created);
  }
  if (/error|failed|disconnected/.test(eventType) || payload.level === 'error') recordComponentError(db, bridge, payload, occurred, created);
  if (['instrument.profile_refreshed', 'instrument.fundamentals_refreshed', 'instrument.membership_refreshed', 'instrument.corporate_events_refreshed'].includes(eventType)) saveInstrumentProfile(db, bridge, eventType, payload, occurred, created);
  if (eventType === 'account.snapshot') {
    db.prepare(`INSERT INTO ibkrnew_account_state(owner_user_id,account_id,bridge_id,eligible_capital_usd,cash_usd,realized_pnl_day_usd,unrealized_pnl_usd,positions_json,open_orders_json,captured_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_user_id,account_id) DO UPDATE SET bridge_id=excluded.bridge_id,eligible_capital_usd=excluded.eligible_capital_usd,cash_usd=excluded.cash_usd,realized_pnl_day_usd=excluded.realized_pnl_day_usd,unrealized_pnl_usd=excluded.unrealized_pnl_usd,positions_json=excluded.positions_json,open_orders_json=excluded.open_orders_json,captured_at=excluded.captured_at`).run(bridge.owner_user_id, bridge.account_id, bridge.bridge_id, Number(payload.eligible_capital_usd || payload.net_liquidation_usd || 0), Number(payload.cash_usd || 0), Number(payload.realized_pnl_day_usd || 0), Number(payload.unrealized_pnl_usd || 0), json(payload.positions || []), json(payload.open_orders || []), occurred);
    db.prepare(`INSERT INTO ibkrnew_position_snapshots(snapshot_id,owner_user_id,account_id,bridge_id,snapshot_type,payload_json,captured_at,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(id('IBKRNewSnapshot'), bridge.owner_user_id, bridge.account_id, bridge.bridge_id, 'account', json(payload), occurred, created);
    for (const order of payload.open_orders || []) if (String(order.order_ref || '').startsWith('IBKRNewAuthorization_')) db.prepare(`UPDATE ibkrnew_authorizations SET status='submitted' WHERE authorization_id=? AND owner_user_id=? AND status IN ('issued','uncertain')`).run(order.order_ref, bridge.owner_user_id);
    reconcileFilledReservations(bridge.owner_user_id, payload.positions || [], created, db);
    const policy = ensureIbkrNewDefaults(bridge.owner_user_id).policy;
    reconcileIbkrNewGoal(bridge.owner_user_id, { policy, at: occurred });
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

export function claimCommands(bridge, limit = 10, protocolVersion = 0) {
  if (Number(protocolVersion) < 2) throw Object.assign(new Error('IBKRNew desktop bridge protocol version 2 or newer is required'), { status: 426 });
  ensureIbkrNewEventTraderSchema(); const db = getDb(); const ts = nowIso(); const lease = new Date(Date.now() + 10000).toISOString();
  const tx = db.transaction(() => {
    const goalBlocked = db.prepare(`SELECT o.authorization_id FROM ibkrnew_command_outbox o LEFT JOIN ibkrnew_goal_trade_links l ON l.authorization_id=o.authorization_id LEFT JOIN ibkrnew_goal_cycles c ON c.cycle_id=l.cycle_id LEFT JOIN ibkrnew_goals g ON g.goal_id=l.goal_id WHERE o.bridge_id=? AND o.status IN ('pending','claimed') AND (c.status IS NULL OR c.status<>'ACTIVE' OR g.status<>'ACTIVE' OR c.scheduled_end_at<=?)`).all(bridge.bridge_id, ts);
    for (const row of goalBlocked) {
      db.prepare(`UPDATE ibkrnew_command_outbox SET status='cancelled',acknowledged_at=?,lease_until=NULL WHERE authorization_id=? AND status IN ('pending','claimed')`).run(ts, row.authorization_id);
      db.prepare(`UPDATE ibkrnew_authorizations SET status='cancelled' WHERE authorization_id=? AND status IN ('issued','pending_approval','uncertain')`).run(row.authorization_id);
      db.prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd,gross_released_usd=gross_reserved_usd,status='released',updated_at=? WHERE authorization_id=? AND status='reserved'`).run(ts, row.authorization_id);
    }
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
  const cleanDetail = sanitizeIbkrNewPersistence(detail); const db = getDb(); const row = db.prepare(`SELECT * FROM ibkrnew_command_outbox WHERE command_id=? AND bridge_id=?`).get(commandId, bridge.bridge_id);
  if (!row) throw Object.assign(new Error('command not found'), { status: 404 });
  const mapped = status === 'submitted' ? 'acknowledged' : status;
  if (row.status === mapped || row.status === status) return { ok: true, duplicate: true, command_id: commandId, status, detail: cleanDetail };
  if (row.status !== 'claimed' || row.account_id !== bridge.account_id) throw Object.assign(new Error('command is no longer claimable or belongs to a prior account-reference epoch'), { status: 409 });
  const ts = nowIso(); const tx = db.transaction(() => {
    const updated = db.prepare(`UPDATE ibkrnew_command_outbox SET status=?,acknowledged_at=?,lease_until=NULL WHERE command_id=? AND status='claimed' AND account_id=?`).run(mapped, ts, commandId, bridge.account_id);
    if (!updated.changes) throw Object.assign(new Error('command state changed before acknowledgement'), { status: 409 });
    db.prepare(`UPDATE ibkrnew_authorizations SET status=? WHERE authorization_id=? AND status NOT IN ('cancelled','expired')`).run(status, row.authorization_id);
    if (['rejected', 'cancelled'].includes(status)) db.prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd,gross_released_usd=gross_reserved_usd,status='released',updated_at=? WHERE authorization_id=? AND status='reserved'`).run(ts, row.authorization_id);
    if (status === 'filled') db.prepare(`UPDATE ibkrnew_budget_reservations SET filled_usd=daily_reserved_usd,status='filled',updated_at=? WHERE authorization_id=?`).run(ts, row.authorization_id);
  }); tx();
  return { ok: true, command_id: commandId, status, detail: cleanDetail };
}

export function approveAuthorization(ownerUserId, authorizationId) {
  ensureIbkrNewEventTraderSchema(); const db = getDb(); const ts = nowIso();
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT * FROM ibkrnew_authorizations WHERE authorization_id=? AND owner_user_id=?`).get(authorizationId, ownerUserId);
    if (!row) throw Object.assign(new Error('authorization not found'), { status: 404 });
    if (row.status !== 'pending_approval') throw Object.assign(new Error('authorization is not pending approval'), { status: 409 });
    if (Date.parse(row.expires_at) <= Date.now()) return { expired: true };
    const link = db.prepare(`SELECT c.*,g.status goal_status FROM ibkrnew_goal_trade_links l JOIN ibkrnew_goal_cycles c ON c.cycle_id=l.cycle_id JOIN ibkrnew_goals g ON g.goal_id=l.goal_id WHERE l.authorization_id=? AND l.owner_user_id=?`).get(authorizationId, ownerUserId);
    if (!link || link.status !== 'ACTIVE' || link.goal_status !== 'ACTIVE' || Date.parse(link.scheduled_end_at) <= Date.now()) {
      db.prepare(`UPDATE ibkrnew_authorizations SET status='cancelled' WHERE authorization_id=?`).run(authorizationId);
      db.prepare(`UPDATE ibkrnew_budget_reservations SET daily_released_usd=daily_reserved_usd,gross_released_usd=gross_reserved_usd,status='released',updated_at=? WHERE authorization_id=? AND status='reserved'`).run(ts, authorizationId);
      return { goal_blocked: true };
    }
    const bridge = db.prepare(`SELECT * FROM ibkrnew_bridges WHERE bridge_id=? AND owner_user_id=? AND revoked_at IS NULL`).get(row.bridge_id, ownerUserId);
    if (!bridge) throw Object.assign(new Error('bridge unavailable'), { status: 409 });
    const commandId = insertCommand(db, bridge, parse(row.authorization_json, {}), ts, row.expires_at);
    db.prepare(`UPDATE ibkrnew_authorizations SET status='issued' WHERE authorization_id=?`).run(authorizationId);
    return { authorization_id: authorizationId, command_id: commandId, status: 'issued' };
  }); const result = tx();
  if (result.expired) { expireStaleAuthorizations(ownerUserId, db); throw Object.assign(new Error('authorization expired'), { status: 409 }); }
  if (result.goal_blocked) throw Object.assign(new Error('goal cycle no longer permits opening trades'), { status: 409 });
  return result;
}

export function getDashboard(ownerUserId) {
  const db = getDb(); ensureIbkrNewEventTraderSchema(db); expireStaleAuthorizations(ownerUserId, db); const configs = ensureIbkrNewDefaults(ownerUserId); const day = tradingDay();
  const bridges = db.prepare(`SELECT bridge_id,account_id,environment,status,last_sequence,last_seen_at,created_at,revoked_at FROM ibkrnew_bridges WHERE owner_user_id=? ORDER BY created_at DESC`).all(ownerUserId).map(withAccountRef);
  const account = db.prepare(`SELECT * FROM ibkrnew_account_state WHERE owner_user_id=? ORDER BY captured_at DESC LIMIT 1`).get(ownerUserId);
  const daily = db.prepare(`SELECT COALESCE(SUM(daily_reserved_usd-daily_released_usd),0) used FROM ibkrnew_budget_reservations WHERE owner_user_id=? AND trading_day=? AND status IN ('reserved','partially_filled','filled')`).get(ownerUserId, day).used;
  const events = db.prepare(`SELECT event_id,event_type,bridge_id,sequence,occurred_at,status,reason,created_at FROM ibkrnew_events WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 100`).all(ownerUserId);
  const commands = db.prepare(`SELECT command_id,authorization_id,bridge_id,status,expires_at,created_at,acknowledged_at FROM ibkrnew_command_outbox WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 50`).all(ownerUserId);
  const approvals = db.prepare(`SELECT authorization_id,expression,bridge_id,expires_at,created_at FROM ibkrnew_authorizations WHERE owner_user_id=? AND status='pending_approval' ORDER BY created_at DESC`).all(ownerUserId);
  const reactions = db.prepare(`SELECT reaction_id,agent_name,subscriptions_json,enabled FROM ibkrnew_reaction_registry WHERE owner_user_id=? ORDER BY agent_name`).all(ownerUserId).map((r) => ({ ...r, subscriptions: parse(r.subscriptions_json, []) }));
  const staleMs = Number(configs.policy.freshness?.bridge_offline_after_ms || 30000); const now = Date.now();
  const goal = reconcileIbkrNewGoal(ownerUserId, { policy: configs.policy, at: nowIso() });
  return { namespace: IBKRNEW_NAMESPACE, environment: 'paper', configs, goal, reactions, approvals, trading_day: day, budgets: { daily_limit_usd: configs.policy.budgets.daily_opening_exposure_usd, daily_used_usd: Number(daily), total_limit_usd: configs.policy.budgets.total_gross_exposure_usd }, bridges: bridges.map((b) => ({ ...b, effective_status: !b.last_seen_at || now - Date.parse(b.last_seen_at) > staleMs ? 'offline' : b.status })), account: account ? { ...withAccountRef(account), positions: parse(account.positions_json, []), open_orders: parse(account.open_orders_json, []) } : null, events, commands };
}

export function getIbkrNewSummary(ownerUserId) {
  const db = getDb(); ensureIbkrNewDefaults(ownerUserId);
  const totals = db.prepare(`SELECT COUNT(*) trade_count,COALESCE(SUM(actual_commission_usd),0) actual_commission_usd,COALESCE(SUM(estimated_round_trip_commission_usd),0) estimated_commission_usd,COALESCE(SUM(gross_pnl_usd),0) gross_pnl_usd,COALESCE(SUM(net_pnl_usd),0) net_pnl_usd,SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) open_trade_count,SUM(CASE WHEN status='closed' AND net_pnl_usd>0 THEN 1 ELSE 0 END) profitable_trade_count FROM ibkrnew_trade_records WHERE owner_user_id=?`).get(ownerUserId);
  const trades = db.prepare(`SELECT * FROM ibkrnew_trade_records WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 200`).all(ownerUserId).map((row) => ({ ...withAccountRef(row), economics: parse(row.economics_json, {}) }));
  const allocations = db.prepare(`SELECT * FROM ibkrnew_allocation_decisions WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 200`).all(ownerUserId).map((row) => ({ ...row, detail: parse(row.detail_json, {}) }));
  const profile = db.prepare(`SELECT data_retention_days FROM platform_users WHERE id=?`).get(ownerUserId);
  return { retention_days: Number(profile?.data_retention_days || 90), goal: getIbkrNewGoalState(ownerUserId), totals: { ...totals, win_rate_pct: Number(totals.trade_count) ? Number(totals.profitable_trade_count || 0) / Number(totals.trade_count) * 100 : 0 }, trades, allocations };
}

export function getIbkrNewLiveOperations(ownerUserId, { limit = 200 } = {}) {
  const db = getDb(); const dashboard = getDashboard(ownerUserId); const n = Math.min(500, Math.max(1, Number(limit) || 200)); const staleMs = Number(dashboard.configs.policy.freshness?.bridge_offline_after_ms || 30000); const now = Date.now();
  const health = db.prepare(`SELECT * FROM ibkrnew_component_health WHERE owner_user_id=? ORDER BY updated_at DESC`).all(ownerUserId).map((row) => ({ ...row, detail: parse(row.detail_json, {}), effective_status: now - Date.parse(row.last_seen_at) > staleMs ? 'offline' : row.status }));
  const errors = db.prepare(`SELECT * FROM ibkrnew_component_errors WHERE owner_user_id=? ORDER BY occurred_at DESC LIMIT ?`).all(ownerUserId, n).map((row) => ({ ...row, detail: parse(row.detail_json, {}) }));
  const snapshots = db.prepare(`SELECT * FROM ibkrnew_position_snapshots WHERE owner_user_id=? ORDER BY captured_at DESC LIMIT ?`).all(ownerUserId, n).map((row) => ({ ...withAccountRef(row), payload: parse(row.payload_json, {}) }));
  const executions = db.prepare(`SELECT * FROM ibkrnew_executions WHERE owner_user_id=? ORDER BY occurred_at DESC LIMIT ?`).all(ownerUserId, n).map(withAccountRef);
  const instrumentProfiles = db.prepare(`SELECT symbol,security_type,fundamentals_at,membership_at,corporate_events_at,updated_at,profile_json FROM ibkrnew_instrument_profiles WHERE owner_user_id=? ORDER BY updated_at DESC LIMIT ?`).all(ownerUserId, n).map((row) => ({ ...row, profile: parse(row.profile_json, {}) }));
  const profile = db.prepare(`SELECT data_retention_days FROM platform_users WHERE id=?`).get(ownerUserId);
  return { generated_at: nowIso(), retention_days: Number(profile?.data_retention_days || 90), health, errors, snapshots, executions, instrument_profiles: instrumentProfiles, dashboard, summary: getIbkrNewSummary(ownerUserId) };
}
