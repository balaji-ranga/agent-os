import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENT_OS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ibkrnew-service-'));
const { initDb, getDb } = await import('../src/db/schema.js'); initDb();
getDb().exec(`CREATE TABLE ibkrnew_bridges (
  bridge_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, account_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment = 'paper'), token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'offline', last_sequence INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT, created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE ibkrnew_execution_modes (
  owner_user_id TEXT PRIMARY KEY, requested_mode TEXT NOT NULL CHECK(requested_mode IN ('paper','live')),
  activation_state TEXT NOT NULL CHECK(activation_state IN ('PAPER_ACTIVE','AWAITING_LIVE_BRIDGE','LIVE_ACTIVE','LIVE_BLOCKED')),
  attested_bridge_id TEXT, attestation_status TEXT, attestation_reason TEXT,
  attested_at TEXT, confirmed_at TEXT, halted_at TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE ibkrnew_circuit_breakers (
  owner_user_id TEXT NOT NULL, breaker_type TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL, created_at TEXT NOT NULL, cleared_at TEXT,
  PRIMARY KEY(owner_user_id,breaker_type)
);
CREATE TABLE ibkrnew_goals (
  goal_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, name TEXT NOT NULL,
  mode TEXT NOT NULL, target_return_pct REAL NOT NULL, duration_days INTEGER NOT NULL,
  duration_basis TEXT NOT NULL, capital_basis TEXT NOT NULL, profit_basis TEXT NOT NULL,
  status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_ibkrnew_goal_owner_open ON ibkrnew_goals(owner_user_id) WHERE status IN ('ACTIVE','PAUSED');
CREATE TABLE ibkrnew_goal_cycles (
  cycle_id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
  cycle_number INTEGER NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, scheduled_end_at TEXT NOT NULL,
  capital_basis_usd REAL NOT NULL, target_profit_usd REAL NOT NULL, net_realized_profit_usd REAL NOT NULL DEFAULT 0,
  achieved_at TEXT, closed_at TEXT, stop_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(goal_id,cycle_number)
);
CREATE TABLE ibkrnew_goal_trade_links (authorization_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, goal_id TEXT NOT NULL, cycle_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE ibkrnew_instrument_profiles (
  owner_user_id TEXT NOT NULL, bridge_id TEXT NOT NULL, symbol TEXT NOT NULL, security_type TEXT NOT NULL,
  profile_json TEXT NOT NULL, fundamentals_at TEXT, membership_at TEXT, corporate_events_at TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY(owner_user_id,symbol,security_type)
);
INSERT INTO ibkrnew_execution_modes(owner_user_id,requested_mode,activation_state,updated_at) VALUES('IBKRNewOwner_SchemaMigration','live','LIVE_ACTIVE','2026-10-01T00:00:00.000Z');
INSERT INTO ibkrnew_circuit_breakers(owner_user_id,breaker_type,active,reason,created_at) VALUES('IBKRNewOwner_SchemaMigration','legacy_test',1,'legacy breaker','2026-10-01T00:00:00.000Z');
INSERT INTO ibkrnew_goals(goal_id,owner_user_id,name,mode,target_return_pct,duration_days,duration_basis,capital_basis,profit_basis,status,created_at,updated_at) VALUES('IBKRNewGoal_Legacy','IBKRNewOwner_SchemaMigration','Legacy paper goal','PERPETUAL',5,30,'CALENDAR_DAYS','CYCLE_START_ELIGIBLE_CAPITAL_CAPPED_BY_TOTAL_BUDGET','NET_REALIZED_AFTER_COMMISSIONS','ACTIVE','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');
`);
const legacyTableCountBefore = getDb().prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'ibkr\\_%' ESCAPE '\\'").get().count;
const blueprints = await import('../src/services/ibkrnew-blueprints.js');
const service = await import('../src/services/ibkrnew-event-trader.js');
const { buildIbkrNewEventBridgePackageZip } = await import('../src/services/ibkrnew-event-bridge-package.js');
const { extractZipEntryBySuffix } = await import('../src/services/zip-store.js');

const owner = 'IBKRNewOwner_A'; const other = 'IBKRNewOwner_B';
const blueprintStatus = blueprints.validateIbkrNewBlueprints();
assert.deepEqual(blueprintStatus.config_kinds, ['policy', 'strategy', 'strategy_skill', 'universe', 'market_data']);
assert.equal(blueprintStatus.workflows, 6); assert.equal(blueprintStatus.agent_templates, 6);
const workflowBlueprints = blueprints.getIbkrNewWorkflowBlueprints();
const agentTemplates = blueprints.getIbkrNewAgentTemplateBlueprints();
assert.deepEqual(new Set(workflowBlueprints.map((workflow) => workflow.agent_name)), new Set(agentTemplates.map((template) => template.agent_name)));
for (const template of agentTemplates) {
  const templateDir = join(process.cwd(), '..', 'openclaw-workspace-templates', template.template_base_id);
  for (const filename of ['AGENTS.md', 'SOUL.md', 'TOOLS.md', '.template-source.json']) assert.equal(existsSync(join(templateDir, filename)), true, `${template.agent_name} must ship ${filename}`);
  assert.equal(JSON.parse(readFileSync(join(templateDir, '.template-source.json'), 'utf8')).template_id, template.agent_name);
}
const strategySkillLocations = [
  join(process.cwd(), '..', '.cursor', 'skills', 'ibkrnew-trade-strategy', 'SKILL.md'),
  join(process.cwd(), '..', 'openclaw-skills', 'ibkrnew-trade-strategy', 'SKILL.md'),
];
assert.equal(strategySkillLocations.some((path) => existsSync(path)), true, 'the strategy skill must exist at its canonical source path or packaged OpenClaw runtime path');
const mutableBlueprint = blueprints.getIbkrNewConfigBlueprint('policy'); mutableBlueprint.budgets.daily_opening_exposure_usd = 1;
assert.equal(blueprints.getIbkrNewConfigBlueprint('policy').budgets.daily_opening_exposure_usd, 1000, 'blueprint consumers receive isolated copies');
const configs = service.ensureIbkrNewDefaults(owner);
assert.match(getDb().prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ibkrnew_bridges'`).get().sql, /environment IN \('paper','live'\)/, 'paper-only bridge table is migrated in place before live registration');
assert.equal(getDb().prepare(`SELECT activation_state FROM ibkrnew_execution_modes WHERE owner_user_id='IBKRNewOwner_SchemaMigration'`).get().activation_state, 'ACTIVE', 'legacy Live-specific execution state is migrated to the generic state machine');
assert.equal(getDb().prepare(`SELECT environment FROM ibkrnew_circuit_breakers WHERE owner_user_id='IBKRNewOwner_SchemaMigration'`).get().environment, 'live', 'legacy circuit breakers are attached to their selected account context');
assert.equal(getDb().prepare(`SELECT environment FROM ibkrnew_goals WHERE goal_id='IBKRNewGoal_Legacy'`).get().environment, 'paper', 'legacy goals remain in the Paper context');
assert.equal(configs.policy.budgets.daily_opening_exposure_usd, 1000);
assert.equal(configs.policy.budgets.total_gross_exposure_usd, 10000);
assert.equal(configs.strategy_skill.agent_name, 'IBKRNewStrategyPlanner');
assert.match(configs.strategy_skill.skill_path, /ibkrnew-trade-strategy/);
assert.equal(configs.strategy.goal_binding.selector, 'ACTIVE_IBKRNEW_GOAL');
assert.equal(configs.policy.schema_version, 3); assert.equal(configs.policy.environment, 'shared'); assert.equal(configs.policy.feature_switches.execution_enabled, true); assert.equal(configs.policy.feature_switches.live_execution_enabled, undefined); assert.equal(configs.market_data.schema_version, 1);
assert.equal(service.getIbkrNewGoalState(owner).block_reason, 'goal_waiting_for_capital');
const initialPaperGoal = service.getIbkrNewGoalState(owner, { environment: 'paper' });
const initialLiveGoal = service.getIbkrNewGoalState(owner, { environment: 'live' });
assert.notEqual(initialPaperGoal.definition.goal_id, initialLiveGoal.definition.goal_id, 'paper and live start with distinct goal records');
assert.equal(initialPaperGoal.definition.environment, 'paper'); assert.equal(initialLiveGoal.definition.environment, 'live');
assert.throws(() => service.publishConfig(owner, 'strategy', { ...configs.strategy, name: 'DU1234567' }), /not accepted in server-side configuration/);
assert.throws(() => service.publishConfig(owner, 'strategy', { ...configs.strategy, schema_version: 999 }), /schema_version must be 2/);
assert.throws(() => service.publishConfig(owner, 'policy', { ...configs.policy, commissions: { ...configs.policy.commissions, maximum_round_trip_commission_pct_of_expected_gross_profit: 101 } }), /between 0 and 100/);
assert.ok(service.getDashboard(owner).reactions.every((x) => x.agent_name.startsWith('IBKRNew')));
assert.deepEqual(service.getDashboard(owner).reactions.map((reaction) => reaction.agent_name).sort(), workflowBlueprints.map((workflow) => workflow.agent_name).sort());

const strategySaveOwner = 'IBKRNewOwner_StrategySave';
const strategySaveDefaults = service.ensureIbkrNewDefaults(strategySaveOwner);
const strategyDocument = structuredClone(strategySaveDefaults.strategy); delete strategyDocument.id; delete strategyDocument.version; delete strategyDocument.status; strategyDocument.name = 'IBKRNew Saved Strategy Test';
const savedStrategy = service.publishConfig(strategySaveOwner, 'strategy', strategyDocument);
assert.equal(savedStrategy.version, 2); assert.equal(savedStrategy.name, 'IBKRNew Saved Strategy Test');
const savedStrategyRows = getDb().prepare(`SELECT version,status,document_json FROM ibkrnew_config_versions WHERE owner_user_id=? AND kind='strategy' ORDER BY version`).all(strategySaveOwner);
assert.deepEqual(savedStrategyRows.map((row) => [row.version, row.status]), [[1, 'retired'], [2, 'published']], 'UI strategy publish persists immutable database versions');
assert.equal(JSON.parse(savedStrategyRows[1].document_json).name, 'IBKRNew Saved Strategy Test');
assert.equal(service.getPublishedConfig(other, 'strategy'), null, 'another owner cannot read the saved strategy');
assert.throws(() => service.publishConfig(owner, 'policy', { ...configs.policy, environment: 'live' }), /policy environment/);
const legacyUniverseOwner = 'IBKRNewOwner_LegacyUniverse'; const legacyAt = new Date().toISOString();
getDb().prepare(`INSERT INTO ibkrnew_config_versions(id,owner_user_id,kind,version,status,document_json,created_at,published_at) VALUES(?,?,?,?,?,?,?,?)`).run('IBKRNewUniverse_legacy', legacyUniverseOwner, 'universe', 1, 'published', JSON.stringify({ name: 'Legacy custom universe', allowlist: [], denylist: [], maximum_active_subscriptions: 25, filters: { country: ['US'], security_types: ['STK', 'ETF'], minimum_price_usd: 25, maximum_price_usd: 250, minimum_average_daily_volume: 3000000, maximum_spread_pct: 0.15, require_shortable_for_short: true } }), legacyAt, legacyAt);
const migratedUniverse = service.ensureIbkrNewDefaults(legacyUniverseOwner).universe;
assert.equal(migratedUniverse.schema_version, 2); assert.equal(migratedUniverse.filters.stock.minimum_price_usd, 25); assert.equal(migratedUniverse.filters.etf.maximum_spread_pct, 0.15);
const legacyPolicyOwner = 'IBKRNewOwner_LegacyPolicy'; const legacyPolicy = structuredClone(configs.policy);
delete legacyPolicy.id; delete legacyPolicy.version; delete legacyPolicy.status; legacyPolicy.schema_version = 2; delete legacyPolicy.feature_switches.execution_enabled; legacyPolicy.feature_switches.paper_execution_enabled = true; legacyPolicy.feature_switches.live_execution_enabled = false;
getDb().prepare(`INSERT INTO ibkrnew_config_versions(id,owner_user_id,kind,version,status,document_json,created_at,published_at) VALUES(?,?,?,?,?,?,?,?)`).run('IBKRNewPolicy_legacy', legacyPolicyOwner, 'policy', 1, 'published', JSON.stringify(legacyPolicy), legacyAt, legacyAt);
const migratedPolicy = service.ensureIbkrNewDefaults(legacyPolicyOwner).policy;
assert.equal(migratedPolicy.schema_version, 3); assert.equal(migratedPolicy.feature_switches.execution_enabled, true); assert.equal(migratedPolicy.feature_switches.paper_execution_enabled, undefined); assert.equal(migratedPolicy.feature_switches.live_execution_enabled, undefined);

assert.throws(() => service.registerBridge(owner, 'DU1234567'), /must remain in the desktop bridge only/);
const credentials = service.registerBridge(owner);
assert.match(credentials.account_ref, /^IBKRNewAccount_/); assert.equal(credentials.account_id, undefined);
const bridge = service.authenticateBridge(credentials.bridge_id, credentials.token);
assert.equal(bridge.owner_user_id, owner); assert.equal(service.authenticateBridge(credentials.bridge_id, 'wrong'), null);
assert.match(bridge.account_id, /^IBKRNewAccount_/);
assert.equal(service.getDashboard(owner).bridges[0].account_id, undefined);
assert.equal(service.getDashboard(owner).bridges[0].account_ref, credentials.account_ref);
assert.equal(service.getDashboard(other).events.length, 0);

const sequenceRepairOwner = 'IBKRNewOwner_SequenceRepair';
const sequenceRepairCredentials = service.registerBridge(sequenceRepairOwner);
const sequenceRepairBridge = service.authenticateBridge(sequenceRepairCredentials.bridge_id, sequenceRepairCredentials.token);
service.ingestBridgeEvent(sequenceRepairBridge, { event_id: 'sequence-repair-1', sequence: 1, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: false } });
getDb().prepare(`UPDATE ibkrnew_bridges SET last_sequence=0 WHERE bridge_id=?`).run(sequenceRepairBridge.bridge_id);
assert.equal(service.reconcileIbkrNewBridgeSequence(sequenceRepairBridge.bridge_id), 1, 'bootstrap must repair a cursor that fell behind an accepted event during a backend restart');
assert.equal(getDb().prepare(`SELECT last_sequence FROM ibkrnew_bridges WHERE bridge_id=?`).get(sequenceRepairBridge.bridge_id).last_sequence, 1);
assert.equal(service.ingestBridgeEvent(sequenceRepairBridge, { event_id: 'sequence-repair-2', sequence: 2, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: false } }).accepted, true);

const notAttestedOwner = 'IBKRNewOwner_NotAttested'; const notAttestedCredentials = service.registerBridge(notAttestedOwner); const notAttestedBridge = service.authenticateBridge(notAttestedCredentials.bridge_id, notAttestedCredentials.token);
service.ingestBridgeEvent(notAttestedBridge, { event_id: 'not-attested-1', sequence: 1, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
const notAttestedSignal = service.ingestBridgeEvent(notAttestedBridge, { event_id: 'not-attested-2', sequence: 2, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'AAPL', security_type: 'STK', quantity: 1, bid: 99.9, ask: 100, last: 100, limit_price: 100, average_daily_volume: 5000000, quote_at: new Date().toISOString(), planned_loss_usd: 5, protection: { stop_price: 95, targets: [{ limit_price: 112, quantity: 1 }] } } });
assert.equal(notAttestedSignal.reaction.reason, 'account_context_not_attested', 'neither Paper nor Live may process an opening order before account attestation');

const liveModeOwner = 'IBKRNewOwner_LiveMode';
assert.equal(service.getIbkrNewExecutionMode(liveModeOwner).requested_mode, 'paper');
const liveCredentials = service.registerBridge(liveModeOwner, null, 'live'); const liveBridge = service.authenticateBridge(liveCredentials.bridge_id, liveCredentials.token);
assert.equal(liveCredentials.environment, 'live');
assert.equal(service.setIbkrNewExecutionMode(liveModeOwner, { mode: 'live' }).activation_state, 'AWAITING_BRIDGE');
service.ingestBridgeEvent(liveBridge, { event_id: 'live-attestation-1', sequence: 1, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: true, account_attestation: { status: 'verified', environment: 'live', execution_ready: true } } });
assert.equal(service.getIbkrNewExecutionMode(liveModeOwner).activation_state, 'ACTIVE');
assert.equal(service.getIbkrNewExecutionMode(liveModeOwner).active_mode, 'live');
service.ingestBridgeEvent(liveBridge, { event_id: 'live-account-2', sequence: 2, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
const liveGoalBeforeTrade = service.setIbkrNewGoal(liveModeOwner, { environment: 'live', name: 'Live account objective', mode: 'PERPETUAL', target_return_pct: 3, duration_days: 20 });
const paperGoalBeforeSwitch = service.getIbkrNewGoalState(liveModeOwner, { environment: 'paper' });
assert.equal(liveGoalBeforeTrade.definition.environment, 'live'); assert.equal(liveGoalBeforeTrade.definition.name, 'Live account objective');
assert.equal(paperGoalBeforeSwitch.block_reason, 'goal_waiting_for_capital');
assert.notEqual(liveGoalBeforeTrade.definition.goal_id, paperGoalBeforeSwitch.definition.goal_id);
service.ingestBridgeEvent(liveBridge, { event_id: 'live-profile-3', sequence: 3, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: { symbol: 'AAPL', security_type: 'STK', average_daily_volume: 5000000, index_memberships: ['SPX'], fundamentals: { market_cap_usd: 3000000000000, revenue_ttm_usd: 300000000000, debt_to_equity: 1.5, operating_cash_flow_ttm_usd: 100000000000, sector: 'TECHNOLOGY' }, corporate_events: [] } });
const liveSignal = service.ingestBridgeEvent(liveBridge, { event_id: 'live-signal-4', sequence: 4, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'AAPL', security_type: 'STK', quantity: 1, bid: 99.9, ask: 100, last: 100, limit_price: 100, average_daily_volume: 5000000, quote_at: new Date().toISOString(), planned_loss_usd: 5, protection: { stop_price: 95, targets: [{ limit_price: 112, quantity: 1 }] } } });
assert.equal(liveSignal.reaction.decision, 'authorized');
const liveCommands = service.claimCommands(liveBridge, 10, 2); assert.equal(liveCommands.length, 1); assert.equal(liveCommands[0].authorization.environment, 'live');
service.ingestBridgeEvent(liveBridge, { event_id: 'live-position-5', sequence: 5, event_type: 'position.changed', occurred_at: new Date().toISOString(), payload: { positions: [{ symbol: 'AAPL', security_type: 'STK', quantity: 1, market_price: 100 }] } });
assert.equal(service.getIbkrNewEventTimeline(liveModeOwner).environment, 'live');
assert.equal(service.getIbkrNewEventTimeline(liveModeOwner).pagination.total_items, 5, 'the active live timeline is isolated from paper events');
assert.equal(service.getIbkrNewExecutionMode(other).requested_mode, 'paper', 'execution mode is owner scoped');
const returnedToPaper = service.setIbkrNewExecutionMode(liveModeOwner, { mode: 'paper' }); assert.equal(returnedToPaper.requested_mode, 'paper'); assert.equal(returnedToPaper.cancelled_authorizations, 1);
assert.equal(getDb().prepare(`SELECT status FROM ibkrnew_command_outbox WHERE command_id=?`).get(liveCommands[0].command_id).status, 'cancelled');
assert.equal(getDb().prepare(`SELECT status FROM ibkrnew_budget_reservations WHERE authorization_id=?`).get(liveSignal.reaction.authorization_id).status, 'released');
assert.equal(service.getIbkrNewEventTimeline(liveModeOwner).environment, 'paper');
assert.equal(service.getIbkrNewEventTimeline(liveModeOwner).pagination.total_items, 0, 'switching to paper does not mix live history into the paper timeline');
assert.equal(service.getIbkrNewEventTimeline(liveModeOwner, { environment: 'live' }).pagination.total_items, 5, 'live history remains available through an explicit mode filter');
const paperGoalAfterSwitch = service.setIbkrNewGoal(liveModeOwner, { environment: 'paper', name: 'Paper account objective', mode: 'PERPETUAL', target_return_pct: 5, duration_days: 30 });
assert.equal(paperGoalAfterSwitch.definition.name, 'Paper account objective');
assert.equal(service.getIbkrNewGoalState(liveModeOwner, { environment: 'live' }).definition.goal_id, liveGoalBeforeTrade.definition.goal_id, 'switching and changing the paper goal does not replace the live goal');
assert.ok(service.getIbkrNewGoalHistory(liveModeOwner, { environment: 'paper' }).every((goal) => goal.environment === 'paper'), 'paper goal history is context scoped');
assert.ok(service.getIbkrNewGoalHistory(liveModeOwner, { environment: 'live' }).every((goal) => goal.environment === 'live'), 'live goal history is context scoped');
assert.equal(service.getIbkrNewGoalState(liveModeOwner, { environment: 'live' }).definition.name, 'Live account objective');
assert.equal(service.getDashboard(liveModeOwner).inactive_live_account.positions[0].symbol, 'AAPL', 'returning to paper keeps residual live exposure visible for reconciliation');
const blockedLiveOwner = 'IBKRNewOwner_BlockedLive'; const blockedLiveCredentials = service.registerBridge(blockedLiveOwner, null, 'live'); const blockedLiveBridge = service.authenticateBridge(blockedLiveCredentials.bridge_id, blockedLiveCredentials.token);
service.setIbkrNewExecutionMode(blockedLiveOwner, { mode: 'live' });
service.ingestBridgeEvent(blockedLiveBridge, { event_id: 'blocked-live-1', sequence: 1, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: true, account_attestation: { status: 'failed', environment: 'live', execution_ready: false, reason_code: 'ACCOUNT_ENVIRONMENT_MISMATCH' } } });
assert.equal(service.getIbkrNewExecutionMode(blockedLiveOwner).activation_state, 'BLOCKED');
assert.equal(service.getIbkrNewExecutionMode(blockedLiveOwner).execution_enabled, false);
const contextOwner = 'IBKRNewOwner_ContextIsolation';
const contextLiveCredentials = service.registerBridge(contextOwner, null, 'live'); const contextLiveBridge = service.authenticateBridge(contextLiveCredentials.bridge_id, contextLiveCredentials.token);
service.setIbkrNewExecutionMode(contextOwner, { mode: 'live' });
service.ingestBridgeEvent(contextLiveBridge, { event_id: 'context-live-1', sequence: 1, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: true, account_attestation: { status: 'verified', environment: 'live', execution_ready: true } } });
service.ingestBridgeEvent(contextLiveBridge, { event_id: 'context-live-2', sequence: 2, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
service.ingestBridgeEvent(contextLiveBridge, { event_id: 'context-live-3', sequence: 3, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: { symbol: 'AAPL', security_type: 'STK', average_daily_volume: 5000000, index_memberships: ['SPX'], fundamentals: { market_cap_usd: 3000000000000, revenue_ttm_usd: 300000000000, debt_to_equity: 1.5, operating_cash_flow_ttm_usd: 100000000000, sector: 'TECHNOLOGY' }, corporate_events: [] } });
const contextLiveSignal = service.ingestBridgeEvent(contextLiveBridge, { event_id: 'context-live-4', sequence: 4, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'AAPL', security_type: 'STK', quantity: 1, bid: 99.9, ask: 100, last: 100, limit_price: 100, average_daily_volume: 5000000, quote_at: new Date().toISOString(), planned_loss_usd: 5, protection: { stop_price: 95, targets: [{ limit_price: 112, quantity: 1 }] } } });
assert.equal(contextLiveSignal.reaction.decision, 'authorized');
getDb().prepare(`UPDATE ibkrnew_authorizations SET status='filled' WHERE authorization_id=?`).run(contextLiveSignal.reaction.authorization_id);
getDb().prepare(`UPDATE ibkrnew_command_outbox SET status='filled' WHERE authorization_id=?`).run(contextLiveSignal.reaction.authorization_id);
getDb().prepare(`UPDATE ibkrnew_budget_reservations SET status='filled',gross_released_usd=0 WHERE authorization_id=?`).run(contextLiveSignal.reaction.authorization_id);
getDb().prepare(`INSERT INTO ibkrnew_circuit_breakers(owner_user_id,environment,breaker_type,active,reason,created_at) VALUES(?,?,'test_live_only',1,'test isolation',?)`).run(contextOwner, 'live', new Date().toISOString());
service.setIbkrNewExecutionMode(contextOwner, { mode: 'paper' });
const contextPaperCredentials = service.registerBridge(contextOwner, null, 'paper'); const contextPaperBridge = service.authenticateBridge(contextPaperCredentials.bridge_id, contextPaperCredentials.token);
service.ingestBridgeEvent(contextPaperBridge, { event_id: 'context-paper-1', sequence: 1, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: true, account_attestation: { status: 'verified', environment: 'paper', execution_ready: true } } });
service.ingestBridgeEvent(contextPaperBridge, { event_id: 'context-paper-2', sequence: 2, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 9900, positions: [{ symbol: 'AAPL', security_type: 'STK', quantity: 1, market_price: 100 }], open_orders: [] } });
assert.equal(getDb().prepare(`SELECT gross_released_usd FROM ibkrnew_budget_reservations WHERE authorization_id=?`).get(contextLiveSignal.reaction.authorization_id).gross_released_usd, 0, 'a Paper position snapshot cannot reconcile a Live reservation');
service.ingestBridgeEvent(contextPaperBridge, { event_id: 'context-paper-3', sequence: 3, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: { symbol: 'MSFT', security_type: 'STK', average_daily_volume: 5000000, index_memberships: ['SPX'], fundamentals: { market_cap_usd: 3000000000000, revenue_ttm_usd: 300000000000, debt_to_equity: 1.5, operating_cash_flow_ttm_usd: 100000000000, sector: 'TECHNOLOGY' }, corporate_events: [] } });
const contextPaperSignal = service.ingestBridgeEvent(contextPaperBridge, { event_id: 'context-paper-4', sequence: 4, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'MSFT', security_type: 'STK', quantity: 1, bid: 99.9, ask: 100, last: 100, limit_price: 100, average_daily_volume: 5000000, quote_at: new Date().toISOString(), planned_loss_usd: 5, protection: { stop_price: 95, targets: [{ limit_price: 112, quantity: 1 }] } } });
assert.equal(contextPaperSignal.reaction.decision, 'authorized', 'a Live circuit breaker cannot block the Paper account context');
assert.throws(() => service.ingestBridgeEvent(contextPaperBridge, { event_id: 'context-paper-spoof-5', sequence: 5, event_type: 'execution.fill', occurred_at: new Date().toISOString(), payload: { authorization_id: contextLiveSignal.reaction.authorization_id, execution_id: 'cross-context-spoof', order_role: 'entry', side: 'BUY', quantity: 1, price: 100 } }), /does not belong to this bridge account context/);
assert.equal(getDb().prepare(`SELECT 1 FROM ibkrnew_events WHERE bridge_id=? AND source_event_id='context-paper-spoof-5'`).get(contextPaperBridge.bridge_id), undefined, 'a cross-context broker callback is rejected before persistence');
const packageOwner = 'IBKRNewOwner_Package';
const packaged = await buildIbkrNewEventBridgePackageZip({ ownerUserId: packageOwner, includeRuntime: false, baseUrlOverride: 'https://flolah.example' });
const packageEnv = extractZipEntryBySuffix(packaged.zip, '.env').toString('utf8');
const packageMetaText = extractZipEntryBySuffix(packaged.zip, 'bridge.meta.json').toString('utf8');
const packageMeta = JSON.parse(packageMetaText);
const packageToken = packageEnv.match(/^IBKRNEW_BRIDGE_TOKEN=(.+)$/m)?.[1];
assert.equal(packaged.filename, 'IBKRNewBridge-paper-lite.zip');
assert.match(packageEnv, /^IBKRNEW_API_URL=https:\/\/flolah\.example\/api\/ibkrnew-event-trader$/m);
assert.match(packageEnv, /^IBKRNEW_ACCOUNT_ID=$/m, 'real IBKR account remains desktop-only and blank');
assert.match(packageEnv, /^IBKRNEW_ACCOUNT_SNAPSHOT_INTERVAL_MS=15000$/m);
assert.match(packageEnv, /^IBKRNEW_TRADING_MODE=paper$/m);
assert.match(packageEnv, /^IBKRNEW_EXECUTION_ENABLED=0$/m);
assert.match(packageEnv, /^IBKRNEW_HTTP_TIMEOUT_MS=15000$/m);
assert.match(packageEnv, /^IBKRNEW_STALL_TIMEOUT_MS=120000$/m);
assert.match(packageEnv, /^IBKRNEW_WATCHDOG_INTERVAL_MS=10000$/m);
assert.ok(packageToken?.startsWith('ibkrnew_'));
assert.doesNotMatch(packageMetaText, new RegExp(packageToken));
assert.equal(packageMeta.bridge_id, packaged.bridge_id);
assert.equal(packageMeta.dependencies_included, false);
assert.ok(extractZipEntryBySuffix(packaged.zip, 'scripts/Start-IBKRNewBridge.ps1'));
assert.ok(extractZipEntryBySuffix(packaged.zip, 'scripts/Test-IBKRNewBridge.ps1'));
assert.ok(service.authenticateBridge(packaged.bridge_id, packageToken));
assert.equal(service.getDashboard(packageOwner).bridges.length, 1);
assert.equal(service.getDashboard(other).bridges.some((row) => row.bridge_id === packaged.bridge_id), false, 'package bridge stays owner scoped');
const packagedLive = await buildIbkrNewEventBridgePackageZip({ ownerUserId: packageOwner, includeRuntime: false, baseUrlOverride: 'https://flolah.example', environment: 'live' });
const livePackageEnv = extractZipEntryBySuffix(packagedLive.zip, '.env').toString('utf8');
assert.equal(packagedLive.filename, 'IBKRNewBridge-live-lite.zip');
assert.match(livePackageEnv, /^IBKRNEW_TRADING_MODE=live$/m);
assert.match(livePackageEnv, /^IBKRNEW_GATEWAY_PORT=4001$/m);
assert.match(livePackageEnv, /^IBKRNEW_EXECUTION_ENABLED=0$/m);
assert.doesNotMatch(livePackageEnv, /^IBKRNEW_(?:PAPER|LIVE)_EXECUTION_ENABLED=/m);
assert.equal(service.authenticateBridge(packagedLive.bridge_id, livePackageEnv.match(/^IBKRNEW_BRIDGE_TOKEN=(.+)$/m)?.[1]).environment, 'live');
const privacySentinel = 'DU1234567';
assert.throws(() => service.ingestBridgeEvent(bridge, { event_id: privacySentinel, sequence: 1, event_type: 'bridge.heartbeat', payload: {} }), /not accepted in event metadata/);
service.ingestBridgeEvent(bridge, { event_id: 'desktop-1', sequence: 1, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { account_id: privacySentinel, eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [], nested: [{ acctCode: privacySentinel, note: `broker ${privacySentinel} snapshot` }] } });
const defaultGoal = service.getIbkrNewGoalState(owner); assert.equal(defaultGoal.opening_trades_allowed, true); assert.equal(defaultGoal.cycle.capital_basis_usd, 10000); assert.equal(defaultGoal.cycle.target_profit_usd, 500);
const persistedSnapshot = getDb().prepare(`SELECT payload_json FROM ibkrnew_events WHERE bridge_id=? AND source_event_id='desktop-1'`).get(bridge.bridge_id);
assert.doesNotMatch(persistedSnapshot.payload_json, /DU1234567|acctCode|account_id/);
assert.match(persistedSnapshot.payload_json, /REDACTED_IBKR_ACCOUNT/);
assert.equal(service.ingestBridgeEvent(bridge, { event_id: 'desktop-1', sequence: 1, event_type: 'account.snapshot', payload: {} }).duplicate, true);
const healthyStockProfile = (symbol, extra = {}) => ({ symbol, security_type: 'STK', average_daily_volume: 5000000, index_memberships: ['SPX'], fundamentals: { market_cap_usd: 3000000000000, revenue_ttm_usd: 300000000000, debt_to_equity: 1.5, operating_cash_flow_ttm_usd: 100000000000, sector: 'TECHNOLOGY' }, corporate_events: [], ...extra });
service.ingestBridgeEvent(bridge, { event_id: 'desktop-profile-1', sequence: 2, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: healthyStockProfile('AAPL') });
service.ingestBridgeEvent(bridge, { event_id: 'desktop-attestation-3', sequence: 3, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: true, account_attestation: { status: 'verified', environment: 'paper', execution_ready: true } } });

const signal = (eventId, sequence, extra = {}) => service.ingestBridgeEvent(bridge, { event_id: eventId, sequence, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'AAPL', security_type: 'STK', quantity: 2, bid: 99.9, ask: 100, last: 100, limit_price: 100, average_daily_volume: 5000000, quote_at: new Date().toISOString(), planned_loss_usd: 20, protection: { stop_price: 95, targets: [{ limit_price: 110, quantity: 2 }] }, ...extra } });
const first = signal('desktop-4', 4); assert.equal(first.reaction.decision, 'authorized');
assert.ok(first.reaction.reserved_usd > 200, 'opening reservation includes estimated commissions');
assert.ok(first.reaction.economics.estimated_round_trip_commission_usd > 0);
assert.ok(first.reaction.economics.expected_net_profit_usd < first.reaction.economics.expected_gross_profit_usd);
assert.ok(first.reaction.economics.required_profitable_exit_price > 100);
assert.throws(() => service.claimCommands(bridge), /protocol version 2/);
const commands = service.claimCommands(bridge, 10, 2); assert.equal(commands.length, 1); assert.ok(commands[0].command_id.startsWith('IBKRNew'));
const cleanAck = service.acknowledgeCommand(bridge, commands[0].command_id, 'rejected', { account_id: privacySentinel, error: `Account ${privacySentinel} rejected` });
assert.equal(cleanAck.detail.account_id, undefined); assert.match(cleanAck.detail.error, /REDACTED_IBKR_ACCOUNT/); assert.doesNotMatch(JSON.stringify(cleanAck), /DU1234567/);
assert.equal(service.getDashboard(owner).budgets.daily_used_usd, 0);
const gap = service.ingestBridgeEvent(bridge, { event_id: 'desktop-gap', sequence: 6, event_type: 'bridge.heartbeat', payload: {} }); assert.equal(gap.status, 'quarantined'); assert.match(gap.reason, /expected_5/);
const option = signal('desktop-5', 5, { expression: 'LONG_CALL', quantity: 1, limit_price: 2, bid: 1.95, ask: 2, underlying_price: 100, underlying_average_daily_volume: 5000000, underlying_spread_pct: 0.1, multiplier: 100, dte: 30, open_interest: 1000, daily_volume: 100, delta: 0.6, protection: { stop_price: 1.5, targets: [{ limit_price: 3, quantity: 1 }] } });
assert.equal(option.reaction.decision, 'authorized');
assert.ok(option.reaction.reserved_usd > 200, 'option premium applies 100x multiplier and includes commission');
assert.equal(service.ingestBridgeEvent(bridge, { event_id: 'desktop-gap', sequence: 6, event_type: 'bridge.heartbeat', payload: {} }).status, 'accepted');

const policy = structuredClone(service.getPublishedConfig(owner, 'policy'));
delete policy.id; delete policy.version; delete policy.status; policy.feature_switches.short_stock_enabled = false;
service.publishConfig(owner, 'policy', policy);
const short = service.ingestBridgeEvent(bridge, { event_id: 'desktop-7', sequence: 7, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'SHORT_STOCK', symbol: 'TSLA', quantity: 1, last: 200, ask: 200, limit_price: 200, average_daily_volume: 5000000, quote_at: new Date().toISOString(), shortable: true, planned_loss_usd: 20, protection: { stop_price: 210 } } });
assert.equal(short.reaction.reason, 'short_stock_enabled_disabled');
const stale = signal('desktop-8', 8, { quote_at: new Date(Date.now() - 60000).toISOString() }); assert.equal(stale.reaction.reason, 'stale_quote');
let sequence = 9; let capacityBlock = null;
for (; sequence <= 20; sequence++) {
  const result = signal(`desktop-${sequence}`, sequence).reaction;
  if (result.decision === 'blocked') { capacityBlock = result; break; }
  assert.equal(result.decision, 'authorized');
}
assert.ok(capacityBlock, 'allocation eventually reaches the daily capacity');
assert.ok(['daily_budget_exceeded', 'allocation_capacity_too_small', 'commission_drag_excessive'].includes(capacityBlock.reason), `unexpected capacity block: ${capacityBlock.reason}`);
assert.ok(service.getDashboard(owner).budgets.daily_used_usd <= 1000, 'commission-aware reservations never exceed daily opening budget');

const eligibilityOwner = 'IBKRNewOwner_Eligibility'; const eligibilityDefaults = service.ensureIbkrNewDefaults(eligibilityOwner);
const eligibilityUniverse = structuredClone(eligibilityDefaults.universe); delete eligibilityUniverse.id; delete eligibilityUniverse.version; delete eligibilityUniverse.status;
eligibilityUniverse.filters.stock.indexes = ['NDX']; eligibilityUniverse.filters.etf.categories = ['EQUITY'];
service.publishConfig(eligibilityOwner, 'universe', eligibilityUniverse);
const eligibilityCredentials = service.registerBridge(eligibilityOwner); const eligibilityBridge = service.authenticateBridge(eligibilityCredentials.bridge_id, eligibilityCredentials.token);
service.ingestBridgeEvent(eligibilityBridge, { event_id: 'eligibility-1', sequence: 1, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
service.ingestBridgeEvent(eligibilityBridge, { event_id: 'eligibility-2', sequence: 2, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: healthyStockProfile('AAPL', { index_memberships: ['SPX'] }) });
service.ingestBridgeEvent(eligibilityBridge, { event_id: 'eligibility-attestation-3', sequence: 3, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: true, account_attestation: { status: 'verified', environment: 'paper', execution_ready: true } } });
const eligibilitySignal = (eventId, sequence, symbol, extra = {}) => service.ingestBridgeEvent(eligibilityBridge, { event_id: eventId, sequence, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol, security_type: 'STK', quantity: 1, bid: 99.9, ask: 100, last: 100, limit_price: 100, average_daily_volume: 5000000, quote_at: new Date().toISOString(), planned_loss_usd: 5, protection: { stop_price: 95, targets: [{ limit_price: 112, quantity: 1 }] }, ...extra } });
assert.equal(eligibilitySignal('eligibility-4', 4, 'AAPL').reaction.reason, 'outside_configured_stock_indexes');
service.ingestBridgeEvent(eligibilityBridge, { event_id: 'eligibility-5', sequence: 5, event_type: 'instrument.membership_refreshed', occurred_at: new Date().toISOString(), payload: { symbol: 'AAPL', security_type: 'STK', index_memberships: ['SPX', 'NDX'] } });
assert.equal(eligibilitySignal('eligibility-6', 6, 'AAPL').reaction.decision, 'authorized');
service.ingestBridgeEvent(eligibilityBridge, { event_id: 'eligibility-7', sequence: 7, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: { symbol: 'NOFUND', security_type: 'STK', average_daily_volume: 5000000, index_memberships: ['NDX'], corporate_events: [] } });
assert.equal(eligibilitySignal('eligibility-8', 8, 'NOFUND').reaction.reason, 'fundamentals_missing');
service.ingestBridgeEvent(eligibilityBridge, { event_id: 'eligibility-9', sequence: 9, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: { symbol: 'SPY', security_type: 'ETF', average_daily_volume: 50000000, assets_under_management_usd: 500000000000, etf_categories: ['EQUITY', 'INDEX'] } });
assert.equal(eligibilitySignal('eligibility-10', 10, 'SPY', { security_type: 'ETF' }).reaction.decision, 'authorized');
service.ingestBridgeEvent(eligibilityBridge, { event_id: 'eligibility-11', sequence: 11, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: healthyStockProfile('MSFT', { index_memberships: ['NDX'], corporate_events: [{ type: 'earnings', at: new Date(Date.now() + 86400000).toISOString() }] }) });
assert.equal(eligibilitySignal('eligibility-12', 12, 'MSFT').reaction.reason, 'earnings_blackout_active');

const approvalOwner = 'IBKRNewOwner_Approval'; const approvalDefaults = service.ensureIbkrNewDefaults(approvalOwner);
const approvalPolicy = structuredClone(approvalDefaults.policy); delete approvalPolicy.id; delete approvalPolicy.version; delete approvalPolicy.status; approvalPolicy.feature_switches.ceo_approval_required = true;
service.publishConfig(approvalOwner, 'policy', approvalPolicy, { confirmRiskLoosening: true });
const approvalCredentials = service.registerBridge(approvalOwner); const approvalBridge = service.authenticateBridge(approvalCredentials.bridge_id, approvalCredentials.token);
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-1', sequence: 1, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-profile-2', sequence: 2, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: healthyStockProfile('MSFT') });
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-3', sequence: 3, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: true, bridge_version: '1.1.0', account_attestation: { status: 'verified', environment: 'paper', execution_ready: true }, components: [{ component_id: 'IBKRNewSpool', component_type: 'durable_spool', status: 'online', depth: 0 }] } });
const pending = service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-4', sequence: 4, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'MSFT', security_type: 'STK', quantity: 1, bid: 99.9, ask: 100, last: 100, limit_price: 100, average_daily_volume: 5000000, quote_at: new Date().toISOString(), planned_loss_usd: 5, protection: { stop_price: 95, targets: [{ limit_price: 112, quantity: 1 }] } } });
assert.equal(pending.reaction.decision, 'pending_approval'); assert.equal(service.claimCommands(approvalBridge, 10, 2).length, 0);
assert.equal(getDb().prepare(`SELECT decision FROM ibkrnew_event_reactions WHERE event_id=?`).get(pending.event_id).decision, 'pending_approval');
const firstTimelinePage = service.getIbkrNewEventTimeline(approvalOwner, { page: 1, pageSize: 5 });
assert.equal(firstTimelinePage.pagination.page_size, 5); assert.equal(firstTimelinePage.items.length, 4); assert.equal(firstTimelinePage.items[0].description.length > 20, true);
const signalTimelineItem = firstTimelinePage.items.find((item) => item.event_id === pending.event_id);
assert.equal(signalTimelineItem.agent_name, 'IBKRNewStrategyPlanner'); assert.equal(signalTimelineItem.decision, 'pending_approval'); assert.equal(signalTimelineItem.authorization_status, 'pending_approval');
const signalDetailBeforeApproval = service.getIbkrNewEventDetail(approvalOwner, pending.event_id);
assert.equal(signalDetailBeforeApproval.lifecycle.length, 6); assert.equal(signalDetailBeforeApproval.lifecycle.find((stage) => stage.agent_name === 'IBKRNewExecutionOperator').status, 'waiting_approval');
assert.equal(service.getIbkrNewLiveOperations(approvalOwner).agent_activity.find((item) => item.agent_name === 'IBKRNewExecutionOperator').status, 'waiting_approval');
assert.throws(() => service.getIbkrNewEventDetail(other, pending.event_id), /not found/);
assert.throws(() => service.approveAuthorization(other, pending.reaction.authorization_id), /not found/);
assert.ok(service.approveAuthorization(approvalOwner, pending.reaction.authorization_id).command_id.startsWith('IBKRNewCommand'));
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-5', sequence: 5, event_type: 'execution.fill', occurred_at: new Date().toISOString(), payload: { authorization_id: pending.reaction.authorization_id, execution_id: 'exec-approval-1', order_role: 'entry', side: 'BUY', quantity: 1, price: 100 } });
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-6', sequence: 6, event_type: 'commission.report', occurred_at: new Date().toISOString(), payload: { authorization_id: pending.reaction.authorization_id, execution_id: 'exec-approval-1', commission_usd: 1.25 } });
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-7', sequence: 7, event_type: 'order.status_changed', occurred_at: new Date().toISOString(), payload: { authorization_id: pending.reaction.authorization_id, order_role: 'entry', status: 'Filled', filled: 1, remaining: 0 } });
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-8', sequence: 8, event_type: 'position.changed', occurred_at: new Date().toISOString(), payload: { positions: [{ symbol: 'MSFT', security_type: 'STK', quantity: 1, market_price: 101 }] } });
const transferredReservation = getDb().prepare(`SELECT gross_reserved_usd,gross_released_usd FROM ibkrnew_budget_reservations WHERE authorization_id=?`).get(pending.reaction.authorization_id);
assert.equal(transferredReservation.gross_released_usd, transferredReservation.gross_reserved_usd, 'broker position replaces pending gross reservation without double counting');
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-9', sequence: 9, event_type: 'desktop.component_error', occurred_at: new Date().toISOString(), payload: { component_id: 'IBKRNewGateway', component_type: 'ibkr_gateway', accountNumber: privacySentinel, code: 'TEST_DISCONNECT', message: `test gateway ${privacySentinel} disconnect`, detail: [{ acct_no: privacySentinel }] } });
const approvalTimelinePageOne = service.getIbkrNewEventTimeline(approvalOwner, { page: 1, pageSize: 5 });
const approvalTimelinePageTwo = service.getIbkrNewEventTimeline(approvalOwner, { page: 2, pageSize: 5 });
assert.equal(approvalTimelinePageOne.pagination.total_items, 9); assert.equal(approvalTimelinePageOne.items.length, 5); assert.equal(approvalTimelinePageTwo.items.length, 4);
assert.equal(new Set([...approvalTimelinePageOne.items, ...approvalTimelinePageTwo.items].map((item) => item.event_id)).size, 9, 'server pages do not repeat timeline events');
const filteredTimeline = service.getIbkrNewEventTimeline(approvalOwner, { eventType: 'execution.fill', status: 'accepted' });
assert.equal(filteredTimeline.pagination.total_items, 1); assert.equal(filteredTimeline.items[0].event_type, 'execution.fill');
const refreshedAccount = { eligible_capital_usd: 10000, cash_usd: 9900, positions: [{ symbol: 'MSFT', security_type: 'STK', quantity: 1, average_cost: 100, market_price: 101 }], open_orders: [] };
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-10', sequence: 10, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: refreshedAccount });
const snapshotsAfterMaterialChange = Number(getDb().prepare(`SELECT COUNT(*) count FROM ibkrnew_position_snapshots WHERE owner_user_id=? AND snapshot_type='account'`).get(approvalOwner).count);
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-11', sequence: 11, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { ...refreshedAccount, unrealized_pnl_usd: 1.5, positions: [{ ...refreshedAccount.positions[0], market_price: 101.5 }] } });
assert.equal(Number(getDb().prepare(`SELECT COUNT(*) count FROM ibkrnew_position_snapshots WHERE owner_user_id=? AND snapshot_type='account'`).get(approvalOwner).count), snapshotsAfterMaterialChange, 'frequent valuation-only account refreshes do not create redundant history snapshots');
const summary = service.getIbkrNewSummary(approvalOwner);
assert.equal(summary.totals.trade_count, 1);
assert.equal(summary.totals.actual_commission_usd, 1.25);
assert.equal(summary.trades[0].status, 'open');
assert.equal(summary.trades[0].gross_pnl_usd, 0, 'an open position must not report its entry notional as a realized loss');
assert.equal(summary.trades[0].net_pnl_usd, -1.25, 'open net P&L reflects incurred commission until realized P&L arrives');
assert.ok(summary.trades[0].required_profitable_exit_price > 100);
const live = service.getIbkrNewLiveOperations(approvalOwner);
assert.equal(live.dashboard.events.length, 0, 'Live Operations loads the event timeline through its paginated endpoint');
assert.equal(live.agent_activity.length, 6); assert.deepEqual(new Set(live.agent_activity.map((item) => item.agent_name)), new Set(workflowBlueprints.map((workflow) => workflow.agent_name)));
assert.equal(live.agent_activity.find((item) => item.agent_name === 'IBKRNewTradingSupervisor').status, 'monitoring', 'normal bridge heartbeats show active supervision');
assert.ok(live.health.some((component) => component.component_id === 'IBKRNewSpool'));
assert.ok(live.errors.some((error) => error.error_code === 'TEST_DISCONNECT'));
assert.match(live.errors.find((error) => error.error_code === 'TEST_DISCONNECT').message, /REDACTED_IBKR_ACCOUNT/);
assert.ok(live.snapshots.some((snapshot) => snapshot.snapshot_type === 'positions'));
assert.equal(live.executions[0].commission_usd, 1.25);
assert.ok(live.instrument_profiles.some((profile) => profile.symbol === 'MSFT'));
assert.equal(service.getIbkrNewSummary(other).totals.trade_count, 0, 'reports remain owner scoped');
assert.equal(service.getIbkrNewEventTimeline(other).pagination.total_items, 0, 'event timeline remains owner scoped');

const goalOwner = 'IBKRNewOwner_GoalLifecycle'; const goalCredentials = service.registerBridge(goalOwner); const goalBridge = service.authenticateBridge(goalCredentials.bridge_id, goalCredentials.token);
service.ingestBridgeEvent(goalBridge, { event_id: 'goal-1', sequence: 1, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
service.ingestBridgeEvent(goalBridge, { event_id: 'goal-2', sequence: 2, event_type: 'instrument.profile_refreshed', occurred_at: new Date().toISOString(), payload: healthyStockProfile('AAPL') });
service.ingestBridgeEvent(goalBridge, { event_id: 'goal-3', sequence: 3, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: true, account_attestation: { status: 'verified', environment: 'paper', execution_ready: true } } });
const goalSignal = (eventId, sequence) => service.ingestBridgeEvent(goalBridge, { event_id: eventId, sequence, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'AAPL', security_type: 'STK', quantity: 1, bid: 99.9, ask: 100, last: 100, limit_price: 100, average_daily_volume: 5000000, quote_at: new Date().toISOString(), planned_loss_usd: 5, protection: { stop_price: 95, targets: [{ limit_price: 112, quantity: 1 }] } } });
const goalTrade = goalSignal('goal-4', 4); assert.equal(goalTrade.reaction.decision, 'authorized');
assert.ok(getDb().prepare(`SELECT 1 FROM ibkrnew_goal_trade_links WHERE authorization_id=?`).get(goalTrade.reaction.authorization_id));
service.ingestBridgeEvent(goalBridge, { event_id: 'goal-5', sequence: 5, event_type: 'execution.fill', occurred_at: new Date().toISOString(), payload: { authorization_id: goalTrade.reaction.authorization_id, execution_id: 'goal-entry', order_role: 'entry', side: 'BUY', quantity: 1, price: 100 } });
service.ingestBridgeEvent(goalBridge, { event_id: 'goal-6', sequence: 6, event_type: 'commission.report', occurred_at: new Date().toISOString(), payload: { authorization_id: goalTrade.reaction.authorization_id, execution_id: 'goal-entry', commission_usd: 1 } });
service.ingestBridgeEvent(goalBridge, { event_id: 'goal-7', sequence: 7, event_type: 'execution.fill', occurred_at: new Date().toISOString(), payload: { authorization_id: goalTrade.reaction.authorization_id, execution_id: 'goal-exit', order_role: 'exit', side: 'SELL', quantity: 1, price: 700 } });
service.ingestBridgeEvent(goalBridge, { event_id: 'goal-8', sequence: 8, event_type: 'commission.report', occurred_at: new Date().toISOString(), payload: { authorization_id: goalTrade.reaction.authorization_id, execution_id: 'goal-exit', commission_usd: 1, realized_pnl_usd: 600 } });
const achievedGoal = service.getIbkrNewGoalState(goalOwner); assert.equal(achievedGoal.cycle.status, 'ACHIEVED'); assert.equal(achievedGoal.opening_trades_allowed, false); assert.ok(achievedGoal.cycle.net_realized_profit_usd >= 500);
assert.equal(goalSignal('goal-9', 9).reaction.reason, 'goal_target_achieved');
assert.equal(service.ingestBridgeEvent(goalBridge, { event_id: 'goal-10', sequence: 10, event_type: 'position.changed', occurred_at: new Date().toISOString(), payload: { positions: [] } }).accepted, true, 'goal completion never blocks position/risk-reducing events');
getDb().prepare(`UPDATE ibkrnew_goal_cycles SET scheduled_end_at=? WHERE cycle_id=?`).run(new Date(Date.now() - 1000).toISOString(), achievedGoal.cycle.cycle_id);
const restartedGoal = service.getIbkrNewGoalState(goalOwner); assert.equal(restartedGoal.cycle.status, 'ACTIVE'); assert.ok(restartedGoal.cycle.cycle_number > achievedGoal.cycle.cycle_number); assert.equal(restartedGoal.opening_trades_allowed, true);
const oneTime = service.setIbkrNewGoal(goalOwner, { name: 'One-time objective', mode: 'ONE_TIME', target_return_pct: 5, duration_days: 1 }); assert.equal(oneTime.definition.mode, 'ONE_TIME');
getDb().prepare(`UPDATE ibkrnew_goal_cycles SET scheduled_end_at=? WHERE cycle_id=?`).run(new Date(Date.now() - 1000).toISOString(), oneTime.cycle.cycle_id);
const expiredOneTime = service.getIbkrNewGoalState(goalOwner); assert.equal(expiredOneTime.definition.status, 'COMPLETED'); assert.equal(expiredOneTime.block_reason, 'goal_completed');
const pausedReplacement = service.setIbkrNewGoal(goalOwner, { name: 'Paused perpetual', mode: 'PERPETUAL', target_return_pct: 4, duration_days: 30 }); assert.equal(pausedReplacement.opening_trades_allowed, true);
assert.equal(service.pauseIbkrNewGoal(goalOwner).block_reason, 'goal_paused'); assert.equal(service.resumeIbkrNewGoal(goalOwner).opening_trades_allowed, true);
assert.equal(getDb().prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'ibkr\\_%' ESCAPE '\\'").get().count, legacyTableCountBefore, 'must not create or alter the legacy IBKR table set');

// Simulate an upgrade from the old contract, including an unsigned-safe pending command.
const legacyAccount = 'DU7654321';
for (const { name } of getDb().prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'ibkrnew_%'`).all()) getDb().exec(`DROP TRIGGER ${name}`);
getDb().prepare(`UPDATE ibkrnew_bridges SET account_id=? WHERE bridge_id=?`).run(legacyAccount, approvalBridge.bridge_id);
for (const table of ['ibkrnew_events', 'ibkrnew_account_state', 'ibkrnew_authorizations', 'ibkrnew_command_outbox', 'ibkrnew_position_snapshots', 'ibkrnew_trade_records', 'ibkrnew_executions']) getDb().prepare(`UPDATE ${table} SET account_id=? WHERE bridge_id=?`).run(legacyAccount, approvalBridge.bridge_id);
getDb().prepare(`UPDATE ibkrnew_budget_reservations SET account_id=? WHERE authorization_id IN (SELECT authorization_id FROM ibkrnew_authorizations WHERE bridge_id=?)`).run(legacyAccount, approvalBridge.bridge_id);
getDb().prepare(`UPDATE ibkrnew_component_errors SET message=?,detail_json=? WHERE bridge_id=?`).run(`legacy ${legacyAccount}`, JSON.stringify({ acctNumber: legacyAccount }), approvalBridge.bridge_id);
getDb().prepare(`UPDATE ibkrnew_command_outbox SET status='pending',command_json=? WHERE bridge_id=?`).run(JSON.stringify({ authorization: { account_id: legacyAccount } }), approvalBridge.bridge_id);
const legacyCommandId = getDb().prepare(`SELECT command_id FROM ibkrnew_command_outbox WHERE bridge_id=?`).get(approvalBridge.bridge_id).command_id;
service.ensureIbkrNewEventTraderSchema(getDb());
assert.equal(getDb().prepare(`SELECT status FROM ibkrnew_command_outbox WHERE bridge_id=?`).get(approvalBridge.bridge_id).status, 'cancelled');
assert.match(getDb().prepare(`SELECT account_id FROM ibkrnew_bridges WHERE bridge_id=?`).get(approvalBridge.bridge_id).account_id, /^IBKRNewAccount_/);
assert.equal(service.authenticateBridge(approvalCredentials.bridge_id, approvalCredentials.token), null, 'legacy bridge credentials are revoked at the account-reference cutover');
const migratedBridge = getDb().prepare(`SELECT * FROM ibkrnew_bridges WHERE bridge_id=?`).get(approvalBridge.bridge_id);
assert.throws(() => service.acknowledgeCommand(migratedBridge, legacyCommandId, 'submitted'), /prior account-reference epoch/);
assert.equal(getDb().prepare(`SELECT status FROM ibkrnew_command_outbox WHERE command_id=?`).get(legacyCommandId).status, 'cancelled', 'a stale acknowledgement must not resurrect a migrated command');
assert.deepEqual(service.migrateIbkrNewAccountPrivacy(getDb(), { force: true }), { migrated_bridge_count: 0, storage_rebuilt: false }, 'migration is idempotent');
assert.throws(() => getDb().prepare(`INSERT INTO ibkrnew_bridges(bridge_id,owner_user_id,account_id,environment,token_hash,status,created_at) VALUES(?,?,?,?,?,'offline',?)`).run('IBKRNewBridge_old_writer', owner, 'DU5555555', 'paper', 'old-token-hash', new Date().toISOString()), /opaque account reference/, 'schema gate blocks mixed-version writers after the migration marker');

for (const { name: table } of getDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ibkrnew_%'`).all()) {
  const textColumns = getDb().prepare(`PRAGMA table_info(${table})`).all().filter((column) => /TEXT/i.test(column.type)).map((column) => column.name);
  if (!textColumns.length) continue;
  for (const row of getDb().prepare(`SELECT ${textColumns.join(',')} FROM ${table}`).all()) {
    const serialized = JSON.stringify(row);
    assert.doesNotMatch(serialized, /\b(?:DU|U)[- ]?\d{5,12}\b/i, `${table} must not persist IBKR account identifiers`);
  }
}
getDb().pragma('wal_checkpoint(TRUNCATE)');
for (const suffix of ['', '-wal']) {
  const path = join(process.env.AGENT_OS_DATA_DIR, `agent-os.db${suffix}`);
  if (existsSync(path)) assert.equal(readFileSync(path).includes(Buffer.from(legacyAccount)), false, `${suffix || ' database'} bytes must not retain the legacy account identifier`);
}
console.log('IBKRNew event trader service tests passed');
